# Hide Max When Ultra Is Available Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide the duplicate `max` variant for GPT-5.6 models that expose `ultra`, while preserving Luna's `max` variant and the `ultra` wire mapping.

**Architecture:** Change only the GPT-5.6 Sol/Terra effort constant in `ProviderTransform`; it becomes the common levels plus `ultra`, without `max`. The existing `openAIWireEffort` conversion continues to lower `ultra` to `max` in provider request bodies. Luna continues to use its existing common-levels-plus-`max` constant.

**Tech Stack:** TypeScript, Bun test, tsgo.

## Global Constraints

- Do not add dependencies, model catalog changes, API changes, migrations, UI-specific model detection, or new abstractions.
- GPT-5.6 Sol, Terra, and the `gpt-5.6` alias expose `none`, `low`, `medium`, `high`, `xhigh`, and `ultra` in that order.
- GPT-5.6 Luna exposes `none`, `low`, `medium`, `high`, `xhigh`, and `max` in that order.
- The `ultra` variant key must continue to send `max` in every existing OpenAI-shaped provider body.
- Run tests and `bun typecheck` from `packages/opencode` only.

---

### Task 1: Simplify GPT-5.6 variant keys

**Files:**
- Modify: `packages/opencode/test/provider/transform.test.ts:4122-4207`
- Modify: `packages/opencode/src/provider/transform.ts:528-573`

**Interfaces:**
- Consumes: `ProviderTransform.variants(model)`.
- Produces: Sol/Terra/alias matrices without `max`, Luna matrix with `max`, and unchanged `ultra` request bodies containing wire value `max`.

- [ ] **Step 1: Write failing matrix expectations**

In the existing GPT-5.6 table, replace the Sol/Terra/alias expected constant with:

```ts
const gpt56UltraEfforts = [...gpt54And55Efforts, "ultra"]
```

Use `gpt56UltraEfforts` for `gpt-5.6`, `gpt-5.6-sol`, `gpt-5.6-sol-2026-07-11`, `gpt-5.6-terra`, and the Bedrock Mantle `openai.gpt-5.6-terra` expectation. Keep Luna as:

```ts
[...gpt54And55Efforts, "max"]
```

Add `expect(result.max).toBeUndefined()` to the exact-matrix test cases that use `gpt56UltraEfforts`.

- [ ] **Step 2: Run the focused test and verify it fails**

Run from `packages/opencode`:

```bash
bun test test/provider/transform.test.ts
```

Expected: FAIL because Sol, Terra, aliases, snapshots, and Mantle still include `max` before `ultra`.

- [ ] **Step 3: Remove max from the ultra-specific constant**

In `packages/opencode/src/provider/transform.ts`, replace:

```ts
const OPENAI_GPT56_ULTRA_EFFORTS = [...OPENAI_GPT56_EFFORTS, "ultra"]
```

with:

```ts
const OPENAI_GPT56_ULTRA_EFFORTS = [...OPENAI_GPT54_55_EFFORTS, "ultra"]
```

Do not change `OPENAI_GPT56_EFFORTS`, `openAIWireEffort`, or the `member === "luna"` branch.

- [ ] **Step 4: Run focused provider tests and typecheck**

Run from `packages/opencode`:

```bash
bun test test/provider/transform.test.ts test/provider/cf-ai-gateway-e2e.test.ts
bun typecheck
```

Expected: PASS. Existing `ultra` provider-body and AI Gateway tests continue to assert the wire value `max`; Luna keeps `max` and no `ultra` key.

- [ ] **Step 5: Commit the simplification**

```bash
git add packages/opencode/src/provider/transform.ts packages/opencode/test/provider/transform.test.ts
git commit -m "fix(provider): hide max when ultra is available"
```
