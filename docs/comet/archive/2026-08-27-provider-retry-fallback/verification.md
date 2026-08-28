---
generated_from_state_version: 10
---

# Verification

## Current result

- Result: **Passed**
- Assurance: **skill-coordinated**
- Goal cycle: 1
- Iteration: 2
- Verifier attempt: 1
- Completed: 2026-08-27T17:17:56.249Z
- Summary: candidate d7d85157-ce6f-4aa6-b36f-3d544d138b11 满足 A1-A18，可通过 iteration 2 attempt 1。

## Acceptance

| ID | Result | Source | Criterion | Reason |
| --- | --- | --- | --- | --- |
| A1 | passed | brief.md | A1：普通对话或 task/subagent 子 Session 在原 Session retry 可处理的错误、HTTP 429、明确 rate-limit 或明确 concurrency-limit 失败后，均通过同一个 `SessionRetry.policy` 重试；adapter、SDK、executor 和 task 不建立额外 retry loop。 | 普通与 child Session 共用 SessionRetry.policy，TaskTool 无独立 retry loop。 |
| A2 | passed | brief.md | A2：`provider_retry.max_retries` 是非负整数，表示初始请求之外允许的最大重试次数；未配置默认 10，配置 0 不执行重试，配置 10 时最多产生 11 次 provider 请求。 | 非负整数配置及默认 10、0、自定义预算语义正确。 |
| A3 | passed | brief.md | A3：无有效 Retry-After 时，第 N 次重试使用 `2 秒 × 2^(N-1)` 的基础指数退避并保留现有 0–25% jitter；本地计算的单次等待封顶 120 秒。 | 2 秒指数、0-25% jitter 与 120 秒本地封顶正确。 |
| A4 | passed | brief.md | A4：合法 `retry-after-ms` 或 `Retry-After` 继续优先于本地指数退避，并可要求超过 120 秒的等待；缺失或无效 header 继续回退本地退避。 | 合法数值/HTTP-date hint 优先且可超过 120 秒，ISO/过期/非法值 fallback。 |
| A5 | passed | brief.md | A5：新增 rate/concurrency/429 分类不得把 insufficient quota、认证、权限、context overflow 或其他现有 permanent failure 改为 retryable；现有非目标错误的分类和展示保持兼容。 | context/quota、401/403 与 auth/permission permanent error 优先否决。 |
| A6 | passed | brief.md | A6：配置只作用于 `SessionRetry.policy`；V2 RequestExecutor、model-backed search 和 MCP websearch 的请求次数、等待与错误处理和 Git 基线一致。 | Runtime scoped diff 证明 RequestExecutor 和 websearch/MCP 非目标路径零差异。 |
| A7 | passed | brief.md | A7：上一轮未提交的 HTTP 429 专用实现、V2/search 配置传递、递归 Session 删除中断和相关测试/生成差异被撤回；独立 `26.8.2706` release 文件保持不变。 | 旧专用实现已撤回，26.8.2706 release 保留且检查通过。 |
| A8 | passed | brief.md | A8：V1/V2 Config schema、V1→V2 迁移、OpenAPI/SDK 类型和全局 JSONC 均接受 `provider_retry.max_retries`；描述明确默认 10 且只控制 Session retry。 | V1/V2 schema、迁移、OpenAPI、SDK 与全局 JSONC 配置贯通。 |
| A9 | passed | brief.md | A9：确定性测试覆盖默认/0/自定义次数、次数耗尽、指数退避、jitter、120 秒本地封顶、长 Retry-After、rate/concurrency/429、permanent failure 否决和 task 子 Session 继承，不调用真实 provider。 | 确定性测试覆盖预算、退避、分类、否决和 task child 继承。 |
| A10 | passed | specs/provider-retry/spec.md | legacy Session 普通对话以及 task/subagent 子 Session 必须通过现有 `SessionRetry.policy` 处理 provider retry。现有 retryable error、HTTP 429、明确的 rate-limit 和明确的 concurrency-limit 必须进入同一个 retry policy；AI SDK adapter、HTTP transport、V2 RequestExecutor、model-backed search 和 task 工具不得为这些错误增加第二个 retry loop 或独立预算。 | Processor 是唯一 Session retry owner，无第二套预算。 |
| A11 | passed | specs/provider-retry/spec.md | `provider_retry.max_retries` 使用非负整数配置 `SessionRetry.policy` 在初始 provider 请求之外允许的最大重试次数。未配置时默认 10，配置 0 时不重试，配置 N 时一次 provider turn 最多执行 N+1 次 provider 请求。该配置不控制 V2 RequestExecutor、V1/V2 model-backed search 或未配置 model 的 Exa/Parallel MCP websearch。 | Processor 将共享配置传给 policy，N+1 请求语义与 child 0 配置集成正确。 |
| A12 | passed | specs/provider-retry/spec.md | 无有效 provider 等待提示时，第 N 次重试的基础等待为 `2 秒 × 2^(N-1)`，并保留 0–25% jitter。本地计算的单次等待最多 120 秒。合法 `retry-after-ms`、`Retry-After` 十进制秒数或未来 HTTP-date 优先于本地指数退避；provider 明确要求的等待可以超过 120 秒。缺失、无效或过期的等待提示回退到本地指数退避。 | 严格 HTTP-date、ISO fallback、长 hint 与本地退避均有源码和测试证据。 |
| A13 | passed | specs/provider-retry/spec.md | rate-limit、concurrency-limit 与 HTTP 429 只补充为原 retryable 分类，不建立专用等待、固定最短等待、累计等待上限或特殊重试状态。明确的 `Concurrency limit exceeded for user, please retry later` 与 account 等价形式必须可重试；匹配必须足够具体，不得因普通业务文本包含 concurrency 或 limit 就触发重试。 | 429/rate/精确 concurrency 仅扩充既有分类，反例不匹配。 |
| A14 | passed | specs/provider-retry/spec.md | 现有 permanent failure 判定拥有优先级。insufficient quota、认证、权限、context overflow 和其他现有不可重试错误不得因同时包含 429、rate 或 concurrency 文本而变为 retryable。现有 provider-specific 非目标规则，包括 OpenAI 404、5xx、网络错误、stream timeout、Go usage limit action 和错误展示，除新增配置上限外保持兼容。 | permanent failure 优先，现有 provider-specific 行为保持通过。 |
| A15 | passed | specs/provider-retry/spec.md | Session retry 的状态发布、取消和错误投影继续使用现有流程。配置只改变允许的最大 retry 次数；本 change 不新增 V2 Session retry 状态、provider/model failover、部分流回滚、tool 幂等或副作用去重。 | 状态、取消、投影和 cleanup 沿用原流程。 |
| A16 | passed | specs/provider-retry/spec.md | 实现必须将 `provider_retry.max_retries` 加入 V1/V2 Config schema、V1→V2 配置迁移和公开 JSON Schema/OpenAPI/SDK 类型。配置描述必须明确默认 10 且只控制 Session retry。不得新增第三方依赖。 | 公开契约与生成产物完整，无新增依赖。 |
| A17 | passed | specs/provider-retry/spec.md | 上一版未提交的 HTTP 429 专用实现不得作为本 capability 的组成部分：V2 executor 专用配置、model-backed search 统一预算、固定 10 秒最短等待、429 累计等待规则、递归 Session 删除中断和相关专用测试必须回到 Git 基线。独立 release 版本改动、用户全局 `opencode.jsonc` 与 Comet 历史产物不属于回退范围。 | 五个非目标源文件 scoped diff 为零，release 内容同步。 |
| A18 | passed | specs/provider-retry/spec.md | 验收必须使用确定性 fake error/provider 和 TestClock 覆盖：默认 10、配置 0、自定义次数、N+1 请求上限、次数耗尽、2 秒指数退避、0–25% jitter、120 秒本地单次封顶、超过 120 秒的合法 Retry-After、无效 Retry-After fallback、HTTP 429、rate-limit、user/account concurrency-limit、quota/auth/context/permanent 否决，以及 task/subagent 只继承子 Session 预算。还必须通过差异检查和定向测试证明 V2 RequestExecutor、model-backed search、MCP websearch、Session 删除和独立 release 文件未被本 capability 改写。真实 provider 调用不作为验收前提。 | Runtime 测试、TestClock、真实 TaskTool child、Processor child 与基线检查全部通过。 |

