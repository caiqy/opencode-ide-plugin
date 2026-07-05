# 能力：IDE Bridge 协议

> **象限**：Reference（能力参考）
> **能力编号**：G1（见 [capabilities-index](../capabilities-index.md)）
> **基线状态**：基线

## 代码真源

| 角色 | 文件 |
|------|------|
| WebGUI bridge client | `packages/opencode/webgui/src/lib/ideBridge.ts` |
| WebGUI bridge state | `packages/opencode/webgui/src/state/IdeBridgeContext.tsx` |
| VSCode bridge server | `hosts/vscode-plugin/src/ui/IdeBridgeServer.ts` |
| JetBrains bridge server | `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt` |

> 命名交叉核验（Step 5）：能力索引 G1 指向 `ideBridge.ts`、`IdeBridgeServer.ts`、`IdeBridge.kt`；三处都暴露 `ideBridge`/`IdeBridge` 命名与 `/idebridge/{sessionId}` 路径。

## 意图

让 WebGUI 在 VSCode webview iframe 或 JetBrains JCEF 内访问宿主 IDE 能力，同时保留浏览器模式可运行的边界。完整逐文件清单见 [hosts-vscode-plugin 参考](../repositories/hosts-vscode-plugin.md)。

## 行为契约

- 传输模型是宿主本地 HTTP server 监听 `127.0.0.1:0`：VSCode 在 `server.listen(0, "127.0.0.1")` 创建随机端口（`IdeBridgeServer.ts:65`），JetBrains 在 `HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)` 创建随机端口（`IdeBridge.kt:91`）。
- 每个 session 生成独立 `sessionId` 和 `token`，base URL 形如 `http://127.0.0.1:{port}/idebridge/{sessionId}`（`IdeBridgeServer.ts:119-133`、`IdeBridge.kt:129-154`）。
- 所有 `events` 和 `send` 请求都通过 query `token` 鉴权；session 不存在或 token 不匹配返回 401（`IdeBridgeServer.ts:176-185`、`IdeBridge.kt:247-258`）。
- UI 使用 `EventSource` 连接 `{bridgeBase}/events?token=...`，请求用 `POST {bridgeBase}/send?token=...`（`ideBridge.ts:57-59`、`ideBridge.ts:197-200`）。
- SSE 初始事件名为 `connected`；VSCode 可发送 `minVersion`/`restartMode`，JetBrains 发送 `minVersion` 和 `restartMode="ide"`（`IdeBridgeServer.ts:211-217`、`IdeBridge.kt:285-293`）。
- UI 解析 `connected` 元数据为 `customApi`、`minVersion`、`restartMode`，并派发 `opencode:idebridge-connected`（`ideBridge.ts:67-82`）。
- SSE message 结构由 `id`、`replyTo`、`type`、`payload`、`ok`、`error`、`result` 组成；UI 用 `replyTo` 匹配 pending request（`ideBridge.ts:1-9`、`ideBridge.ts:149-159`、`IdeBridgeServer.ts:480-503`、`IdeBridge.kt:564-593`）。
- 宿主每 15 秒写入 SSE comment ping，避免连接被代理/隧道闲置断开（`IdeBridgeServer.ts:71-74`、`IdeBridgeServer.ts:506-512`、`IdeBridge.kt:142-150`、`IdeBridge.kt:196-204`）。

## 消息边界

- UI -> Host 请求清单以宿主 `handleSend` 为准：`openFile`、`openUrl`、`reloadPath`、`clipboardWrite`、`saveImage`、`restartHost`、`ensureAndOpenFile`、`storageGet`、`storageSet`、更新相关请求等（`IdeBridgeServer.ts:247-466`、`IdeBridge.kt:319-553`）。完整表链接 [IDE Bridge 能力参考](ide-bridge.md)。
- Host -> UI 推送以 `bridgeServer.send`/`IdeBridge.send` 为准：`insertPaths`、`pastePath`、`readUrisResult`、`drag-event`、`updateOpenedFiles`、update events 等；WebGUI 在 `App.tsx` 和 `IdeBridgeContext.tsx` 消费（`App.tsx:403-486`、`IdeBridgeContext.tsx:42-71`）。

## 代码锚点速查

| 契约 | 锚点 |
|------|------|
| UI 读取 URL query | `ideBridge.ts:22-25` |
| UI 建立 SSE | `ideBridge.ts:54-59` |
| UI POST send | `ideBridge.ts:193-200` |
| VSCode 创建 session | `IdeBridgeServer.ts:113-135` |
| VSCode connected event | `IdeBridgeServer.ts:201-226` |
| JetBrains 创建 session | `IdeBridge.kt:113-155` |
| JetBrains connected event | `IdeBridge.kt:272-302` |
| WebGUI opened files state | `IdeBridgeContext.tsx:42-71` |

## 边界与约束

- Bridge 不是 opencode backend API；它只在宿主注入 `ideBridge` 和 `ideBridgeToken` 时安装（`ideBridge.ts:22-48`）。
- WebGUI 断线时会 reject pending request 并指数退避重连，最大 30 秒（`ideBridge.ts:104-147`）。
- `customApi` 默认 true；当前代码只在 `connected` 事件里读取布尔值，VSCode/JetBrains 代码未显式发送 `customApi`（`ideBridge.ts:29`、`ideBridge.ts:70-72`）。

## 运行时待核验

- [ ] Remote-SSH / JetBrains Gateway 等远端场景下 SSE ping 是否足以维持长连接（`待运行时核验`：需要真实远端 IDE）。
- [ ] `customApi` 未由宿主显式发送时，状态面板实际展示是否符合预期（`待运行时核验`：需要打开 WebGUI 观察）。

## 相关

- 上下文插入：[context-insertion](context-insertion.md)
- 宿主动作：[host-actions](host-actions.md)
- 宿主重启：[host-restart](host-restart.md)
