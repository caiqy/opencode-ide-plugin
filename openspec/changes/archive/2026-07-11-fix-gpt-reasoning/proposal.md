## Why

The project currently uses overly broad rules to generate reasoning options for GPT-5.4 through GPT-5.6. Those rules cannot express the restricted Pro levels, GPT-5.6 `max`, or the Codex UI-to-API mapping for `ultra`, which can expose invalid options or hide supported capabilities.

## What Changes

- Generate reasoning levels according to the specific GPT-5.4, GPT-5.5, and GPT-5.6 model.
- Add `ultra` to GPT-5.6 Sol and Terra and map its request effort to `max`.
- Do not expose `ultra` for GPT-5.6 Luna, GPT-5.4, or GPT-5.5.
- Allow the native GPT-5.6 `max` effort through the OpenAI request transformation.
- Display `ultra` with the Chinese label `极高` and remove `minimal` from all generated GPT variants and WebGUI reasoning labels.

## Capabilities

### New Capabilities

- `gpt-reasoning-options`: Defines the available reasoning levels, UI labels, and OpenAI wire-value mapping for GPT-5.4 through GPT-5.6 models.

### Modified Capabilities

None.

## Impact

- Provider model variant generation.
- OpenAI reasoning-effort filtering and transformation.
- WebGUI reasoning labels and option tests, including removal of the generic GPT `minimal` presentation.
- No new dependency or change to public APIs, model catalogs, pricing, or session multi-agent orchestration.