## Checks

| Check | Command | Working directory | Status | Exit | Duration |
| --- | --- | --- | --- | ---: | ---: |
| Provider retry, Processor, and TaskTool tests | test test/session/retry.test.ts test/provider/error.test.ts test/session/processor-effect.test.ts test/tool/task.test.ts | packages/opencode | passed | 0 | 36700 ms |
| Core config tests | test test/config/config.test.ts | packages/core | passed | 0 | 2073 ms |
| opencode typecheck | typecheck | packages/opencode | passed | 0 | 11627 ms |
| Core typecheck | typecheck | packages/core | passed | 0 | 5038 ms |
| Legacy JavaScript SDK typecheck | typecheck | packages/sdk/js | passed | 0 | 402 ms |
| Client generated files are current | run check:generated | packages/client | passed | 0 | 2056 ms |
| Non-target retry paths match Git baseline | diff --exit-code -- packages/llm/src/route/executor.ts packages/core/src/tool/websearch.ts packages/opencode/src/tool/websearch.ts packages/opencode/src/tool/mcp-websearch.ts packages/opencode/src/session/session.ts | . | passed | 0 | 124 ms |
| Release content is in sync | run release-content:check | . | passed | 0 | 256 ms |
| Git diff whitespace check | diff --check | . | passed | 0 | 209 ms |

## Blockers

_None._

## Risks and skipped work

_None reported._

## Previous iterations

| Goal cycle | Iteration | Attempt | Outcome | Unresolved | Summary | Completed |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 1 | 1 | fail | A4, A5, A6, A7, A9, A12, A14, A17, A18 | 配置 owner、预算、退避上限、schema/SDK 主体正确；需修复严格 Retry-After、认证/权限永久失败优先级，并补足强制验收证据。 | 2026-08-27T17:06:17.295Z |
| 1 | 2 | 1 | pass | — | candidate d7d85157-ce6f-4aa6-b36f-3d544d138b11 满足 A1-A18，可通过 iteration 2 attempt 1。 | 2026-08-27T17:17:56.249Z |

## Conclusion

candidate d7d85157-ce6f-4aa6-b36f-3d544d138b11 满足 A1-A18，可通过 iteration 2 attempt 1。
