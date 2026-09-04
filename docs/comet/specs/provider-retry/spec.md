# Provider Retry

## 完整行为

legacy Session 普通对话以及 task/subagent 子 Session 必须通过现有 `SessionRetry.policy` 处理 provider retry。现有 retryable error、HTTP 429、明确的 rate-limit 和明确的 concurrency-limit 必须进入同一个 retry policy；AI SDK adapter、HTTP transport、V2 RequestExecutor、model-backed search 和 task 工具不得为这些错误增加第二个 retry loop 或独立预算。

`provider_retry.max_retries` 使用非负整数配置 `SessionRetry.policy` 在初始 provider 请求之外允许的最大重试次数。未配置时默认 10，配置 0 时不重试，配置 N 时一次 provider turn 最多执行 N+1 次 provider 请求。该配置不控制 V2 RequestExecutor、V1/V2 model-backed search 或未配置 model 的 Exa/Parallel MCP websearch。

第 N 次重试的基础等待为 `2 秒 × 2^(N-1)`，并保留 0–25% jitter，单次等待最多 120 秒。Session retry 不遵从 provider 的 `retry-after-ms` 或 `Retry-After` 提示。每个 assistant message/provider turn 独立创建重试策略，次数和退避从第 1 次重新开始，同一 Session 的不同对话节点不得累计。

rate-limit、concurrency-limit 与 HTTP 429 只补充为原 retryable 分类，不建立专用等待、固定最短等待、累计等待上限或特殊重试状态。明确的 `Concurrency limit exceeded for user, please retry later` 与 account 等价形式必须可重试；匹配必须足够具体，不得因普通业务文本包含 concurrency 或 limit 就触发重试。

现有 permanent failure 判定拥有优先级。insufficient quota、认证、权限、context overflow 和其他现有不可重试错误不得因同时包含 429、rate 或 concurrency 文本而变为 retryable。现有 provider-specific 非目标规则，包括 OpenAI 404、5xx、网络错误、stream timeout、Go usage limit action 和错误展示，除新增配置上限外保持兼容。

Session retry 的状态发布、取消和错误投影继续使用现有流程。配置只改变允许的最大 retry 次数；本 change 不新增 V2 Session retry 状态、provider/model failover、部分流回滚、tool 幂等或副作用去重。

实现必须将 `provider_retry.max_retries` 加入 V1/V2 Config schema、V1→V2 配置迁移和公开 JSON Schema/OpenAPI/SDK 类型。配置描述必须明确默认 10 且只控制 Session retry。不得新增第三方依赖。

上一版未提交的 HTTP 429 专用实现不得作为本 capability 的组成部分：V2 executor 专用配置、model-backed search 统一预算、固定 10 秒最短等待、429 累计等待规则、递归 Session 删除中断和相关专用测试必须回到 Git 基线。独立 release 版本改动、用户全局 `opencode.jsonc` 与 Comet 历史产物不属于回退范围。

## 验证

验收必须使用确定性 fake error/provider 和 TestClock 覆盖：默认 10、配置 0、自定义次数、N+1 请求上限、次数耗尽、2 秒指数退避、0–25% jitter、120 秒单次封顶、忽略 Retry-After、不同对话节点独立计数和退避、HTTP 429、rate-limit、user/account concurrency-limit、quota/auth/context/permanent 否决，以及 task/subagent 只继承子 Session 预算。还必须通过差异检查和定向测试证明 V2 RequestExecutor、model-backed search、MCP websearch、Session 删除和独立 release 文件未被本 capability 改写。真实 provider 调用不作为验收前提。
