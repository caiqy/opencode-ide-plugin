# Native Web Search Routing

## Configuration

When native search is enabled, configuration supplies an ordered list of
explicit `provider/model` references. Supported providers are OpenAI,
Anthropic, and xAI. Each entry identifies the model that performs the search;
the implementation must not silently substitute a provider default model.

The ordered list is the fallback order. When the active conversation model's
provider is present and usable, that provider's search entry is attempted first.
All other entries retain their configured order. A provider/model entry is
usable only when its provider route and credentials can be resolved.

When native search is disabled or no native search routes are configured, the
existing Exa/Parallel-backed `websearch` behavior remains unchanged.

The optional `mode` selects the native search transport. It defaults to
`responses`. When `mode` is `alpha-search`, the configured route must use the
OpenAI provider and the request is sent to the Alpha Search endpoint instead of
the provider-native Responses or Messages declaration.

For Alpha Search, the endpoint URL is resolved from the selected model's
`api.url` first. When that URL is empty, the provider's `options.baseURL` is
used. Trailing slashes are removed before appending `/alpha/search`. The
request uses the provider credential as a Bearer token and must not expose the
credential in tool output or diagnostics returned to the user.

## Tool Behavior

Native search continues to be exposed to the conversation as the existing
local `websearch` tool and keeps its existing permission boundary. The tool
does not send a hosted search declaration in the conversation model's request.
Instead, after permission succeeds, it starts one independent search-model
request using the selected configured provider/model.

The independent request uses the provider-native search declaration:

- OpenAI: Responses API `web_search`.
- Anthropic: Messages API `web_search_20250305` server tool.
- xAI: Responses API `web_search`.

The independent request may be fulfilled by a different provider than the
conversation model. The active conversation provider only affects priority;
it never changes the configured search model or causes a request to be sent to
the conversation provider without a matching configured entry.

## Fallback and Errors

If the preferred search route cannot be resolved or its request fails, the
implementation tries the next configured route. It stops at the first
successful search response. If all routes fail, the local tool returns one
stable failure with provider and credential details redacted from user-facing
text; diagnostics may retain typed provider context.

The tool result contains the search answer, citations/source metadata when the
provider returns them, and the selected `provider/model` identity. The result
is returned to the active conversation model as ordinary local tool output.

Alpha Search responses use the returned `output` as the answer and project
returned `results` as sources. Private citation markers are removed before the
result is returned to the active conversation model.

## History and Runtime

The active conversation performs one local `websearch` tool call. The internal
search-model turn owns its provider-executed search events and does not expose
them as dispatchable local calls in the active conversation. The active
conversation runtime must not try to execute or redispatch the internal hosted
search call.

When native search mode is enabled, the model-visible Exa/Parallel execution
path is hidden. Disabling native mode restores the prior local provider
selection and behavior.

## Compatibility

Existing provider-executed event parsing, citation metadata, bounded output,
permission checks, and tool rendering remain compatible. Unsupported models or
routes do not receive a native search declaration. Ordinary local tools remain
available and continue to use their existing lowering and execution paths.

## Acceptance

- A1: Ordered explicit provider/model configuration is parsed and validated.
- A2: Same-provider preference and configured cross-provider fallback are
  deterministic.
- A3: Each supported provider receives its exact native search declaration.
- A4: Independent search results and citations are projected into the local
  `websearch` result without dispatching hosted calls in the active session.
- A5: Failed routes fall back in order and all-route failure is stable and
  redacted.
- A6: Native mode hides Exa/Parallel execution and disabled mode preserves it.
- A7: Focused protocol, routing, runtime, permission, and regression tests pass.
- A8: `websearch.mode` accepts `responses` and `alpha-search`, with `responses`
  as the default.
- A9: Alpha Search selects only OpenAI routes, resolves `api.url` before
  provider `options.baseURL`, appends `/alpha/search`, and sends Bearer
  credentials without exposing them.
- A10: Alpha Search `output` and `results` are projected into the local
  `websearch` result, with private citation markers removed.
- A11: Alpha Search configuration, URL fallback, route failure behavior, and a
  real runtime request are verified.
