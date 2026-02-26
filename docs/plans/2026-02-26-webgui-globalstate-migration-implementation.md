# Webgui GlobalState Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 `packages/opencode/webgui/src` 运行时代码中的 localStorage 全量迁移到 globalState（`ideBridge.storageGet/storageSet`），并彻底切断历史键与兼容兜底。

**Architecture:** 新增统一 storage adapter（host 持久化 + 非 IDE 内存降级），业务层与 `sdk.model`/`sdk.kv` 只通过 adapter 访问存储。`sdk.model.get/update` 与 `sdk.kv.get/update` 的 API 名称保持不变，仅替换底层实现。写入失败通过统一错误语义上抛到提示层，使用 toast 轻提示并按 key+error 节流去重。

**Tech Stack:** TypeScript, React, Vitest, Bun, ideBridge

---

## Key Contract（先固定，避免实现分叉）

- 新键前缀统一：`opencode:webgui:<domain>:<name>`
- 本次使用：
  - `opencode:webgui:theme:v1`
  - `opencode:webgui:model:v1`
  - `opencode:webgui:kv:v1`
  - `opencode:webgui:draft_session:v1`
- 禁止读取/写入旧键：
  - `opencode_webgui_*`
  - `opencode_favorite_models_v1`
  - `oc-webgui-theme`
  - `opencode_selected_*`

---

### Task 1: 新增 storage adapter（host + memory + 统一错误语义）

**Files:**

- Create: `packages/opencode/webgui/src/state/globalState.ts`
- Create: `packages/opencode/webgui/src/state/globalState.test.ts`
- Modify: `packages/opencode/webgui/src/App.tsx`
- Test: `packages/opencode/webgui/src/state/globalState.test.ts`

**Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../lib/ideBridge", () => ({
  ideBridge: {
    isInstalled: vi.fn(),
    storageGet: vi.fn(),
    storageSet: vi.fn(),
  },
}))

import { ideBridge } from "../lib/ideBridge"
import {
  globalStateGetJSON,
  globalStateSetJSON,
  setGlobalStateWriteErrorReporter,
  resetGlobalStateForTest,
} from "./globalState"

