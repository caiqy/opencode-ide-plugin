# IDE 原生通知

## 目标行为

WebGUI 仅在通过受支持的桌面 IDE bridge 运行时，将现有 Agent 完成和权限请求事件映射为 IDE 原生通知。通知不得改变会话、消息或权限状态。

## 触发与抑制

1. 实时 `session.status` 从 `busy` 或 `retry` 转换为 `idle` 时触发完成通知。
2. 首次观察到某会话为 `idle`、重复 `idle`、初始状态查询和重连状态快照不得触发完成通知。
3. 新的 `permission.asked` request ID 触发权限通知；同一 ID 的重复事件不得重复通知，`permission.replied` 后可释放该 ID。
4. session error 和其他事件不得触发通知。
5. 当目标是当前会话，且页面可见并拥有焦点时抑制通知；其他会话仍可通知。
6. IDE bridge 未安装或 host 不支持时安全无操作。普通网页版不得使用 Web Notification 作为回退。

## 通知内容

- 完成标题固定为 `Agent finished`。正文优先使用目标会话最新助手文本的空白折叠、最多 220 字符预览；缺失时为 `Finished working.`。
- 权限标题固定为 `Agent needs permission`。正文优先使用权限 metadata title，其次权限名；缺失时为 `Permission requested.`。
- WebGUI 发送 `{ type: "showNotification", payload: { title, body } }`。VS Code 与 JetBrains host 必须保留相同 title/body 语义。

## Host 行为

- VS Code 使用 `vscode.window.showInformationMessage` 显示 payload。
- JetBrains 使用已注册的 Notification Group 创建 INFORMATION 通知。
- title 或 body 缺失、非字符串或仅含空白时，host 必须拒绝请求且不得调用平台 API。
