# Agent Config Model Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Agent 配置页 native model `<select>` with the chat UI `ModelSelector` search picker while preserving default/clear behavior.

**Architecture:** Extend `ModelSelector` with optional props for clear/default support and settings-panel sizing/placement. `AgentConfigTab` parses its existing `provider/model` string into selector props and keeps all config mutation in the existing `updateAgent` function.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Tailwind CSS, existing SDK client mocks.

---

## Implementation Notes Added After Review

Current implementation went beyond the initial picker swap plan to cover production issues found during review and end-to-end testing:

- `ModelSelector` also supports `providersData`, `defaultIdsData`, and `renderInPortal` so Agent 配置页 can share one provider load across rows and avoid dropdown clipping inside SettingsPanel.
- Portal dropdown position is recalculated on window/ancestor scroll and resize.
- `useClickOutsideWithEscape` consumes Escape in capture phase so a nested model dropdown closes before SettingsPanel's document-level Escape handler can close the modal.
- `SettingsPanel` sends only changed top-level config fields. For Agent config changes, the changed top-level `agent` object is sent as a full replacement patch.
- `Config.updateGlobal()` writes top-level `agent` with replace semantics for both JSON and JSONC, so clearing a nested model removes stale `agent.<name>.model` from disk.
- Global config updates treat `agent` as lightweight: saving Agent model/variant config does not dispose instances or disconnect `/event`; active instances hot-reload `Agent.reloadModelConfig()` through `InstanceStore.provideAll(...)`.

---

## Files

- Modify: `packages/opencode/webgui/src/components/ModelSelector.tsx`
  - Add optional clear/default props.
  - Add placement and button class customization.
  - Add optional preloaded provider/default data props.
  - Add optional portal rendering and scroll/resize position refresh.
  - Keep existing default behavior unchanged for chat.
- Modify: `packages/opencode/webgui/src/components/ModelSelector.test.tsx`
  - Add tests for clear/default behavior.
- Modify: `packages/opencode/webgui/src/components/settings/AgentConfigTab.tsx`
  - Replace model `<select>` with adapted `ModelSelector`.
  - Add a small parser for `provider/model` strings.
  - Pass preloaded provider/default data into each row's `ModelSelector`.
  - Render model dropdowns in a portal to avoid SettingsPanel overflow clipping.
- Modify: `packages/opencode/webgui/src/components/settings/AgentConfigTab.test.tsx`
  - Update tests to interact with the search picker.
  - Keep existing variant-clearing and reload coverage.
- Modify: `packages/opencode/webgui/src/components/SettingsPanel/index.tsx`
  - Save only changed top-level fields.
  - Ignore Escape if a child dropdown already handled it.
- Modify: `packages/opencode/webgui/src/hooks/useClickOutside.ts`
  - Consume Escape in capture phase for nested dropdowns.
- Modify: `packages/opencode/src/config/config.ts`
  - Replace top-level `agent` on global config writes to remove cleared nested model fields.
- Modify: `packages/opencode/src/server/routes/instance/httpapi/handlers/global.ts`
  - Avoid dispose for lightweight config changes and hot-reload agent model config.
- Modify: `packages/opencode/src/project/instance-store.ts`
  - Provide an effect across active instance refs for hot reload.
- Modify: `packages/opencode/src/agent/agent.ts`
  - Add `reloadModelConfig()` to refresh cached agent model/variant config.

---

### Task 1: Extend `ModelSelector` with optional clear/default support

**Files:**

- Modify: `packages/opencode/webgui/src/components/ModelSelector.tsx`
- Test: `packages/opencode/webgui/src/components/ModelSelector.test.tsx`

- [ ] **Step 1: Add failing tests for clear/default behavior**

Append these tests before the closing `})` of `describe("ModelSelector favorites", () => {` in `packages/opencode/webgui/src/components/ModelSelector.test.tsx`:

