import { useEffect, useMemo, useState } from "react"
import { parse, type ParseError } from "jsonc-parser"
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
  "https://raw.githubusercontent.com/caiqy/opencode-ide-plugin/refs/heads/ide-plugin/samples/opencode.jsonc"

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
        const models = res.data?.providers.flatMap((provider) => Object.keys(provider.models ?? {})) ?? []
        setKnownModels(Array.from(new Set(models)).sort())
      })
      .catch(() => setKnownModels([]))
  }, [])

  const modelOptions = useMemo(
    () => knownModels.filter((model) => !draft.whitelist.includes(model)),
    [knownModels, draft.whitelist],
  )

  const startEdit = (providerId: string) => {
    if (isSaving) return
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

  const saveConfig = async (next: Partial<Config>, mode: "patch" | "replace" = "patch") => {
    setIsSaving(true)
    setError(null)
    try {
      const response = await sdk.global.config[mode === "replace" ? "replace" : "update"]({ body: next })
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
    if (isSaving) return
    setIsSaving(true)
    setError(null)
    try {
      const text = await fetchConfigText(configUrl)
      const parseErrors: ParseError[] = []
      const remote = parse(text, parseErrors) as unknown
      if (parseErrors.length > 0 || !remote || typeof remote !== "object" || Array.isArray(remote)) {
        throw new Error("配置解析失败")
      }
      const remoteObject = remote as Record<string, unknown>
      if ("provider" in remoteObject && !isPlainObject(remoteObject.provider)) throw new Error("配置解析失败")
      const saved = await saveConfig(
        applyRemoteConfigUpdate(formData, remote as Partial<Config>, updateMode),
        updateMode === "replace" ? "replace" : "patch",
      )
      if (saved) setEditingProviderId(null)
    } catch (err) {
      setError(err instanceof Error && err.message.startsWith("配置下载失败") ? err.message : "配置解析失败")
    } finally {
      setIsSaving(false)
    }
  }

  const addModel = () => {
    if (isSaving) return
    setDraft({ ...draft, whitelist: normalizeWhitelist([...draft.whitelist, modelInput]) })
    setModelInput("")
  }

  const saveProvider = async () => {
    if (isSaving || !editingProviderId || !editingProvider) return
    const next = {
      provider: {
        ...(formData.provider ?? {}),
        [editingProviderId]: buildUpdatedProvider(editingProvider as ProviderConfig, draft),
      },
    }
    const saved = await saveConfig(next)
    if (saved) setEditingProviderId(null)
  }

  if (editingProviderId && editingProvider) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">编辑 Provider</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">提供商不可修改，其余字段保存到全局配置。</p>
          </div>
          <Button variant="secondary" onClick={() => setEditingProviderId(null)} disabled={isSaving}>
            返回列表
          </Button>
        </div>

        {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-gray-700 dark:text-gray-300">提供商</span>
            <input
              className="w-full rounded border border-gray-300 bg-gray-100 px-3 py-2 text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400"
              value={editingProviderId}
              disabled
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-gray-700 dark:text-gray-300">接口地址</span>
            <input
              aria-label="接口地址"
              className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              value={draft.baseURL}
              disabled={isSaving}
              onChange={(event) => setDraft({ ...draft, baseURL: event.target.value })}
            />
          </label>
          <label className="space-y-1 text-sm md:col-span-2">
            <span className="text-gray-700 dark:text-gray-300">API 密钥</span>
            <input
              aria-label="API 密钥"
              className="w-full rounded border border-gray-300 bg-white px-3 py-2 font-mono text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              value={draft.apiKey}
              disabled={isSaving}
              onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
            />
          </label>
        </div>

        <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">模型白名单</h4>
          <div className="mt-2 flex gap-2">
            <input
              className="flex-1 rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              list="provider-model-options"
              placeholder="选择或输入模型，例如 gpt-4.1"
              value={modelInput}
              disabled={isSaving}
              onChange={(event) => setModelInput(event.target.value)}
            />
            <datalist id="provider-model-options">
              {modelOptions.map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
            <Button variant="primary" onClick={addModel} disabled={isSaving || !modelInput.trim()}>
              添加模型
            </Button>
          </div>
          <table className="mt-3 w-full text-xs">
            <tbody>
              {draft.whitelist.map((model, index) => (
                <tr key={`${model}-${index}`}>
                  <td className="py-1 pr-2">
                    <input
                      className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                      value={model}
                      disabled={isSaving}
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
                      size="xs"
                      disabled={isSaving}
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
          <Button variant="secondary" onClick={() => setEditingProviderId(null)} disabled={isSaving}>
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
            className="flex-1 rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            value={configUrl}
            disabled={isSaving}
            onChange={(event) => setConfigUrl(event.target.value)}
          />
          <Button variant="primary" onClick={updateFromUrl} loading={isSaving}>
            更新配置
          </Button>
        </div>
        <div className="mt-2 flex gap-4 text-sm text-gray-600 dark:text-gray-400">
          <label className="inline-flex items-center gap-1">
            <input type="radio" checked={updateMode === "replace"} disabled={isSaving} onChange={() => setUpdateMode("replace")} /> 覆盖
          </label>
          <label className="inline-flex items-center gap-1">
            <input type="radio" checked={updateMode === "merge"} disabled={isSaving} onChange={() => setUpdateMode("merge")} /> 合并
          </label>
        </div>
      </div>
      {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
      <div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Provider 列表</h3>
        <table className="mt-2 w-full text-xs">
          <thead className="text-left text-gray-500 dark:text-gray-400">
            <tr>
              <th className="py-2 pr-2">提供商</th>
              <th className="py-2 pr-2">接口地址</th>
              <th className="py-2 pr-2">API 密钥</th>
              <th className="py-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-gray-100 dark:border-gray-800">
                <td className="py-2 pr-2 font-medium text-gray-900 dark:text-gray-100">{row.id}</td>
                <td className="py-2 pr-2 text-gray-600 dark:text-gray-300">{row.baseURL ?? "未配置"}</td>
                <td className="py-2 pr-2 font-mono text-gray-600 dark:text-gray-300">{row.maskedApiKey}</td>
                <td className="py-2">
                  <Button variant="secondary" size="xs" onClick={() => startEdit(row.id)} disabled={isSaving}>
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

async function fetchConfigText(configUrl: string) {
  try {
    const response = await fetch(configUrl)
    if (!response.ok) throw new Error(`配置下载失败：HTTP ${response.status}`)
    return await response.text()
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("配置下载失败")) throw err
    throw new Error(`配置下载失败：${err instanceof Error ? err.message : String(err)}`)
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}
