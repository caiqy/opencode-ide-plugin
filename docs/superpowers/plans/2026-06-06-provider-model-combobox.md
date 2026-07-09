# Provider 模型白名单 Combobox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the native datalist whitelist picker with a styled combobox backed by an unfiltered models.dev catalog endpoint.

**Architecture:** Add a focused read-only config endpoint that exposes catalog models for one provider without applying the provider whitelist. The WebGUI wraps that endpoint in `sdk.config.providerModels(providerID)`, and `ProviderSettingsTab` uses a small self-contained custom combobox instead of browser `datalist`.

**Tech Stack:** Effect HttpApi, Provider service, Bun tests, React 19, Vitest, Testing Library, Tailwind utility classes.

---

## File Structure

- Modify: `packages/opencode/src/provider/provider.ts`
  - Add `ConfigProviderModelsResult` schema.
  - Add `catalogModels(providerID)` to `Provider.Service` so handlers can read unfiltered catalog models.
- Modify: `packages/opencode/src/server/routes/instance/httpapi/groups/config.ts`
  - Add `GET /config/providers/:providerID/models` endpoint.
- Modify: `packages/opencode/src/server/routes/instance/httpapi/handlers/config.ts`
  - Wire endpoint to `providerSvc.catalogModels(ctx.params.providerID)`.
- Modify: `packages/opencode/test/server/httpapi-config.test.ts`
  - Add HTTP regression coverage that catalog models include whitelist-filtered-out models.
- Modify: `packages/opencode/webgui/src/lib/api/sdkClient.ts`
  - Add `sdk.config.providerModels(providerID)` using `fetch`.
- Modify: `packages/opencode/webgui/src/components/settings/ProviderSettingsTab.tsx`
  - Replace `datalist` with custom combobox markup and state.
  - Load candidate models for the editing provider.
- Modify: `packages/opencode/webgui/src/components/settings/ProviderSettingsTab.test.tsx`
  - Add tests for no datalist, styled listbox, whitelist filtering, selecting a candidate, and manual add fallback.

## Task 1: Backend catalog model endpoint

**Files:**

- Modify: `packages/opencode/src/provider/provider.ts`
- Modify: `packages/opencode/src/server/routes/instance/httpapi/groups/config.ts`
- Modify: `packages/opencode/src/server/routes/instance/httpapi/handlers/config.ts`
- Test: `packages/opencode/test/server/httpapi-config.test.ts`

- [ ] **Step 1: Write the failing HTTP test**

Append this test inside `describe("config HttpApi", () => { ... })` in `packages/opencode/test/server/httpapi-config.test.ts`:

```ts
it.live(
  "serves provider catalog models without applying config whitelist",
  Effect.gen(function* () {
    const tmp = yield* tmpdirEffect({
      config: {
        formatter: false,
        lsp: false,
        provider: {
          anthropic: {
            whitelist: ["claude-sonnet-4-20250514"],
          },
        },
      },
    })

    const response = yield* Effect.promise(() =>
      Promise.resolve(
        app().request("/config/providers/anthropic/models", {
          headers: {
            "x-opencode-directory": tmp.path,
          },
        }),
      ),
    )

    expect(response.status).toBe(200)
    const body = (yield* Effect.promise(() => response.json())) as {
      providerID: string
      models: Array<{ id: string; name: string; status: string }>
    }
    expect(body.providerID).toBe("anthropic")
    expect(body.models.some((model) => model.id === "claude-sonnet-4-20250514")).toBe(true)
    expect(body.models.length).toBeGreaterThan(1)
  }),
)
```

- [ ] **Step 2: Run the backend test and verify RED**

Run from `packages/opencode`:

```bash
bun test test/server/httpapi-config.test.ts --timeout 30000
```

Expected: the new test fails with `404` or route not found for `/config/providers/anthropic/models`.

- [ ] **Step 3: Add Provider schema and service method**

In `packages/opencode/src/provider/provider.ts`, after `ConfigProvidersResult`, add:

```ts
export const ConfigProviderModelsResult = Schema.Struct({
  providerID: ProviderID,
  models: Schema.Array(
    Schema.Struct({
      id: ModelID,
      name: Schema.String,
      status: ModelStatus,
    }),
  ),
})
export type ConfigProviderModelsResult = Types.DeepMutable<Schema.Schema.Type<typeof ConfigProviderModelsResult>>
```

