# Outcome

IDE 原生通知使用易失发送语义：只在 bridge 当前已配置且 ready 时接受，并且 POST 失败后绝不进入重试或重连队列，避免断线后迟到展示过期通知。

# Scope

- 在 WebGUI `IdeBridge` 增加 `sendTransient(msg): boolean`。
- 让底层 POST 发送支持最小的内部重试开关，易失发送关闭重试。
- `sendIdeNotification()` 改用易失入口并返回其结果。
- 使用真实 singleton、MockEventSource、fetch 与 fake timers 覆盖网络失败和 5xx 后断线重连不补发。
- 更新现有通知单元测试和 MessagesContext bridge mock。

# Non-goals

- 不改变普通 `send()`、`request()`、队列、重连或重试语义。
- 不改变通知内容、聚焦抑制、permission 去重或两个 host 的 payload 行为。
- 不处理 MessagesContext session 状态集合增长。

# Acceptance examples

- bridge ready 后通过 `sendIdeNotification()` 发送通知，POST Promise reject，随后 SSE 断线、重连并推进全部重试定时器，fetch 始终只调用一次。
- bridge ready 后通过 `sendIdeNotification()` 发送通知，POST 返回 5xx，随后 SSE 断线、重连并推进全部重试定时器，fetch 始终只调用一次。
- bridge 未配置或未 ready 时，`sendTransient()` 返回 false 且不调用 fetch、不入队。
- bridge 已配置且 ready 时，`sendTransient()` 接受一次发送并返回 true；异步 POST 失败不改变该接受结果。
- 普通 `send()` 与 `request()` 继续保留既有排队和失败重试行为。

# Constraints and invariants

- 易失入口必须承担配置和 ready 的最终同步门禁，调用方不得先检查再调用普通 `send()`。
- 不复制 fetch 实现；复用现有 `doSend()` 并使用语义明确的 retry 开关。
- 不用 `retryCount=3` 魔数模拟禁止重试。
- 保留全部现有产品改动、Comet 归档及 vfox 说明。
- 工具使用 vfox 管理版本；测试从各 package 目录运行。
- 不提交、推送或创建 PR。

# Decisions

- 公共入口命名为 `sendTransient(msg): boolean`。
- 返回 true 表示当前状态已接受一次 POST 尝试，不表示异步 POST 成功。
- 网络异常和任意 HTTP 5xx 对易失发送均只记录现有 warning，不调用 `requeueWithBackoff()`。
- 4xx 继续沿用现有一次发送后的拒绝处理，不重试。

# Open questions

无。

# Verification expectations

- TDD：先用真实 singleton 回归确认当前代码在失败、断线、重连后产生第二次 fetch，再实施修复。
- GREEN 后运行 ideBridge、ideNotifications、MessagesContext 通知相关定向测试及 WebGUI 全量测试。
- 运行 WebGUI build、窄 lint、VS Code compile/2 个 host 测试、JetBrains Java 21 定向测试和 `git diff --check`。
- 完成 Native Verify/Archive，并复核 Runtime 哈希和外部备份清理。
