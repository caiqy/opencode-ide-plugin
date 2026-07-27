# Outcome

修复 IDE 原生通知独立审阅发现的状态、去重和 host payload 一致性缺陷，使错误终止不产生完成通知、权限重放不绕过去重，并让 VS Code 与 JetBrains 对通知输入采用相同契约。

# Scope

- WebGUI 按 session 记录当前轮次是否由 `session.error` 终止；错误后的清理 `idle` 不通知，后续 `busy` 或 `retry` 开始新轮次时重置。
- `permission.asked` request ID 在首次观察时立即登记去重，不受前台抑制、bridge 可用性或实际发送结果影响；`permission.replied` 继续释放 ID。
- `shouldNotifySessionIdle` 仅接受 `busy|retry -> idle`。
- VS Code 在验证 title/body 后把 trim 后的值交给 handler；JetBrains 拒绝缺失、空白或非字符串 title/body。
- 为上述行为添加最小回归测试。

# Non-goals

- 不改变 WebGUI 发送的统一通知 title/body、预览生成规则、焦点抑制规则或 bridge 协议形状。
- 不重构通知架构，不添加依赖，不修改生成代码。
- 不改动现有通知实现、`docs/comet/`、AGENTS.md 或 CLAUDE.md 中与本次缺陷无关的工作树内容。

# Acceptance examples

- 同一 session 依次收到 `busy -> session.error -> idle` 时，不发送 `Agent finished`；随后收到新一轮 `busy -> idle` 时只发送一次完成通知。
- 同一权限 request ID 首次在当前前台聚焦会话中被抑制后，页面失焦并重放该 ID 时仍不通知；收到 `permission.replied` 后可释放该 ID。
- `shouldNotifySessionIdle` 对 `busy -> idle` 和 `retry -> idle` 返回 true；对 undefined、`idle` 或其他非 busy/retry 前态到 `idle` 返回 false。
- VS Code 对带外围空白的有效 title/body 调用 handler 时传入 trim 后的相同值，并拒绝无效字段。
- JetBrains 拒绝缺失、空字符串、纯空白或非字符串 title/body，且不调用平台通知 API。

# Constraints and invariants

- 严格按 TDD：先添加测试并在未修复生产代码上确认 RED 的失败原因，再实施最小修复并确认 Green。
- WebGUI 测试、lint 和 build 从 `packages/opencode` 或其 WebGUI package 上下文运行；VS Code 与 JetBrains 从各自 host package 运行。
- 使用 vfox 管理的工具版本；JetBrains 需要 Java 21，缺失时如实记录。
- 不撤销现有工作树改动，不提交、不推送、不创建 PR。
- Runtime 临时预算修改必须仅在实际阻塞调用点应用，使用外部备份并在 finally 中恢复、校验 SHA-256、删除备份。

# Decisions

- 错误终止标记按 session 保存，在 `session.error` 设置，在下一个 `busy` 或 `retry` 清除。
- 权限去重以“首次观察事件”为边界，而不是以“成功发送通知”为边界。
- host 验证后的规范值为 title/body 各自的 trim 结果；WebGUI payload 保持不变。
- 采用现有测试工具与结构，不引入新依赖或新抽象。

# Open questions

无。

# Verification expectations

- 保存 WebGUI、VS Code、JetBrains 各定向测试的 RED 与 Green 命令和实际结果。
- Green 后运行 WebGUI lint/build、VS Code compile 与可行 smoke/定向测试、JetBrains 使用 vfox Java/JDK 的定向测试。
- 运行 Comet 内置检查并在 verification.md 中逐项绑定 Runtime 派生 acceptance ID；所有未运行检查和宿主限制必须明确记录。
