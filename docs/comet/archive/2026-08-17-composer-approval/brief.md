# Outcome

在 IDE 插件 WebGUI 的 Composer 中为当前会话提供三级审批模式，统一控制工具 permission 请求：手动审批、自动审批、完全访问。自动审批使用内置 `approval` agent 判断请求，默认模型为 `openai/gpt-5.6-luna`，并允许通过 `Opencode.jsonc` 覆盖。

# Scope

- 在 `packages/opencode/webgui` 的 Composer 提供当前会话的审批模式选择和状态同步。
- 手动审批复用现有 permission dock 和 `once`、`always`、`reject` 回复流程。
- 自动审批为每个 permission 请求启动一次隔离的 one-shot Guardian 评审。Guardian 结合有界 Session transcript、类型化 action、用户授权与风险策略作出结构化判定；明确允许时自动放行，明确拒绝时拒绝，不确定、无效或调用失败时回退人工审批。
- Guardian 仅可使用 `read`、`glob`、`grep` 调查当前 Location，不得调用 shell、网络或写工具。
- 完全访问为当前会话应用全量 allow 规则，跳过人工审批。
- 增加配置 schema、内置 agent 默认值、后端策略和前端交互所需测试。

# Non-goals

- 不提供项目级或全局默认审批模式。
- 不引入 Codex sandbox，也不改变现有 sandbox 行为；Guardian 的只读能力由工具白名单强制。
- 不重做既有 permission API。
- 不把 Guardian 评审保存为普通用户 Session，不跨 permission 请求复用评审上下文。
- 不修改上游 `packages/app` 的 Composer 或本地化资源。

# Acceptance examples

- A1：当前会话可在 IDE 插件 WebGUI 的 Composer 中选择三级模式，刷新或重新打开该会话后模式保持一致，其他会话不受影响。
- A2：手动审批模式下，未命中既有 allow 规则的请求显示现有 permission dock，并可完成允许一次、始终允许或拒绝。
- A3：自动审批模式下，审批 agent 明确返回允许时请求自动放行，明确返回拒绝时请求被拒绝。
- A4：自动审批模式下，审批 agent 返回不确定、无效结果或调用失败时，请求回到 Composer 人工审批，不会默认放行。
- A5：完全访问模式下，当前会话的工具请求不会产生人工 permission 请求；其他会话仍按自身模式处理。
- A6：未配置时内置 `approval` agent 使用 `openai/gpt-5.6-luna`；`Opencode.jsonc` 可覆盖其 `model` 和 `variant`。
- A7：相关策略、配置解析、模式切换和回退行为的测试及类型检查通过。
- A8：Guardian 输入包含经过裁剪的当前 Session user/assistant/tool transcript，以及含真实工具名、请求参数、工作目录和理由的 action；提示明确区分用户授权证据与不可信工具内容。
- A9：Guardian 可以调用 `read`、`glob`、`grep` 调查当前 Location，但看不到 shell、网络或写工具；调查达到轮次或时间上限时回退人工审批。
- A10：Guardian 结构化返回风险等级、用户授权等级、`allow`/`deny`/`ask` 结论和理由；格式错误时回退人工审批。

# Constraints and invariants

- 审批模式的作用域严格为当前会话。
- 自动审批只把当前 Session 的有界 transcript 和当前 permission action 交给隔离 Guardian，不读取其他 Session。
- Guardian 仅暴露 `read`、`glob`、`grep`；这些调用使用 total permission ruleset，不能递归触发 Guardian。
- 自动审批失败采用人工回退，不能因模型异常而扩大权限。
- 每个 permission 请求使用独立 one-shot Guardian 上下文；不将调查记录写入普通 Session transcript。
- 现有 permission 请求、回复和持久化规则保持兼容。

# Decisions

- 采用当前会话作用域，因为功能入口是 Composer，且不改变其他会话或配置文件默认值。
- 第二级命名为“自动审批”，不是“自动审计”。
- 自动审批无法明确判断时回退人工审批，以避免模型误判导致工具执行。
- 内置审批 agent 默认使用 `openai/gpt-5.6-luna`，并沿用现有 agent 配置覆盖机制。
- 参考 Codex CLI Guardian 的策略、transcript、action 和结构化结论模型，但不引入 Codex sandbox。
- Guardian 可以使用 `read`、`glob`、`grep` 调查当前 Location；仓库没有可强制只读的 shell sandbox，因此明确禁止 shell、网络和写工具。
- Guardian 每次请求 one-shot，不复用评审会话，避免跨请求残留授权证据或 prompt injection。
- Guardian 输出包含 `risk_level`、`user_authorization`、`outcome` 和 `rationale`；`outcome` 保留 `ask`，模型失败或不确定时继续回退人工审批。

# Open questions

无。

# Verification expectations

- 运行审批策略和配置解析单元测试。
- 运行 transcript 裁剪、action 序列化、结构化输出解析、只读工具白名单、轮次/超时和递归防护测试。
- 运行 `packages/opencode/webgui` 的 Composer 相关测试或新增的最小交互状态测试。
- 在对应包目录运行 `bun typecheck`。
