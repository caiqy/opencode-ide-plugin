# Comet Design Handoff

- Change: fix-gpt-reasoning
- Phase: design
- Mode: compact
- Context hash: cf86923cc95a12492e20bfce9ce87ea99fd87f027b6fc4d4fff860fcf3ea6b74

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/fix-gpt-reasoning/proposal.md

- Source: openspec/changes/fix-gpt-reasoning/proposal.md
- Lines: 1-28
- SHA256: 2336f0c2304c5358564894f5d9abd6e0bd49add4935e8baeae1987d5f14815c7

```md
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

```

## openspec/changes/fix-gpt-reasoning/design.md

- Source: openspec/changes/fix-gpt-reasoning/design.md
- Lines: 1-66
- SHA256: 8eece43ff030f4d423478e356cca2f764238133c203f7d9b72134e8d64a802c2

```md
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

```

## openspec/changes/fix-gpt-reasoning/tasks.md

- Source: openspec/changes/fix-gpt-reasoning/tasks.md
- Lines: 1-14
- SHA256: 66e3b1eed2a1559d286893d0722faa465f11225af216f790cd16bde1d7ed8f78

```md
## 1. Provider reasoning matrix

- [ ] 1.1 Add failing tests for exact GPT-5.4/5.5/5.6 variant sets, aliases, snapshots, negative ID matches, and the preserved non-GPT fallback
- [ ] 1.2 Update provider variant generation and remove `minimal` through GPT-specific branches without changing the shared non-GPT fallback

## 2. OpenAI wire mapping

- [ ] 2.1 Add failing tests for preserving `max` and mapping `ultra` to `max` in each affected provider body shape
- [ ] 2.2 Allow the OpenAI protocol to send `max` while ensuring it never sends an `ultra` wire value

## 3. WebGUI labels and verification

- [ ] 3.1 Add `极高 ultra`, fallback `Minimal`, and stale saved-selection tests; remove the obsolete Chinese `minimal` label tests
- [ ] 3.2 Run the relevant package tests, typechecks, and WebGUI build to verify model options and request behavior

```

## openspec/changes/fix-gpt-reasoning/specs/gpt-reasoning-options/spec.md

- Source: openspec/changes/fix-gpt-reasoning/specs/gpt-reasoning-options/spec.md
- Lines: 1-74
- SHA256: 28eb577ddb21fe2f96aafdfe05928b0b48a747d5750d5086b4f5ab31de236323

```md
## ADDED Requirements

### Requirement: GPT-5.4 reasoning options match the concrete model
The system SHALL offer `none`, `low`, `medium`, `high`, and `xhigh` for GPT-5.4, GPT-5.4 mini, and GPT-5.4 nano. It SHALL offer only `medium`, `high`, and `xhigh` for GPT-5.4 Pro.

#### Scenario: Standard and smaller GPT-5.4 models
- **WHEN** the system generates variants for GPT-5.4, GPT-5.4 mini, or GPT-5.4 nano
- **THEN** the reasoning levels are exactly `none`, `low`, `medium`, `high`, and `xhigh`

#### Scenario: GPT-5.4 Pro
- **WHEN** the system generates variants for GPT-5.4 Pro
- **THEN** the reasoning levels are exactly `medium`, `high`, and `xhigh`

### Requirement: GPT-5.5 reasoning options match the concrete model
The system SHALL offer `none`, `low`, `medium`, `high`, and `xhigh` for GPT-5.5. It SHALL offer only `medium`, `high`, and `xhigh` for GPT-5.5 Pro.

#### Scenario: GPT-5.5
- **WHEN** the system generates variants for GPT-5.5
- **THEN** the reasoning levels are exactly `none`, `low`, `medium`, `high`, and `xhigh`

#### Scenario: GPT-5.5 Pro
- **WHEN** the system generates variants for GPT-5.5 Pro
- **THEN** the reasoning levels are exactly `medium`, `high`, and `xhigh`

### Requirement: GPT-5.6 reasoning options match the family member
The system SHALL offer `none`, `low`, `medium`, `high`, `xhigh`, and `max` for GPT-5.6 Sol, Terra, and Luna. It SHALL additionally offer `ultra` for Sol and Terra but MUST NOT offer `ultra` for Luna. The `gpt-5.6` alias SHALL use the same options as Sol.

#### Scenario: Sol and its alias
- **WHEN** the system generates variants for `gpt-5.6` or GPT-5.6 Sol
- **THEN** the reasoning levels are exactly `none`, `low`, `medium`, `high`, `xhigh`, `max`, and `ultra`

#### Scenario: Terra
- **WHEN** the system generates variants for GPT-5.6 Terra
- **THEN** the reasoning levels are exactly `none`, `low`, `medium`, `high`, `xhigh`, `max`, and `ultra`

#### Scenario: Luna
- **WHEN** the system generates variants for GPT-5.6 Luna
- **THEN** the reasoning levels are exactly `none`, `low`, `medium`, `high`, `xhigh`, and `max`

### Requirement: Ultra maps to OpenAI max effort
The system SHALL set the OpenAI request effort of the `ultra` variant to `max` and MUST NOT send `ultra` as an OpenAI API wire value.

#### Scenario: Selecting ultra
- **WHEN** a user selects `ultra` for a GPT-5.6 model that supports the option
- **THEN** the OpenAI request contains `reasoning.effort: "max"`

### Requirement: OpenAI requests allow max effort
The system SHALL accept and preserve the `max` reasoning effort produced by a GPT-5.6 variant.

#### Scenario: Selecting max
- **WHEN** a user selects `max` for a GPT-5.6 model
- **THEN** the OpenAI request contains `reasoning.effort: "max"`

### Requirement: WebGUI displays a bilingual ultra label
The WebGUI SHALL display the `ultra` reasoning option as `极高 ultra`.

#### Scenario: Rendering the ultra option
- **WHEN** the reasoning selector renders an `ultra` variant
- **THEN** the user sees the Chinese label `极高` and the English value `ultra`

### Requirement: GPT models do not offer minimal
The system MUST NOT generate a `minimal` variant for any GPT model and the WebGUI MUST NOT retain its global Chinese translation for `minimal`. The generic LLM effort schema and non-GPT provider variants MAY retain the literal.

#### Scenario: Generating variants for a GPT model
- **WHEN** the system generates variants for any GPT model
- **THEN** the variants do not contain `minimal`

#### Scenario: Rendering generic reasoning labels
- **WHEN** the WebGUI renders reasoning variants
- **THEN** it does not apply the removed Chinese `minimal` translation and a remaining non-GPT `minimal` option uses the normal fallback label

#### Scenario: Loading a removed saved selection
- **WHEN** a saved GPT selection still names the removed `minimal` variant
- **THEN** it contributes no variant-specific request options and the normal base options remain in effect

```
