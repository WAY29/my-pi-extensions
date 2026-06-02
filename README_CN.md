# Pi 扩展

[English](README.md) | 简体中文

用于 [pi](https://pi.dev) 的个人扩展集合。这些扩展适合放在 `~/.pi/agent/extensions/` 下，也可以从本仓库作为 pi package 安装。

> 安全提示：pi 扩展会以本地 pi 进程的相同权限运行。安装或分享给他人之前，请先审查代码。

## 安装

推荐从 GitHub 安装：

```bash
pi install git:github.com/WAY29/my-pi-extensions
```

也支持原始 GitHub URL：

```bash
pi install https://github.com/WAY29/my-pi-extensions
```

然后重启 pi，或在现有 pi 会话中运行 `/reload`。

也支持安装到项目本地：

```bash
pi install git:github.com/WAY29/my-pi-extensions -l
```

如果你不想使用 `pi install`，也可以手动复制：

```bash
mkdir -p ~/.pi/agent/extensions
git clone https://github.com/WAY29/my-pi-extensions /tmp/pi-extensions
find /tmp/pi-extensions -mindepth 1 -maxdepth 1 ! -name .git -exec cp -R {} ~/.pi/agent/extensions/ \;
```

这会复制源仓库 `.git/` 目录以外的所有顶层内容。它仍会复制有用的点文件，例如 `.gitignore`。

如需临时测试单个扩展：

```bash
pi -e ~/.pi/agent/extensions/<extension-file-or-directory>
```

## 扩展

| 扩展 | 类型 | 主要命令 / 工具 / 钩子 | 用途 |
|---|---|---|---|
| `AskUserQuestion.ts` | 工具 | `AskUserQuestion` | 为 agent 添加交互式提问工具。支持单问题或多问题流程、选项列表、自定义文本回答和每个选项的备注。 |
| `bash-grep-output-mode.ts` | UI/工具渲染器 | `/bash-grep-output`, `Ctrl+Shift+O`, `Alt+O` | 在 `hidden`、`compact` 和 `full` 之间切换 `bash` 与 `grep` 输出渲染模式，同时不改变模型接收到的内容。bash 部分通过 `bash-tool-coordinator.ts` 协作。 |
| `bash-tool-coordinator.ts` | 辅助模块 | 自动 | 为需要包装 `bash` 工具的扩展提供共享组合层。它本身刻意不提供可见 UI。 |
| `code-block-enhancer.ts` | UI patch + 命令/快捷键 | 自动、`/copy-code`, `Ctrl+Alt+C` | 合并原代码 fence 隐藏和复制代码扩展。将 fenced code block 渲染为带边框和编号的区块，并支持按编号、全部复制或保留 markdown fence 复制最近的 assistant 代码块。 |
| `effort.ts` | 命令 | `/effort` | 快速切换或循环 pi 的思考级别：`off`、`minimal`、`low`、`medium`、`high`、`xhigh`。 |
| `hide-read-output.ts` | UI/工具渲染器 | 自动 | 在 TUI 中隐藏所有内置 `read` 工具的结果输出，同时仍将文件内容返回给模型。连续读取会合并为简洁摘要。 |
| `image-gen.ts` | 图片工具 | `image_gen` | 为 pi 增加一个 OpenAI 兼容的位图图片生成/编辑工具。支持纯 prompt 生成、工作区路径图片编辑、最近附图回退，以及当当前 relay 无法提供原生透明图时通过本地 chroma-key 抠图得到透明输出。 |
| `keydump.ts` | 命令/调试 UI | `/keydump` | 显示 pi 收到的原始按键序列，适合调试终端快捷键。 |
| `permission-gate.ts` | 安全门禁 | 自动、`/glance` 开关 | 对 `rm`、`chmod/chown ... 777` 等潜在危险 bash 命令执行前提示确认。无 UI 可用时默认阻止。可通过扩展事件总线在 pi-glance 中启用或禁用。 |
| `pretty-image-paste.ts` | 输入/图片辅助 | 自动 | 将粘贴进编辑器的 pi 剪贴板图片路径替换为易读的 `[Image #n]` 标签，并在提交时附加对应图片。 |
| `progress-checkpoints.ts` | 提示词辅助 | `/progress`, `/progress-checkpoints` | 注入进度检查点策略，让 assistant 在多步骤或大量工具调用任务中给出简短状态更新。 |
| `retry-stream-read-error.ts` | 重试 patch | 自动 | 通过 patch pi 的重试分类逻辑，把 `stream_read_error` assistant 失败视为可重试；当前 pi 版本不支持时会给出警告。 |
| `stable-scroll.ts` | UI patch | 自动 | 过滤正常重绘时的终端清空 scrollback 序列，避免 TUI 刷新抹掉滚动历史，同时保留会话启动时的清屏。 |
| `sudo-auth.ts` | sudo 辅助 | 自动 | 为 bash 命令中的 `sudo` 提供 TUI askpass 桥接。密码只缓存在扩展内存中，并会在认证失败或会话结束时清除。 |
| `notify-hook.ts` | 集成钩子 | 自动 | 面向外部平台的通用通知桥接层，用于转发 pi 生命周期事件和临时“等待用户介入”状态。当前内置的是 Superset adapter（调用 Superset 的 `notify.sh`），但核心扩展本身不与 Superset 绑定，后续可继续增加其它通知后端。 |
| `notify-hook/attention.ts` | 辅助模块 | 自动 | 为 `notify-hook.ts`、`permission-gate.ts`、`pi-sandbox/` 等扩展共享临时“等待用户介入”信号的 helper，避免重复实现事件名和 start/end 计数逻辑。 |
| `working-status.ts` | 工作状态/UI 状态 | 自动 | 将 pi 流式阶段的 `Working...` 替换为带动作感知和实时耗时的文案。模型继续输出时会保持显示最近一次工具动作，并在 `agent_end` 后保留一条浅灰色 `Finished working in ...` 状态，直到下一次运行。 |
| `startup-info.ts` | 启动信息聚合器 | 自动 | 聚合多个扩展协作发出的启动期 `info` 提示，并合并为一条启动消息，避免 `pi-sandbox/` 状态与 `pi-glance/` AutoModel 切换之类的信息互相覆盖。 |
| `pi-glance/` | UI/输入界面 | `/glance` | 用圆角多行编辑器和内联状态概览替换默认输入区，展示模型、上下文、tokens、费用、Git、标题和计划状态。它的设置面板也可以配置工作区自动模型规则，包括 `model[:thinking]` 形式的 AutoModel 规则，并在相关扩展已安装时切换 `permission-gate.ts` / `pi-sandbox/`。 |
| `pi-rewind/` | 检查点/恢复 | `/rewind`, `Esc Esc` | 在产生文件改动的回合后创建检查点，并在 agent 改错时回退文件和/或会话状态。有 Git 仓库时使用仓库 Git 数据；非 Git 目录会使用 pi-rewind 管理的外部 Git 存储。 |
| `pi-sandbox/` | 安全/沙箱 | `/sandbox`, `/sandbox-enable`, `/sandbox-disable`, `--no-sandbox`, `/glance` 开关 | 增加 OS 级 bash 沙箱，以及针对直接工具的文件系统/网络权限提示。消费 `plan-mode/` 请求的只读锁，通过 `bash-tool-coordinator.ts` 包装 bash，并向 pi-glance 暴露事件总线状态/切换钩子。 |
| `plan-mode/` | 计划工作流 | `/plan`, `/plan-todos`, `/plan-execute-clear-context`, `Shift+Tab`, `--plan`, `plan_complete_step` | 用于安全规划的只读探索模式，以及带 1-10 个编号步骤、即时 `plan_complete_step` 进度、3 步可见 todo 窗口、可选清上下文执行和 `[DONE:n]` 兜底恢复的执行模式。向 `pi-glance/` 广播状态，并与 `pi-sandbox/` 集成。 |
| `review/` | 评审工作流 | `/review` | 启动一个隔离的 Codex 风格代码评审会话，支持预设目标选择、主线程实时工具/assistant 渲染、可恢复的中断评审，以及一键解决全部或选定 findings 的后续动作。 |
| `any-access/` | Web 访问/搜索 | `web_search`, `code_search`, `fetch_content`, `get_search_content` | 聚焦版 Tinyfish/Exa Web 搜索与内容访问扩展，支持 GitHub 感知抓取、`includeContent` 后台补抓，以及轻量 TUI 活动显示。 |

## 扩展之间的关系

### Bash 工具组合：`bash-tool-coordinator.ts`

pi 只有一个名为 `bash` 的活动工具。如果多个扩展各自独立替换这个工具，最后注册的替换会覆盖之前的行为。`bash-tool-coordinator.ts` 通过把多个插件组合成一个 bash 工具，避免这些扩展互相踩掉。

- `pi-sandbox/` 注册一个高优先级的 bash operations 包装器。沙箱启用并初始化后，bash 命令会走沙箱后端；否则回退到下一个 bash 实现。
- `sudo-auth.ts` 注册一个较低优先级的 bash operations 包装器，在沙箱 bash 未接管时注入 sudo askpass 环境。
- `bash-grep-output-mode.ts` 注册一个 bash 结果渲染包装器。它可以隐藏、压缩或完整展开 bash 输出，同时保留底层的沙箱行为。
- `bash-grep-output-mode.ts` 也会直接包装 `grep` 的渲染，因为 `grep` 是另一个独立内置工具，不经过 bash coordinator。
- `bash-tool-coordinator.ts` 必须保持在仓库顶层。它不注册面向用户的命令，但仍需要随仓库一起复制。

### 计划工作流：`plan-mode/` + `pi-sandbox/` + `pi-glance/`

这三个扩展会协作，但职责不同：

1. `plan-mode/` 负责计划状态。它注册 `/plan`、`/plan-todos`、`/plan-execute-clear-context`、`Shift+Tab` 和 `--plan`，跟踪 todo 项，发出 `plan-mode:state`，并响应 `plan-mode:request-state`。
2. `pi-glance/` 只负责展示计划状态。它监听 `plan-mode:state` 事件，并在 plan mode 激活或执行时在输入界面显示 Plan segment。它不负责强制只读。
3. `plan-mode/` 会通过发出 owner 为 `plan-mode` 的 `pi-sandbox:set-read-only-lock` 事件，请求 `pi-sandbox/` 执行只读规划。
4. 当 `pi-sandbox/` 可用时，plan mode 会保持当前活动工具集合不变，但由沙箱策略拒绝当前工作目录下的写入。
5. 当 `pi-sandbox/` 不可用时，plan mode 会降级到较小的只读工具集合（`read`、`bash`、`grep`、`find`、`ls`、`AskUserQuestion`）以及内部 bash allowlist。
6. 当开始执行计划时，`plan-mode/` 会解除只读锁并发送执行上下文，让 agent 按编号步骤推进，并在每步完成时调用 `plan_complete_step`。`[DONE:n]` 现在只是工具不可用时的兜底恢复标记。
7. 如果选择清上下文执行，`plan-mode/` 会创建新会话，在其中持久化已批准计划，并只用该计划作为交接上下文启动执行。

### 安全控制：`pi-glance/` + `permission-gate.ts` + `pi-sandbox/`

`pi-glance/` 可以作为两个安全扩展的控制界面，但不接管实际安全执行逻辑：

- `permission-gate.ts` 响应 `permission-gate:request-state` 和 `permission-gate:set-enabled` 事件。`/glance` 通过这些钩子显示并保存它的启用状态。
- `pi-sandbox/` 响应 `pi-sandbox:request-state` 和 `pi-sandbox:set-enabled` 事件。`/glance` 可以为当前会话启用或禁用沙箱，并把偏好保存在 pi-glance 配置中。
- `--no-sandbox` 仍然优先。如果启动 pi 时传入了 `--no-sandbox`，pi-glance 不能强制打开沙箱。
- 如果保存 `/glance` 设置时某个安全扩展不可用，pi-glance 会保留该设置，并在后续会话或 reload 中等扩展响应后应用。
- 执行安全策略的仍然是 `permission-gate.ts` 和 `pi-sandbox/`；pi-glance 只是通过共享事件总线请求状态变更。

### 安全与恢复分层

- `permission-gate.ts` 是基于提示确认的安全网，用于明显危险的 bash 命令。它独立于 `pi-sandbox/`，即使关闭沙箱也有用。
- `pi-sandbox/` 是更强的策略层，负责 OS 级 bash 沙箱以及直接工具的文件系统/网络提示。
- `plan-mode/` 是工作流层，会向 `pi-sandbox/` 请求只读行为；如果没有沙箱，也会优雅降级。
- `pi-rewind/` 是恢复层，不是预防层。agent 改坏文件或会话状态后，用它回退。它可用于 Git 仓库，也可以为普通目录在 `~/.pi/agent/pi-rewind/workspaces/` 下创建 pi-rewind 自己管理的外部 Git 存储。
- `pi-glance/` 和 `progress-checkpoints.ts` 是可见性/控制层，帮助你看到当前状态并请求状态变更；安全执行仍由安全扩展本身负责。

## 常见工作流

### 更安全的规划和执行

搭配使用：

- `pi-sandbox/`：文件系统/网络权限门禁，以及 cwd 范围的只读锁。
- `plan-mode/`：编辑前的只读规划，包括可选的已批准计划清上下文执行。
- `pi-glance/`：在输入界面中显示计划状态，并从同一个设置面板切换 `permission-gate.ts` / `pi-sandbox/`。
- `pi-rewind/`：从错误文件改动中恢复，包括通过外部本地 checkpoint 存储保护非 Git 目录。
- `permission-gate.ts`：为高风险 bash 命令提供简单确认层。

仓库根目录包含 `sandbox.json`，这是 `pi-sandbox/` 在 macOS 下的推荐配置。它会拒绝读取常见密钥目录、拒绝写入看起来像密钥的文件，并允许写入当前工作区以及常见的 macOS/cache 目录。它不是扩展入口；如果你想启用这套策略，需要手动复制：

```bash
cp sandbox.json ~/.pi/agent/sandbox.json
```

在其它机器上使用前请先审查这份策略。

### 更清爽的终端输出

搭配使用：

- `hide-read-output.ts`：隐藏所有内置 `read` 结果输出。
- `bash-grep-output-mode.ts`：控制噪声较多的命令/搜索输出。
- `code-block-enhancer.ts`：让 markdown 代码块更清爽、带编号，并可快速复制生成的代码。

### 按工作区自动切换模型

使用 `/glance` → **Auto model** 添加精确 cwd 匹配规则，在 `session_start` 时自动切换模型。规则可以写成 `provider/model`，也可以只写模型名并复用当前 provider。

### 长时间自主任务

搭配使用：

- `progress-checkpoints.ts`：保持公开进度更新简洁。
- `effort.ts`：无需打开设置即可调整推理级别。

### 图片较多的提示词

粘贴多张截图或剪贴板图片时使用 `pretty-image-paste.ts`。它会在编辑器里显示 `[Image #n]` 标签以保持输入可读，并在提交时重新附加对应图片文件。

## 备注

- 根目录 `package.json` 通过 `pi.extensions` 声明 package 的扩展入口。新增或删除顶层扩展时需要同步更新。
- `bash-tool-coordinator.ts` 是辅助模块，但仍列在 package manifest 中，以便 package 安装方式尽量贴近本地自动发现的扩展目录。
- `notify-hook/attention.ts` 也是辅助模块。它让多个扩展可以共享同一套临时“等待用户介入”信号，而不用重复实现事件名和 start/end 状态维护逻辑。
- `notify-hook/adapters/superset.ts` 存放当前的 Superset 适配器。后续新增其它平台时，建议继续放在 `notify-hook/adapters/` 下，保持顶层扩展本身与具体平台解耦。
- `pi-glance/` 和 `pi-sandbox/` 拥有自己的 `package.json`，也可能可以作为独立 pi 包使用。
- 根目录 `sandbox.json` 是从 `~/.pi/agent/sandbox.json` 复制来的 macOS 推荐 `pi-sandbox/` 策略；它应与属于独立包源码的 `pi-sandbox/sandbox.json` 分开维护。
- `pi-sandbox/dist/` 被有意保留，因为 `pi-sandbox/index.ts` 会重新导出 `./dist/index.js`。
- `pi-glance/.tmp-git-dev/` 等生成的开发目录会被有意忽略。
- 一些文件包含基于现有 MIT 许可 pi 扩展改编代码的署名注释。重新分发时请保留这些声明。

## 许可证

MIT。参见 [LICENSE](LICENSE)。

带有各自许可证或署名声明的子目录或文件应保留这些声明。
