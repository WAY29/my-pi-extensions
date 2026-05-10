# Pi 扩展

[English](README.md) | 简体中文

用于 [pi](https://pi.dev) 的个人扩展集合。这些扩展适合放在 `~/.pi/agent/extensions/` 下，并可通过 pi 的常规扩展发现机制和 `/reload` 启用。

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

| 扩展 | 类型 | 主要命令 / 工具 | 用途 |
|---|---:|---|---|
| `AskUserQuestion.ts` | 工具 | `AskUserQuestion` | 为 agent 添加交互式提问工具。支持单问题或多问题流程、选项列表、自定义文本回答和每个选项的备注。 |
| `bash-grep-output-mode.ts` | UI/工具渲染器 | `/bash-grep-output`, `Ctrl+Shift+O`, `Alt+O` | 在 `hidden`、`compact` 和 `full` 之间切换 `bash`/`grep` 输出渲染模式，同时不改变模型接收到的内容。 |
| `codex-apply-patch.ts` | 工具 | `apply_patch` | 添加用于 `create_file`、`update_file` 和 `delete_file` 操作的结构化 patch 工具，使用 V4A 风格 diff，并保留内置 `edit`/`write` 可用。 |
| `copy-code-block.ts` | 命令/快捷键 | `/copy-code`, `Ctrl+Alt+C` | 从最新的 assistant 消息中复制代码块。支持选择某个代码块、复制全部代码块，并可保留 markdown fence。 |
| `effort.ts` | 命令 | `/effort` | 快速切换或循环 pi 的思考级别：`off`、`minimal`、`low`、`medium`、`high`、`xhigh`。 |
| `hide-code-fence-markers.ts` | UI patch | 自动 | 通过隐藏终端 UI 中额外的代码块 fence 标记行，清理 markdown 代码块渲染效果。 |
| `hide-read-output.ts` | UI/工具渲染器 | 自动 | 在 TUI 中隐藏体积较大的 `read` 工具输出，同时仍将文件内容返回给模型。连续读取会合并为简洁摘要。 |
| `permission-gate.ts` | 安全门禁 | 自动 | 对 `rm`、`sudo`、`chmod/chown ... 777` 等潜在危险 bash 命令执行前提示确认。无 UI 可用时默认阻止。 |
| `progress-checkpoints.ts` | 提示词辅助 | `/progress`, `/progress-checkpoints` | 注入进度检查点策略，让 assistant 在多步骤或大量工具调用任务中给出简短状态更新。 |
| `pi-glance/` | UI/输入界面 | `/glance` | 用圆角多行编辑器和内联状态概览替换默认输入区，展示模型、上下文、tokens、费用、Git、标题和计划状态。 |
| `pi-goal/` | 目标管理器 | `/goal`, `get_goal`, `update_goal` | 跟踪长期会话目标、可选 token 预算、继续提示、状态栏状态，并通过工具调用验证完成情况。 |
| `pi-rewind/` | 检查点/恢复 | `/rewind`, `Esc Esc` | 在产生文件改动的回合后创建基于 Git 的检查点，并在 agent 改错时回退文件和/或会话状态。 |
| `pi-sandbox/` | 安全/沙箱 | `/sandbox`, `/sandbox-enable`, `/sandbox-disable`, `--no-sandbox` | 增加 OS 级 bash 沙箱，以及针对直接工具的文件系统/网络权限提示。集成 `plan-mode` 只读锁。 |
| `plan-mode/` | 计划工作流 | `/plan`, `/plan-todos`, `Shift+Tab`, `--plan` | 用于安全规划的只读探索模式，以及带编号计划步骤和 `[DONE:n]` 进度跟踪的执行模式。 |

## 常见工作流

### 更安全的规划和执行

搭配使用：

- `pi-sandbox/`：文件系统/网络权限门禁。
- `plan-mode/`：编辑前的只读规划。
- `pi-glance/`：在输入界面中显示计划状态。
- `pi-rewind/`：从错误文件改动中恢复。

### 更清爽的终端输出

搭配使用：

- `hide-read-output.ts`：折叠大型 read 结果。
- `bash-grep-output-mode.ts`：控制噪声较多的命令/搜索输出。
- `hide-code-fence-markers.ts`：让 markdown 代码块显示更干净。
- `copy-code-block.ts`：需要快速复制生成代码时使用。

### 长时间自主任务

搭配使用：

- `pi-goal/`：让 agent 聚焦于用户定义的目标。
- `progress-checkpoints.ts`：保持公开进度更新简洁。
- `effort.ts`：无需打开设置即可调整推理级别。

## 备注

- `pi-glance/` 和 `pi-sandbox/` 拥有自己的 `package.json`，也可能可以作为独立 pi 包使用。
- `pi-sandbox/dist/` 被有意保留，因为 `pi-sandbox/index.ts` 会重新导出 `./dist/index.js`。
- 一些文件包含基于现有 MIT 许可 pi 扩展改编代码的署名注释。重新分发时请保留这些声明。

## 许可证

MIT。参见 [LICENSE](LICENSE)。

带有各自许可证或署名声明的子目录或文件应保留这些声明。