describe("globalState", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-02-26T00:00:00Z"))
    resetGlobalStateForTest()
  })

  it("non-IDE 场景走内存态且可回读", async () => {
    ;(ideBridge.isInstalled as any).mockReturnValue(false)
    const w = await globalStateSetJSON("opencode:webgui:kv:v1", { a: 1 })
    const r = await globalStateGetJSON("opencode:webgui:kv:v1", {})
    expect(w.ok).toBe(true)
    expect(r).toEqual({ a: 1 })
  })

  it("host 写失败时按 key+error 节流上报", async () => {
    ;(ideBridge.isInstalled as any).mockReturnValue(true)
    ;(ideBridge.storageSet as any).mockResolvedValue(false)
    const report = vi.fn()
    setGlobalStateWriteErrorReporter(report)

    await globalStateSetJSON("opencode:webgui:theme:v1", "dark")
    await globalStateSetJSON("opencode:webgui:theme:v1", "light")
    expect(report).toHaveBeenCalledTimes(1)

    vi.setSystemTime(new Date("2026-02-26T00:00:06Z"))
    await globalStateSetJSON("opencode:webgui:theme:v1", "dark")
    expect(report).toHaveBeenCalledTimes(2)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/state/globalState.test.ts`  
Expected: FAIL（`globalState` 模块尚不存在）。

**Step 3: Write minimal implementation**

```ts
// src/state/globalState.ts
import { ideBridge } from "../lib/ideBridge"

type WriteError = "host_write_failed" | "invalid_payload"
type WriteResult = { ok: true } | { ok: false; error: WriteError }

const mem = new Map<string, string>()
const seen = new Map<string, number>()
const windowMs = 5000
let reporter: ((args: { key: string; error: WriteError; message: string }) => void) | null = null

function notify(key: string, error: WriteError) {
  const id = `${key}:${error}`
  const now = Date.now()
  const last = seen.get(id) ?? 0
  if (now - last < windowMs) return
  seen.set(id, now)
  reporter?.({ key, error, message: "设置未保存，本次会话可继续使用" })
}

export function setGlobalStateWriteErrorReporter(
  fn: ((args: { key: string; error: WriteError; message: string }) => void) | null,
) {
  reporter = fn
}

export function resetGlobalStateForTest() {
  mem.clear()
  seen.clear()
  reporter = null
}

export async function globalStateGet(keys: string[]) {
  if (!ideBridge.isInstalled()) return Object.fromEntries(keys.map((k) => [k, mem.get(k)]))
  const host = await ideBridge.storageGet(keys)
  if (!host) return Object.fromEntries(keys.map((k) => [k, mem.get(k)]))
  for (const key of keys) {
    if (typeof host[key] === "string") mem.set(key, host[key]!)
  }
  return Object.fromEntries(keys.map((k) => [k, host[k] ?? mem.get(k)]))
}

export async function globalStateSet(key: string, value: string): Promise<WriteResult> {
  mem.set(key, value)
  if (!ideBridge.isInstalled()) return { ok: true }
  const ok = await ideBridge.storageSet(key, value)
  if (ok) return { ok: true }
  notify(key, "host_write_failed")
  return { ok: false, error: "host_write_failed" }
}

export async function globalStateGetJSON<T>(key: string, fallback: T): Promise<T> {
  const raw = (await globalStateGet([key]))[key]
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export async function globalStateSetJSON(key: string, value: unknown): Promise<WriteResult> {
  return globalStateSet(key, JSON.stringify(value))
}
```

```ts
// src/App.tsx（挂接统一轻提示）
useEffect(() => {
  setGlobalStateWriteErrorReporter(({ message }) => {
    showToast(message, { variant: "warning", duration: 2500 })
  })
  return () => setGlobalStateWriteErrorReporter(null)
}, [showToast])
```

**Step 4: Run test to verify it passes**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/state/globalState.test.ts`  
Expected: PASS。

**Step 5: Commit**

```bash
git add packages/opencode/webgui/src/state/globalState.ts packages/opencode/webgui/src/state/globalState.test.ts packages/opencode/webgui/src/App.tsx
git commit -m "feat(webgui): add globalState adapter with typed write errors and throttled warning"
```

---

### Task 2: 重构 sdkClient 存储后端（API 不变，底层改 adapter）

**Files:**

- Modify: `packages/opencode/webgui/src/lib/api/sdkClient.ts`
- Modify: `packages/opencode/webgui/src/lib/api/sdkClient.migration.test.ts`
- Test: `packages/opencode/webgui/src/lib/api/sdkClient.migration.test.ts`

**Step 1: Write the failing test**

```ts
it("kv.get 不再读取 opencode_webgui_state_v1", async () => {
  localStorage.setItem("opencode_webgui_state_v1", JSON.stringify({ agent: "build" }))
  const r = await sdk.kv.get()
  expect(r.error).toBeNull()
  expect(r.data).toEqual({})
})

it("model.get 不再迁移 opencode_favorite_models_v1", async () => {
  localStorage.setItem("opencode_favorite_models_v1", JSON.stringify(["openai/gpt-4.1"]))
  const r = await sdk.model.get()
  expect(r.error).toBeNull()
  expect(r.data?.favorite).toEqual([])
})
```

**Step 2: Run test to verify it fails**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/lib/api/sdkClient.migration.test.ts`  
Expected: FAIL（当前实现仍包含 localStorage/旧键迁移逻辑）。

**Step 3: Write minimal implementation**

```ts
// src/lib/api/sdkClient.ts
import { globalStateGetJSON, globalStateSetJSON } from "../../state/globalState"

const modelKey = "opencode:webgui:model:v1"
const kvKey = "opencode:webgui:kv:v1"

async function modelValue(): Promise<ModelPreferences> {
  return globalStateGetJSON<ModelPreferences>(modelKey, {
    recent: [],
    favorite: [],
    variant: {},
  })
}

async function modelStore(value: ModelPreferences) {
  await globalStateSetJSON(modelKey, value)
}

async function kvValue() {
  return globalStateGetJSON<Record<string, any>>(kvKey, {})
}

async function kvStore(value: Record<string, any>) {
  await globalStateSetJSON(kvKey, value)
}

// 保持 sdk.model.get/update 与 sdk.kv.get/update API 形态不变
```

**Step 4: Run test to verify it passes**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/lib/api/sdkClient.migration.test.ts`  
Expected: PASS。

**Step 5: Commit**

```bash
git add packages/opencode/webgui/src/lib/api/sdkClient.ts packages/opencode/webgui/src/lib/api/sdkClient.migration.test.ts
git commit -m "refactor(webgui): switch sdk model and kv persistence to globalState adapter"
```

---

### Task 3: 迁移 ThemeContext 并删除 useLocalStorage hook

**Files:**

- Modify: `packages/opencode/webgui/src/state/ThemeContext.tsx`
- Modify: `packages/opencode/webgui/src/state/ThemeContext.test.tsx`
- Delete: `packages/opencode/webgui/src/hooks/useLocalStorage.ts`
- Delete: `packages/opencode/webgui/src/hooks/useLocalStorage.test.ts`
- Test: `packages/opencode/webgui/src/state/ThemeContext.test.tsx`

**Step 1: Write the failing test**

```ts
it("主题读写仅通过 globalState，不触发 localStorage", async () => {
  const getSpy = vi.spyOn(Storage.prototype, "getItem")
  const setSpy = vi.spyOn(Storage.prototype, "setItem")

  ;(globalStateGetJSON as any).mockResolvedValue("dark")

  render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  )

  await screen.findByText("dark")
  await userEvent.setup().click(screen.getByText("toggle"))

  expect(globalStateSetJSON).toHaveBeenCalledWith("opencode:webgui:theme:v1", "light")
  expect(getSpy).not.toHaveBeenCalled()
  expect(setSpy).not.toHaveBeenCalled()
})
```

**Step 2: Run test to verify it fails**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/state/ThemeContext.test.tsx`  
Expected: FAIL（当前实现仍依赖 `useLocalStorage` 与 `window.localStorage`）。

**Step 3: Write minimal implementation**

```ts
// src/state/ThemeContext.tsx
import { globalStateGetJSON, globalStateSetJSON } from "./globalState"

const THEME_KEY = "opencode:webgui:theme:v1"

const [theme, setTheme] = useState<Theme>("dark")

useEffect(() => {
  void globalStateGetJSON<Theme>(THEME_KEY, "dark").then((next) => {
    if (next === "dark" || next === "light") setTheme(next)
  })
}, [])

useEffect(() => {
  document.documentElement.classList.toggle("dark", theme === "dark")
  void globalStateSetJSON(THEME_KEY, theme)
}, [theme])
```

**Step 4: Run test to verify it passes**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/state/ThemeContext.test.tsx`  
Expected: PASS。

**Step 5: Commit**

```bash
git add packages/opencode/webgui/src/state/ThemeContext.tsx packages/opencode/webgui/src/state/ThemeContext.test.tsx
git add -A packages/opencode/webgui/src/hooks/useLocalStorage.ts packages/opencode/webgui/src/hooks/useLocalStorage.test.ts
git commit -m "refactor(webgui): migrate theme persistence to globalState and remove useLocalStorage hook"
```

---

### Task 4: 迁移 SessionContext（移除 localStorage fallback 与写回）

**Files:**

- Modify: `packages/opencode/webgui/src/state/SessionContext.tsx`
- Modify: `packages/opencode/webgui/src/state/SessionContext.test.tsx`
- Test: `packages/opencode/webgui/src/state/SessionContext.test.tsx`

**Step 1: Write the failing test**

```ts
it("setSelectedModel/setSelectedAgent 不再读取或写入 opencode_selected_*", async () => {
  const getSpy = vi.spyOn(Storage.prototype, "getItem")
  const setSpy = vi.spyOn(Storage.prototype, "setItem")

  const { result } = renderHook(() => useSession(), { wrapper })
  await waitFor(() => expect(result.current.selectedAgent).toBeTruthy())

  await act(async () => {
    await result.current.setSelectedModel("openai", "gpt-4.1")
    await result.current.setSelectedAgent("plan")
  })

  expect(getSpy).not.toHaveBeenCalledWith("opencode_selected_provider")
  expect(getSpy).not.toHaveBeenCalledWith("opencode_selected_model")
  expect(getSpy).not.toHaveBeenCalledWith("opencode_selected_agent")
  expect(setSpy).not.toHaveBeenCalled()
})
```

**Step 2: Run test to verify it fails**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/state/SessionContext.test.tsx`  
Expected: FAIL（当前实现仍存在 localStorage fallback/写回）。

**Step 3: Write minimal implementation**

```ts
// src/state/SessionContext.tsx
// 删除 initializeState catch 中 localStorage fallback
// 删除 setSelectedModel/setSelectedAgent/restoreSelections 中 localStorage set/remove
// 仅保留 sdk.kv.update + sdk.model.update + lastSelectionStore(host)

const setSelectedModel = useCallback(
  async (providerId: string, modelId: string) => {
    setSelectedProviderId(providerId)
    setSelectedModelId(modelId)
    await sdk.kv.update({ body: { webgui_provider: providerId, webgui_model: modelId } })
    await sdk.model.update({ body: { recent: nextRecent } })
  },
  [nextRecent],
)
```

**Step 4: Run test to verify it passes**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/state/SessionContext.test.tsx`  
Expected: PASS。

**Step 5: Commit**

```bash
git add packages/opencode/webgui/src/state/SessionContext.tsx packages/opencode/webgui/src/state/SessionContext.test.tsx
git commit -m "refactor(webgui): remove localStorage selection fallback from session context"
```

---

### Task 5: 迁移 ModelSelector 与 uiBridgeState（去掉历史键路径）

**Files:**

- Modify: `packages/opencode/webgui/src/components/ModelSelector.tsx`
- Modify: `packages/opencode/webgui/src/components/ModelSelector.test.tsx`
- Modify: `packages/opencode/webgui/src/state/uiBridgeState.ts`
- Modify: `packages/opencode/webgui/src/state/uiBridgeState.test.ts`
- Test: `packages/opencode/webgui/src/components/ModelSelector.test.tsx`
- Test: `packages/opencode/webgui/src/state/uiBridgeState.test.ts`

**Step 1: Write the failing test**

```ts
it("ModelSelector 不读取 opencode_favorite_models_v1", async () => {
  localStorage.setItem("opencode_favorite_models_v1", JSON.stringify(["openai/gpt-4.1"]))
  const getSpy = vi.spyOn(Storage.prototype, "getItem")

  render(<ModelSelector onSelect={vi.fn()} />)
  await screen.findByText("选择模型")

  expect(getSpy).not.toHaveBeenCalledWith("opencode_favorite_models_v1")
})

it("uiBridge 草稿持久化只走 globalState key", async () => {
  const setSpy = vi.spyOn(Storage.prototype, "setItem")
  uiBridgeHydrate({})
  uiBridgeUpdateDraftSessionId("s-1")
  expect(setSpy).not.toHaveBeenCalled()
})
```

**Step 2: Run test to verify it fails**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/components/ModelSelector.test.tsx`  
Expected: FAIL（当前包含旧收藏键逻辑）。

Run: `bun run --cwd packages/opencode/webgui test:run -- src/state/uiBridgeState.test.ts`  
Expected: FAIL（当前仍有 localStorage 分支）。

**Step 3: Write minimal implementation**

```ts
// src/components/ModelSelector.tsx
// 删除 LEGACY_FAVORITE_KEY 及 parse/hydrate legacy 分支
// 收藏/最近仅来自 sdk.model.get 与 sdk.model.update
```

```ts
// src/state/uiBridgeState.ts
import { globalStateGetJSON, globalStateSetJSON } from "./globalState"

const draftKey = "opencode:webgui:draft_session:v1"

async function persistedDraftSessionId() {
  return globalStateGetJSON<string | null>(draftKey, null)
}

function persistDraftSessionId(id: string | null) {
  void globalStateSetJSON(draftKey, id)
}
```

**Step 4: Run test to verify it passes**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/components/ModelSelector.test.tsx`  
Expected: PASS。

Run: `bun run --cwd packages/opencode/webgui test:run -- src/state/uiBridgeState.test.ts`  
Expected: PASS。

**Step 5: Commit**

```bash
git add packages/opencode/webgui/src/components/ModelSelector.tsx packages/opencode/webgui/src/components/ModelSelector.test.tsx
git add packages/opencode/webgui/src/state/uiBridgeState.ts packages/opencode/webgui/src/state/uiBridgeState.test.ts
git commit -m "refactor(webgui): remove legacy favorite path and migrate draft session persistence to globalState"
```

---

### Task 6: 回归验证与封口（不引入脆弱 grep 单测）

**Files:**

- Modify: `packages/opencode/webgui/src/lib/api/sdkClient.migration.test.ts`
- Modify: `packages/opencode/webgui/src/state/ThemeContext.test.tsx`
- Modify: `packages/opencode/webgui/src/state/SessionContext.test.tsx`
- Modify: `packages/opencode/webgui/src/components/ModelSelector.test.tsx`
- Modify: `packages/opencode/webgui/src/state/uiBridgeState.test.ts`

**Step 1: Write the failing test**

```ts
// 追加到 sdkClient.migration.test.ts
it("sdk.model/sdk.kv 关键链路不触发 localStorage API", async () => {
  const getSpy = vi.spyOn(Storage.prototype, "getItem")
  const setSpy = vi.spyOn(Storage.prototype, "setItem")

  await sdk.kv.get()
  await sdk.model.get()
  await sdk.kv.update({ body: { foo: "bar" } })

  expect(getSpy).not.toHaveBeenCalled()
  expect(setSpy).not.toHaveBeenCalled()
})
```

**Step 2: Run test to verify it fails**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/lib/api/sdkClient.migration.test.ts`  
Expected: FAIL（若仍存在 localStorage 读写将触发断言失败）。

**Step 3: Write minimal implementation**

```ts
// 清理剩余 runtime localStorage 引用
// 仅保留测试代码中的 localStorage mock/spy
```

**Step 4: Run tests/build/grep to verify it passes**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/state/globalState.test.ts src/lib/api/sdkClient.migration.test.ts src/state/ThemeContext.test.tsx src/state/SessionContext.test.tsx src/components/ModelSelector.test.tsx src/state/uiBridgeState.test.ts`  
Expected: PASS。

Run: `bun run --cwd packages/opencode/webgui build`  
Expected: PASS。

Run: `rg -n "localStorage" packages/opencode/webgui/src --glob "!**/*.test.ts" --glob "!**/*.test.tsx"`  
Expected: 无输出（此项为验证命令，不写成单测）。

**Step 5: Commit**

```bash
git add packages/opencode/webgui/src/lib/api/sdkClient.migration.test.ts packages/opencode/webgui/src/state/ThemeContext.test.tsx packages/opencode/webgui/src/state/SessionContext.test.tsx packages/opencode/webgui/src/components/ModelSelector.test.tsx packages/opencode/webgui/src/state/uiBridgeState.test.ts
git commit -m "test(webgui): add storage path guards and verify runtime has no localStorage"
```

---

Plan complete and saved to `docs/plans/2026-02-26-webgui-globalstate-migration-implementation.md`.

Two execution options:

**1. Subagent-Driven (this session)** - 我在当前会话按任务逐个执行，并在每个任务后做审查与回归。  
**2. Parallel Session (separate)** - 你新开会话并加载 `superpowers:executing-plans`，按该计划批量推进。

Which approach?
