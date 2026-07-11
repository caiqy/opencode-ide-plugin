---
change: fix-gpt-reasoning
design-doc: docs/superpowers/specs/2026-07-11-fix-gpt-reasoning-design.md
base-ref: 94d6407e445f2df662118037a10cdc10b08dfff2
---

# GPT Reasoning Options Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate the exact GPT-5.4, GPT-5.5, and GPT-5.6 reasoning-option matrix, map UI-only `ultra` to the OpenAI wire value `max`, and remove GPT/WebGUI-specific `minimal` behavior without changing non-GPT fallbacks.

**Architecture:** Keep provider variant selection in `ProviderTransform.variants` and retain its branch-based layout. Add only GPT-family effort constants, precise canonical-ID predicates, and one pure `ultra`-to-`max` conversion applied when OpenAI-shaped variant bodies are built. Preserve the existing stale-variant lookup behavior: an absent saved `minimal` key merges as no variant options over the regular base options.

**Tech Stack:** TypeScript, Bun test, Effect, AI SDK provider options, React 19, Vitest, Testing Library.

## Global Constraints

- Do not add dependencies, generated SDK changes, model-catalog synchronization, public API changes, persisted-selection migrations, directories, or abstractions beyond the single shared wire-effort conversion required below.
- Keep the existing shared `ReasoningEfforts` schema unchanged; non-GPT variants may continue to expose `minimal`.
- Match only canonical GPT IDs at the start of an ID or after `/`, plus the explicit `openai.` separator used by Bedrock Mantle; accept dated snapshots only with a `-YYYY-MM-DD` suffix.
- Match GPT-5.4/5.5 Pro and named GPT-5.6 members before broader version fallbacks. Unknown, lookalike, third-party, and custom Azure deployment IDs must retain their existing fallback and never gain `max` or `ultra`.
- Preserve effort order exactly: `none`, `low`, `medium`, `high`, `xhigh`, `max`, `ultra` where supported.
- `ultra` remains the stored/UI variant key but every affected provider request body sends `max`, never `ultra`.
- Retain each provider's body shape: OpenAI, Azure, Bedrock Mantle, and AI Gateway use `reasoningEffort`; OpenRouter uses `reasoning.effort`.
- Run tests and `bun typecheck` only from their owning package directories. Run the WebGUI production build from `packages/opencode/webgui`; it includes its TypeScript build.

---

### Task 1: Lock down the GPT effort matrix and stale-selection fallback

**Files:**
- Modify: `packages/opencode/test/provider/transform.test.ts:2941-4021`
- Modify: `packages/opencode/test/provider/transform.test.ts:350-409`
- Modify: `packages/opencode/src/provider/transform.ts:519-598`

**Interfaces:**
- Consumes: `ProviderTransform.variants(model: Provider.Model): Record<string, Record<string, any>>`.
- Produces: GPT-5.4/5.5/5.6 variant keys in canonical effort order; unknown IDs still use the existing provider fallback.
- Preserves: `LLMRequestPrep.prepare(input)` merges `input.model.variants?.[input.user.model.variant] ?? {}` over normal base options.

- [x] **Step 1: Write failing table-driven variant and fallback tests**

In the existing `describe("ProviderTransform.variants")` block, use `createMockModel` and add this table-driven expectation. Keep the existing pre-5.4 tests unchanged; replace only old GPT-5.4/5.5 assertions that conflict with the matrix.

```ts
const gpt54And56Efforts = ["none", "low", "medium", "high", "xhigh"]
const gpt56FullEfforts = [...gpt54And56Efforts, "max", "ultra"]

for (const testCase of [
  { apiId: "gpt-5.4", efforts: gpt54And56Efforts },
  { apiId: "gpt-5.4-mini", efforts: gpt54And56Efforts },
  { apiId: "gpt-5.4-nano", efforts: gpt54And56Efforts },
  { apiId: "gpt-5.4-pro", efforts: ["medium", "high", "xhigh"] },
  { apiId: "gpt-5.5", efforts: gpt54And56Efforts },
  { apiId: "gpt-5.5-pro", efforts: ["medium", "high", "xhigh"] },
  { apiId: "gpt-5.6", efforts: gpt56FullEfforts },
  { apiId: "gpt-5.6-sol", efforts: gpt56FullEfforts },
  { apiId: "gpt-5.6-sol-2026-07-11", efforts: gpt56FullEfforts },
  { apiId: "gpt-5.6-terra", efforts: gpt56FullEfforts },
  { apiId: "gpt-5.6-luna", efforts: [...gpt54And56Efforts, "max"] },
]) {
  test(`${testCase.apiId} returns its exact reasoning matrix`, () => {
    const result = ProviderTransform.variants(
      createMockModel({
        id: `openai/${testCase.apiId}`,
        providerID: "openai",
        api: { id: testCase.apiId, url: "https://api.openai.com", npm: "@ai-sdk/openai" },
      }),
    )
    expect(Object.keys(result)).toEqual(testCase.efforts)
    expect(result.minimal).toBeUndefined()
  })
}
```

