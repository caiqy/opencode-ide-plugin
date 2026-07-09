import { useState, useEffect, useRef } from "react"
import { sdk } from "../../lib/api/sdkClient"
import type { Config, Agent, Provider } from "@opencode-ai/sdk/client"
import { ModelSelector } from "../ModelSelector"

interface AgentConfigTabProps {
  formData: Partial<Config>
  setFormData: (data: Partial<Config>) => void
  onReloadConfig?: (data: Partial<Config>) => void
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
  const slashIndex = modelValue.indexOf("/")
  if (slashIndex < 0) return []
  const providerID = modelValue.slice(0, slashIndex)
  const modelID = modelValue.slice(slashIndex + 1)
  if (!providerID || !modelID) return []
  const provider = providers.find((p) => p.id === providerID)
  if (!provider) return []
  const model = provider.models[modelID] as { variants?: Record<string, unknown> } | undefined
  if (!model?.variants) return []
  return Object.keys(model.variants)
}

function parseModelValue(modelValue: string | undefined) {
  if (!modelValue) return { providerID: undefined, modelID: undefined }
  const slashIndex = modelValue.indexOf("/")
  if (slashIndex < 0) return { providerID: undefined, modelID: undefined }
  const providerID = modelValue.slice(0, slashIndex)
  const modelID = modelValue.slice(slashIndex + 1)
  if (!providerID || !modelID) return { providerID: undefined, modelID: undefined }
  return { providerID, modelID }
}

export function AgentConfigTab({ formData, setFormData, onReloadConfig }: AgentConfigTabProps) {
  const [agents, setAgents] = useState<Agent[]>([])
  const [providers, setProviders] = useState<Provider[]>([])
  const [defaultIds, setDefaultIds] = useState<Record<string, string>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  const loadData = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const [agentsRes, providersRes] = await Promise.all([sdk.app.agents(), sdk.config.providers()])

      if (!mountedRef.current) return

      if (agentsRes.error) throw new Error("加载 Agent 列表失败")
      if (providersRes.error) throw new Error("加载模型列表失败")

      if (agentsRes.data) setAgents(agentsRes.data)
      if (providersRes.data) {
        setProviders(providersRes.data.providers)
        setDefaultIds(providersRes.data.default)
      }
    } catch (err) {
      if (!mountedRef.current) return
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (mountedRef.current) setIsLoading(false)
    }
  }

  useEffect(() => {
    mountedRef.current = true
    loadData()
    return () => {
      mountedRef.current = false
    }
  }, [])

  const handleReload = async () => {
    setError(null)
    try {
      const configRes = await sdk.global.config.get()
      if (!mountedRef.current) return
      if (configRes.error) throw new Error("重新加载配置失败")
      if (configRes.data) {
        const fresh = structuredClone(configRes.data)
        setFormData(fresh)
        onReloadConfig?.(structuredClone(configRes.data))
      }
      await loadData()
    } catch (err) {
      if (!mountedRef.current) return
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const rows: AgentRow[] = agents.map((agent) => {
    const agentConfig = formData.agent?.[agent.name]
    return {
      name: agent.name,
      mode: agent.mode,
      description: agent.description,
      model: (agentConfig?.model as string | undefined) ?? undefined,
      variant: (agentConfig?.variant as string | undefined) ?? undefined,
      configured: agentConfig !== undefined && Object.keys(agentConfig).length > 0,
    }
  })

  const sortedRows = [...rows].sort((a, b) => {
    if (a.configured !== b.configured) return a.configured ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  const updateAgent = (name: string, field: "model" | "variant", value: string | undefined) => {
    const currentAgent = formData.agent ?? {}
    const currentConfig = currentAgent[name] ?? {}

    const updated: Record<string, unknown> = { ...currentConfig, [field]: value || undefined }

    if (field === "model") {
      const variants = getVariantsForModel(providers, value)
      if (updated.variant && typeof updated.variant === "string" && !variants.includes(updated.variant)) {
        updated.variant = undefined
      }
    }

    const hasValues = updated.model || updated.variant
    const nextAgent = { ...currentAgent }
    if (hasValues) {
      nextAgent[name] = updated as typeof currentConfig
    } else {
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
      <div className="space-y-3">
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
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-3 text-sm text-red-800 dark:text-red-200">
          {error}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
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
              const selectedModel = parseModelValue(row.model)
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
                    <ModelSelector
                      selectedProviderId={selectedModel.providerID}
                      selectedModelId={selectedModel.modelID}
                      onSelect={(providerID, modelID) => updateAgent(row.name, "model", `${providerID}/${modelID}`)}
                      allowClear
                      clearLabel="默认"
                      placeholder="默认"
                      onClear={() => updateAgent(row.name, "model", undefined)}
                      dropdownPlacement="bottom"
                      providersData={providers}
                      defaultIdsData={defaultIds}
                      renderInPortal
                      buttonClassName="h-7 w-full max-w-[220px] px-2 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-between gap-1"
                    />
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
