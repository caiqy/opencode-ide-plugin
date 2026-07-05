# 能力：宿主重启

> **象限**：Reference（能力参考）
> **能力编号**：G4（见 [capabilities-index](../capabilities-index.md)）
> **基线状态**：基线；`RestartRequiredModal` 是设置链路中单独维护的漂移点

## 代码真源

| 角色 | 文件 |
|------|------|
| WebGUI restart bridge client | `packages/opencode/webgui/src/lib/ideBridge.ts` |
| Provider 保存后的重启弹窗 | `packages/opencode/webgui/src/components/settings/RestartRequiredModal.tsx` |
| CompactHeader 重启入口 | `packages/opencode/webgui/src/components/CompactHeader/index.tsx` |
| VSCode restart handler | `hosts/vscode-plugin/src/ui/WebviewController.ts`、`hosts/vscode-plugin/src/ui/IdeBridgeServer.ts` |
| JetBrains restart handler | `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt` |

> 命名交叉核验（Step 5）：能力索引 G4 的 `restartHost` 在 UI 请求、VSCode handler、JetBrains handler 中保持同名。

## 意图

让需要重载插件/IDE 才能生效的配置改动有统一入口。设置相关背景见 [settings-panel 能力参考](settings-panel.md)，bridge 传输见 [IDE Bridge 能力参考](ide-bridge.md)。

## 行为契约

- UI 通过 `ideBridge.request("restartHost")` 发起重启请求；该请求有 5 秒超时（`ideBridge.ts:38-42`、`RestartRequiredModal.tsx:14-24`）。
- VSCode session metadata 设置 `restartMode: "window"`，供 UI 区分文案/能力（`WebviewController.ts:181-184`）。
- VSCode 重启动作是执行 `workbench.action.reloadWindow`（`WebviewController.ts:155-159`）。
- VSCode bridge 对 `restartHost` 先 `replyOk`，再 `setTimeout(..., 0)` 执行 reload，避免 transport 被销毁前 UI 收不到回复（`IdeBridgeServer.ts:302-315`）。
- JetBrains SSE connected metadata 固定 `restartMode: "ide"`（`IdeBridge.kt:285-290`）。
- JetBrains 默认重启动作是 `ApplicationManager.getApplication().restart()`（`IdeBridge.kt:52-55`）。
- `CompactHeader` 根据 `restartMode` 展示“重启 IDE”或“重载窗口并重启插件”文案，并调用 `restartHost`（`CompactHeader/index.tsx:58-83`、`CompactHeader/index.tsx:127-134`、`CompactHeader/index.tsx:645`）。
- `RestartRequiredModal` 是 Provider 设置保存后的专用弹窗，失败时提示手动重启插件或 Reload Window（`RestartRequiredModal.tsx:18-23`、`RestartRequiredModal.tsx:31-40`）。

## 边界与约束

- JetBrains 当前 `restartHost` 在 handler 内先 `restartHook()` 再 `replyOk()`；如果 restart 立即破坏 transport，可能收不到 OK。VSCode 已显式规避该问题（`IdeBridge.kt:488-492`、`IdeBridgeServer.ts:307-314`）。
- `RestartRequiredModal` 文案固定提到“插件/Reload Window”，没有读取 `ideBridge.restartMode`；`CompactHeader` 才按 mode 分支（`RestartRequiredModal.tsx:19-21`、`CompactHeader/index.tsx:645`）。
- 浏览器模式没有 `ideBridge` 时，`restartHost` 请求会 reject 为 bridge not installed（`ideBridge.ts:248-264`）。

## 代码锚点速查

| 契约 | 锚点 |
|------|------|
| restart 请求超时 | `ideBridge.ts:38-42` |
| Provider 重启弹窗 | `RestartRequiredModal.tsx:14-24` |
| Header restartMode state | `CompactHeader/index.tsx:58-83` |
| Header 调用 restartHost | `CompactHeader/index.tsx:127-134` |
| VSCode restartMode | `WebviewController.ts:181-184` |
| VSCode reloadWindow | `WebviewController.ts:155-159` |
| VSCode 先回复再 reload | `IdeBridgeServer.ts:302-315` |
| JetBrains restartHook | `IdeBridge.kt:52-55` |

## 运行时待核验

- [ ] JetBrains `restartHost` 是否能在 IDE restart 前稳定把 OK 回复给 WebGUI（`待运行时核验`：代码顺序存在风险）。
- [ ] `RestartRequiredModal` 在 JetBrains 模式下的文案是否需要区分 `restartMode="ide"`（`待运行时核验`：需要真实 UI 流程确认）。

## 相关

- Provider 设置页：[provider-settings](provider-settings.md)
- IDE Bridge 协议：[ide-bridge](ide-bridge.md)
