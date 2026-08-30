import { useEffect, useMemo, useState, type ReactNode } from "react"
import type { Config } from "@opencode-ai/sdk/client"
import { sdk } from "../../lib/api/sdkClient"

const defaultSearchModel = "openai/gpt-5.6-luna"

type CommonConfig = Partial<Config> & {
  websearch?: { models: string[]; mode?: "responses" | "alpha-search" }
  parallel_limit?: { websearch?: number; subagent?: number }
  provider_retry?: { max_retries: number }
}

interface GeneralTabProps {
  formData: Partial<Config>
  setFormData: (data: Partial<Config>) => void
  pluginAutoUpdate: boolean
  setPluginAutoUpdate: (enabled: boolean) => void
  pluginAutoUpdateAvailable: boolean
  setStatus: (status: { valid: boolean; draftDirty: boolean }) => void
}

export function GeneralTab({
  formData,
  setFormData,
  pluginAutoUpdate,
  setPluginAutoUpdate,
  pluginAutoUpdateAvailable,
  setStatus,
}: GeneralTabProps) {
  const config = formData as CommonConfig
  const [websearchLimit, setWebsearchLimit] = useState(String(config.parallel_limit?.websearch ?? 3))
  const [subagentLimit, setSubagentLimit] = useState(String(config.parallel_limit?.subagent ?? 3))
  const [retryLimit, setRetryLimit] = useState(String(config.provider_retry?.max_retries ?? 10))
  const [models, setModels] = useState<string[]>([])
  const [hasCredentials, setHasCredentials] = useState(false)
  const [modelsLoading, setModelsLoading] = useState(true)
  const openAI = config.websearch === undefined || config.websearch.mode === "alpha-search"
  const searchModel = config.websearch?.models[0] ?? defaultSearchModel

  useEffect(() => setWebsearchLimit(String(config.parallel_limit?.websearch ?? 3)), [config.parallel_limit?.websearch])
  useEffect(() => setSubagentLimit(String(config.parallel_limit?.subagent ?? 3)), [config.parallel_limit?.subagent])
  useEffect(() => setRetryLimit(String(config.provider_retry?.max_retries ?? 10)), [config.provider_retry?.max_retries])

  useEffect(() => {
    let active = true
    setModelsLoading(true)
    Promise.all([sdk.config.allProviders(), sdk.auth.list()])
      .then(([providers, auth]) => {
        if (!active) return
        const provider = providers.data?.providers.find((item) => item.id === "openai")
        const configured = config.provider?.openai
        const modelIDs = [
          ...Object.values(provider?.models ?? {}).map((model) => model.id),
          ...Object.keys(configured?.models ?? {}),
          ...(configured?.whitelist ?? []),
        ]
        setModels(
          Array.from(
            new Set(modelIDs.map((model) => (model.startsWith("openai/") ? model : `openai/${model}`))),
          ).sort(),
        )
        setHasCredentials(Boolean(auth.openai || configured?.options?.apiKey))
      })
      .catch(() => {
        if (!active) return
        setModels([])
        setHasCredentials(false)
      })
      .finally(() => {
        if (active) setModelsLoading(false)
      })
    return () => {
      active = false
    }
  }, [config.provider?.openai])

  const websearchError = integerError(websearchLimit, 1, 10)
  const subagentError = integerError(subagentLimit, 1, 10)
  const retryError = integerError(retryLimit, 0, 100)
  const modelError = !openAI
    ? undefined
    : modelsLoading
      ? "正在检查 OpenAI 模型和凭据…"
      : !models.includes(searchModel)
        ? `模型 ${searchModel} 尚未配置`
        : !hasCredentials
          ? "OpenAI 凭据不可用，请先在 Provider 设置中完成配置"
          : undefined
  const draftDirty =
    websearchLimit !== String(config.parallel_limit?.websearch ?? 3) ||
    subagentLimit !== String(config.parallel_limit?.subagent ?? 3) ||
    retryLimit !== String(config.provider_retry?.max_retries ?? 10)

  useEffect(() => {
    setStatus({ valid: !websearchError && !subagentError && !retryError && !modelError, draftDirty })
  }, [draftDirty, modelError, retryError, setStatus, subagentError, websearchError])

  const modelOptions = useMemo(
    () => (models.includes(searchModel) ? models : [searchModel, ...models]),
    [models, searchModel],
  )

  const updateNumber = (
    value: string,
    setValue: (value: string) => void,
    min: number,
    max: number,
    update: (value: number) => void,
  ) => {
    setValue(value)
    if (!integerError(value, min, max)) update(Number(value))
  }

  return (
    <div className="divide-y divide-gray-200 dark:divide-gray-800">
      <Setting
        title="IDE 插件自动更新"
        description="默认开启。定时检查 IDE 插件的新版本并执行插件安装；关闭后停止自动检查，但仍可手动检查更新。不会读取或修改 OpenCode 后端的 autoupdate 配置。"
      >
        <input
          aria-label="IDE 插件自动更新"
          type="checkbox"
          checked={pluginAutoUpdate}
          disabled={!pluginAutoUpdateAvailable}
          onChange={(event) => setPluginAutoUpdate(event.target.checked)}
          className="h-4 w-4 rounded border-gray-300 dark:border-gray-700"
        />
      </Setting>

      <Setting
        title="文件快照"
        description="默认关闭。开启后为后续会话记录文件状态，可用于文件撤销和恢复；关闭时不记录快照，相应的文件恢复能力不可用。"
      >
        <input
          aria-label="文件快照"
          type="checkbox"
          checked={config.snapshot === true}
          onChange={(event) => setFormData({ ...formData, snapshot: event.target.checked })}
          className="h-4 w-4 rounded border-gray-300 dark:border-gray-700"
        />
      </Setting>

      <Setting
        title="搜索模式"
        description="默认使用 OpenAI 搜索。原生搜索沿用 Exa/Parallel；OpenAI 搜索调用 /alpha/search，模型或凭据不可用时会明确报错，不会回退。"
      >
        <div className="inline-flex overflow-hidden rounded border border-gray-300 dark:border-gray-700">
          {(["native", "openai"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={(mode === "openai") === openAI}
              onClick={() =>
                setFormData({
                  ...formData,
                  websearch:
                    mode === "openai"
                      ? { mode: "alpha-search", models: [searchModel] }
                      : { mode: "responses", models: [] },
                } as Partial<Config>)
              }
              className={`px-3 py-1.5 text-sm ${
                (mode === "openai") === openAI
                  ? "bg-blue-600 text-white"
                  : "bg-white text-gray-700 dark:bg-gray-900 dark:text-gray-300"
              }`}
            >
              {mode === "openai" ? "OpenAI 搜索" : "原生搜索"}
            </button>
          ))}
        </div>
      </Setting>

      {openAI && (
        <Setting
          title="OpenAI 搜索模型"
          description={`默认 ${defaultSearchModel}。只显示已配置的 OpenAI 模型；所选模型和凭据均可用后才能保存。`}
          error={modelError}
        >
          <select
            aria-label="OpenAI 搜索模型"
            value={searchModel}
            onChange={(event) =>
              setFormData({
                ...formData,
                websearch: { mode: "alpha-search", models: [event.target.value] },
              } as Partial<Config>)
            }
            className="w-full max-w-sm rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          >
            {modelOptions.map((model) => (
              <option key={model} value={model} disabled={!models.includes(model)}>
                {model}
                {models.includes(model) ? "" : "（不可用）"}
              </option>
            ))}
          </select>
        </Setting>
      )}

      <NumberSetting
        title="网页搜索并行数"
        description="默认 3，范围 1–10。限制后续同时执行的网页搜索数量；降低可减少资源占用，提高会增加并发请求。正在执行的搜索不受影响。"
        value={websearchLimit}
        error={websearchError}
        onChange={(value) =>
          updateNumber(value, setWebsearchLimit, 1, 10, (next) =>
            setFormData({
              ...formData,
              parallel_limit: { ...config.parallel_limit, websearch: next },
            } as Partial<Config>),
          )
        }
      />
      <NumberSetting
        title="子任务并行数"
        description="默认 3，范围 1–10。限制后续同时执行的子任务数量；降低可减少资源占用，提高会增加并发执行。正在执行的子任务不受影响。"
        value={subagentLimit}
        error={subagentError}
        onChange={(value) =>
          updateNumber(value, setSubagentLimit, 1, 10, (next) =>
            setFormData({
              ...formData,
              parallel_limit: { ...config.parallel_limit, subagent: next },
            } as Partial<Config>),
          )
        }
      />
      <NumberSetting
        title="错误重试上限"
        description="默认 10，范围 0–100。表示首次模型请求失败后最多追加的自动重试次数；设为 0 会禁用自动重试。正在执行的请求不受影响。"
        value={retryLimit}
        error={retryError}
        onChange={(value) =>
          updateNumber(value, setRetryLimit, 0, 100, (next) =>
            setFormData({ ...formData, provider_retry: { max_retries: next } } as Partial<Config>),
          )
        }
      />
    </div>
  )
}

function Setting(props: { title: string; description: string; error?: string; children: ReactNode }) {
  return (
    <section className="grid gap-3 py-4 first:pt-0 md:grid-cols-[minmax(0,1fr)_minmax(12rem,18rem)] md:items-start">
      <div>
        <h3 className="text-sm font-medium text-gray-800 dark:text-gray-200">{props.title}</h3>
        <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">{props.description}</p>
        {props.error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{props.error}</p>}
      </div>
      <div className="md:justify-self-end">{props.children}</div>
    </section>
  )
}

function NumberSetting(props: {
  title: string
  description: string
  value: string
  error?: string
  onChange: (value: string) => void
}) {
  return (
    <Setting title={props.title} description={props.description} error={props.error}>
      <input
        aria-label={props.title}
        inputMode="numeric"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        className="w-24 rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
      />
    </Setting>
  )
}

function integerError(value: string, min: number, max: number) {
  if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) return `请输入 ${min}–${max} 的整数`
}
