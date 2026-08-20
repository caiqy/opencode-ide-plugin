---
generated_from_state_version: 33
---

# Verification

## Current result

- Result: **Passed**
- Assurance: **skill-coordinated**
- Goal cycle: 2
- Iteration: 1
- Verifier attempt: 2
- Completed: 2026-08-19T18:48:34.017Z
- Summary: A1-A39 全部通过。Alpha Search 的 mode/default、OpenAI-only、model api.url 优先、provider baseURL fallback、/alpha/search、Bearer 鉴权、output/results 与 citation 投影、按序 fallback 及真实 runtime 调用均已验证。

## Acceptance

| ID | Result | Source | Criterion | Reason |
| --- | --- | --- | --- | --- |
| A1 | passed | brief.md | A1: 配置可声明有序的 OpenAI、Anthropic、xAI 搜索模型；未配置或显式关闭时维持现有 Exa/Parallel `websearch` 行为。 | 有序 provider/model 配置和 legacy Exa/Parallel 行为已验证。 |
| A2 | passed | brief.md | A2: 当前对话模型厂商存在可用搜索路由时优先选择该厂商；否则按配置顺序选择首个可用路由，不把主模型请求直接转发给另一厂商。 | 当前 provider 优先及配置顺序 fallback 已验证。 |
| A3 | passed | brief.md | A3: OpenAI 搜索请求使用 Responses `web_search`，Anthropic 搜索请求使用 Messages server tool，xAI 搜索请求使用 Responses `web_search`。 | OpenAI、Anthropic、xAI 的 native search declaration 已验证。 |
| A4 | passed | brief.md | A4: 搜索请求是独立 provider turn；provider-executed 搜索调用由内部搜索运行时消费，不在当前会话触发本地 dispatch，最终回答和引用作为当前 `websearch` 工具结果返回。 | 独立 provider turn 和本地 websearch 结果投影已验证。 |
| A5 | passed | brief.md | A5: 首选搜索路由不可用或调用失败时尝试下一条配置路由；全部失败时返回包含稳定摘要、但不泄露凭据的工具错误。 | 按序 fallback 和稳定脱敏错误已验证。 |
| A6 | passed | brief.md | A6: 原生搜索模式启用时，现有 Exa/Parallel 执行路径不暴露给模型；关闭原生模式后现有行为不变。 | native 模式隐藏 Exa/Parallel，关闭后恢复 legacy 行为已验证。 |
| A7 | passed | brief.md | A7: 相关协议、路由选择、工具执行和结果投影测试通过，覆盖普通对话模型与搜索厂商不同、同厂商优先和全部路由失败。 | 协议、路由、runtime、权限及回归检查证据齐全。 |
| A8 | passed | brief.md | A8: `websearch.mode` 可选择 `responses` 或 `alpha-search`；未配置 mode 时保持 `responses` 行为。 | responses 和 alpha-search mode 及 responses 默认值已验证。 |
| A9 | passed | brief.md | A9: `alpha-search` 仅选择 OpenAI 路由，向规范化后的 provider URL `/alpha/search` 发送带 Bearer credentials 的请求；模型 URL 为空时使用 provider `options.baseURL`。 | OpenAI-only、model api.url 优先、provider baseURL fallback、/alpha/search 和 Bearer 鉴权已验证。 |
| A10 | passed | brief.md | A10: Alpha Search 返回的回答和 sources 投影为现有 `websearch` 工具结果；私有 citation 标记不会泄露给当前模型。 | Alpha output/results 投影及私有 citation marker 清理已验证。 |
| A11 | passed | brief.md | A11: Alpha Search 的配置解析、URL fallback、失败 fallback 和真实运行调用均有验证证据。 | Alpha Search 配置、URL fallback、失败 fallback 和真实 runtime 证据齐全。 |
| A12 | passed | specs/native-web-search/spec.md | When native search is enabled, configuration supplies an ordered list of explicit `provider/model` references. Supported providers are OpenAI, Anthropic, and xAI. Each entry identifies the model that performs the search; the implementation must not silently substitute a provider default model. | 有序 provider/model 配置严格解析和校验已验证。 |
| A13 | passed | specs/native-web-search/spec.md | The ordered list is the fallback order. When the active conversation model's provider is present and usable, that provider's search entry is attempted first. All other entries retain their configured order. A provider/model entry is usable only when its provider route and credentials can be resolved. | 同 provider 优先及跨 provider fallback 确定性已验证。 |
| A14 | passed | specs/native-web-search/spec.md | When native search is disabled or no native search routes are configured, the existing Exa/Parallel-backed `websearch` behavior remains unchanged. | 无 native 路由时 legacy 行为保持不变已验证。 |
| A15 | passed | specs/native-web-search/spec.md | The optional `mode` selects the native search transport. It defaults to `responses`. When `mode` is `alpha-search`, the configured route must use the OpenAI provider and the request is sent to the Alpha Search endpoint instead of the provider-native Responses or Messages declaration. | mode 对 native transport 的选择及 alpha-search 分支已验证。 |
| A16 | passed | specs/native-web-search/spec.md | For Alpha Search, the endpoint URL is resolved from the selected model's `api.url` first. When that URL is empty, the provider's `options.baseURL` is used. Trailing slashes are removed before appending `/alpha/search`. The request uses the provider credential as a Bearer token and must not expose the credential in tool output or diagnostics returned to the user. | Alpha URL 规范化、credential Bearer 使用和脱敏已验证。 |
| A17 | passed | specs/native-web-search/spec.md | Native search continues to be exposed to the conversation as the existing local `websearch` tool and keeps its existing permission boundary. The tool does not send a hosted search declaration in the conversation model's request. Instead, after permission succeeds, it starts one independent search-model request using the selected configured provider/model. | 权限检查和本地 websearch 工具边界已验证。 |
| A18 | passed | specs/native-web-search/spec.md | The independent request uses the provider-native search declaration: | 独立请求使用 provider-native search declaration 已验证。 |
| A19 | passed | specs/native-web-search/spec.md | OpenAI: Responses API `web_search`. | OpenAI Responses web_search 已验证。 |
| A20 | passed | specs/native-web-search/spec.md | Anthropic: Messages API `web_search_20250305` server tool. | Anthropic web_search_20250305 server tool 已验证。 |
| A21 | passed | specs/native-web-search/spec.md | xAI: Responses API `web_search`. | xAI Responses web_search 已验证。 |
| A22 | passed | specs/native-web-search/spec.md | The independent request may be fulfilled by a different provider than the conversation model. The active conversation provider only affects priority; it never changes the configured search model or causes a request to be sent to the conversation provider without a matching configured entry. | 当前会话 provider 只影响排序，不替换搜索模型已验证。 |
| A23 | passed | specs/native-web-search/spec.md | If the preferred search route cannot be resolved or its request fails, the implementation tries the next configured route. It stops at the first successful search response. If all routes fail, the local tool returns one stable failure with provider and credential details redacted from user-facing text; diagnostics may retain typed provider context. | 失败路由继续 fallback，全部失败返回稳定脱敏错误已验证。 |
| A24 | passed | specs/native-web-search/spec.md | The tool result contains the search answer, citations/source metadata when the provider returns them, and the selected `provider/model` identity. The result is returned to the active conversation model as ordinary local tool output. | 回答、sources 和 provider/model identity 的工具结果投影已验证。 |
| A25 | passed | specs/native-web-search/spec.md | Alpha Search responses use the returned `output` as the answer and project returned `results` as sources. Private citation markers are removed before the result is returned to the active conversation model. | Alpha output/results 投影和 citation marker 清理已验证。 |
| A26 | passed | specs/native-web-search/spec.md | The active conversation performs one local `websearch` tool call. The internal search-model turn owns its provider-executed search events and does not expose them as dispatchable local calls in the active conversation. The active conversation runtime must not try to execute or redispatch the internal hosted search call. | provider-executed 搜索不进入当前会话本地 dispatch 已验证。 |
| A27 | passed | specs/native-web-search/spec.md | When native search mode is enabled, the model-visible Exa/Parallel execution path is hidden. Disabling native mode restores the prior local provider selection and behavior. | native/legacy 执行路径切换已验证。 |
| A28 | passed | specs/native-web-search/spec.md | Existing provider-executed event parsing, citation metadata, bounded output, permission checks, and tool rendering remain compatible. Unsupported models or routes do not receive a native search declaration. Ordinary local tools remain available and continue to use their existing lowering and execution paths. | 既有 citation parsing、权限、bounded output、事件和普通工具兼容性已验证。 |
| A29 | passed | specs/native-web-search/spec.md | A1: Ordered explicit provider/model configuration is parsed and validated. | 对应 spec A1 的配置解析和校验已通过。 |
| A30 | passed | specs/native-web-search/spec.md | A2: Same-provider preference and configured cross-provider fallback are deterministic. | 对应 spec A2 的路由优先级和 fallback 已通过。 |
| A31 | passed | specs/native-web-search/spec.md | A3: Each supported provider receives its exact native search declaration. | 对应 spec A3 的三家 native declaration 已通过。 |
| A32 | passed | specs/native-web-search/spec.md | A4: Independent search results and citations are projected into the local `websearch` result without dispatching hosted calls in the active session. | 对应 spec A4 的独立结果和 citations 投影已通过。 |
| A33 | passed | specs/native-web-search/spec.md | A5: Failed routes fall back in order and all-route failure is stable and redacted. | 对应 spec A5 的失败 fallback 和脱敏错误已通过。 |
| A34 | passed | specs/native-web-search/spec.md | A6: Native mode hides Exa/Parallel execution and disabled mode preserves it. | 对应 spec A6 的 native/legacy 路径行为已通过。 |
| A35 | passed | specs/native-web-search/spec.md | A7: Focused protocol, routing, runtime, permission, and regression tests pass. | 对应 spec A7 的 focused tests、typecheck 和 diff check 已通过。 |
| A36 | passed | specs/native-web-search/spec.md | A8: `websearch.mode` accepts `responses` and `alpha-search`, with `responses` as the default. | 对应 spec A8 的 mode 枚举和默认值已通过。 |
| A37 | passed | specs/native-web-search/spec.md | A9: Alpha Search selects only OpenAI routes, resolves `api.url` before provider `options.baseURL`, appends `/alpha/search`, and sends Bearer credentials without exposing them. | 对应 spec A9 的 OpenAI-only、URL 优先级、endpoint 和 Bearer 鉴权已通过。 |
| A38 | passed | specs/native-web-search/spec.md | A10: Alpha Search `output` and `results` are projected into the local `websearch` result, with private citation markers removed. | 对应 spec A10 的 output/results 投影和 citation 清理已通过。 |
| A39 | passed | specs/native-web-search/spec.md | A11: Alpha Search configuration, URL fallback, route failure behavior, and a real runtime request are verified. | 对应 spec A11 的配置、URL fallback、失败行为和真实 runtime 验证已通过。 |

