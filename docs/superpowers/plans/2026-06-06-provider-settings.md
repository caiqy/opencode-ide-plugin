# Provider 设置页 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 WebGUI 右上角设置弹窗中新增默认打开的 `Provider 设置` tab，支持下载/合并全局配置、展示 provider、编辑 provider 字段并提示重启。

**Architecture:** 前端在现有 `SettingsPanel` 中新增一个聚焦的 `ProviderSettingsTab`，将 provider 配置的纯逻辑放入独立工具文件并用单元测试覆盖。保存继续走现有 `sdk.global.config.update`，该 API 的当前实现会在没有全局配置文件时创建 `opencode.jsonc`，并在已有全局配置文件时更新当前全局配置候选；本功能的 UI 文案面向全局 `opencode.jsonc`。

**Tech Stack:** React 19、Vitest、Testing Library、`@opencode-ai/sdk`、`jsonc-parser`、现有 `ideBridge.request("restartHost")`。

---

## File Structure

- Modify: `packages/opencode/webgui/package.json`
  - 添加 `jsonc-parser` 直接依赖，用于浏览器侧解析远程 JSONC。
- Create: `packages/opencode/webgui/src/components/settings/providerSettingsUtils.ts`
  - Provider 配置纯逻辑：API Key 脱敏、远程配置合并、provider 字段读写、白名单标准化。
- Create: `packages/opencode/webgui/src/components/settings/providerSettingsUtils.test.ts`
  - 覆盖所有纯逻辑与边界条件。
- Create: `packages/opencode/webgui/src/components/settings/RestartRequiredModal.tsx`
  - 保存成功后的重启提示弹窗。
- Create: `packages/opencode/webgui/src/components/settings/RestartRequiredModal.test.tsx`
  - 覆盖 `立即重启` 与 `暂不重启`。
- Create: `packages/opencode/webgui/src/components/settings/ProviderSettingsTab.tsx`
  - 配置更新区域、Provider 列表、编辑视图与保存交互。
- Create: `packages/opencode/webgui/src/components/settings/ProviderSettingsTab.test.tsx`
  - 覆盖 tab 主交互、编辑、下载更新和错误显示。
- Modify: `packages/opencode/webgui/src/components/SettingsPanel/TabBar.tsx`
  - 增加第一个 tab：`Provider 设置`。
- Modify: `packages/opencode/webgui/src/components/SettingsPanel/TabBar.test.tsx`
  - 调整 tab 顺序与点击测试。
- Modify: `packages/opencode/webgui/src/components/SettingsPanel/index.tsx`
  - 默认 active tab 改为 provider，渲染新 tab。
- Modify: `packages/opencode/webgui/src/components/SettingsPanel/index.test.tsx`
  - 覆盖默认打开 Provider 设置、旧 tab 不回归。

## Execution Order Note

按任务执行时先完成 `Task 4: 添加重启提示弹窗`，再完成 `Task 3: 添加 Provider 设置 tab UI 与单测`。这是因为 `ProviderSettingsTab` 最终实现会直接依赖 `RestartRequiredModal`。

---

### Task 1: 添加 JSONC 解析依赖

**Files:**

- Modify: `packages/opencode/webgui/package.json`

- [ ] **Step 1: 添加直接依赖**

在 `packages/opencode/webgui/package.json` 的 `dependencies` 中加入：

```json
"jsonc-parser": "3.3.1"
```

保持依赖区按现有风格简单排列即可，例如：

```json
"dependencies": {
  "@lexical/react": "0.37.0",
  "@opencode-ai/sdk": "workspace:*",
  "diff": "^7.0.0",
  "fuzzysort": "catalog:",
  "jsonc-parser": "3.3.1",
  "lexical": "0.37.0",
  "react": "^19.1.1",
  "react-dom": "^19.1.1",
  "react-syntax-highlighter": "^15.6.1"
}
```

- [ ] **Step 2: 安装依赖并更新 lockfile**

Run:

```powershell
bun install
```

Expected: 命令成功完成，并更新 lockfile 中 webgui workspace 的依赖信息。

- [ ] **Step 3: 验证 webgui 仍能解析依赖**

Run:

```powershell
bun --cwd packages/opencode/webgui test:run -- --run src/components/SettingsPanel/TabBar.test.tsx
```

Expected: `TabBar.test.tsx` 测试通过。

---

### Task 2: 实现 Provider 设置纯逻辑

**Files:**

- Create: `packages/opencode/webgui/src/components/settings/providerSettingsUtils.ts`
- Create: `packages/opencode/webgui/src/components/settings/providerSettingsUtils.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `packages/opencode/webgui/src/components/settings/providerSettingsUtils.test.ts`：

```ts
import { describe, expect, it } from "vitest"
import {
  applyRemoteConfigUpdate,
  buildUpdatedProvider,
  maskApiKey,
  normalizeWhitelist,
  providerRows,
} from "./providerSettingsUtils"

