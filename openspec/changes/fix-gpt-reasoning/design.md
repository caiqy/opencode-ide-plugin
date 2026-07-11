## Context

The project currently reuses reasoning-level arrays based on broad GPT version ranges. GPT-5.4 and GPT-5.5 need different handling for standard and Pro models, while GPT-5.6 Sol, Terra, and Luna differ in their support for `ultra`. The protocol layer also filters `max`, so generating the option alone would not produce a valid request.

Codex defines `ultra` as a product mode: the model request still sends `max`, while Codex separately enables proactive task delegation. This change implements only the request mapping and does not add proactive multi-agent behavior to the existing session orchestration.

## Goals / Non-Goals

**Goals:**

- Match generated variants to the supported effort levels of each GPT-5.4 through GPT-5.6 model.
- Allow OpenAI requests to send GPT-5.6 `max`.
- Display `极高 ultra` for Sol and Terra and set that variant's request effort to `max`.
- Remove `minimal` from every generated GPT variant and from the WebGUI label mapping while leaving the generic LLM schema available to non-GPT providers.
- Protect the model matrix, wire mapping, and label with focused tests.

**Non-Goals:**

- Implement Codex proactive multi-agent mode.
- Add model registrations, pricing, context-window metadata, or provider capability discovery.
- Guess `max` or `ultra` support for unknown third-party models.

## Decisions

### 1. Generate variants from explicit model families

Use a small set of shared effort constants and select them by concrete model ID:

- GPT-5.4 standard, mini, and nano: `none/low/medium/high/xhigh`
- GPT-5.4 Pro: `medium/high/xhigh`
- GPT-5.5 standard: `none/low/medium/high/xhigh`
- GPT-5.5 Pro: `medium/high/xhigh`
- GPT-5.6 Sol, including the `gpt-5.6` alias, and Terra: `none/low/medium/high/xhigh/max/ultra`
- GPT-5.6 Luna: `none/low/medium/high/xhigh/max`

Explicit branches preserve the Pro and GPT-5.6 submodel differences without guessing capabilities for future models. Family-specific matches run before broader version fallbacks. Matching uses each provider branch's canonical model identifier and the repository's anchored separator rules; unknown identifiers and Azure deployment names that do not identify the underlying model are not inferred.

### 2. Keep ultra as a UI variant and send max on the wire

The `ultra` variant body sets `reasoningEffort: "max"`. The variant key remains distinct for selection state, while the protocol layer sees only a supported OpenAI value. In this change, `max` and `ultra` produce the same model request and differ only as product-level option names.

The implementation must not send `ultra` to OpenAI or add it to the generic API effort schema.

### 3. Allow max in the OpenAI protocol layer

The OpenAI option transformation includes `max` among accepted efforts instead of filtering it. This permits an existing schema value and does not introduce a new wire value.

### 4. Preserve bilingual labels with the requested translation

The WebGUI renders `ultra` as `极高 ultra`. The global `minimal` translation and its component tests are removed because GPT variants no longer expose it. A non-GPT provider that still exposes the literal uses the existing fallback label `Minimal`. The shared LLM effort schema is not narrowed.

## Risks / Trade-offs

- [`ultra` does not include proactive delegation] -> Documentation and tests define it only as a `max` request mapping; orchestration remains a separate future change.
- [A third-party OpenAI-compatible endpoint may reject `max`] -> Generate the option only for explicitly recognized GPT-5.6 models rather than as a global default.
- [Snapshots or aliases may miss model matching] -> Cover base IDs, the `gpt-5.6` alias, and the repository's existing dated-snapshot matching form.
- [Earlier GPT-5 models lose `minimal`] -> This is an explicitly accepted product behavior change; a GPT-family branch removes it without changing the shared non-GPT fallback.
- [A persisted selection still names `minimal`] -> Existing variant lookup contributes no matching request options and falls back to normal base options; no data migration is required.

## Migration Plan

No data migration is required. A saved GPT `minimal` selection no longer resolves to variant request options and therefore uses normal base options. The code changes can be reverted directly if rollback is needed.

## Open Questions

None. Proactive multi-agent semantics are explicitly deferred to a separate design.
