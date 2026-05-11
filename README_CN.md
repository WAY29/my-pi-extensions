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
| `copy-code-block.ts` | 命令/快捷键 | `/copy-code`, `Ctrl+Alt+C` | 从最新的 assistant 消息中复制代码块。支持选择某个代码块、复制全部代码块，并可保留 markdown fence。 |
| `effort.ts` | 命令 | `/effort` | 快速切换或循环 pi 的思考级别：`off`、`minimal`、`low`、`medium`、`high`、`xhigh`。 |
| `hide-code-fence-markers.ts` | UI patch | 自动 | 通过隐藏终端 UI 中额外的代码块 fence 标记行，清理 markdown 代码块渲染效果。 |
| `hide-read-output.ts` | UI/工具渲染器 | 自动 | 在 TUI 中隐藏所有内置 `read` 工具的结果输出，同时仍将文件内容返回给模型。连续读取会合并为简洁摘要。 |
| `keydump.ts` | 命令/调试 UI | `/keydump` | 显示 pi 收到的原始按键序列，适合调试终端快捷键。 |
| `permission-gate.ts` | 安全门禁 | 自动、`/glance` 开关 | 对 `rm`、`sudo`、`chmod/chown ... 777` 等潜在危险 bash 命令执行前提示确认。无 UI 可用时默认阻止。可通过扩展事件总线在 pi-glance 中启用或禁用。 |
| `path-autocomplete-normalizer.ts` | 自动补全 patch | 自动 | 规范化部分文件补全流程产生的重复 `/./` 路径片段。 |
| `pretty-image-paste.ts` | 输入/图片辅助 | 自动 | 将粘贴进编辑器的 pi 剪贴板图片路径替换为易读的 `[Image #n]` 标签，并在提交时附加对应图片。 |
| `progress-checkpoints.ts` | 提示词辅助 | `/progress`, `/progress-checkpoints` | 注入进度检查点策略，让 assistant 在多步骤或大量工具调用任务中给出简短状态更新。 |
| `pi-glance/` | UI/输入界面 | `/glance` | 用圆角多行编辑器和内联状态概览替换默认输入区，展示模型、上下文、tokens、费用、Git、标题和计划状态。它的设置面板也可以在相关扩展已安装时切换 `permission-gate.ts` 和 `pi-sandbox/`。 |
| `pi-goal/` | 目标管理器 | `/goal`, `get_goal`, `update_goal` | 跟踪长期会话目标、可选 token 预算、继续提示、状态栏状态，并通过工具调用验证完成情况。 |
| `pi-rewind/` | 检查点/恢复 | `/rewind`, `Esc Esc` | 在产生文件改动的回合后创建基于 Git 的检查点，并在 agent 改错时回退文件和/或会话状态。 |
| `pi-sandbox/` | 安全/沙箱 | `/sandbox`, `/sandbox-enable`, `/sandbox-disable`, `--no-sandbox`, `/glance` 开关 | 增加 OS 级 bash 沙箱，以及针对直接工具的文件系统/网络权限提示。消费 `plan-mode/` 请求的只读锁，通过 `bash-tool-coordinator.ts` 包装 bash，并向 pi-glance 暴露事件总线状态/切换钩子。 |
| `plan-mode/` | 计划工作流 | `/plan`, `/plan-todos`, `Shift+Tab`, `--plan`, `plan_complete_step` | 用于安全规划的只读探索模式，以及带 1-10 个编号步骤、即时 `plan_complete_step` 进度和 `[DONE:n]` transcript 兜底的执行模式。向 `pi-glance/` 广播状态，并与 `pi-sandbox/` 集成。 |

## 扩展之间的关系

### Bash 工具组合：`bash-tool-coordinator.ts`

pi 只有一个名为 `bash` 的活动工具。如果多个扩展各自独立替换这个工具，最后注册的替换会覆盖之前的行为。`bash-tool-coordinator.ts` 通过把多个插件组合成一个 bash 工具，避免这些扩展互相踩掉。

- `pi-sandbox/` 注册一个高优先级的 bash operations 包装器。沙箱启用并初始化后，bash 命令会走沙箱后端；否则回退到下一个 bash 实现。
- `bash-grep-output-mode.ts` 注册一个 bash 结果渲染包装器。它可以隐藏、压缩或完整展开 bash 输出，同时保留底层的沙箱行为。
- `bash-grep-output-mode.ts` 也会直接包装 `grep` 的渲染，因为 `grep` 是另一个独立内置工具，不经过 bash coordinator。
- `bash-tool-coordinator.ts` 必须保持在仓库顶层。它不注册面向用户的命令，但仍需要随仓库一起复制。

