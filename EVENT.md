# EVENT: pi `@` 自动补全启动后延迟

## 状态

- 状态：已定位，未修复（按要求先不改代码）。
- 发生位置：启动 `pi agent` 或在交互界面执行 `/new` 新 session 后。
- 表现：刚进入新 session 时输入 `@` 像普通字符一样；约十几秒后 `@` 文件补全才恢复。

## 结论

主要原因不是 `@` 补全本身，也不是 `fd` 慢，而是 `pi-rewind` 在 `session_start` 后启动的后台清理任务会扫描 synthetic workspace，并对已有 checkpoint refs 大量启动 `git` 子进程，短时间内占用 Node 事件循环/子进程回调处理。此时编辑器补全请求虽然已经触发，但 `fd` 子进程的输出/关闭事件不能及时被处理，所以补全列表迟迟不显示。

另一个放大因素是 pi 交互 UI 会先启动，随后才完成 session 扩展绑定和补全 provider 设置。因此在极早期输入的 `@` 可能确实还没有任何 autocomplete provider；但复现到的 15 秒量级延迟，核心瓶颈来自 `pi-rewind` 的 checkpoint 扫描。

## 证据

### 1. `fd` 本身很快

在当前目录直接跑 pi 使用的文件补全命令，约 50-60ms：

```bash
fd --base-directory /Users/lang/.pi/agent/extensions \
  --max-results 100 --type f --type d --follow --hidden \
  --exclude .git --exclude '.git/*' --exclude '.git/**'
```

实测：

- `real 0m0.063s`
- 输出约 98/99 条。

### 2. 无扩展时补全正常

只加载临时 autocomplete 探针，不加载其它扩展：

- `fdProbe=59ms`
- `CombinedAutocompleteProvider.getSuggestions=50ms`
- `@` 补全立刻出现。

### 3. 只加载 `pi-rewind` 就复现

只加载 `pi-rewind` 加探针时：

- `fdProbe=5615ms`
- `CombinedAutocompleteProvider` 在等待 `fd` 结果前就被阻塞。

加载 `pi-glance + pi-rewind` 时：

- `fdProbe=7661ms`

其它单独扩展（`pi-glance`、`pi-sandbox`、`plan-mode`、`pretty-image-paste`、`sudo-auth`、`pi-web-access`）未复现同等级延迟。

### 4. 完整环境中可复现十几秒延迟

真实启动后反复输入 `@`/退格，探针记录：

- 多个被取消的 `getSuggestions` 每个约 2.5s 后返回 0 项。
- 最终成功的 `getSuggestions` 才返回 20 项。
- 第一次看到补全列表约在 18s 左右。

这是因为 TUI editor 的 autocomplete 请求队列会串行等待前一个请求结束；用户反复输入/删除 `@` 会制造多个取消请求，进一步把可见补全推迟。

### 5. `pi-rewind` workspace 扫描本身很慢

直接调用 `pi-rewind/core.ts`：

- `listSyntheticWorkspaces()`：约 15942ms。
- 当前 synthetic workspace 中 `/Users/lang/.pi/agent/extensions` 有 119 个 checkpoint refs。
- 对这个 workspace 调用 `loadAllCheckpoints(...)`：约 14559ms。

## 具体代码链路

### pi 侧

- `InteractiveMode.init()` 先 `this.ui.start()`，随后 `await this.rebindCurrentSession()`。
- `rebindCurrentSession()` 内部调用 `bindCurrentSessionExtensions()`。
- `bindCurrentSessionExtensions()` 里会 `await this.session.bindExtensions(...)`，完成后才 `this.setupAutocompleteProvider()`。
- `AgentSession.bindExtensions()` 会 `await this._extensionRunner.emit(session_start)`，然后再处理 `resources_discover`。

因此：

1. UI 可以先显示并接收输入。
2. 补全 provider 要等 session 扩展绑定后才设置。
3. 如果 session_start 或其触发的后台任务让事件循环繁忙，补全请求会表现为“没有自动补全”。

### pi-rewind 侧

文件：`pi-rewind/index.ts`

`initSession(ctx)` 末尾会触发：

```ts
cleanupMissingSyntheticWorkspaces().catch(() => {});
```

这个调用未 await，但仍在同一个 Node 进程内执行，会继续占用事件循环。

文件：`pi-rewind/core.ts`

`cleanupMissingSyntheticWorkspaces()` 调用 `listSyntheticWorkspaces()`。

`listSyntheticWorkspaces()` 对每个 workspace 调用 `readSyntheticWorkspace(...)`。

`readSyntheticWorkspace(...)` 当前会做两件偏重的事：

1. 同步递归计算目录大小：

```ts
const sizeBytes = directorySizeBytes(storageDir);
```

2. 为了得到 `checkpointCount`，加载并解析所有 checkpoints：

```ts
checkpointCount = (await loadAllCheckpoints(gitRoot, undefined, metadata.gitDir)).length;
```

`loadAllCheckpoints(...)` 又是：

```ts
const refs = await listCheckpointRefs(root, gitDir);
const results = await Promise.all(refs.map((r) => loadCheckpointFromRef(root, r, gitDir)));
```