describe("maskApiKey", () => {
  it("空值显示未配置", () => {
    expect(maskApiKey(undefined)).toBe("未配置")
    expect(maskApiKey("")).toBe("未配置")
  })

  it("短 key 使用固定掩码", () => {
    expect(maskApiKey("abc123")).toBe("••••••")
  })

  it("长 key 保留首尾并中段脱敏", () => {
    expect(maskApiKey("sk-1234567890abcdef")).toBe("sk-1…cdef")
  })
})

describe("normalizeWhitelist", () => {
  it("去空、trim、去重并保留首次出现顺序", () => {
    expect(normalizeWhitelist([" gpt-4.1 ", "", "gpt-4.1", "claude-opus"])).toEqual(["gpt-4.1", "claude-opus"])
  })
})

describe("providerRows", () => {
  it("从 config.provider 生成列表行", () => {
    expect(
      providerRows({
        provider: {
          openai: { options: { baseURL: "https://api.example.com/v1", apiKey: "sk-1234567890abcdef" } },
          anthropic: {},
        },
      }),
    ).toEqual([
      {
        id: "anthropic",
        baseURL: undefined,
        apiKey: undefined,
        maskedApiKey: "未配置",
      },
      {
        id: "openai",
        baseURL: "https://api.example.com/v1",
        apiKey: "sk-1234567890abcdef",
        maskedApiKey: "sk-1…cdef",
      },
    ])
  })
})

describe("buildUpdatedProvider", () => {
  it("写入 baseURL、apiKey、whitelist", () => {
    expect(
      buildUpdatedProvider(
        { name: "OpenAI", options: { timeout: 1000, baseURL: "old", apiKey: "old-key" }, whitelist: ["old"] },
        { baseURL: "https://new.example.com/v1", apiKey: "new-key", whitelist: ["gpt-4.1", "gpt-4.1"] },
      ),
    ).toEqual({
      name: "OpenAI",
      options: { timeout: 1000, baseURL: "https://new.example.com/v1", apiKey: "new-key" },
      whitelist: ["gpt-4.1"],
    })
  })

  it("空 baseURL/apiKey 会从 options 中移除", () => {
    expect(
      buildUpdatedProvider(
        { options: { timeout: 1000, baseURL: "old", apiKey: "old-key" } },
        { baseURL: "", apiKey: "", whitelist: [] },
      ),
    ).toEqual({ options: { timeout: 1000 }, whitelist: [] })
  })
})

describe("applyRemoteConfigUpdate", () => {
  const local = {
    username: "local-user",
    provider: {
      openai: {
        name: "Local OpenAI",
        options: { baseURL: "https://local.example.com/v1", apiKey: "local-key", timeout: 1000 },
        whitelist: ["local-model"],
      },
    },
  }

  const remote = {
    username: "remote-user",
    provider: {
      openai: {
        name: "Remote OpenAI",
        options: { baseURL: "https://remote.example.com/v1", apiKey: "remote-key", chunkTimeout: 2000 },
        whitelist: ["remote-model"],
      },
      anthropic: { options: { apiKey: "anthropic-key" } },
    },
  }

  it("覆盖模式以远程为主体，但保留同名 provider 的 baseURL/apiKey", () => {
    expect(applyRemoteConfigUpdate(local, remote, "replace")).toEqual({
      username: "remote-user",
      provider: {
        openai: {
          name: "Remote OpenAI",
          options: {
            baseURL: "https://local.example.com/v1",
            apiKey: "local-key",
            chunkTimeout: 2000,
          },
          whitelist: ["remote-model"],
        },
        anthropic: { options: { apiKey: "anthropic-key" } },
      },
    })
  })

  it("合并模式以本地为主体，并保留本地 baseURL/apiKey", () => {
    expect(applyRemoteConfigUpdate(local, remote, "merge")).toEqual({
      username: "remote-user",
      provider: {
        openai: {
          name: "Remote OpenAI",
          options: {
            baseURL: "https://local.example.com/v1",
            apiKey: "local-key",
            timeout: 1000,
            chunkTimeout: 2000,
          },
          whitelist: ["remote-model"],
        },
        anthropic: { options: { apiKey: "anthropic-key" } },
      },
    })
  })
})
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
bun --cwd packages/opencode/webgui test:run -- --run src/components/settings/providerSettingsUtils.test.ts
```

Expected: FAIL，错误包含 `Cannot find module './providerSettingsUtils'`。

- [ ] **Step 3: 实现纯逻辑**

创建 `packages/opencode/webgui/src/components/settings/providerSettingsUtils.ts`：

```ts
import type { Config } from "@opencode-ai/sdk/client"

export type ProviderUpdateMode = "replace" | "merge"

type JsonObject = Record<string, unknown>

type ProviderConfig = NonNullable<Partial<Config>["provider"]>[string]

type ProviderOptions = NonNullable<ProviderConfig["options"]>