### 计划工作流：`plan-mode/` + `pi-sandbox/` + `pi-glance/`

这三个扩展会协作，但职责不同：

1. `plan-mode/` 负责计划状态。它注册 `/plan`、`/plan-todos`、`Shift+Tab` 和 `--plan`，跟踪 todo 项，发出 `plan-mode:state`，并响应 `plan-mode:request-state`。
2. `pi-glance/` 只负责展示计划状态。它监听 `plan-mode:state` 事件，并在 plan mode 激活或执行时在输入界面显示 Plan segment。它不负责强制只读。
3. `plan-mode/` 会通过发出 owner 为 `plan-mode` 的 `pi-sandbox:set-read-only-lock` 事件，请求 `pi-sandbox/` 执行只读规划。
4. 当 `pi-sandbox/` 可用时，plan mode 会保持当前活动工具集合不变，但由沙箱策略拒绝当前工作目录下的写入。
5. 当 `pi-sandbox/` 不可用时，plan mode 会降级到较小的只读工具集合（`read`、`bash`、`grep`、`find`、`ls`、`AskUserQuestion`）以及内部 bash allowlist。
6. 当开始执行计划时，`plan-mode/` 会解除只读锁并发送执行上下文，让 agent 按编号步骤推进，在每步完成时调用 `plan_complete_step`，并额外留下 `[DONE:n]` 标记以便从 transcript 恢复进度。

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
- `pi-rewind/` 是恢复层，不是预防层。agent 改坏文件或会话状态后，用它回退。
- `pi-glance/` 和 `progress-checkpoints.ts` 是可见性/控制层，帮助你看到当前状态并请求状态变更；安全执行仍由安全扩展本身负责。

## 常见工作流

### 更安全的规划和执行

搭配使用：

- `pi-sandbox/`：文件系统/网络权限门禁，以及 cwd 范围的只读锁。
- `plan-mode/`：编辑前的只读规划。
- `pi-glance/`：在输入界面中显示计划状态，并从同一个设置面板切换 `permission-gate.ts` / `pi-sandbox/`。
- `pi-rewind/`：从错误文件改动中恢复。
- `permission-gate.ts`：为高风险 bash 命令提供简单确认层。

### 更清爽的终端输出

搭配使用：

- `hide-read-output.ts`：隐藏所有内置 `read` 结果输出。
- `bash-grep-output-mode.ts`：控制噪声较多的命令/搜索输出。
- `hide-code-fence-markers.ts`：让 markdown 代码块显示更干净。
- `copy-code-block.ts`：需要快速复制生成代码时使用。

### 长时间自主任务

搭配使用：

- `pi-goal/`：让 agent 聚焦于用户定义的目标。
- `progress-checkpoints.ts`：保持公开进度更新简洁。
- `effort.ts`：无需打开设置即可调整推理级别。

### 图片较多的提示词

粘贴多张截图或剪贴板图片时使用 `pretty-image-paste.ts`。它会在编辑器里显示 `[Image #n]` 标签以保持输入可读，并在提交时重新附加对应图片文件。

## 备注

- 根目录 `package.json` 通过 `pi.extensions` 声明 package 的扩展入口。新增或删除顶层扩展时需要同步更新。
- `bash-tool-coordinator.ts` 是辅助模块，但仍列在 package manifest 中，以便 package 安装方式尽量贴近本地自动发现的扩展目录。
- `pi-glance/` 和 `pi-sandbox/` 拥有自己的 `package.json`，也可能可以作为独立 pi 包使用。
- `pi-sandbox/dist/` 被有意保留，因为 `pi-sandbox/index.ts` 会重新导出 `./dist/index.js`。
- `pi-glance/.tmp-git-dev/` 等生成的开发目录会被有意忽略。
- 一些文件包含基于现有 MIT 许可 pi 扩展改编代码的署名注释。重新分发时请保留这些声明。

## 许可证

MIT。参见 [LICENSE](LICENSE)。

带有各自许可证或署名声明的子目录或文件应保留这些声明。
