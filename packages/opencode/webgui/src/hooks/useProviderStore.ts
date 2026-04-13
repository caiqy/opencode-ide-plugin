// packages/opencode/webgui/src/hooks/useProviderStore.ts
import { useEffect, useState } from "react"
import { sdk } from "../lib/api/sdkClient"

interface ProviderModel {
  name: string
  [key: string]: unknown
}

interface ProviderEntry {
  id: string
  name: string
  models: Record<string, ProviderModel>
}

// 模块级缓存：所有组件实例共享同一份 provider 列表
let cachedProviders: ProviderEntry[] | null = null
let fetchPromise: Promise<void> | null = null

function fetchProviders(): Promise<void> {
  if (fetchPromise) return fetchPromise
  fetchPromise = sdk.config
    .providers()
    .then((res) => {
      if (res.data) {
        cachedProviders = res.data.providers as unknown as ProviderEntry[]
      }
    })
    .catch(() => {
      // 静默失败，resolveModelName 会 fallback 到 modelID
    })
    .finally(() => {
      fetchPromise = null
    })
  return fetchPromise
}

/**
 * 提供 model 名称解析能力。
 * 使用模块级缓存，provider 列表只请求一次。
 */
export function useProviderStore() {
  const [, setTick] = useState(0)

  useEffect(() => {
    if (cachedProviders) return
    fetchProviders().then(() => {
      setTick((t) => t + 1) // 触发重渲染以使用缓存数据
    })
  }, [])

  return {
    resolveModelName(providerID: string, modelID: string): string {
      if (!cachedProviders) return modelID
      const provider = cachedProviders.find((p) => p.id === providerID)
      return provider?.models?.[modelID]?.name ?? modelID
    },
  }
}

// 仅用于测试：重置模块级缓存
export function _resetProviderCache() {
  cachedProviders = null
  fetchPromise = null
}
