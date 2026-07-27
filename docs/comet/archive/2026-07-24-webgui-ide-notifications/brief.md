# Outcome

WebGUI 在 VS Code 与 JetBrains/IDEA 插件内运行时，对需要用户注意的 Agent 完成和权限请求状态发送 IDE 原生通知；普通网页版保持无通知。

# Scope

- WebGUI 从现有 `session.status` 和 `permission.asked` 事件派生通知。
- 通过现有 IDE bridge 发送统一的通知标题和正文。
- VS Code 使用 `vscode.window.showInformationMessage`，JetBrains 使用 Notification API。
- 增加 WebGUI、VS Code bridge 和 JetBrains bridge 的最小关键测试。

# Non-goals

- 不支持普通网页版的 Web Notification。
- 不通知 session error、重试过程、消息流更新或其他状态。
- 不新增通知设置、声音、点击跳转、持久化通知历史或新依赖。

# Acceptance examples

- 已安装 IDE bridge、目标会话不在当前前台焦点，且实时状态从 `busy` 或 `retry` 变为 `idle` 时，发送一次 `{ title: "Agent finished", body: <最新助手文本或回退文案> }`；后续重复 `idle` 不再发送。
- 已安装 IDE bridge、目标会话不在当前前台焦点，收到新的 `permission.asked` 时，发送一次 `{ title: "Agent needs permission", body: <权限标题、权限名或回退文案> }`；同一 request ID 的重复事件不再发送。
- 当前页面可见且拥有焦点，并且通知对应当前会话时，完成或权限通知均被抑制；其他会话仍可通知。
- 未安装 IDE bridge、bridge 不支持消息、正文不可用或在普通网页版运行时均安全无操作，不抛出用户可见错误。
- VS Code 与 JetBrains 对同一 bridge payload 保留相同 title/body 语义；无效 payload 返回 bridge 错误，不调用平台通知 API。

# Constraints and invariants

- 只使用已有 SDK 事件、IDE bridge 和两端平台原生通知 API，不新增依赖。
- 通知是尽力而为的旁路行为，不得改变会话状态、权限处理或消息渲染。
- 遵守现有 bridge token、会话隔离、请求回复和线程模型。
- 不直接编辑 generated 目录，不改变 Protocol 或 Server HttpApi。

# Decisions

- 参考 Paseo 的可观察行为，仅通知 `finished` 与 `permission`，不通知 `error`。
- 完成去重由内存中的上一实时状态控制；初始加载和重连快照只建立 UI 状态，不产生完成通知。
- 权限通知按 request ID 在当前 WebGUI 生命周期内去重，权限回复后释放该 ID。
- 正文预览折叠空白并限制为 220 字符；缺失时使用 Paseo 对应的英文回退文案。
- 当前会话的前台判定使用 `document.visibilityState === "visible"` 与 `document.hasFocus()`；无法证明前台时按后台处理。

# Open questions

无。

# Verification expectations

- WebGUI 单元测试覆盖 bridge 缺失、前台抑制、统一 payload 与状态/权限去重。
- VS Code bridge 测试覆盖 payload 校验、handler 映射和回复。
- JetBrains unitTest 覆盖 payload 到 Notification hook 的映射和回复。
- 在对应 package/module 目录运行测试与类型/编译检查，并记录未运行项。
