# Brainstorm Summary

- Change: fix-gpt-reasoning
- Date: 2026-07-11

## Confirmed Facts

- Correct GPT-5.4 through GPT-5.6 reasoning variants by concrete model family.
- GPT-5.6 Sol and Terra expose `ultra`; Luna does not.
- `ultra` is a UI variant whose OpenAI request effort is `max`; proactive multi-agent behavior is out of scope.
- Display `ultra` as `极高 ultra`.
- The user confirmed a scope expansion: remove `minimal` from all generated GPT model variants and remove its WebGUI translation/tests. The generic LLM effort schema remains unchanged for non-GPT providers.

## Candidate Approaches

1. Confirmed: retain the current branch-based transformer, add explicit effort constants and narrow model predicates, and special-case the `ultra` variant body.
2. Replace transformer branches with a declarative model-to-effort table.
3. Import or synchronize the Codex model catalog at runtime/build time.

## Confirmed Technical Design

- Keep the branch-based transformer and add only the effort constants and model predicates needed for the concrete model families.
- Identify models through the canonical identifier already used by each provider branch; do not infer unknown Azure deployment names.
- Use one pure wire-value conversion that maps `ultra` to `max`; retain each provider's existing body shape.
- Unknown models do not gain `max` or `ultra`.
- Remove `minimal` through GPT-specific variant branches and remove its global WebGUI translation/tests, while retaining the generic schema and shared fallback for non-GPT providers.

## Risks

- Removing `minimal` globally changes earlier GPT-5 model options beyond the original GPT-5.4 through GPT-5.6 correction.
- `ultra` and `max` produce the same provider request because multi-agent orchestration is excluded.

## Spec Patch Candidate

Applied:

- Expanded the delta spec so no GPT model generates `minimal`.
- Updated proposal, design, and tasks to remove the generic WebGUI `minimal` translation and tests.

## Confirmed Test Strategy

- Table-driven provider tests cover all GPT-5.4 through GPT-5.6 model families, Pro variants, aliases, and key order.
- Provider tests verify that each affected branch carries `max` for `ultra`, including OpenAI-shaped and OpenRouter-shaped bodies.
- An OpenAI Responses preparation test verifies that `max` survives protocol lowering.
- WebGUI tests cover the `极高 ultra` menu and selected state and remove the obsolete `minimal` label cases.
- Run focused tests, package typechecks, and the WebGUI production build.