Update the existing legacy `gpt-5` expectations so they prove the GPT-family fallback no longer emits `minimal`:

```ts
expect(Object.keys(result)).not.toContain("minimal")
```

Add explicit canonical-separator and negative tests:

```ts
test("recognizes Bedrock Mantle's openai. GPT-5.6 catalog ID", () => {
  const result = ProviderTransform.variants(
    createMockModel({
      id: "amazon-bedrock/openai.gpt-5.6-terra",
      providerID: "amazon-bedrock",
      api: { id: "openai.gpt-5.6-terra", url: "https://bedrock.example", npm: "@ai-sdk/amazon-bedrock/mantle" },
    }),
  )
  expect(Object.keys(result)).toEqual(gpt56FullEfforts)
})

for (const apiId of [
  "gpt-5.60",
  "gpt-5.4-sol",
  "gpt-5.5-mini",
  "vendor.gpt-5.6-sol",
  "gpt-5.6-sol-custom",
  "gpt-5.6-azure-deployment",
]) {
  test(`${apiId} keeps the non-GPT-5.6 fallback`, () => {
    const result = ProviderTransform.variants(
      createMockModel({ api: { id: apiId, url: "https://azure.example", npm: "@ai-sdk/azure" } }),
    )
    expect(Object.keys(result)).not.toContain("max")
    expect(Object.keys(result)).not.toContain("ultra")
  })
}

test("retains minimal for a non-GPT OpenAI-compatible fallback", () => {
  const result = ProviderTransform.variants(
    createMockModel({
      id: "test/reasoning-model",
      api: { id: "reasoning-model", url: "https://api.test.com", npm: "@openrouter/ai-sdk-provider" },
    }),
  )
  expect(Object.keys(result)).toContain("minimal")
})
```

Add a request-preparation regression beside the existing Azure merge test. Build a GPT-5.6 model whose generated `variants` lacks `minimal`, request `variant: "minimal"`, and assert that the prepared options retain the normal GPT default rather than adding variant options:

```ts
expect(result.params.options.reasoningEffort).toBe("medium")
expect(result.params.options.reasoningSummary).toBe("auto")
expect(result.params.options.include).toEqual(["reasoning.encrypted_content"])
```

- [x] **Step 2: Run the focused variant test and verify it fails**

Run from `packages/opencode`:

```bash
bun test test/provider/transform.test.ts
```

Expected: FAIL because GPT variants still include `minimal`, GPT-5.6 has no `max`/`ultra`, `openai.gpt-5.6-*` is not recognized, and the stale-selection test cannot yet use the intended matrix.

- [x] **Step 3: Implement the minimal GPT-only matrix**

In `packages/opencode/src/provider/transform.ts`, retain the existing GPT-5/Codex/chat logic. Add only the constants and predicates needed for GPT-5.4 through GPT-5.6, before `versionedGpt5ReasoningEfforts`, then make the latter delegate to the exact matrix before its existing version fallback:

