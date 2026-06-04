# pi-agent-browser

Pi 扩展骨架：把 `agent-browser-mcp` 迁成 Pi package 风格，并用 skill 显式引导启用。

## 当前设计

- 默认不激活任何浏览器工具，避免无关会话浪费 token。
- 通过以下任一方式启用本会话浏览器工具：
  - `/skill:agent-browser`
  - `/browser-on`
- 通过 `/browser-off` 关闭。
- 通过 `/browser-install` / `/browser-doctor` 做首次安装与诊断。

## 当前已落地

- 本地 Node/TS 扩展骨架
- 内置本地 WebSocket/HTTP bridge
- Chrome unpacked 扩展资源
- 会话级 arm/disarm
- skill 资源动态注册
- 基础浏览器工具：
  - `browser_status`
  - `browser_list_tabs`
  - `browser_switch_tab`
  - `browser_open_url`
  - `browser_open_new_tab`
  - `browser_scan_page`
  - `browser_execute_js`
  - `browser_cdp_command`
  - `browser_cdp_batch`
  - `browser_get_cookies`
  - `browser_capture_page_screenshot`

## 当前仍是骨架/待完善

- `browser_scan_page` 已接入 `simphtml` 核心移植版：`optHTML + findMainList + token 优化 + smart truncate`。但仍未做逐页对比校准，因此现在是“高相似度首版”，不是已验证的逐字符一致版。
- page screenshot 还未真正写入 `save_path`。
- 尚未加入危险动作确认分层。
- 还未做更高层 skill workflow/router。
- 还未做 Windows/macOS 差异验证。

## 安装

开发或重新打包时，在该目录运行：

```bash
npm install
npm run build
```

正常使用时，扩展通过已提交的 `dist/` 启动；即使删除开发环境下的 `node_modules/`，只要 `dist/` 还在，Pi 也能加载该扩展。修改源码后记得重新运行 `npm run build`，然后在 Pi 中 `/reload`。

## Chrome 扩展安装

1. 运行 `/browser-install`
2. 在 macOS 上，这会自动打开 `chrome://extensions`、在 Finder 中定位本目录下的 `chrome-extension/`，并把该目录路径复制到剪贴板
3. 开启开发者模式
4. 加载已解压扩展，选择本目录下的 `chrome-extension/`
5. 打开任意正常的 `http/https` 页面
6. 回到 Pi 运行 `/browser-doctor`

## 说明

你当前要求是：
- 保留 Chrome 扩展
- 用 skill 引导
- 默认不暴露工具以减少 token
- 只做浏览器内操作，不控制物理设备

这个骨架就是按这组约束起的。