In the `Interface` block, add:

```ts
  readonly catalogModels: (providerID: ProviderID) => Effect.Effect<ConfigProviderModelsResult>
```

Near the existing `const list = ...` implementation, add:

```ts
const catalogModels = Effect.fn("Provider.catalogModels")(function* (providerID: ProviderID) {
  const stateValue = yield* InstanceState.use(state, (s) => s.catalog)
  const provider = stateValue[providerID]
  return {
    providerID,
    models: Object.values(provider?.models ?? {})
      .map((model) => ({ id: model.id, name: model.name, status: model.status }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  }
})
```

In the `Service.of({ ... })` return object, add:

```ts
      catalogModels,
```

- [ ] **Step 4: Add the HttpApi endpoint**

In `packages/opencode/src/server/routes/instance/httpapi/groups/config.ts`, add `Schema` and `ProviderID` imports:

```ts
import { Schema } from "effect"
import { ProviderID } from "@/provider/schema"
```

Add this endpoint after the existing `providers` endpoint:

```ts
        HttpApiEndpoint.get("providerModels", `${root}/providers/:providerID/models`, {
          params: { providerID: ProviderID },
          query: WorkspaceRoutingQuery,
          success: described(Provider.ConfigProviderModelsResult, "List catalog models for a provider"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "config.provider.models",
            summary: "List provider catalog models",
            description: "Get unfiltered catalog models for one provider so configuration UIs can edit whitelists.",
          }),
        ),
```

If `Schema` is unused after editing, remove that import; do not keep unused imports.

- [ ] **Step 5: Add the handler**

In `packages/opencode/src/server/routes/instance/httpapi/handlers/config.ts`, add:

```ts
const providerModels = Effect.fn("ConfigHttpApi.providerModels")(function* (ctx) {
  return yield* providerSvc.catalogModels(ctx.params.providerID)
})
```

Change the return chain to:

```ts
return handlers
  .handle("get", get)
  .handle("update", update)
  .handle("providers", providers)
  .handle("providerModels", providerModels)
```

- [ ] **Step 6: Run backend test and verify GREEN**

Run from `packages/opencode`:

```bash
bun test test/server/httpapi-config.test.ts --timeout 30000
```

Expected: all tests in `httpapi-config.test.ts` pass.

## Task 2: WebGUI SDK wrapper and combobox tests

**Files:**

- Modify: `packages/opencode/webgui/src/lib/api/sdkClient.ts`
- Modify: `packages/opencode/webgui/src/components/settings/ProviderSettingsTab.test.tsx`

- [ ] **Step 1: Add failing frontend tests**

In `ProviderSettingsTab.test.tsx`, extend the hoisted mocks:

```ts
const mocks = vi.hoisted(() => ({
  configUpdate: vi.fn(),
  configReplace: vi.fn(),
  configProviders: vi.fn(),
  configProviderModels: vi.fn(),
}))
```

Extend the SDK mock:

```ts
    config: {
      providers: (...args: unknown[]) => mocks.configProviders(...args),
      providerModels: (...args: unknown[]) => mocks.configProviderModels(...args),
    },
```

In `beforeEach`, add:

```ts
mocks.configProviderModels.mockResolvedValue({
  data: {
    providerID: "openai",
    models: [
      { id: "gpt-4.1", name: "GPT 4.1", status: "active" },
      { id: "gpt-4.1-mini", name: "GPT 4.1 Mini", status: "active" },
    ],
  },
  error: null,
})
```

Add these tests inside the `ProviderSettingsTab` describe:

