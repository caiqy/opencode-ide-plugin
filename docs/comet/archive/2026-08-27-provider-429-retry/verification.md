---
generated_from_state_version: 24
---

# Verification

## Current result

- Result: **Passed**
- Assurance: **skill-coordinated**
- Goal cycle: 3
- Iteration: 2
- Verifier attempt: 1
- Completed: 2026-08-27T11:56:02.962Z
- Summary: 独立只读复核确认旧候选的五类问题均已关闭，A1-A16 全部通过。

## Acceptance

| ID | Result | Source | Criterion | Reason |
| --- | --- | --- | --- | --- |
| A1 | passed | brief.md | A1：普通对话、配置 model 的 native/alpha search 和 task/subagent 在任何可见输出前收到 HTTP 429 时会自动重试，成功后只产生一份最终回答或搜索结果。 | legacy Session、V2 RequestExecutor、V1/V2 model-backed native/alpha search 均在可见输出前处理 HTTP 429；task/subagent 复用子 Session 机制，成功路径只保留一份最终结果。 |
| A2 | passed | brief.md | A2：所有新增 HTTP 429 路径每次至少等待 10 秒；严格合法的 Retry-After 要求更久时等待更久，缺失、无效或短于 10 秒时等待 10 秒，不再使用指数退避或累计等待上限。 | 新增 429 路径统一使用 max(10000ms, 合法 Retry-After)，没有指数退避或累计等待上限；legacy 不再截断超过 2^31-1ms 的合法值。 |
| A3 | passed | brief.md | A3：`provider_retry.max_retries` 以非负整数配置每个 provider turn 或 model-backed search invocation 在初始请求外的最大重试次数；未配置默认 5，配置 0 关闭，SDK、executor 和 route fallback 不会各自重置次数。 | provider_retry.max_retries 为非负整数，默认 5、0 禁用；各路径各自只有一个预算 owner，search 只对 HTTP 429 增加 retry 计数。 |
| A4 | passed | brief.md | A4：用户取消、父 task 取消或 Session 删除会中断当前等待并阻止后续 provider 请求。 | 等待均可中断；Session.remove 动态读取 SessionExecution.Service，依次中断 root、child、grandchild，V1 同时取消前台执行。 |
| A5 | passed | brief.md | A5：明确的 quota exceeded、认证、权限和其他 typed permanent failure 直接失败；既有 provider-specific 非 429 分类不因本 change 改变。 | typed permanent failure 均为 terminal；legacy 已识别 error.type=insufficient_quota，即使 SDK 标记 isRetryable=true 也不会重试。 |
| A6 | passed | brief.md | A6：provider 已产生 text、reasoning、hosted/local tool 事件后再失败时不会重试整轮。 | legacy 可见输出 gate 与 V2 流边界均阻止部分输出后的整轮重放。 |
| A7 | passed | brief.md | A7：model-backed search 的 fallback 共用预算，最终错误保留脱敏后的 HTTP 状态、Retry-After 与 rate-limit/quota 分类；普通 MCP websearch 不增加重试。 | V1/V2 model-backed search 共享 invocation 级 429 预算，最终错误只投影脱敏状态、Retry-After 与分类；MCP 路径未增加 loop。 |
| A8 | passed | brief.md | A8：task/subagent 不建立额外 retry loop，仅由其子 Session 的 provider turn 使用上述预算。 | task 工具没有额外 retry loop，provider 重试仅由 child Session owner 负责。 |
| A9 | passed | specs/provider-retry/spec.md | 普通对话、配置 model 的 provider native/alpha search 与 task/subagent 子 Session 必须在 provider 尚未产生任何可见内容或 tool 事件时，对 HTTP 429 rate limit 自动重试。没有 HTTP 429 状态的流内 provider-error 不属于本能力，沿用既有处理。 | 能力限定于无可见输出的 HTTP 429；无 HTTP 429 的流内错误沿用既有行为。 |
| A10 | passed | specs/provider-retry/spec.md | `provider_retry.max_retries` 使用非负整数配置每个 provider turn 或 model-backed search invocation 在初始请求之外的最大重试次数。未配置时默认 5，配置 0 时关闭新增的 HTTP 429 自动重试。每次重试至少等待 10 秒；严格合法的 `retry-after-ms`、`Retry-After` 十进制秒数或未来 HTTP-date 要求更久时等待更久，负数、混合字符串、过期日期及其他非法值视为缺失。不使用指数退避、jitter 或累计等待上限。 | 三类合法 Retry-After 均严格解析，非法值回退 10 秒；默认、0、10 次和耗尽行为已有覆盖。 |
| A11 | passed | specs/provider-retry/spec.md | 明确的 quota exceeded、认证、权限和 typed permanent failure 不得因 HTTP 状态文本被重新分类为 retryable。既有 provider-specific 非 429 规则保持兼容，本能力不重新定义 OpenAI 404 等历史行为。 | 永久分类优先于 status/message retry 判定；既有非 429 provider 规则保持原分支。 |
| A12 | passed | specs/provider-retry/spec.md | 一旦本轮产生 text、reasoning、tool input、tool call、tool result 或其他可见 provider 事件，后续任何错误都直接结束本轮，不得清空、追加或重放。用户取消、父 task 取消或 Session 删除必须中断 retry wait，并保证取消后不再调用 provider。 | 部分输出后 retry 被禁止；用户取消、父 task 取消及 Session 删除均中断等待并阻止下一次请求。 |
| A13 | passed | specs/provider-retry/spec.md | 预算 owner 必须唯一，并使用合并后的同一个 `provider_retry.max_retries` 值。legacy Session orchestration 关闭 AI SDK/native executor 内层预算并继续发布现有 retry 状态；V2 普通 provider turn 由 typed RequestExecutor 拥有预算且不新增 V2 状态协议；V1/V2 model-backed search 由一次 tool invocation 拥有预算并关闭内部 SDK/executor 重试。task/subagent 不增加 task 级 retry loop。 | legacy、V2 turn、V1/V2 search 均有唯一预算 owner，task 不增加预算层。 |
| A14 | passed | specs/provider-retry/spec.md | 配置 model 的 native 与 alpha search fallback 必须共享最多 `max_retries + 1` 个总请求。最终失败只暴露脱敏后的 HTTP 状态、Retry-After 和 rate-limit/quota 分类，并只产生一个最终 tool result。未配置 model 的 Exa/Parallel MCP websearch 保持现状，不增加重试。 | native/alpha fallback 共享 429 计数，非 429 fallback 保持原行为；alpha quota 保留脱敏 HTTP 429、retry-after-ms 和 QuotaExceeded。 |
| A15 | passed | specs/provider-retry/spec.md | 实现必须将 `provider_retry.max_retries` 加入 V1/V2 Config schema 和生成的 JSON Schema，不得增加第三方依赖或第二个 V2 provider-turn 调用点。`@opencode-ai/llm` 的 V2 Session runner 继续每 turn 只显式调用一次 `llm.stream(request)`。 | V1/V2 Config、OpenAPI 与 SDK 均含配置；无新增依赖，V2 runner 保持单一 llm.stream(request) 调用。 |
| A16 | passed | specs/provider-retry/spec.md | 验收使用确定性 fake provider/HTTP 响应覆盖 429 后成功、合法和非法 Retry-After、10 秒最短等待、默认/0/10 次配置、次数耗尽、quota/permanent failure、取消、Session 删除、fallback 共用次数、部分输出后不重试，以及 task 子 Session 不增加第二层预算。真实上游调用不作为验收前提。 | 确定性测试覆盖规格列出的重试、等待、次数、永久错误、取消、删除、fallback、部分输出与 task 边界；Runtime 检查全部通过。 |

