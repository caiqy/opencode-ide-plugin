# IDE 原生通知

## 目标行为

WebGUI 仅在通过受支持的桌面 IDE bridge 运行时，将现有 Agent 完成和权限请求事件映射为 IDE 原生通知。通知不得改变会话、消息或权限状态。

## 触发与抑制

1. 实时 `session.status` 仅在 previous 为 `busy` 或 `retry` 且 current 为 `idle` 时触发完成通知。
2. 首次观察到某会话为 `idle`、重复 `idle`、非 `busy`/`retry` 前态到 `idle`、初始状态查询和重连状态快照不得触发完成通知。
3. 每个 session 保留当前轮次的错误终止状态。收到 `session.error` 后，该轮后续清理用 `session.status idle` 不得触发完成通知；下一个 `busy` 或 `retry` 开始新轮次并重置错误终止状态，之后正常到 `idle` 仍应通知一次。
4. `permission.asked` request ID 在首次观察事件时立即登记；即使该事件因当前前台聚焦会话、bridge 未安装、不支持或未实际发送而被抑制，同一 ID 的后续重放也不得通知。`permission.replied` 后释放该 ID。
5. session error 和其他事件本身不得触发通知。
6. 当目标是当前会话，且页面可见并拥有焦点时抑制通知；其他会话仍可通知。
7. IDE bridge 未安装或 host 不支持时安全无操作。普通网页版不得使用 Web Notification 作为回退。

## 通知内容

- 完成标题固定为 `Agent finished`。正文优先使用目标会话最新助手文本的空白折叠、最多 220 字符预览；缺失时为 `Finished working.`。
- 权限标题固定为 `Agent needs permission`。正文优先使用权限 metadata title，其次权限名；缺失时为 `Permission requested.`。
- WebGUI 发送 `{ type: "showNotification", payload: { title, body } }`。VS Code 与 JetBrains host 必须保留相同 title/body 语义。

## Host 行为

- VS Code 使用 `vscode.window.showInformationMessage` 显示 payload。验证 title/body 后，传给 handler 的 title/body 必须是各自 trim 后的值。
- JetBrains 使用已注册的 Notification Group 创建 INFORMATION 通知。
- 两个 host 对 title 或 body 缺失、非字符串、空字符串或仅含空白的请求都必须拒绝，且不得调用平台 API。

## 验收场景

1. `busy -> session.error -> idle` 不通知；同一 session 随后的新一轮 `busy -> idle` 只通知一次。
2. 权限 request ID 首次在前台聚焦时被抑制，失焦后重放相同 ID 仍不通知。
3. idle 判定只接受 `busy|retry -> idle`，拒绝所有其他前态。
4. VS Code handler 收到 trim 后的有效 title/body；JetBrains 拒绝缺失、空白或非字符串字段。