```ts
  it("模型白名单使用自绘候选列表且不再渲染 datalist", async () => {
    const user = userEvent.setup()
    render(<ProviderSettingsTab formData={formData} setFormData={vi.fn()} onReloadConfig={vi.fn()} />)

    await user.click(screen.getByRole("button", { name: "编辑" }))
    expect(document.querySelector("datalist")).toBeNull()
    await user.click(screen.getByPlaceholderText(/选择或输入模型/))

    expect(await screen.findByRole("listbox", { name: "模型候选" })).toBeInTheDocument()
    expect(screen.queryByRole("option", { name: /gpt-4\.1$/ })).not.toBeInTheDocument()
    expect(screen.getByRole("option", { name: /gpt-4\.1-mini/ })).toBeInTheDocument()
  })

  it("可以从模型候选列表选择并添加 whitelist 外模型", async () => {
    const user = userEvent.setup()
    render(<ProviderSettingsTab formData={formData} setFormData={vi.fn()} onReloadConfig={vi.fn()} />)

    await user.click(screen.getByRole("button", { name: "编辑" }))
    await user.click(screen.getByPlaceholderText(/选择或输入模型/))
    await user.click(await screen.findByRole("option", { name: /gpt-4\.1-mini/ }))
    await user.click(screen.getByRole("button", { name: "添加模型" }))

    expect(screen.getByDisplayValue("gpt-4.1-mini")).toBeInTheDocument()
  })

  it("模型候选为空时仍可手动添加输入值", async () => {
    const user = userEvent.setup()
    mocks.configProviderModels.mockResolvedValue({ data: { providerID: "openai", models: [] }, error: null })
    render(<ProviderSettingsTab formData={formData} setFormData={vi.fn()} onReloadConfig={vi.fn()} />)

    await user.click(screen.getByRole("button", { name: "编辑" }))
    await user.type(screen.getByPlaceholderText(/选择或输入模型/), "custom-model")
    expect(screen.getByText("没有匹配的候选，可直接添加当前输入")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "添加模型" }))

    expect(screen.getByDisplayValue("custom-model")).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run frontend test and verify RED**

Run from repo root:

```bash
bun --cwd packages/opencode/webgui test:run -- --run src/components/settings/ProviderSettingsTab.test.tsx
```

Expected: tests fail because `sdk.config.providerModels` is missing and/or the component still renders `datalist`.

- [ ] **Step 3: Add SDK wrapper**

In `packages/opencode/webgui/src/lib/api/sdkClient.ts`, add this type near other local SDK helper types:

```ts
type ProviderCatalogModel = {
  id: string
  name: string
  status: string
}

type ProviderCatalogModelsResult = {
  providerID: string
  models: ProviderCatalogModel[]
}
```

Add this function near `globalConfigReplace`:

```ts
async function configProviderModels(providerID: string): Promise<ApiResult<ProviderCatalogModelsResult>> {
  try {
    const response = await fetch(`/config/providers/${encodeURIComponent(providerID)}/models`)

    if (!response.ok) {
      return {
        error: { message: "Failed to load provider catalog models" },
        data: null,
      }
    }

    const data = (await response.json()) as ProviderCatalogModelsResult
    return { data, error: null }
  } catch (error) {
    return {
      error: { message: error instanceof Error ? error.message : "Unknown error" },
      data: null,
    }
  }
}
```

Change the `sdk.config` object to:

```ts
  config: {
    providers: baseClient.config.providers.bind(baseClient.config),
    providerModels: configProviderModels,
  },