export type ProviderRow = {
  id: string
  baseURL?: string
  apiKey?: string
  maskedApiKey: string
}

export function maskApiKey(value: string | undefined) {
  if (!value) return "未配置"
  if (value.length <= 8) return "••••••"
  return `${value.slice(0, 4)}…${value.slice(-4)}`
}

export function normalizeWhitelist(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)))
}

export function providerRows(config: Partial<Config>): ProviderRow[] {
  return Object.entries(config.provider ?? {})
    .map(([id, provider]) => ({
      id,
      baseURL: provider.options?.baseURL,
      apiKey: provider.options?.apiKey,
      maskedApiKey: maskApiKey(provider.options?.apiKey),
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

export function buildUpdatedProvider(
  provider: ProviderConfig,
  values: { baseURL: string; apiKey: string; whitelist: string[] },
): ProviderConfig {
  const options: ProviderOptions = { ...(provider.options ?? {}) }
  const baseURL = values.baseURL.trim()
  const apiKey = values.apiKey.trim()

  if (baseURL) options.baseURL = baseURL
  else delete options.baseURL

  if (apiKey) options.apiKey = apiKey
  else delete options.apiKey

  return {
    ...provider,
    options,
    whitelist: normalizeWhitelist(values.whitelist),
  }
}

export function applyRemoteConfigUpdate(
  localConfig: Partial<Config>,
  remoteConfig: Partial<Config>,
  mode: ProviderUpdateMode,
): Partial<Config> {
  if (mode === "replace") return mergeProviderSecrets(remoteConfig, localConfig)
  const merged = mergePlainObjects(localConfig as JsonObject, remoteConfig as JsonObject) as Partial<Config>
  return mergeProviderSecrets(merged, localConfig)
}

function mergeProviderSecrets(targetConfig: Partial<Config>, localConfig: Partial<Config>): Partial<Config> {
  const provider = Object.fromEntries(
    Object.entries(targetConfig.provider ?? {}).map(([id, remoteProvider]) => {
      const localProvider = localConfig.provider?.[id]
      const baseURL = localProvider?.options?.baseURL
      const apiKey = localProvider?.options?.apiKey
      if (!baseURL && !apiKey) return [id, remoteProvider]
      return [
        id,
        {
          ...remoteProvider,
          options: {
            ...(remoteProvider.options ?? {}),
            ...(baseURL ? { baseURL } : {}),
            ...(apiKey ? { apiKey } : {}),
          },
        },
      ]
    }),
  )
  return { ...targetConfig, provider }
}

function mergePlainObjects(left: JsonObject, right: JsonObject): JsonObject {
  return Object.fromEntries(
    Array.from(new Set([...Object.keys(left), ...Object.keys(right)])).map((key) => {
      const leftValue = left[key]
      const rightValue = right[key]
      if (isPlainObject(leftValue) && isPlainObject(rightValue)) {
        return [key, mergePlainObjects(leftValue, rightValue)]
      }
      return [key, rightValue === undefined ? leftValue : rightValue]
    }),
  )
}

function isPlainObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value)
}
```

- [ ] **Step 4: 运行测试并确认通过**

Run:

```powershell
bun --cwd packages/opencode/webgui test:run -- --run src/components/settings/providerSettingsUtils.test.ts
```

Expected: PASS。

---

### Task 3: 添加 Provider 设置 tab UI 与单测

**Files:**

- Create: `packages/opencode/webgui/src/components/settings/ProviderSettingsTab.tsx`
- Create: `packages/opencode/webgui/src/components/settings/ProviderSettingsTab.test.tsx`

- [ ] **Step 1: 写失败测试**

创建 `packages/opencode/webgui/src/components/settings/ProviderSettingsTab.test.tsx`：

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ProviderSettingsTab } from "./ProviderSettingsTab"

const mocks = vi.hoisted(() => ({
  configUpdate: vi.fn(),
  configProviders: vi.fn(),
}))

vi.mock("../../lib/api/sdkClient", () => ({
  sdk: {
    global: { config: { update: (...args: unknown[]) => mocks.configUpdate(...args) } },
    config: { providers: (...args: unknown[]) => mocks.configProviders(...args) },
  },
}))

const formData = {
  provider: {
    openai: {
      options: { baseURL: "https://api.openai.com/v1", apiKey: "sk-1234567890abcdef" },
      whitelist: ["gpt-4.1"],
    },
  },
}

describe("ProviderSettingsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.configUpdate.mockResolvedValue({ data: formData, error: null })
    mocks.configProviders.mockResolvedValue({
      data: {
        providers: [{ id: "openai", name: "OpenAI", models: { "gpt-4.1": { name: "GPT 4.1" } } }],
        default: {},
      },
      error: null,
    })
  })

  it("展示配置更新区域和 Provider 列表", () => {
    render(<ProviderSettingsTab formData={formData} setFormData={vi.fn()} onReloadConfig={vi.fn()} />)

    expect(screen.getByText("配置更新")).toBeInTheDocument()
    expect(screen.getByDisplayValue(/raw.githubusercontent.com/)).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: /覆盖/ })).toBeChecked()
    expect(screen.getByRole("radio", { name: /合并/ })).not.toBeChecked()
    expect(screen.getByText("openai")).toBeInTheDocument()
    expect(screen.getByText("https://api.openai.com/v1")).toBeInTheDocument()
    expect(screen.getByText("sk-1…cdef")).toBeInTheDocument()
  })

  it("编辑 Provider 后保存并显示重启提示", async () => {
    const user = userEvent.setup()
    const setFormData = vi.fn()
    const onReloadConfig = vi.fn()
    render(<ProviderSettingsTab formData={formData} setFormData={setFormData} onReloadConfig={onReloadConfig} />)

    await user.click(screen.getByRole("button", { name: "编辑" }))
    expect(screen.getByDisplayValue("openai")).toBeDisabled()
    await user.clear(screen.getByLabelText("接口地址"))
    await user.type(screen.getByLabelText("接口地址"), "https://proxy.example.com/v1")
    await user.clear(screen.getByLabelText("API 密钥"))
    await user.type(screen.getByLabelText("API 密钥"), "new-key")
    await user.type(screen.getByPlaceholderText(/选择或输入模型/), "gpt-4.1-mini")
    await user.click(screen.getByRole("button", { name: "添加模型" }))
    await user.click(screen.getByRole("button", { name: "保存 Provider" }))

    await waitFor(() => {
      expect(mocks.configUpdate).toHaveBeenCalledWith({
        body: {
          provider: {
            openai: {
              options: { baseURL: "https://proxy.example.com/v1", apiKey: "new-key" },
              whitelist: ["gpt-4.1", "gpt-4.1-mini"],
            },
          },
        },
      })
    })
    expect(setFormData).toHaveBeenCalledWith(formData)
    expect(onReloadConfig).toHaveBeenCalledWith(formData)
    expect(screen.getByText("Provider 设置已保存")).toBeInTheDocument()
  })

  it("删除白名单模型", async () => {
    const user = userEvent.setup()
    render(<ProviderSettingsTab formData={formData} setFormData={vi.fn()} onReloadConfig={vi.fn()} />)

    await user.click(screen.getByRole("button", { name: "编辑" }))
    const row = screen.getByDisplayValue("gpt-4.1").closest("tr")!
    await user.click(within(row).getByRole("button", { name: "删除" }))

    expect(screen.queryByDisplayValue("gpt-4.1")).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
bun --cwd packages/opencode/webgui test:run -- --run src/components/settings/ProviderSettingsTab.test.tsx
```

Expected: FAIL，错误包含 `Cannot find module './ProviderSettingsTab'`。

- [ ] **Step 3: 实现 ProviderSettingsTab**

创建 `packages/opencode/webgui/src/components/settings/ProviderSettingsTab.tsx`：

```tsx
import { useEffect, useMemo, useState } from "react"
import { parse } from "jsonc-parser"
import type { Config } from "@opencode-ai/sdk/client"
import { sdk } from "../../lib/api/sdkClient"
import { Button } from "../common"
import { RestartRequiredModal } from "./RestartRequiredModal"
import {
  applyRemoteConfigUpdate,
  buildUpdatedProvider,
  normalizeWhitelist,
  providerRows,
  type ProviderUpdateMode,
} from "./providerSettingsUtils"

const defaultConfigUrl =
  "https://raw.githubusercontent.com/caiqy/opencode-ide-plugin/refs/heads/ide-plugin/samles/opencode.jsonc"

interface ProviderSettingsTabProps {
  formData: Partial<Config>
  setFormData: (data: Partial<Config>) => void
  onReloadConfig?: (data: Partial<Config>) => void
}

type ProviderConfig = NonNullable<Partial<Config>["provider"]>[string]

export function ProviderSettingsTab({ formData, setFormData, onReloadConfig }: ProviderSettingsTabProps) {
  const [configUrl, setConfigUrl] = useState(defaultConfigUrl)
  const [updateMode, setUpdateMode] = useState<ProviderUpdateMode>("replace")
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null)
  const [draft, setDraft] = useState({ baseURL: "", apiKey: "", whitelist: [] as string[] })
  const [modelInput, setModelInput] = useState("")
  const [knownModels, setKnownModels] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [restartOpen, setRestartOpen] = useState(false)

  const rows = providerRows(formData)
  const editingProvider = editingProviderId ? formData.provider?.[editingProviderId] : undefined

  useEffect(() => {
    sdk.config
      .providers()
      .then((res) => {
        const models =
          res.data?.providers.flatMap((provider) => Object.keys(provider.models ?? {}).map((model) => model)) ?? []
        setKnownModels(Array.from(new Set(models)).sort())
      })
      .catch(() => setKnownModels([]))
  }, [])

  const modelOptions = useMemo(
    () => knownModels.filter((model) => !draft.whitelist.includes(model)),
    [knownModels, draft.whitelist],
  )

  const startEdit = (providerId: string) => {
    const provider = formData.provider?.[providerId]
    if (!provider) return
    setEditingProviderId(providerId)
    setDraft({
      baseURL: provider.options?.baseURL ?? "",
      apiKey: provider.options?.apiKey ?? "",
      whitelist: [...(provider.whitelist ?? [])],
    })
    setModelInput("")
    setError(null)
  }

  const saveConfig = async (next: Partial<Config>) => {
    setIsSaving(true)
    setError(null)
    try {
      const response = await sdk.global.config.update({ body: next })
      if (response.error) throw new Error("保存 Provider 设置失败")
      const saved = structuredClone((response.data ?? next) as Partial<Config>)
      setFormData(saved)
      onReloadConfig?.(saved)
      setRestartOpen(true)
      return saved
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return undefined
    } finally {
      setIsSaving(false)
    }
  }

  const updateFromUrl = async () => {
    setIsSaving(true)
    setError(null)
    try {
      const response = await fetch(configUrl)
      if (!response.ok) throw new Error(`配置下载失败：HTTP ${response.status}`)
      const text = await response.text()
      const remote = parse(text) as Partial<Config>
      const next = applyRemoteConfigUpdate(formData, remote, updateMode)
      const saved = await saveConfig(next)
      if (saved) setEditingProviderId(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "配置解析失败")
    } finally {
      setIsSaving(false)
    }
  }

  const addModel = () => {
    const next = normalizeWhitelist([...draft.whitelist, modelInput])
    setDraft({ ...draft, whitelist: next })
    setModelInput("")
  }

  const saveProvider = async () => {
    if (!editingProviderId || !editingProvider) return
    const nextProvider = buildUpdatedProvider(editingProvider as ProviderConfig, draft)
    const next = {
      ...formData,
      provider: {
        ...(formData.provider ?? {}),
        [editingProviderId]: nextProvider,
      },
    }
    const saved = await saveConfig(next)
    if (saved) setEditingProviderId(null)
  }

  if (editingProviderId && editingProvider) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">编辑 Provider</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">提供商不可修改，其余字段保存到全局配置。</p>
          </div>
          <Button variant="secondary" onClick={() => setEditingProviderId(null)}>
            返回列表
          </Button>
        </div>

        {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1 text-sm">
            <span className="text-gray-700 dark:text-gray-300">提供商</span>
            <input className="w-full rounded border px-3 py-2" value={editingProviderId} disabled />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-gray-700 dark:text-gray-300">接口地址</span>
            <input
              aria-label="接口地址"
              className="w-full rounded border px-3 py-2"
              value={draft.baseURL}
              onChange={(event) => setDraft({ ...draft, baseURL: event.target.value })}
            />
          </label>
          <label className="col-span-2 space-y-1 text-sm">
            <span className="text-gray-700 dark:text-gray-300">API 密钥</span>
            <input
              aria-label="API 密钥"
              className="w-full rounded border px-3 py-2 font-mono"
              value={draft.apiKey}
              onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
            />
          </label>
        </div>

        <div className="rounded border border-gray-200 p-3 dark:border-gray-700">
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">模型白名单</h4>
          <div className="mt-2 flex gap-2">
            <input
              className="flex-1 rounded border px-3 py-2"
              list="provider-model-options"
              placeholder="选择或输入模型，例如 gpt-4.1"
              value={modelInput}
              onChange={(event) => setModelInput(event.target.value)}
            />
            <datalist id="provider-model-options">
              {modelOptions.map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
            <Button variant="primary" onClick={addModel} disabled={!modelInput.trim()}>
              添加模型
            </Button>
          </div>
          <table className="mt-3 w-full text-xs">
            <tbody>
              {draft.whitelist.map((model, index) => (
                <tr key={`${model}-${index}`}>
                  <td className="py-1 pr-2">
                    <input
                      className="w-full rounded border px-2 py-1"
                      value={model}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          whitelist: draft.whitelist.map((item, itemIndex) =>
                            itemIndex === index ? event.target.value : item,
                          ),
                        })
                      }
                    />
                  </td>
                  <td className="w-20 py-1">
                    <Button
                      variant="danger"
                      onClick={() => setDraft({ ...draft, whitelist: draft.whitelist.filter((_, i) => i !== index) })}
                    >
                      删除
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setEditingProviderId(null)}>
            取消
          </Button>
          <Button variant="primary" onClick={saveProvider} loading={isSaving}>
            保存 Provider
          </Button>
        </div>
        <RestartRequiredModal isOpen={restartOpen} onClose={() => setRestartOpen(false)} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">配置更新</h3>
        <div className="mt-2 flex gap-2">
          <input
            className="flex-1 rounded border px-3 py-2 text-sm"
            value={configUrl}
            onChange={(event) => setConfigUrl(event.target.value)}
          />
          <Button variant="primary" onClick={updateFromUrl} loading={isSaving}>
            更新配置
          </Button>
        </div>
        <div className="mt-2 flex gap-4 text-sm text-gray-600 dark:text-gray-400">
          <label>
            <input type="radio" checked={updateMode === "replace"} onChange={() => setUpdateMode("replace")} /> 覆盖
          </label>
          <label>
            <input type="radio" checked={updateMode === "merge"} onChange={() => setUpdateMode("merge")} /> 合并
          </label>
        </div>
      </div>
      {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
      <div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Provider 列表</h3>
        <table className="mt-2 w-full text-xs">
          <thead>
            <tr>
              <th>提供商</th>
              <th>接口地址</th>
              <th>API 密钥</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.id}</td>
                <td>{row.baseURL ?? "未配置"}</td>
                <td>{row.maskedApiKey}</td>
                <td>
                  <Button variant="secondary" onClick={() => startEdit(row.id)}>
                    编辑
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <RestartRequiredModal isOpen={restartOpen} onClose={() => setRestartOpen(false)} />
    </div>
  )
}
```

- [ ] **Step 4: 运行测试并修正样式/类型问题**

Run:

```powershell
bun --cwd packages/opencode/webgui test:run -- --run src/components/settings/ProviderSettingsTab.test.tsx
```

Expected: PASS。

---

### Task 4: 添加重启提示弹窗

**Files:**

- Create: `packages/opencode/webgui/src/components/settings/RestartRequiredModal.tsx`
- Create: `packages/opencode/webgui/src/components/settings/RestartRequiredModal.test.tsx`

- [ ] **Step 1: 写失败测试**

创建 `packages/opencode/webgui/src/components/settings/RestartRequiredModal.test.tsx`：

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { RestartRequiredModal } from "./RestartRequiredModal"

const mocks = vi.hoisted(() => ({ restart: vi.fn() }))

vi.mock("../../lib/ideBridge", () => ({
  ideBridge: {
    request: (...args: unknown[]) => mocks.restart(...args),
  },
}))

describe("RestartRequiredModal", () => {
  beforeEach(() => vi.clearAllMocks())

  it("暂不重启只关闭弹窗", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<RestartRequiredModal isOpen={true} onClose={onClose} />)

    await user.click(screen.getByRole("button", { name: "暂不重启" }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(mocks.restart).not.toHaveBeenCalled()
  })

  it("立即重启调用 ideBridge restartHost", async () => {
    const user = userEvent.setup()
    mocks.restart.mockResolvedValue({ ok: true })
    render(<RestartRequiredModal isOpen={true} onClose={vi.fn()} />)

    await user.click(screen.getByRole("button", { name: "立即重启" }))

    await waitFor(() => expect(mocks.restart).toHaveBeenCalledWith("restartHost"))
  })

  it("重启失败时显示手动重启提示", async () => {
    const user = userEvent.setup()
    mocks.restart.mockRejectedValue(new Error("boom"))
    render(<RestartRequiredModal isOpen={true} onClose={vi.fn()} />)

    await user.click(screen.getByRole("button", { name: "立即重启" }))

    expect(await screen.findByText("请手动重启插件或执行 Reload Window")).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
bun --cwd packages/opencode/webgui test:run -- --run src/components/settings/RestartRequiredModal.test.tsx
```

Expected: FAIL，错误包含 `Cannot find module './RestartRequiredModal'`。

- [ ] **Step 3: 实现 RestartRequiredModal**

创建 `packages/opencode/webgui/src/components/settings/RestartRequiredModal.tsx`：

```tsx
import { useState } from "react"
import { ideBridge } from "../../lib/ideBridge"
import { Modal, Button } from "../common"

interface RestartRequiredModalProps {
  isOpen: boolean
  onClose: () => void
}

export function RestartRequiredModal({ isOpen, onClose }: RestartRequiredModalProps) {
  const [error, setError] = useState<string | null>(null)
  const [restarting, setRestarting] = useState(false)

  const restart = async () => {
    setRestarting(true)
    setError(null)
    try {
      await ideBridge.request("restartHost")
    } catch {
      setError("请手动重启插件或执行 Reload Window")
    } finally {
      setRestarting(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="sm">
      <div className="space-y-4 p-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Provider 设置已保存</h3>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">配置变更需要重启插件后才能生效。</p>
        </div>
        {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={restarting}>
            暂不重启
          </Button>
          <Button variant="primary" onClick={restart} loading={restarting}>
            立即重启
          </Button>
        </div>
      </div>
    </Modal>
  )
}
```

- [ ] **Step 4: 运行测试并确认通过**

Run:

```powershell
bun --cwd packages/opencode/webgui test:run -- --run src/components/settings/RestartRequiredModal.test.tsx
```

Expected: PASS。

---

### Task 5: 接入 SettingsPanel 与 TabBar

**Files:**

- Modify: `packages/opencode/webgui/src/components/SettingsPanel/TabBar.tsx`
- Modify: `packages/opencode/webgui/src/components/SettingsPanel/TabBar.test.tsx`
- Modify: `packages/opencode/webgui/src/components/SettingsPanel/index.tsx`
- Modify: `packages/opencode/webgui/src/components/SettingsPanel/index.test.tsx`

- [ ] **Step 1: 更新 TabBar 测试为失败态**

修改 `TabBar.test.tsx` 断言：

```tsx
it("Provider 设置是第一个标签页", () => {
  render(<TabBar activeTab="provider" onTabChange={vi.fn()} />)

  const buttons = screen.getAllByRole("button")
  expect(buttons.map((button) => button.textContent)).toEqual([
    expect.stringContaining("Provider 设置"),
    expect.stringContaining("Agent 配置"),
    expect.stringContaining("快捷短语"),
  ])
})
```

并在点击测试中加入：

```tsx
await user.click(screen.getByRole("button", { name: /Provider 设置/ }))
expect(onTabChange).toHaveBeenCalledWith("provider")
```

- [ ] **Step 2: 运行 TabBar 测试并确认失败**

Run:

```powershell
bun --cwd packages/opencode/webgui test:run -- --run src/components/SettingsPanel/TabBar.test.tsx
```

Expected: FAIL，原因是 `provider` 类型或按钮不存在。

- [ ] **Step 3: 修改 TabBar**

将 `packages/opencode/webgui/src/components/SettingsPanel/TabBar.tsx` 的类型扩展为：

```tsx
type SettingsTab = "provider" | "agents" | "advanced" | "quick-phrases"

interface TabBarProps {
  activeTab: SettingsTab
  onTabChange: (tab: SettingsTab) => void
}
```

将 `all` 改为：

```tsx
const all: { id: SettingsTab; label: string; icon: string }[] = [
  { id: "provider", label: "Provider 设置", icon: "🔌" },
  { id: "agents", label: "Agent 配置", icon: "🤖" },
  { id: "quick-phrases", label: "快捷短语", icon: "🏷️" },
]
```

- [ ] **Step 4: 更新 SettingsPanel 测试为失败态**

在 `SettingsPanel/index.test.tsx` 中新增：

```tsx
it("默认打开 Provider 设置", () => {
  mocks.useSettingsForm.mockReturnValue({
    formData: { provider: { openai: { options: { apiKey: "sk-1234567890abcdef" } } } },
    setFormData: vi.fn(),
    originalFormData: { provider: { openai: { options: { apiKey: "sk-1234567890abcdef" } } } },
    setOriginalFormData: vi.fn(),
    isLoading: false,
    error: null,
  })

  render(<SettingsPanel isOpen={true} onClose={vi.fn()} />)

  expect(screen.getByRole("button", { name: /Provider 设置/ })).toBeInTheDocument()
  expect(screen.getByText("配置更新")).toBeInTheDocument()
  expect(screen.getByText("openai")).toBeInTheDocument()
})
```

- [ ] **Step 5: 运行 SettingsPanel 测试并确认失败**

Run:

```powershell
bun --cwd packages/opencode/webgui test:run -- --run src/components/SettingsPanel/index.test.tsx
```

Expected: FAIL，原因是 `Provider 设置` 未接入。

- [ ] **Step 6: 修改 SettingsPanel**

在 `SettingsPanel/index.tsx` 中：

```tsx
import { ProviderSettingsTab } from "../settings/ProviderSettingsTab"
```

将 tab 类型改为：

```tsx
type TabType = "provider" | "general" | "agents" | "advanced" | "quick-phrases"
```

将默认状态改为：

```tsx
const [activeTab, setActiveTab] = useState<TabType>("provider")
```

在内容区增加：

```tsx
{
  activeTab === "provider" && (
    <ProviderSettingsTab formData={formData} setFormData={setFormData} onReloadConfig={setOriginalFormData} />
  )
}
```

- [ ] **Step 7: 运行接入测试并确认通过**

Run:

```powershell
bun --cwd packages/opencode/webgui test:run -- --run src/components/SettingsPanel/TabBar.test.tsx src/components/SettingsPanel/index.test.tsx
```

Expected: PASS。

---

### Task 6: 覆盖远程配置下载流程

**Files:**

- Modify: `packages/opencode/webgui/src/components/settings/ProviderSettingsTab.test.tsx`
- Modify: `packages/opencode/webgui/src/components/settings/ProviderSettingsTab.tsx`

- [ ] **Step 1: 添加下载成功测试**

在 `ProviderSettingsTab.test.tsx` 中新增：

```tsx
it("覆盖更新会下载 JSONC 并保留本地同名 provider 的 baseURL/apiKey", async () => {
  const user = userEvent.setup()
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      text: async () => `{
        // remote config
        "provider": {
          "openai": { "options": { "baseURL": "https://remote.example.com/v1", "apiKey": "remote-key" }, "whitelist": ["remote"] },
          "anthropic": { "options": { "apiKey": "anthropic-key" } }
        }
      }`,
    })),
  )
  render(<ProviderSettingsTab formData={formData} setFormData={vi.fn()} onReloadConfig={vi.fn()} />)

  await user.click(screen.getByRole("button", { name: "更新配置" }))

  await waitFor(() => {
    expect(mocks.configUpdate).toHaveBeenCalledWith({
      body: {
        provider: {
          openai: {
            options: { baseURL: "https://api.openai.com/v1", apiKey: "sk-1234567890abcdef" },
            whitelist: ["remote"],
          },
          anthropic: { options: { apiKey: "anthropic-key" } },
        },
      },
    })
  })
  vi.unstubAllGlobals()
})
```

- [ ] **Step 2: 添加下载失败测试**

在 `ProviderSettingsTab.test.tsx` 中新增：

```tsx
it("下载失败时显示错误且不保存", async () => {
  const user = userEvent.setup()
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, status: 404 })),
  )
  render(<ProviderSettingsTab formData={formData} setFormData={vi.fn()} onReloadConfig={vi.fn()} />)

  await user.click(screen.getByRole("button", { name: "更新配置" }))

  expect(await screen.findByText("配置下载失败：HTTP 404")).toBeInTheDocument()
  expect(mocks.configUpdate).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
})
```

- [ ] **Step 3: 运行测试**

Run:

```powershell
bun --cwd packages/opencode/webgui test:run -- --run src/components/settings/ProviderSettingsTab.test.tsx
```

Expected: PASS。若解析错误显示不是 `配置解析失败`，调整 catch 分支为：

```ts
setError(err instanceof Error && err.message.startsWith("配置下载失败") ? err.message : "配置解析失败")
```

---

### Task 7: 全量验证

**Files:**

- Verify only

- [ ] **Step 1: 运行相关单测**

Run:

```powershell
bun --cwd packages/opencode/webgui test:run -- --run src/components/settings/providerSettingsUtils.test.ts src/components/settings/ProviderSettingsTab.test.tsx src/components/settings/RestartRequiredModal.test.tsx src/components/SettingsPanel/TabBar.test.tsx src/components/SettingsPanel/index.test.tsx
```

Expected: PASS。

- [ ] **Step 2: 运行 webgui typecheck/build**

Run:

```powershell
bun --cwd packages/opencode/webgui run build
```

Expected: TypeScript build 和 Vite build 均成功。

- [ ] **Step 3: 检查工作区改动**

Run:

```powershell
git status --short
git diff -- docs/superpowers/specs/2026-06-06-provider-settings-design.md docs/superpowers/plans/2026-06-06-provider-settings.md packages/opencode/webgui/package.json packages/opencode/webgui/src/components/settings/providerSettingsUtils.ts packages/opencode/webgui/src/components/settings/providerSettingsUtils.test.ts packages/opencode/webgui/src/components/settings/RestartRequiredModal.tsx packages/opencode/webgui/src/components/settings/RestartRequiredModal.test.tsx packages/opencode/webgui/src/components/settings/ProviderSettingsTab.tsx packages/opencode/webgui/src/components/settings/ProviderSettingsTab.test.tsx packages/opencode/webgui/src/components/SettingsPanel/TabBar.tsx packages/opencode/webgui/src/components/SettingsPanel/TabBar.test.tsx packages/opencode/webgui/src/components/SettingsPanel/index.tsx packages/opencode/webgui/src/components/SettingsPanel/index.test.tsx
```

Expected: 只包含本功能相关改动；不要提交 `dummy.txt`、`response.txt`、`samples/` 等已有未跟踪文件。

- [ ] **Step 4: 提交处理**

仓库规则要求只有用户明确要求才提交。若用户明确授权提交，执行：

```powershell
git status --short
git diff
git log --oneline -10
git add docs/superpowers/specs/2026-06-06-provider-settings-design.md docs/superpowers/plans/2026-06-06-provider-settings.md packages/opencode/webgui/package.json packages/opencode/webgui/src/components/settings/providerSettingsUtils.ts packages/opencode/webgui/src/components/settings/providerSettingsUtils.test.ts packages/opencode/webgui/src/components/settings/RestartRequiredModal.tsx packages/opencode/webgui/src/components/settings/RestartRequiredModal.test.tsx packages/opencode/webgui/src/components/settings/ProviderSettingsTab.tsx packages/opencode/webgui/src/components/settings/ProviderSettingsTab.test.tsx packages/opencode/webgui/src/components/SettingsPanel/TabBar.tsx packages/opencode/webgui/src/components/SettingsPanel/TabBar.test.tsx packages/opencode/webgui/src/components/SettingsPanel/index.tsx packages/opencode/webgui/src/components/SettingsPanel/index.test.tsx
git commit -m "feat(webgui): add provider settings tab"
```

Expected: commit 成功，且未包含无关未跟踪文件。
