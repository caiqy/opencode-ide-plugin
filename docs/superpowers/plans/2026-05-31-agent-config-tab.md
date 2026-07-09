# Agent 配置标签页实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在设置面板中新增 "Agent 配置" 标签页，允许用户为所有系统已知 agent 设置 model 和 variant。

**Architecture:** 新增一个 `AgentConfigTab` 组件，表格式布局。组件内部加载 agent 列表和 provider/model 数据，用户修改后通过现有设置面板的统一保存流程写入全局配置。

**Tech Stack:** React 19, TypeScript, Tailwind CSS, @opencode-ai/sdk

---

## Implementation Notes Added After Review

The final implementation differs from this initial plan in several important ways:

- The model column no longer uses a native `<select>`; it uses the shared `ModelSelector` search picker with a “默认” clear option.
- Agent 配置保存 is written to global config through changed top-level fields only. When `agent` changes, the whole top-level `agent` object is sent so cleared nested model fields can be removed.
- Backend global config writes use replacement semantics for top-level `agent` in JSON and JSONC files.
- Saving Agent model/variant config no longer disposes instances. It is treated as lightweight config and hot-reloads active instances through `Agent.reloadModelConfig()`.
- The model picker renders in a portal inside SettingsPanel to avoid overflow clipping; Escape closes only the picker, not the SettingsPanel.

See the follow-up design/plan for the implemented model picker details:

- `docs/superpowers/specs/2026-06-01-agent-config-model-selector-design.md`
- `docs/superpowers/plans/2026-06-01-agent-config-model-selector.md`

---

## 文件结构

| 文件                                         | 职责                            |
| -------------------------------------------- | ------------------------------- |
| `src/components/settings/AgentConfigTab.tsx` | 新建。Agent 配置表格主组件      |
| `src/components/SettingsPanel/TabBar.tsx`    | 修改。新增 "agents" tab         |
| `src/components/SettingsPanel/index.tsx`     | 修改。导入并渲染 AgentConfigTab |

Additional files changed by review follow-ups:

| 文件                                                                      | 职责                                                      |
| ------------------------------------------------------------------------- | --------------------------------------------------------- |
| `packages/opencode/webgui/src/components/ModelSelector.tsx`               | 搜索式模型选择器、默认/清空、预加载 provider、portal 下拉 |
| `packages/opencode/webgui/src/hooks/useClickOutside.ts`                   | 子下拉 Escape 优先处理，避免关闭 SettingsPanel            |
| `packages/opencode/src/config/config.ts`                                  | 全局 `agent` replace 写入语义                             |
| `packages/opencode/src/server/routes/instance/httpapi/handlers/global.ts` | lightweight config 更新与 agent 热更新                    |
| `packages/opencode/src/agent/agent.ts`                                    | agent model/variant cache 热更新                          |
| `packages/opencode/src/project/instance-store.ts`                         | 在 active instances 中执行热更新 effect                   |

---

### Task 1: 扩展 TabBar 支持 "agents" 标签

**Files:**

- Modify: `packages/opencode/webgui/src/components/SettingsPanel/TabBar.tsx`
- Modify: `packages/opencode/webgui/src/components/SettingsPanel/index.tsx`

- [ ] **Step 1: 修改 TabBar 类型和选项**