## Checks

| Check | Command | Working directory | Status | Exit | Duration |
| --- | --- | --- | --- | ---: | ---: |
| opencode retry, search, task and HTTP tests | test test/session/session.test.ts test/session/retry.test.ts test/session/llm.test.ts test/session/processor-effect.test.ts test/tool/websearch.test.ts test/tool/task.test.ts test/server/httpapi-session.test.ts test/server/httpapi-sdk.test.ts --timeout 30000 | packages/opencode | passed | 0 | 141267 ms |
| core config, websearch and SessionRunner tests | test test/tool-websearch.test.ts test/config/config.test.ts test/session-runner.test.ts --timeout 30000 | packages/core | passed | 0 | 6231 ms |
| llm executor and provider tests | test test/executor.test.ts test/provider --timeout 30000 | packages/llm | passed | 0 | 1358 ms |
| opencode typecheck | typecheck | packages/opencode | passed | 0 | 11693 ms |
| core typecheck | typecheck | packages/core | passed | 0 | 4399 ms |
| llm typecheck | typecheck | packages/llm | passed | 0 | 1255 ms |
| generated OpenAPI and SDK contract | -e const openapi=await Bun.file('packages/sdk/openapi.json').text(); const types=await Bun.file('packages/sdk/js/src/v2/gen/types.gen.ts').text(); if(!openapi.includes('provider_retry')\|\|!openapi.includes('max_retries')\|\|!types.includes('provider_retry?:')\|\|!types.includes('max_retries: number')) process.exit(1) | . | passed | 0 | 149 ms |
| global config schema validation | -e import {parse} from 'jsonc-parser'; import {Schema} from 'effect'; import {ConfigV1} from '@opencode-ai/core/v1/config/config'; const value=Schema.decodeUnknownSync(ConfigV1.Info)(parse(await Bun.file('C:/Users/caiqy/.config/opencode/opencode.jsonc').text()),{errors:'all',onExcessProperty:'ignore'}); if(value.provider_retry?.max_retries!==10) process.exit(1) | packages/opencode | passed | 0 | 1278 ms |
| git diff check | diff --check | . | passed | 0 | 229 ms |