```tsx
it("显示清空入口并在点击时调用 onClear", async () => {
  const onSelect = vi.fn()
  const onClear = vi.fn()
  render(
    <ModelSelector
      selectedProviderId="openai"
      selectedModelId="gpt-4.1"
      onSelect={onSelect}
      allowClear
      clearLabel="默认"
      onClear={onClear}
    />,
  )
  await screen.findByText("GPT 4.1")

  const user = userEvent.setup()
  await user.click(screen.getByTitle("选择模型"))
  await user.click(screen.getByRole("button", { name: "默认" }))

  expect(onClear).toHaveBeenCalledTimes(1)
  expect(onSelect).not.toHaveBeenCalled()
})

it("未选择模型时使用传入的 placeholder", async () => {
  render(<ModelSelector onSelect={() => {}} placeholder="默认" />)
  await screen.findByText("默认")
})

it("默认不显示清空入口", async () => {
  render(<ModelSelector selectedProviderId="openai" selectedModelId="gpt-4.1" onSelect={() => {}} />)
  await screen.findByText("GPT 4.1")

  const user = userEvent.setup()
  await user.click(screen.getByTitle("选择模型"))

  expect(screen.queryByRole("button", { name: "默认" })).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
cd packages/opencode/webgui
node_modules\.bin\vitest run src/components/ModelSelector.test.tsx
```

Expected: tests fail because `allowClear`, `clearLabel`, `onClear`, and `placeholder` props do not exist or do not affect the UI yet.

- [ ] **Step 3: Extend `ModelSelectorProps`**

In `packages/opencode/webgui/src/components/ModelSelector.tsx`, replace the props interface with:

```tsx
interface ModelSelectorProps {
  selectedProviderId?: string
  selectedModelId?: string
  onSelect: (providerId: string, modelId: string) => void | Promise<void>
  disabled?: boolean
  placeholder?: string
  allowClear?: boolean
  clearLabel?: string
  onClear?: () => void | Promise<void>
  buttonClassName?: string
  dropdownPlacement?: "top" | "bottom"
}
```

- [ ] **Step 4: Update `ModelSelector` function signature and display fallback**

Replace the function signature and `getCurrentDisplay` with:

```tsx
export function ModelSelector({
  selectedProviderId,
  selectedModelId,
  onSelect,
  disabled,
  placeholder = "选择模型",
  allowClear = false,
  clearLabel = "默认",
  onClear,
  buttonClassName,
  dropdownPlacement = "top",
}: ModelSelectorProps) {
  const { isOpen, searchTerm, setSearchTerm, dropdownRef, close, toggle } = useDropdown()
  const [providers, setProviders] = useState<Provider[]>([])
  const [defaultIds, setDefaultIds] = useState<{ [key: string]: string }>({})
  const [isLoading, setIsLoading] = useState(true)
  const [recent, setRecent] = useState<ModelEntry[]>([])
  const [favorite, setFavorite] = useState<ModelEntry[]>([])

  const favoriteSet = new Set(favorite.map(favoriteKey))

  const isFavorite = useCallback(
    (providerID: string, modelID: string) => favorite.some((f) => f.providerID === providerID && f.modelID === modelID),
    [favorite],
  )

  const getCurrentDisplay = () => {
    const pid = selectedProviderId || defaultIds.provider
    const mid = selectedModelId || defaultIds.model
    if (!pid || !mid) return placeholder
    const provider = providers.find((p) => p.id === pid)
    return provider?.models[mid]?.name || `${pid}/${mid}`
  }
```

Keep the existing `useEffect`, `handleSelect`, `toggleFavorite`, filter helpers, and `renderModelRow` below this block.

- [ ] **Step 5: Add clear handler and classes**

Add this function after `handleSelect`:

```tsx
const handleClear = async () => {
  await onClear?.()
  close()
}
```

Add these constants before the `return` statement:

```tsx
const buttonClasses =
  buttonClassName ??
  "h-6 px-1.5 text-xs text-gray-600 dark:text-gray-200 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 rounded disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-0.5"
const dropdownClasses =
  dropdownPlacement === "bottom"
    ? "absolute top-full left-0 mt-1 min-w-[300px] w-max max-w-[500px] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 max-h-96 overflow-hidden flex flex-col"
    : "absolute bottom-full left-0 mb-1 min-w-[300px] w-max max-w-[500px] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 max-h-96 overflow-hidden flex flex-col"
```

- [ ] **Step 6: Use customizable button/dropdown classes and render clear row**

In the returned JSX:

1. Replace the button's long Tailwind `className` string with `className={buttonClasses}`.
2. Replace the dropdown wrapper class with `className={dropdownClasses}`.
3. Inside `<div className="overflow-y-auto flex-1">`, before the loading/providers conditional, render the clear row when enabled:

```tsx
{
  allowClear && (
    <div className="border-b border-gray-100 dark:border-gray-800">
      <button
        type="button"
        onClick={handleClear}
        className="w-full px-3 py-2 text-xs text-left hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2 text-gray-900 dark:text-gray-100"
      >
        <ModelSelectionIndicator selected={!selectedProviderId && !selectedModelId} />
        <span className="font-medium truncate">{clearLabel}</span>
      </button>
    </div>
  )
}
```

- [ ] **Step 7: Run tests for `ModelSelector`**

Run:

```bash
cd packages/opencode/webgui
node_modules\.bin\vitest run src/components/ModelSelector.test.tsx
```

Expected: all `ModelSelector` tests pass.

- [ ] **Step 8: Commit Task 1**

Run:

```bash
git add packages/opencode/webgui/src/components/ModelSelector.tsx packages/opencode/webgui/src/components/ModelSelector.test.tsx
git commit -m "feat(webgui): add clearable model selector option"
```

---

### Task 2: Replace Agent 配置页 model `<select>` with `ModelSelector`

**Files:**

- Modify: `packages/opencode/webgui/src/components/settings/AgentConfigTab.tsx`
- Test: `packages/opencode/webgui/src/components/settings/AgentConfigTab.test.tsx`

- [ ] **Step 1: Add failing Agent 配置页 tests for picker behavior**

In `packages/opencode/webgui/src/components/settings/AgentConfigTab.test.tsx`, replace the existing `"selecting model updates formData"` test with:

```tsx
it("selecting model with the search picker updates formData", async () => {
  const user = userEvent.setup()
  const { setFormData } = setup()
  await waitFor(() => {
    expect(screen.getByText("build")).toBeInTheDocument()
  })

  const buildRow = screen.getByText("build").closest("tr")!
  await user.click(within(buildRow).getByTitle("选择模型"))
  await user.type(screen.getByPlaceholderText("搜索模型…"), "gpt-5.5")
  await user.click(screen.getByRole("button", { name: /GPT-5.5/ }))

  expect(setFormData).toHaveBeenCalledWith(
    expect.objectContaining({
      agent: expect.objectContaining({
        build: expect.objectContaining({ model: "openai/gpt-5.5" }),
      }),
    }),
  )
})
```

Update the import at the top to include `within`:

```tsx
import { render, screen, waitFor, within } from "@testing-library/react"
```

Add this new test after the model selection test:

```tsx
it("clearing model with the picker preserves other agent fields", async () => {
  const user = userEvent.setup()
  const formData = {
    agent: {
      build: { model: "openai/gpt-5.5", variant: "high", prompt: "custom prompt", temperature: 0.7 },
    },
  }
  const { setFormData } = setup(formData)
  await waitFor(() => {
    expect(screen.getByText("build")).toBeInTheDocument()
  })

  const buildRow = screen.getByText("build").closest("tr")!
  await user.click(within(buildRow).getByTitle("选择模型"))
  await user.click(screen.getByRole("button", { name: "默认" }))

  const call = setFormData.mock.calls[setFormData.mock.calls.length - 1][0]
  expect(call.agent.build.prompt).toBe("custom prompt")
  expect(call.agent.build.temperature).toBe(0.7)
  expect(call.agent.build.model).toBeUndefined()
  expect(call.agent.build.variant).toBeUndefined()
})
```