```tsx
// packages/opencode/webgui/src/components/SettingsPanel/TabBar.tsx
interface TabBarProps {
  activeTab: "general" | "agents" | "advanced" | "quick-phrases"
  onTabChange: (tab: "general" | "agents" | "advanced" | "quick-phrases") => void
}

export function TabBar({ activeTab, onTabChange }: TabBarProps) {
  const all: { id: typeof activeTab; label: string; icon: string }[] = [
    { id: "general", label: "常规", icon: "⚙️" },
    { id: "agents", label: "Agent 配置", icon: "🤖" },
    { id: "quick-phrases", label: "快捷短语", icon: "🏷️" },
    { id: "advanced", label: "高级", icon: "🔧" },
  ]

  return (
    <div className="border-b border-gray-200 dark:border-gray-800">
      <div className="flex px-4">
        {all.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`px-3 py-1.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? "border-blue-600 text-blue-600 dark:border-blue-500 dark:text-blue-500"
                : "border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
            }`}
          >
            <span className="mr-1.5">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 修改 SettingsPanel index.tsx 的 TabType 和渲染逻辑**

在 `packages/opencode/webgui/src/components/SettingsPanel/index.tsx` 中：

1. 添加 import：

```tsx
import { AgentConfigTab } from "../settings/AgentConfigTab"
```

2. 修改 TabType：

```tsx
type TabType = "general" | "agents" | "advanced" | "quick-phrases"
```

3. 在渲染区域添加 agents tab 的条件渲染（在 `{activeTab === "general" && ...}` 之后）：

```tsx
{
  activeTab === "agents" && <AgentConfigTab formData={formData} setFormData={setFormData} />
}
```

- [ ] **Step 3: 验证编译通过**

Run: `cd packages/opencode/webgui && npx tsc --noEmit`

此时会报错因为 `AgentConfigTab` 还不存在，这是预期的。先创建一个空壳组件。

---

### Task 2: 创建 AgentConfigTab 组件

**Files:**

- Create: `packages/opencode/webgui/src/components/settings/AgentConfigTab.tsx`

- [ ] **Step 1: 创建完整的 AgentConfigTab 组件**

```tsx
// packages/opencode/webgui/src/components/settings/AgentConfigTab.tsx
import { useState, useEffect, useCallback } from "react"
import { sdk } from "../../lib/api/sdkClient"
import type { Config, Agent, Provider } from "@opencode-ai/sdk/client"

interface AgentConfigTabProps {
  formData: Partial<Config>
  setFormData: (data: Partial<Config>) => void
}

interface AgentRow {
  name: string
  mode: string
  description?: string
  model: string | undefined // "provider/modelId" format
  variant: string | undefined
  configured: boolean // whether this agent has config in formData
}

function getVariantsForModel(providers: Provider[], modelValue: string | undefined): string[] {
  if (!modelValue) return []
  const [providerID, modelID] = modelValue.split("/", 2)
  if (!providerID || !modelID) return []
  const provider = providers.find((p) => p.id === providerID)
  if (!provider) return []
  const model = provider.models[modelID]
  if (!model?.variants) return []
  return Object.keys(model.variants)
}