```

## Task 3: Custom ProviderSettingsTab combobox

**Files:**

- Modify: `packages/opencode/webgui/src/components/settings/ProviderSettingsTab.tsx`
- Test: `packages/opencode/webgui/src/components/settings/ProviderSettingsTab.test.tsx`

- [ ] **Step 1: Replace model state and loading effect**

In `ProviderSettingsTab.tsx`, replace `knownModels` state with:

```ts
const [catalogModels, setCatalogModels] = useState<Array<{ id: string; name: string; status: string }>>([])
const [modelListOpen, setModelListOpen] = useState(false)
```

Remove the `useEffect` that calls `sdk.config.providers()` for model options.

Add this effect below `editingProvider`:

```ts
useEffect(() => {
  if (!editingProviderId) {
    setCatalogModels([])
    setModelListOpen(false)
    return
  }
  sdk.config
    .providerModels(editingProviderId)
    .then((res) => setCatalogModels(res.data?.models ?? []))
    .catch(() => setCatalogModels([]))
}, [editingProviderId])
```

- [ ] **Step 2: Add filtered combobox options**

Replace the current `modelOptions` memo with:

```ts
const modelOptions = useMemo(() => {
  const query = modelInput.trim().toLowerCase()
  return catalogModels
    .filter((model) => !draft.whitelist.includes(model.id))
    .filter((model) => {
      if (!query) return true
      return model.id.toLowerCase().includes(query) || model.name.toLowerCase().includes(query)
    })
    .slice(0, 50)
}, [catalogModels, draft.whitelist, modelInput])
```

- [ ] **Step 3: Replace datalist markup with custom listbox**

Replace lines around the existing model input and `<datalist>` with:

```tsx
<div className="relative flex-1">
  <input
    aria-label="模型白名单输入"
    aria-autocomplete="list"
    aria-expanded={modelListOpen}
    aria-controls="provider-model-options"
    className="w-full rounded border border-gray-300 bg-white px-3 py-2 pr-8 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
    placeholder="选择或输入模型，例如 gpt-4.1"
    value={modelInput}
    disabled={isSaving}
    onFocus={() => setModelListOpen(true)}
    onChange={(event) => {
      setModelInput(event.target.value)
      setModelListOpen(true)
    }}
    onKeyDown={(event) => {
      if (event.key === "Enter" && modelInput.trim()) {
        event.preventDefault()
        addModel()
      }
      if (event.key === "Escape") setModelListOpen(false)
    }}
  />
  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">▾</span>
  {modelListOpen && !isSaving && (
    <div
      id="provider-model-options"
      role="listbox"
      aria-label="模型候选"
      className="absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-md border border-gray-200 bg-white py-1 text-sm shadow-xl dark:border-gray-700 dark:bg-gray-900"
    >
      {modelOptions.map((model) => (
        <button
          key={model.id}
          type="button"
          role="option"
          className="flex w-full flex-col px-3 py-2 text-left hover:bg-blue-50 focus:bg-blue-50 dark:hover:bg-gray-800 dark:focus:bg-gray-800"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setModelInput(model.id)
            setModelListOpen(false)
          }}
        >
          <span className="font-mono text-gray-900 dark:text-gray-100">{model.id}</span>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {model.name}
            {model.status !== "active" ? ` · ${model.status}` : ""}
          </span>
        </button>
      ))}
      {modelOptions.length === 0 && (
        <div className="px-3 py-2 text-gray-500 dark:text-gray-400">没有匹配的候选，可直接添加当前输入</div>
      )}
    </div>
  )}
</div>
```

Keep the existing `添加模型` button immediately after this div.

- [ ] **Step 4: Close list after add**

Change `addModel` to:

```ts
const addModel = () => {
  if (isSaving) return
  setDraft({ ...draft, whitelist: normalizeWhitelist([...draft.whitelist, modelInput]) })
  setModelInput("")
  setModelListOpen(false)
}
```

- [ ] **Step 5: Run frontend tests and verify GREEN**

Run from repo root:

```bash
bun --cwd packages/opencode/webgui test:run -- --run src/components/settings/ProviderSettingsTab.test.tsx
```

Expected: all `ProviderSettingsTab` tests pass.

## Task 4: Full verification and browser check

**Files:**

- No new files unless tests reveal a defect.

- [ ] **Step 1: Run backend config tests**

Run from `packages/opencode`:

```bash
bun test test/config/config.test.ts test/server/httpapi-config.test.ts --timeout 30000
```

Expected: all tests pass.

- [ ] **Step 2: Run WebGUI settings tests**

Run from repo root:

```bash
bun --cwd packages/opencode/webgui test:run -- --run src/components/settings/providerSettingsUtils.test.ts src/components/settings/ProviderSettingsTab.test.tsx src/components/settings/RestartRequiredModal.test.tsx src/components/SettingsPanel/TabBar.test.tsx src/components/SettingsPanel/index.test.tsx
```

Expected: all tests pass.

- [ ] **Step 3: Build WebGUI**

Run from `packages/opencode/webgui`:

```bash
bun run build
```

Expected: build exits 0. Existing Vite chunk-size warnings are acceptable.

- [ ] **Step 4: Verify in browser debug session**

Use Chrome DevTools on `http://localhost:5174/app`:

1. Open Settings → Provider 设置 → edit a provider.
2. Focus the “模型白名单” input.
3. Confirm the popup width matches the input width.
4. Type a partial model ID such as `claude` or `gpt`.
5. Confirm candidates include models not already in whitelist.
6. Click a candidate and add it.
7. Confirm it appears in the whitelist table.

## Self-Review

- Spec coverage: every spec goal maps to Task 1 backend catalog, Task 2 SDK/tests, Task 3 combobox, or Task 4 browser verification.
- Placeholder scan: no TBD/TODO/“implement later” placeholders remain.
- Type consistency: `ProviderCatalogModelsResult`, `ConfigProviderModelsResult`, and `providerModels(providerID)` names are used consistently across backend, SDK, tests, and UI.
