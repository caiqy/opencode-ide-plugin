---
comet_change: fix-gpt-reasoning
role: technical-design
canonical_spec: openspec
archived-with: 2026-07-11-fix-gpt-reasoning
status: final
---

# GPT Reasoning Options Design

## Goal

Generate the exact supported reasoning variants for GPT-5.4 through GPT-5.6, map the UI-only `ultra` variant to OpenAI's `max` wire value, and remove `minimal` from all GPT variants and WebGUI reasoning labels.

## Provider Variant Generation

Keep the existing branch-based implementation in `packages/opencode/src/provider/transform.ts`. Add only the shared effort arrays and model predicates needed to distinguish these families:

- GPT-5.4 standard, mini, and nano: `none`, `low`, `medium`, `high`, `xhigh`
- GPT-5.4 Pro: `medium`, `high`, `xhigh`
- GPT-5.5 standard: `none`, `low`, `medium`, `high`, `xhigh`
- GPT-5.5 Pro: `medium`, `high`, `xhigh`
- GPT-5.6 Sol, the `gpt-5.6` alias, and Terra: `none`, `low`, `medium`, `high`, `xhigh`, `max`, `ultra`
- GPT-5.6 Luna: `none`, `low`, `medium`, `high`, `xhigh`, `max`

Match the canonical model identifier already passed by each provider branch. Accept the repository's existing start-of-string or slash-prefixed GPT IDs and dated suffixes such as `gpt-5.6-sol-YYYY-MM-DD`; add only the explicit separator form required by a provider's canonical catalog ID. Match Pro and named GPT-5.6 families before their broader version fallback. Unknown future, lookalike, custom Azure deployment, or third-party IDs retain the existing fallback and do not gain `max` or `ultra`.

Remove `minimal` from the GPT fallback through the GPT-family branch rather than by deleting it from a shared OpenAI-compatible fallback that also serves non-GPT models. Do not narrow the generic LLM effort schema because non-GPT providers may still accept `minimal`.

## Wire Mapping

Add one pure effort conversion used by all OpenAI-shaped variant builders:

```ts
effort === "ultra" ? "max" : effort
```

The variant key remains `ultra`, preserving selection state. Each provider keeps its existing body shape: OpenAI, Azure, Bedrock Mantle, and AI Gateway use `reasoningEffort`; OpenRouter uses `reasoning.effort`. No request sends `ultra` as an API value.

In `packages/llm/src/protocols/utils/openai-options.ts`, stop filtering out the schema's existing `max` value so the selected effort reaches OpenAI Responses unchanged.

## WebGUI

In `VariantSelector.tsx`, add the bilingual label `极高 ultra` and remove the global `minimal` translation. A non-GPT provider that still supplies `minimal` consequently uses the component's existing fallback label `Minimal`. The selector remains data-driven from provider variants; no model-specific UI logic is added.

If a persisted GPT selection still names the removed `minimal` variant, the existing lookup finds no variant options and the request falls back to its normal base options. No stored session or preference migration is added.

## Verification

- Add table-driven variant tests for every model family, Pro restriction, alias, dated snapshot, and expected key order.
- Add negative cases for lookalike and unknown family IDs, plus a non-GPT regression proving its shared fallback can still expose `minimal`.
- Verify every affected provider branch maps `ultra` to `max`, including both `reasoningEffort` and OpenRouter's `reasoning.effort` body shapes.
- Verify OpenAI Responses preparation preserves `max`.
- Replace WebGUI `minimal` label cases with `极高 ultra` menu and selected-state cases.
- Verify a persisted removed `minimal` selection contributes no variant request options.
- Run focused package tests, `bun typecheck` from the affected package directories, and the WebGUI production build.

## Deliberate Exclusions

No dependency, generated SDK change, model catalog synchronization, public API change, or proactive multi-agent behavior is included. `max` and `ultra` intentionally produce the same provider request in this change.