export function AgentConfigTab({ formData, setFormData }: AgentConfigTabProps) {
  const [agents, setAgents] = useState<Agent[]>([])
  const [providers, setProviders] = useState<Provider[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const [agentsRes, providersRes] = await Promise.all([sdk.app.agents(), sdk.config.providers()])

      if (agentsRes.error) throw new Error("加载 Agent 列表失败")
      if (providersRes.error) throw new Error("加载模型列表失败")

      if (agentsRes.data) setAgents(agentsRes.data)
      if (providersRes.data) setProviders(providersRes.data.providers)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleReload = async () => {
    // Re-fetch global config to get latest values
    const configRes = await sdk.global.config.get()
    if (configRes.data) {
      setFormData(structuredClone(configRes.data))
    }
    await loadData()
  }

  const rows: AgentRow[] = agents.map((agent) => {
    const agentConfig = formData.agent?.[agent.name]
    return {
      name: agent.name,
      mode: agent.mode,
      description: agent.description,
      model: agentConfig?.model ?? undefined,
      variant: agentConfig?.variant ?? undefined,
      configured: !!agentConfig?.model || !!agentConfig?.variant,
    }
  })

  // Sort: configured first, then alphabetical
  const sortedRows = [...rows].sort((a, b) => {
    if (a.configured !== b.configured) return a.configured ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  const updateAgent = (name: string, field: "model" | "variant", value: string | undefined) => {
    const currentAgent = formData.agent ?? {}
    const currentConfig = currentAgent[name] ?? {}

    const updated = { ...currentConfig, [field]: value || undefined }

    // If model changed, check if current variant is still valid
    if (field === "model") {
      const variants = getVariantsForModel(providers, value)
      if (updated.variant && !variants.includes(updated.variant)) {
        updated.variant = undefined
      }
    }

    // Clean up: if both model and variant are undefined, remove the entry entirely
    const hasValues = updated.model || updated.variant
    const nextAgent = { ...currentAgent }
    if (hasValues) {
      nextAgent[name] = updated
    } else {
      // Keep other fields (prompt, temperature, etc.) if they exist
      const { model: _m, variant: _v, ...rest } = currentConfig
      if (Object.keys(rest).length > 0) {
        nextAgent[name] = rest
      } else {
        delete nextAgent[name]
      }
    }

    setFormData({ ...formData, agent: nextAgent })
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500 dark:text-gray-400">正在加载 Agent 配置…</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-3 text-sm text-red-800 dark:text-red-200">
        {error}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Header with reload button */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Agent 模型配置</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">为每个 Agent 指定使用的模型和推理强度</p>
        </div>
        <button
          onClick={handleReload}
          className="px-2 py-1 text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 rounded border border-gray-300 dark:border-gray-700"
          title="重新加载配置"
        >
          ↻ 重新加载
        </button>
      </div>

      {/* Table */}
      <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
              <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400">Agent</th>
              <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400">Mode</th>
              <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400">模型</th>
              <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400">Variant</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => {
              const variants = getVariantsForModel(providers, row.model)
              return (
                <tr
                  key={row.name}
                  className={`border-b border-gray-100 dark:border-gray-800 last:border-0 ${
                    row.configured ? "" : "opacity-60"
                  }`}
                >
                  <td className="px-3 py-2">
                    <div className="font-medium text-gray-900 dark:text-gray-100">{row.name}</div>
                    {row.description && (
                      <div className="text-[10px] text-gray-500 dark:text-gray-400 truncate max-w-[120px]">
                        {row.description}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        row.mode === "primary"
                          ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                          : row.mode === "subagent"
                            ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300"
                            : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400"
                      }`}
                    >
                      {row.mode}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={row.model ?? ""}
                      onChange={(e) => updateAgent(row.name, "model", e.target.value || undefined)}
                      className="w-full max-w-[200px] px-1.5 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="">默认</option>
                      {providers.map((provider) => (
                        <optgroup key={provider.id} label={provider.name}>
                          {Object.entries(provider.models).map(([modelId, model]) => (
                            <option key={`${provider.id}/${modelId}`} value={`${provider.id}/${modelId}`}>
                              {model.name}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={row.variant ?? ""}
                      onChange={(e) => updateAgent(row.name, "variant", e.target.value || undefined)}
                      disabled={variants.length === 0}
                      className="w-full max-w-[100px] px-1.5 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <option value="">默认</option>
                      {variants.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {sortedRows.length === 0 && (
        <div className="text-center py-8 text-xs text-gray-500 dark:text-gray-400">暂无可用 Agent</div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

Run: `cd packages/opencode/webgui && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add packages/opencode/webgui/src/components/settings/AgentConfigTab.tsx
git add packages/opencode/webgui/src/components/SettingsPanel/TabBar.tsx
git add packages/opencode/webgui/src/components/SettingsPanel/index.tsx
git commit -m "feat(webgui): add Agent config tab to settings panel"
```

---

### Task 3: 修复 TabBar 测试

**Files:**

- Modify: `packages/opencode/webgui/src/components/SettingsPanel/TabBar.test.tsx`

- [ ] **Step 1: 更新 TabBar 测试以包含新的 "agents" tab**

检查 `TabBar.test.tsx` 中是否有硬编码的 tab 数量或 tab id 断言，更新为包含 `"agents"` tab。

如果测试中有类似 `expect(tabs).toHaveLength(3)` 的断言，改为 `4`。如果有 tab id 列表断言，添加 `"agents"`。

- [ ] **Step 2: 运行测试验证**

Run: `cd packages/opencode/webgui && npx vitest run src/components/SettingsPanel/`
Expected: 所有测试通过

- [ ] **Step 3: 提交**

```bash
git add packages/opencode/webgui/src/components/SettingsPanel/TabBar.test.tsx
git commit -m "test(webgui): update TabBar tests for agents tab"
```

---

### Task 4: 手动验证

- [ ] **Step 1: 启动 dev server 验证 UI**

Run: `cd packages/opencode/webgui && npx vite --host`

在浏览器中打开，进入设置面板，确认：

1. TabBar 中出现 "🤖 Agent 配置" 标签
2. 点击后显示表格，列出所有 agent
3. 已配置的 agent 排在前面，未配置的淡化显示
4. Model 下拉按 provider 分组，能选择模型
5. 选择模型后 Variant 下拉动态更新
6. 点击保存后配置写入成功
7. 重新加载按钮能刷新数据

- [ ] **Step 2: 运行全量测试**

Run: `cd packages/opencode/webgui && npx vitest run`
Expected: 所有测试通过

- [ ] **Step 3: 最终提交（如有修复）**

```bash
git add -A
git commit -m "fix(webgui): address agent config tab issues from manual testing"
```