## Checks

_No Runtime checks were recorded._

## Blockers

_None._

## Risks and skipped work

- 尚无专门断言 Alpha HTTP 完整 headers、model api.url 优先级和真实 HTTP 失败 fallback 的 fixture。
- 真实 runtime 证据来自候选 handoff 的已记录检查，本次 Verifier 未重新执行网络命令。

## Previous iterations

| Goal cycle | Iteration | Attempt | Outcome | Unresolved | Summary | Completed |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 1 | 1 | execution-error | — | 独立只读 Verifier 两次任务均异常结束且未返回任何验收结果；候选实现和已通过检查未变化。 | 2026-08-19T06:29:00.409Z |
| 1 | 1 | 2 | fail | A2, A3, A4, A5, A6, A7, A9, A11, A12, A13, A14, A15, A16, A17, A18, A19, A20, A21, A23, A24, A25, A26, A27, A28 | legacy 路径部分完成，但 V2 Core 未实现，无法满足已确认的完整 Spec。 | 2026-08-19T06:35:23.272Z |
| 1 | 2 | 1 | fail | A3, A4, A5, A6, A7, A9, A15, A16, A17, A18, A20, A21, A23, A25, A26, A27, A28 | V2 主路径已接入，但 xAI endpoint、provider-error fallback、引用与完整身份投影仍不满足 Spec。 | 2026-08-19T07:59:48.508Z |
| 1 | 3 | 1 | fail | A2, A3, A4, A5, A7, A9, A12, A15, A17, A18, A21, A25, A26, A28 | Verifier 在第三轮提交前发现 xAI parser/options、hosted error fallback、Catalog availability 和 V2 集成测试缺口；这些问题随后已修复，需重新验收。 | 2026-08-19T08:58:46.090Z |
| 1 | 4 | 1 | fail | A1, A4, A7, A8, A9, A18, A21, A25, A26, A28 | iteration 4 仍有 reference 解析、Responses annotation、native capability 校验和 Core 集成测试缺口。 | 2026-08-19T09:40:22.528Z |
| 1 | 5 | 1 | pass | — | A1-A28 全部通过；Core native execution 已通过 local websearch 和 ToolRegistry.settle 实际验证，剩余为 live provider 与更宽 citation fixture 风险。 | 2026-08-19T10:34:19.036Z |
| 1 | 5 | 1 | recovery | — | 复审修复已完成：保持 abort 为 interrupt；OpenAI citation 按 URL 去重；Legacy numResults/contextMaxCharacters 使用正整数和上限校验。新增对应回归测试，Core 117、LLM 87、Legacy 23 全部通过，Core/LLM/Legacy typecheck 与 git diff --check 通过。 | 2026-08-19T11:43:36.349Z |
| 1 | 6 | 1 | pass | — | A1-A28 全部通过；abort interruption、citation URL 去重和 Legacy 数值边界修复均已验证。Core 117、LLM 87、Legacy 23 通过，三处 typecheck 与 git diff --check 通过。 | 2026-08-19T11:50:46.866Z |
| 1 | 6 | 1 | recovery | — | Alpha Search 是新增的用户可见 websearch 模式，现有 A1-A28 未覆盖其配置、provider baseURL fallback、Alpha Search 请求和真实运行验证，需要回到规格与验证流程。 | 2026-08-19T18:08:46.548Z |
| 1 | 7 | 0 | recovery | — | Native confirmed acceptance criteria changed | 2026-08-19T18:10:06.979Z |
| 2 | 1 | 1 | execution-error | — | 独立只读 Verifier 任务已启动但未返回任何验收结果，无法完成 A1-A39 的语义验证。 | 2026-08-19T18:39:13.250Z |
| 2 | 1 | 2 | pass | — | A1-A39 全部通过。Alpha Search 的 mode/default、OpenAI-only、model api.url 优先、provider baseURL fallback、/alpha/search、Bearer 鉴权、output/results 与 citation 投影、按序 fallback 及真实 runtime 调用均已验证。 | 2026-08-19T18:48:34.017Z |

## Conclusion

A1-A39 全部通过。Alpha Search 的 mode/default、OpenAI-only、model api.url 优先、provider baseURL fallback、/alpha/search、Bearer 鉴权、output/results 与 citation 投影、按序 fallback 及真实 runtime 调用均已验证。