```ts
const OPENAI_GPT54_55_EFFORTS = ["none", "low", "medium", "high", "xhigh"]
const OPENAI_GPT54_55_PRO_EFFORTS = ["medium", "high", "xhigh"]
const OPENAI_GPT56_EFFORTS = [...OPENAI_GPT54_55_EFFORTS, "max"]
const OPENAI_GPT56_ULTRA_EFFORTS = [...OPENAI_GPT56_EFFORTS, "ultra"]

function gpt54To56ReasoningEfforts(apiId: string) {
  // Accept canonical names plus dated snapshots, never deployment-like suffixes.
  const match = /(?:^|[/.])gpt-5\.(4|5|6)(?:-(mini|nano|pro|sol|terra|luna))?(?:-\d{4}-\d{2}-\d{2})?$/i.exec(apiId)
  if (!match) return undefined
  const [, version, member] = match
  if (version === "4") {
    if (member === "pro") return OPENAI_GPT54_55_PRO_EFFORTS
    if (!member || member === "mini" || member === "nano") return OPENAI_GPT54_55_EFFORTS
    return undefined
  }
  if (version === "5") {
    if (member === "pro") return OPENAI_GPT54_55_PRO_EFFORTS
    if (!member) return OPENAI_GPT54_55_EFFORTS
    return undefined
  }
  if (member && member !== "sol" && member !== "terra" && member !== "luna") return undefined
  if (member === "luna") return OPENAI_GPT56_EFFORTS
  return OPENAI_GPT56_ULTRA_EFFORTS
}

function versionedGpt5ReasoningEfforts(apiId: string) {
  const exact = gpt54To56ReasoningEfforts(apiId)
  if (exact) return exact
  if (GPT5_VERSIONED_PRO_RE.test(apiId)) return OPENAI_GPT5_PRO_2_PLUS_EFFORTS
  const version = gpt5Version(apiId)
  if (version === undefined) return undefined
  if (version === 1) return OPENAI_GPT5_1_EFFORTS
  return OPENAI_GPT5_2_PLUS_EFFORTS
}
```

Do not remove `minimal` from `OPENAI_EFFORTS` or change `ReasoningEfforts`. Remove only `openaiReasoningEfforts`' GPT-family `minimal` insertion, and make `openaiCompatibleReasoningEfforts` return a GPT-only fallback without `minimal` before its final shared `OPENAI_EFFORTS` fallback:

```ts
function openaiCompatibleReasoningEfforts(id: string) {
  const apiId = id.toLowerCase()
  const chatEfforts = gpt5ChatReasoningEfforts(apiId)
  if (chatEfforts) return chatEfforts
  if (GPT5_PRO_RE.test(apiId)) return OPENAI_GPT5_PRO_EFFORTS
  const codexEfforts = gpt5CodexReasoningEfforts(apiId)
  if (codexEfforts) return codexEfforts
  const versionedEfforts = versionedGpt5ReasoningEfforts(apiId)
  if (versionedEfforts) return versionedEfforts
  if (GPT5_FAMILY_RE.test(apiId)) return WIDELY_SUPPORTED_EFFORTS
  return OPENAI_EFFORTS
}
```

- [x] **Step 4: Run the focused variant test and verify it passes**

Run from `packages/opencode`:

```bash
bun test test/provider/transform.test.ts
```

Expected: PASS; exact GPT-5.4/5.5/5.6 keys, Pro restrictions, aliases, dated snapshots, canonical `openai.` IDs, negative IDs, non-GPT `minimal`, and stale saved `minimal` fallback all pass.

- [ ] **Step 5: Commit the matrix change**

```bash
git add packages/opencode/src/provider/transform.ts packages/opencode/test/provider/transform.test.ts
git commit -m "fix(opencode): correct GPT reasoning variants"
```

### Task 2: Map ultra to max in every OpenAI-shaped body and permit Responses max

**Files:**
- Modify: `packages/opencode/src/provider/transform.ts:739-900`
- Modify: `packages/opencode/test/provider/transform.test.ts:2941-4021`
- Modify: `packages/opencode/test/provider/cf-ai-gateway-e2e.test.ts:98-122`
- Modify: `packages/llm/src/protocols/utils/openai-options.ts:5-8`
- Modify: `packages/llm/test/provider/openai-responses.test.ts:549-572`

**Interfaces:**
- Consumes: the `"ultra"` variant key from `ProviderTransform.variants`.
- Produces: `{ reasoningEffort: "max" }` for OpenAI, Azure, Bedrock Mantle, and AI Gateway branches; `{ reasoning: { effort: "max" } }` for OpenRouter.
- Preserves: `OpenAIOptions.reasoningEffort(request): ReasoningEffort | undefined`; OpenAI Responses accepts `max` and rejects no valid schema effort.

- [x] **Step 1: Write failing provider-body and Responses tests**

In `packages/opencode/test/provider/transform.test.ts`, add a table in the existing variants suite that uses a canonical GPT-5.6 Terra model and asserts both the key and exact provider-option body. Cover all affected branch shapes:

```ts
for (const testCase of [
  { npm: "@ai-sdk/openai", apiId: "gpt-5.6-terra", body: { reasoningEffort: "max", reasoningSummary: "auto", include: ["reasoning.encrypted_content"] } },
  { npm: "@ai-sdk/azure", apiId: "gpt-5.6-terra", body: { reasoningEffort: "max", reasoningSummary: "auto", include: ["reasoning.encrypted_content"] } },
  { npm: "@ai-sdk/amazon-bedrock/mantle", apiId: "openai.gpt-5.6-terra", body: { reasoningEffort: "max", reasoningSummary: "auto", include: ["reasoning.encrypted_content"] } },
  { npm: "ai-gateway-provider", apiId: "openai/gpt-5.6-terra", body: { reasoningEffort: "max" } },
  { npm: "@ai-sdk/gateway", apiId: "openai/gpt-5.6-terra", body: { reasoningEffort: "max" } },
  { npm: "@openrouter/ai-sdk-provider", apiId: "openai/gpt-5.6-terra", body: { reasoning: { effort: "max" } } },
]) {
  test(`${testCase.npm} maps ultra to max in its variant body`, () => {
    const variants = ProviderTransform.variants(createMockModel({ api: { id: testCase.apiId, url: "https://api.test.com", npm: testCase.npm } }))
    expect(variants.ultra).toEqual(testCase.body)
    expect(JSON.stringify(variants.ultra)).not.toContain("ultra")
  })
}
```

Extend `packages/opencode/test/provider/cf-ai-gateway-e2e.test.ts` using the existing `callThroughGateway` helper so the real AI Gateway path proves the wire body is `max`:

```ts
const variants = ProviderTransform.variants(cfModel("openai/gpt-5.6-terra"))
const upstream = await callThroughGateway("openai/gpt-5.6-terra", ProviderTransform.providerOptions(cfModel("openai/gpt-5.6-terra"), variants.ultra))
expect(upstream?.reasoning_effort).toBe("max")
```

In `packages/llm/test/provider/openai-responses.test.ts`, add an `it.effect` next to the existing provider-options test that prepares a Responses request with `reasoningEffort: "max"` and asserts:

```ts
expect(prepared.body.reasoning).toEqual({ effort: "max" })
```

- [x] **Step 2: Run focused tests and verify they fail**

Run from `packages/opencode`:

```bash
bun test test/provider/transform.test.ts test/provider/cf-ai-gateway-e2e.test.ts
```

Expected: FAIL because `ultra` is currently emitted literally or missing.

Run from `packages/llm`:

```bash
bun test test/provider/openai-responses.test.ts
```

Expected: FAIL because `OpenAIReasoningEfforts` filters out `max`.

- [x] **Step 3: Implement the single wire-value conversion and retain max in Responses**

In `packages/opencode/src/provider/transform.ts`, add one pure conversion alongside the effort constants, then use it only where each OpenAI-shaped variant body is constructed:

```ts
const openAIWireEffort = (effort: string) => (effort === "ultra" ? "max" : effort)
```

Apply it to the mapped effort in these existing `variants` branches:

```ts
{ reasoning: { effort: openAIWireEffort(effort) } } // @openrouter/ai-sdk-provider
{ reasoningEffort: openAIWireEffort(effort) }       // ai-gateway-provider and @ai-sdk/gateway OpenAI-shaped paths
{ reasoningEffort: openAIWireEffort(effort), reasoningSummary: "auto", include: INCLUDE_ENCRYPTED_REASONING } // Azure, OpenAI, Mantle
```

Do not remap the variant object key: `Object.fromEntries` must keep `"ultra"` as its key. Do not map non-OpenAI provider effort fields.

In `packages/llm/src/protocols/utils/openai-options.ts`, remove only the `max` exclusion so the existing type, schema, validator, and `lowerOptions` pass it through unchanged:

```ts
export const OpenAIReasoningEfforts = ReasoningEfforts
```

- [x] **Step 4: Run focused tests and verify they pass**

Run from `packages/opencode`:

```bash
bun test test/provider/transform.test.ts test/provider/cf-ai-gateway-e2e.test.ts
```

Expected: PASS; every affected variant body and the AI Gateway forwarded request contain `max`, not `ultra`.

Run from `packages/llm`:

```bash
bun test test/provider/openai-responses.test.ts
```

