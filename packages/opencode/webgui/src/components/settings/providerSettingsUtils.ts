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
      if (isPlainObject(leftValue) && isPlainObject(rightValue)) return [key, mergePlainObjects(leftValue, rightValue)]
      return [key, rightValue === undefined ? leftValue : rightValue]
    }),
  )
}

function isPlainObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value)
}