Replace the old `"changing model clears incompatible variant"` test body with picker interactions:

```tsx
it("changing model clears incompatible variant", async () => {
  const user = userEvent.setup()
  const formData = {
    agent: {
      build: { model: "anthropic/claude-opus-4-6", variant: "xhigh" },
    },
  }
  const { setFormData } = setup(formData)
  await waitFor(() => {
    expect(screen.getByText("build")).toBeInTheDocument()
  })

  const buildRow = screen.getByText("build").closest("tr")!
  await user.click(within(buildRow).getByTitle("选择模型"))
  await user.type(screen.getByPlaceholderText("搜索模型…"), "gpt-5.5")
  await user.click(screen.getByRole("button", { name: /GPT-5.5/ }))

  expect(setFormData).toHaveBeenCalledWith(
    expect.objectContaining({
      agent: expect.objectContaining({
        build: expect.objectContaining({ model: "openai/gpt-5.5", variant: undefined }),
      }),
    }),
  )
})
```

Remove the old test code that queries `buildRow.querySelectorAll("select")[0]` for model selection. The Variant `<select>` remains and may still be queried in future variant-specific tests.

- [ ] **Step 2: Run the failing Agent 配置页 tests**

Run:

```bash
cd packages/opencode/webgui
node_modules\.bin\vitest run src/components/settings/AgentConfigTab.test.tsx
```

Expected: tests fail because Agent 配置页 still renders a native model `<select>` and has no `ModelSelector` button.

- [ ] **Step 3: Import `ModelSelector` and add model parser**

At the top of `AgentConfigTab.tsx`, add:

```tsx
import { ModelSelector } from "../ModelSelector"
```

Add this helper near `getVariantsForModel`:

```tsx
function parseModelValue(modelValue: string | undefined) {
  if (!modelValue) return { providerID: undefined, modelID: undefined }
  const slashIndex = modelValue.indexOf("/")
  if (slashIndex < 0) return { providerID: undefined, modelID: undefined }
  const providerID = modelValue.slice(0, slashIndex)
  const modelID = modelValue.slice(slashIndex + 1)
  if (!providerID || !modelID) return { providerID: undefined, modelID: undefined }
  return { providerID, modelID }
}
```

- [ ] **Step 4: Replace the model `<select>` cell with `ModelSelector`**

Inside the `sortedRows.map((row) => {` block, after `const variants = getVariantsForModel(providers, row.model)`, add:

```tsx
const selectedModel = parseModelValue(row.model)
```

Replace the entire model `<td>` content currently containing `<select value={row.model ?? ""}` with:

```tsx
<td className="px-3 py-2">
  <ModelSelector
    selectedProviderId={selectedModel.providerID}
    selectedModelId={selectedModel.modelID}
    onSelect={(providerID, modelID) => updateAgent(row.name, "model", `${providerID}/${modelID}`)}
    allowClear
    clearLabel="默认"
    placeholder="默认"
    onClear={() => updateAgent(row.name, "model", undefined)}
    dropdownPlacement="bottom"
    buttonClassName="h-7 w-full max-w-[220px] px-2 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-between gap-1"
  />
</td>
```

Do not change the Variant `<select>` cell in this task.

- [ ] **Step 5: Ensure clearing model also clears variant**

In `updateAgent`, keep the existing model-change branch:

```tsx
if (field === "model") {
  const variants = getVariantsForModel(providers, value)
  if (updated.variant && !variants.includes(updated.variant)) {
    updated.variant = undefined
  }
}
```

This already clears variant when `value` is `undefined`, because `getVariantsForModel(providers, undefined)` returns `[]`.

- [ ] **Step 6: Run Agent 配置页 tests**

Run:

```bash
cd packages/opencode/webgui
node_modules\.bin\vitest run src/components/settings/AgentConfigTab.test.tsx
```

