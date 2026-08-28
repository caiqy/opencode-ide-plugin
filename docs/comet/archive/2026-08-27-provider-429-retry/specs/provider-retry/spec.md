# Provider Retry

## 完整行为

普通对话、配置 model 的 provider native/alpha search 与 task/subagent 子 Session 必须在 provider 尚未产生任何可见内容或 tool 事件时，对 HTTP 429 rate limit 自动重试。没有 HTTP 429 状态的流内 provider-error 不属于本能力，沿用既有处理。

`provider_retry.max_retries` 使用非负整数配置每个 provider turn 或 model-backed search invocation 在初始请求之外的最大重试次数。未配置时默认 5，配置 0 时关闭新增的 HTTP 429 自动重试。每次重试至少等待 10 秒；严格合法的 `retry-after-ms`、`Retry-After` 十进制秒数或未来 HTTP-date 要求更久时等待更久，负数、混合字符串、过期日期及其他非法值视为缺失。不使用指数退避、jitter 或累计等待上限。

明确的 quota exceeded、认证、权限和 typed permanent failure 不得因 HTTP 状态文本被重新分类为 retryable。既有 provider-specific 非 429 规则保持兼容，本能力不重新定义 OpenAI 404 等历史行为。

一旦本轮产生 text、reasoning、tool input、tool call、tool result 或其他可见 provider 事件，后续任何错误都直接结束本轮，不得清空、追加或重放。用户取消、父 task 取消或 Session 删除必须中断 retry wait，并保证取消后不再调用 provider。

预算 owner 必须唯一，并使用合并后的同一个 `provider_retry.max_retries` 值。legacy Session orchestration 关闭 AI SDK/native executor 内层预算并继续发布现有 retry 状态；V2 普通 provider turn 由 typed RequestExecutor 拥有预算且不新增 V2 状态协议；V1/V2 model-backed search 由一次 tool invocation 拥有预算并关闭内部 SDK/executor 重试。task/subagent 不增加 task 级 retry loop。

配置 model 的 native 与 alpha search fallback 必须共享最多 `max_retries + 1` 个总请求。最终失败只暴露脱敏后的 HTTP 状态、Retry-After 和 rate-limit/quota 分类，并只产生一个最终 tool result。未配置 model 的 Exa/Parallel MCP websearch 保持现状，不增加重试。

实现必须将 `provider_retry.max_retries` 加入 V1/V2 Config schema 和生成的 JSON Schema，不得增加第三方依赖或第二个 V2 provider-turn 调用点。`@opencode-ai/llm` 的 V2 Session runner 继续每 turn 只显式调用一次 `llm.stream(request)`。

## 验证

验收使用确定性 fake provider/HTTP 响应覆盖 429 后成功、合法和非法 Retry-After、10 秒最短等待、默认/0/10 次配置、次数耗尽、quota/permanent failure、取消、Session 删除、fallback 共用次数、部分输出后不重试，以及 task 子 Session 不增加第二层预算。真实上游调用不作为验收前提。
