# Outcome

设计并实现一套覆盖普通对话、配置 model 的 provider native/alpha search 与 task/subagent 的 HTTP 429 重试机制，在不重复预算或重放副作用的前提下缓解偶发上游限流。

# Scope

- legacy Session AI SDK/native runtime 与 V2 Session 的 HTTP provider 请求。
- 配置 model 的 provider native search 与 alpha search。
- task/subagent 子 Session 的 provider turn。
- HTTP 429 分类、Retry-After、可配置重试次数、固定最短等待、取消、Session 删除和安全诊断。

# Non-goals

- 未配置 model、直接调用 Exa/Parallel MCP 的普通 websearch。
- 没有 HTTP 429 状态的流内 provider-error；既有处理保持不变。
- 改写 provider-specific 的非 429 retry 规则，包括既有 OpenAI 404 兼容行为。
- 为 V2 新增 Session retry 状态协议或 UI。
- provider/model 自动 failover、部分流回滚、tool 幂等键或副作用去重。
- 新增第三方依赖。

# Acceptance examples

- A1：普通对话、配置 model 的 native/alpha search 和 task/subagent 在任何可见输出前收到 HTTP 429 时会自动重试，成功后只产生一份最终回答或搜索结果。
- A2：所有新增 HTTP 429 路径每次至少等待 10 秒；严格合法的 Retry-After 要求更久时等待更久，缺失、无效或短于 10 秒时等待 10 秒，不再使用指数退避或累计等待上限。
- A3：`provider_retry.max_retries` 以非负整数配置每个 provider turn 或 model-backed search invocation 在初始请求外的最大重试次数；未配置默认 5，配置 0 关闭，SDK、executor 和 route fallback 不会各自重置次数。
- A4：用户取消、父 task 取消或 Session 删除会中断当前等待并阻止后续 provider 请求。
- A5：明确的 quota exceeded、认证、权限和其他 typed permanent failure 直接失败；既有 provider-specific 非 429 分类不因本 change 改变。
- A6：provider 已产生 text、reasoning、hosted/local tool 事件后再失败时不会重试整轮。
- A7：model-backed search 的 fallback 共用预算，最终错误保留脱敏后的 HTTP 状态、Retry-After 与 rate-limit/quota 分类；普通 MCP websearch 不增加重试。
- A8：task/subagent 不建立额外 retry loop，仅由其子 Session 的 provider turn 使用上述预算。

# Constraints and invariants

- 每个 provider turn 只有一个预算 owner：legacy Session orchestration、V2 RequestExecutor 或 model-backed search invocation。
- 普通对话、model-backed search 与 task/subagent 子 Session 使用同一个合并后配置值。
- `@opencode-ai/llm` 每个 V2 provider turn 保持一个显式 `llm.stream(request)` 调用点。
- legacy Session 继续通过现有 Session retry 状态暴露 attempt、原因和 next；V2 不新增状态协议。
- 最终 search 错误必须脱敏，不暴露认证 header、query secret 或任意 provider body；RequestExecutor 现有 bounded/redacted HTTP context 保持兼容。

# Decisions

- 本 change 在方案确认后继续完成代码实现、回归测试和独立验收。
- 新增 `provider_retry.max_retries` 全局配置；默认 5、允许 0，用户全局配置设为 10，统一作用于普通对话、model-backed search 和 task/subagent 子 Session。
- 删除累计等待上限和指数退避；每次等待 `max(10 秒, 合法 Retry-After)`。
- 只有 HTTP 429 属于本次新增 retry 分类；无 HTTP 状态的流内错误和既有非 429 规则保持现状。
- legacy Session、V2 executor 与 model-backed search 分别在其现有合适边界拥有唯一预算。
- 一旦出现任何可见内容或 tool 事件，后续错误直接结束，不实现回滚或去重。
- 无 model 的 Exa/Parallel MCP websearch 明确排除。

# Open questions

# Verification expectations

- 使用确定性 fake provider/HTTP 响应验证 429 后成功、严格 Retry-After、10 秒最短等待、默认/0/10 次配置、次数耗尽、取消和 Session 删除，不调用真实上游。
- 覆盖 legacy Session、V2 RequestExecutor、V1/V2 model-backed native/alpha search、部分输出以及 task 子 Session 继承边界。
- 执行受影响 package 的定向测试、`bun typecheck` 和 `git diff --check`，再由新的只读 Verifier 验收 A1-A8。