Expected: all `AgentConfigTab` tests pass.

- [ ] **Step 7: Commit Task 2**

Run:

```bash
git add packages/opencode/webgui/src/components/settings/AgentConfigTab.tsx packages/opencode/webgui/src/components/settings/AgentConfigTab.test.tsx
git commit -m "feat(webgui): use searchable model picker for agent config"
```

---

### Task 3: Regression verification for combined behavior

**Files:**

- Verify only unless tests reveal issues.

- [ ] **Step 1: Run focused component tests**

Run:

```bash
cd packages/opencode/webgui
node_modules\.bin\vitest run src/components/ModelSelector.test.tsx src/components/settings/AgentConfigTab.test.tsx
```

Expected: both test files pass with `0 fail`.

- [ ] **Step 2: Run SettingsPanel-related tests**

Run:

```bash
cd packages/opencode/webgui
node_modules\.bin\vitest run src/components/SettingsPanel src/components/settings/AgentConfigTab.test.tsx
```

Expected: SettingsPanel tests and AgentConfigTab tests pass with `0 fail`.

- [ ] **Step 3: Type-check webgui**

Run:

```bash
cd packages/opencode/webgui
node_modules\.bin\tsc --noEmit
```

Expected: command exits with code 0.

- [ ] **Step 4: Inspect final diff**

Run:

```bash
git status --short
git diff -- packages/opencode/webgui/src/components/ModelSelector.tsx packages/opencode/webgui/src/components/ModelSelector.test.tsx packages/opencode/webgui/src/components/settings/AgentConfigTab.tsx packages/opencode/webgui/src/components/settings/AgentConfigTab.test.tsx
```

Expected: only intended files are changed or all changes are already committed.

---

## Self-Review

- Spec goal “替换长原生下拉列表”：Task 2 replaces the model `<select>` with `ModelSelector`.
- Spec goal “默认/清空”：Task 1 adds clear support; Task 2 wires it to `updateAgent(row.name, "model", undefined)`.
- Spec goal “Variant 联动”：Task 2 keeps and relies on existing `updateAgent` variant validation.
- Spec goal “对话界面不回退”：Task 1 tests default behavior does not show clear entry.
- Review follow-up “不裁剪下拉”：implemented through `renderInPortal` and covered by portal/positioning tests.
- Review follow-up “Escape 不关闭 SettingsPanel”：implemented in `useClickOutsideWithEscape` capture handler and covered by SettingsPanel integration test.
- Review follow-up “清空 model 真正删除旧配置”：implemented by top-level `agent` replace semantics in `Config.updateGlobal` and covered by JSON/JSONC config tests.
- Review follow-up “保存不断连”：implemented by lightweight config detection + `Agent.reloadModelConfig()` hot reload instead of dispose; verified with focused tests and browser E2E.
- No placeholders remain; all commands and expected results are explicit.

---

## Final Verification Commands Used

```bash
cd packages/opencode
bun test test/config/config.test.ts -t "updates global agent config by replacing nested agent object"
```

Expected/observed: `2 pass`, `0 fail`.

```bash
cd packages/opencode/webgui
node_modules\.bin\vitest run src/components/SettingsPanel src/components/settings/AgentConfigTab.test.tsx src/components/ModelSelector.test.tsx src/state/repo/modelPrefsRepo.test.ts
```

Expected/observed: all focused frontend tests pass.

```bash
cd packages/opencode/webgui
node_modules\.bin\tsc --noEmit
```

Expected/observed: exits with code 0.

```bash
cd packages/opencode
bun run typecheck
```

Expected/observed: exits with code 0.

Manual E2E on `http://localhost:5173/app`:

1. Open Settings → Agent 配置.
2. Open `compaction` model picker, search and select `DeepSeek V4 Flash Free`.
3. Reopen picker and press Escape: dropdown closes, SettingsPanel remains open.
4. Save: `PATCH /global/config` returns 200; `/event` remains connected; no console errors/warnings.