而 `loadCheckpointFromRef(...)` 对每个 ref 至少执行：

- `git rev-parse --verify ...`
- `git cat-file commit ...`

当前 `/Users/lang/.pi/agent/extensions` synthetic workspace 有 119 个 refs，因此启动时会产生约 238 个 git 子进程。这个“git 子进程风暴”足以让 `fd` 的结果处理和 autocomplete UI 更新延后数秒到十几秒。

## 为什么 `/new` 也会复现

`/new` 会创建新的 `AgentSessionRuntime`，并重新走：

1. teardown old session
2. create new runtime/services
3. bind extensions
4. emit `session_start`
5. rebind interactive UI/autocomplete

因此 `pi-rewind` 的 `session_start` 初始化和 synthetic workspace cleanup 会再次触发，导致新 session 启动后 `@` 补全再次进入延迟窗口。

## 修复方案

### 方案 A：修 pi-rewind startup cleanup（推荐）

目标：启动和 `/new` 时不解析所有 checkpoint 内容，不制造大量 git 子进程。

1. 将 `readSyntheticWorkspace()` 拆成轻量/重量两种路径。
   - 轻量路径用于 `cleanupMissingSyntheticWorkspaces()`：只读 `metadata.json`、判断 `worktreeExists`、计算 `lastUsedAtMs`。
   - 不计算 `checkpointCount`。
   - 不调用 `loadAllCheckpoints()`。

2. `cleanupMissingSyntheticWorkspaces()` 只在真正要删除 workspace 时再计算 `directorySizeBytes()`。
   - 当前对所有 workspace 都同步递归算 size，没有必要。
   - 对现存 workspace 只需跳过，不需要 size。

3. 如果确实需要 checkpoint count，用 `listCheckpointRefs(...).length`，不要 `loadAllCheckpoints(...).length`。
   - `listCheckpointRefs` 只需要一次 `git for-each-ref`。
   - 不需要 `rev-parse` 和 `cat-file` 逐 ref 解析。

4. 将 `loadAllCheckpoints()` 从 `Promise.all(refs.map(loadCheckpointFromRef))` 改成批量读取。
   - 复用现有 `loadCheckpointPage()` 的思路：一次 `git for-each-ref --format=%(refname)%00%(contents)%00 ...` 拉回 ref 和 commit message。
   - 这样可从 `2*N` 个 git 子进程降到 1 个 git 子进程。

5. 给启动 cleanup 加节流/延后。
   - 例如 session 启动后延迟 30s 或等 agent idle 后再清理。
   - 或只在 `/rewind:clean:*` 命令中做全量清理。

### 方案 B：pi core 侧增强鲁棒性（辅助，不是根因）

1. 在 UI 启动前或更早设置基础 autocomplete provider。
   - 这样即使扩展还在绑定，内置 `@` 文件补全也可先工作。

2. 改 TUI editor 的 autocomplete request queue。
   - 当前 `startAutocompleteRequest()` 会等待 `previousTask`。
   - 对已 abort 的旧请求可以不再串行等待，避免用户反复输入/删除 `@` 时积压。

这些能改善体验，但即使做了，也建议修 `pi-rewind`，否则启动后仍会有其它 UI/子进程事件被拖慢。

## 临时缓解方案

不改代码的前提下，可选：

1. 临时禁用 `pi-rewind` 扩展。
   - 例如通过 `pi config` 禁用，或启动时用 `--no-extensions` 再显式加载需要的扩展。

2. 清理/减少 `pi-rewind` checkpoint refs。
   - 当前高延迟主要来自 `/Users/lang/.pi/agent/extensions` synthetic workspace 的 119 个 refs。
   - 减少 refs 后，`loadAllCheckpoints()` 的子进程数量会下降，延迟会变短。

3. 避免在新 session 刚启动时反复输入/删除 `@`。
   - 反复触发会让 autocomplete request queue 排队，扩大延迟。

## 建议验证标准

修复后应满足：

1. `pi-rewind` 单独加载时，启动后第一次 `@` 补全应在 <200ms 内返回。
2. `cleanupMissingSyntheticWorkspaces()` 在 100+ checkpoint refs 的 synthetic workspace 下不应解析所有 checkpoint。
3. `listSyntheticWorkspaces()` 不应随 checkpoint refs 数量线性变慢到秒级。
4. `/new` 后立即输入 `@`，补全应快速出现，不再等待十几秒。

## 需要补的测试

1. `pi-rewind/core` 单元测试：
   - 构造一个 synthetic workspace，写入 100+ checkpoint refs。
   - 调用 `cleanupMissingSyntheticWorkspaces()`。
   - 断言不会调用 `loadCheckpointFromRef()` / 不会按 ref 数量启动大量 git 子进程。

2. `listSyntheticWorkspaces()` 性能/行为测试：
   - 只需要展示 metadata 和 count 时，最多一次 `for-each-ref`。
   - 清理缺失 workspace 时，只对待删除项计算 size。

3. 手工回归：
   - `pi --verbose` 启动后输入 `@`。
   - `/new` 后输入 `@`。
   - 与 `--no-extensions -e ./pi-rewind` 场景单独验证。
