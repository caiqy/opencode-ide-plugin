# Outcome

IDE 原生完成和权限通知仅在 bridge 已安装且当前连接 ready 时立即发送，避免断线期间排队后迟到展示已经过期的瞬时事件。

# Scope

- 在 WebGUI 通知发送边界检查 `ideBridge.isInstalled()` 与 `ideBridge.ready === true`。
- 为完成通知和权限通知增加未 ready 时返回 `false` 且不调用 `send` 的回归测试。
- 验证 WebGUI 及 VS Code、JetBrains 现有通知处理不受回归。

# Non-goals

- 不改变 `IdeBridge.send()` 的通用队列、重连或重试语义。
- 不改变 permission request ID 的首次观察去重与 replied 后释放行为。
- 不改变通知内容、前台聚焦抑制或 host payload 校验。

# Acceptance examples

- bridge 已安装但 `ready=false` 时，完成通知返回 `false`，且不调用 `ideBridge.send()`。
- bridge 已安装但 `ready=false` 时，权限通知返回 `false`，且不调用 `ideBridge.send()`。
- `permission.asked` 在未 ready 时被首次观察，随后 `permission.replied`，bridge 后来 ready 时不得迟到发送该权限通知。
- bridge 已安装且 `ready=true` 时，现有完成与权限通知行为保持不变。

# Constraints and invariants

- 通知是瞬时事件，只允许在事件发生时立即投递，不复用普通 bridge 命令的排队语义。
- 未安装、未 ready 或当前前台聚焦会话均安全无操作。
- 保留现有产品改动以及 AGENTS.md、CLAUDE.md 中的 vfox 说明。
- 使用 vfox 管理的 Bun、Node.js 和 Java 21；测试从各 package 目录运行。
- 不提交、推送或创建 PR。

# Decisions

- 就绪判定直接读取公开的 `ideBridge.ready`，不增加新 API 或队列类型。
- 在 `sendIdeNotification` 入口统一抑制两种通知，返回值继续表示是否调用了 `send`。

# Open questions

无。

# Verification expectations

- TDD：先运行新增 `ready=false` 用例并确认因错误调用 `send` 而失败，再实施最小修复并确认通过。
- 运行 WebGUI 定向测试、全量测试、build 和窄范围 lint。
- 运行 VS Code 与 JetBrains 通知桥定向测试；JetBrains 使用 vfox Java 21。
- 记录所有实际命令、结果及 Runtime 临时预算补丁的恢复哈希。
