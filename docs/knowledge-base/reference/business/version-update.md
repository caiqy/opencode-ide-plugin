# 能力：版本门禁与更新流

> **象限**：Reference（能力参考）
> **能力编号**：I1 + I2 + I3（见 [capabilities-index](../capabilities-index.md)）
> **基线状态**：基线

## 代码真源

| 角色 | 文件 |
|------|------|
| WebGUI 版本门禁 | `packages/opencode/webgui/src/components/VersionGate.tsx` |
| WebGUI 更新状态 | `packages/opencode/webgui/src/state/UpdateContext.tsx` |
| WebGUI 更新横幅 | `packages/opencode/webgui/src/components/UpdateBanner.tsx` |
| VSCode Release 检查 | `hosts/vscode-plugin/src/update/ReleaseChecker.ts` |
| VSCode VSIX 安装 | `hosts/vscode-plugin/src/update/UpdateInstaller.ts` |
| VSCode 更新状态机 | `hosts/vscode-plugin/src/update/UpdateService.ts`、`hosts/vscode-plugin/src/update/version.ts` |
| JetBrains Marketplace 查询 | `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/update/MarketplaceVersionSource.kt` |
| JetBrains 更新服务 | `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/update/PluginUpdateService.kt`、`PluginUpdateModels.kt`、`PluginVersion.kt` |

> 命名交叉核验（Step 5）：能力 I1/I2/I3 分别映射 WebGUI 展示层、VSCode GitHub Release + `.vsix` 更新、JetBrains Marketplace 手动更新；详见 [settings-panel](settings-panel.md) 与 [hosts-vscode-plugin 参考](../repositories/hosts-vscode-plugin.md)。

## 意图

在 IDE WebGUI 中统一展示版本兼容和插件更新状态，同时把实际检查、下载、安装交给宿主插件。WebGUI 不直接访问 Marketplace 或 GitHub Release，也不写宿主安装目录。

## 行为契约

- `VersionGate` 只在 IDE bridge 存在且宿主下发 `minVersion` 时启用门禁；它读取 `/global/health` 的后端版本，低于最低版本时阻断 UI（`VersionGate.tsx` 第 21-64 行、第 72-102 行）。
- WebGUI 初始化时请求 `getUpdateInfo`，并监听 host 推送的 `updateAvailable`、`downloading`、`installing`、`success`、`error`，映射成横幅状态（`UpdateContext.tsx` 第 126-199 行）。
- WebGUI 触发的共同 bridge 请求是 `getUpdateInfo`、`checkForUpdates`、`installUpdate`；VSCode 额外提供 `getExtensionVersion`（`IdeBridgeServer.ts` 第 391-463 行，`IdeBridge.kt` 第 416-486 行）。
- VSCode 从 GitHub latest release 读取可安装版本，并按当前 runtime 选择 5 个目标之一的 `.vsix` asset（`ReleaseChecker.ts` 第 29-43 行、第 69-84 行）。
- VSCode 安装流程下载 `.vsix` 到临时目录，再调用 `workbench.extensions.installExtension`（`UpdateInstaller.ts` 第 14-41 行）。
- VSCode 更新状态机负责 scheduled check、手动 check、install，并向 bridge session 广播状态（`UpdateService.ts` 第 39-68 行、第 91-160 行）。
- JetBrains 使用 public Marketplace `/api/plugins/31609/updates` 查询最新 release，不依赖内部下载 API（`MarketplaceVersionSource.kt` 第 13-39 行）。
- JetBrains 有更新时返回 `manualUpdate=true`；`installUpdate` 只触发 `manualUpdate` 事件并打开 Plugins 页面（`PluginUpdateService.kt` 第 93-115 行，`IdeBridge.kt` 第 459-463 行）。
- JetBrains 空 Marketplace 结果会清理 cached update，并返回 `manual-check` 语义，不能继续展示旧更新（`PluginUpdateService.kt` 第 43-54 行）。
- `getExtensionVersion` / `getUpdateInfo.currentVersion` 来自已安装插件 descriptor 版本（`PluginVersion.kt` 第 13-18 行）。

## 边界与约束

- WebGUI 是展示层和触发层；下载、安装、打开插件管理器都必须走 IDE bridge。
- VSCode 支持站内 `.vsix` 下载安装；JetBrains Marketplace 安装版只提供 public Marketplace 检查和手动更新入口。
- `UpdateBanner` 根据 `manualUpdate` 切换按钮文案为「打开插件管理」，不是「立即更新」（`UpdateBanner.tsx` 第 11-27 行、第 51-60 行）。

## 静态锚点

- WebGUI 初始信息请求：`packages/opencode/webgui/src/state/UpdateContext.tsx:131`
- WebGUI host 事件入口：`packages/opencode/webgui/src/state/UpdateContext.tsx:157`
- WebGUI manual update 分支：`packages/opencode/webgui/src/state/UpdateContext.tsx:207`
- VSCode bridge handler 绑定：`hosts/vscode-plugin/src/ui/WebviewController.ts:163`
- VSCode update 广播绑定：`hosts/vscode-plugin/src/ui/WebviewController.ts:188`
- VSCode bridge 请求分发：`hosts/vscode-plugin/src/ui/IdeBridgeServer.ts:391`
- JetBrains bridge 请求分发：`hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt:416`
- JetBrains cached update 清理：`hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/update/PluginUpdateService.kt:43`

## 维护检查

- 新增 host 更新事件时，先扩展宿主 UpdateService，再扩展 `UpdateContext` 的事件 handler。
- 修改 JetBrains 更新逻辑时，保留 `manualUpdate=true` 与 `openPluginManager` 分支。
- 修改 VSCode Release asset 命名时，同步 `pickVsixAsset` 与 release workflow 的 VSIX 文件名。
- 修改版本门禁时，确认 `minVersion` 仍由 host connected 事件补齐后重检。

## 运行时待核验

- [ ] VSCode `.vsix` 下载后是否按当前 VSCode 版本策略提示 reload（`待运行时核验`：需要真实 VSCode extension host）。
- [ ] JetBrains Marketplace 安装版打开 Plugins 页面后，IDE 原生更新提示是否与 `manualUpdate` 状态一致（`待运行时核验`）。

## 相关

- 发布与打包：[packaging-release](packaging-release.md)
- 宿主 bridge：[ide-bridge](ide-bridge.md)