## Blockers

_None._

## Risks and skipped work

- 全局配置变更需重启 opencode 后生效。

## Previous iterations

| Goal cycle | Iteration | Attempt | Outcome | Unresolved | Summary | Completed |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 1 | 1 | fail | A1, A4, A5, A8, A10, A11, A18, A24, A26, A27, A29, A35 | 验收失败：需解决 Session 删除取消、native owner 规格冲突、退避一致性与诊断/测试缺口。 | 2026-08-27T07:24:11.842Z |
| 1 | 2 | 0 | recovery | — | 收窄到已确认的 HTTP 429：普通对话、配置 model 的 native/alpha search 与 task/subagent；5次/120秒；首个可见输出前；Session 删除/取消中断；quota terminal；无 model MCP 排除。无 HTTP 状态的流内 provider-error、provider-specific 非429行为和新增 V2 retry 状态协议均不在本 change；legacy Session 与 V2 RequestExecutor 可分别作为各自 provider turn 的唯一 budget owner。 | 2026-08-27T07:27:48.105Z |
| 2 | 1 | 1 | fail | A5, A11 | 验收失败：V1 model-backed native search 未保证明确 insufficient_quota 覆盖 isRetryable=true。 | 2026-08-27T08:32:09.491Z |
| 2 | 2 | 1 | pass | — | 独立复核 A1-A16 全部通过；V1 native search 的 quota 优先分类缺口已关闭。 | 2026-08-27T08:51:50.270Z |
| 2 | 2 | 1 | recovery | — | 用户要求新增可配置的 HTTP 429 重试次数，并更新本机 opencode.jsonc；原 A15 的无配置项约束需要修订。 | 2026-08-27T09:09:38.913Z |
| 3 | 1 | 1 | fail | A2, A3, A4, A5, A7, A10, A11, A12, A14, A16 | 旧候选存在五类语义缺口，需要返回 Build 修复。 | 2026-08-27T11:45:04.420Z |
| 3 | 2 | 1 | pass | — | 独立只读复核确认旧候选的五类问题均已关闭，A1-A16 全部通过。 | 2026-08-27T11:56:02.962Z |

## Conclusion

独立只读复核确认旧候选的五类问题均已关闭，A1-A16 全部通过。