Expected: PASS; a selected `max` reaches the OpenAI Responses `reasoning.effort` field.

- [ ] **Step 5: Commit the wire mapping change**

```bash
git add packages/opencode/src/provider/transform.ts packages/opencode/test/provider/transform.test.ts packages/opencode/test/provider/cf-ai-gateway-e2e.test.ts packages/llm/src/protocols/utils/openai-options.ts packages/llm/test/provider/openai-responses.test.ts
git commit -m "fix(provider): map GPT ultra reasoning to max"
```

### Task 3: Update WebGUI labels and run package-scoped verification

**Files:**
- Modify: `packages/opencode/webgui/src/components/VariantSelector.tsx:11-31`
- Modify: `packages/opencode/webgui/src/components/VariantSelector.test.tsx:32-55`

**Interfaces:**
- Consumes: `variants: string[] | undefined` and `selectedVariant: string | undefined` from the provider-selected model.
- Produces: `formatVariantName("ultra") === "极高"`; an unrecognized or non-GPT `"minimal"` uses the existing capitalized fallback `"Minimal"`.
- Preserves: `onSelect` receives the original variant string and no model-specific WebGUI branch is introduced.

- [x] **Step 1: Replace obsolete minimal-label cases with failing ultra and fallback tests**

Replace the two `minimal` translation tests in `packages/opencode/webgui/src/components/VariantSelector.test.tsx` with these cases:

```tsx
it("renders ultra as a bilingual reasoning option", async () => {
  const user = userEvent.setup()
  render(<VariantSelector variants={["ultra", "max"]} selectedVariant={undefined} onSelect={vi.fn()} />)

  await user.click(screen.getByTitle("选择推理强度"))
  expect(screen.getByRole("button", { name: /极高\s*ultra/ })).toBeInTheDocument()
})

it("uses the compact ultra label after selection", () => {
  render(<VariantSelector variants={["ultra"]} selectedVariant="ultra" onSelect={vi.fn()} />)
  const trigger = screen.getByTitle("选择推理强度")
  expect(trigger).toHaveTextContent("极高")
  expect(trigger).not.toHaveTextContent("ultra")
})

it("falls back to Minimal for a non-GPT minimal option", async () => {
  const user = userEvent.setup()
  render(<VariantSelector variants={["minimal"]} selectedVariant={undefined} onSelect={vi.fn()} />)

  await user.click(screen.getByTitle("选择推理强度"))
  expect(screen.getByRole("button", { name: /Minimal\s*minimal/ })).toBeInTheDocument()
})
```

- [x] **Step 2: Run the focused WebGUI test and verify it fails**

Run from `packages/opencode/webgui`:

```bash
bun run test:run src/components/VariantSelector.test.tsx
```

Expected: FAIL because `ultra` has no Chinese label and `minimal` is still translated as `极低`.

- [x] **Step 3: Implement the label-only change**

In `formatVariantName`, remove the `minimal` branch and add `ultra` after `xhigh`; leave the final capitalization fallback unchanged:

```tsx
: variant === "xhigh"
  ? "超高"
  : variant === "ultra"
    ? "极高"
    : undefined
```

Do not add model detection, persistence migration, or selector state changes.

- [x] **Step 4: Run focused WebGUI test and verify it passes**

Run from `packages/opencode/webgui`:

```bash
bun run test:run src/components/VariantSelector.test.tsx
```

Expected: PASS; the menu shows `极高 ultra`, the selected control shows compact `极高`, and an existing non-GPT `minimal` falls back to `Minimal`.

- [x] **Step 5: Run final package-scoped verification**

Run from `packages/opencode`:

```bash
bun test test/provider/transform.test.ts test/provider/cf-ai-gateway-e2e.test.ts
bun typecheck
```

Expected: PASS.

Run from `packages/llm`:

```bash
bun test test/provider/openai-responses.test.ts
bun typecheck
```

Expected: PASS.

Run from `packages/opencode/webgui`:

```bash
bun run test:run src/components/VariantSelector.test.tsx
bun run build
```

Expected: PASS; `bun run build` completes `tsc -b` and the Vite production build.

- [ ] **Step 6: Commit the WebGUI label change**

```bash
git add packages/opencode/webgui/src/components/VariantSelector.tsx packages/opencode/webgui/src/components/VariantSelector.test.tsx
git commit -m "fix(webgui): label GPT ultra reasoning"
```
