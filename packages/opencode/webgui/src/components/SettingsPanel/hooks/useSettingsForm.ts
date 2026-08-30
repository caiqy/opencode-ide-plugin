import { useState, useEffect } from "react"
import { sdk } from "../../../lib/api/sdkClient"
import type { Config } from "@opencode-ai/sdk/client"
import { ideBridge } from "../../../lib/ideBridge"

export const automaticUpdateStorageKey = "commonSettings.autoUpdate"

export function useSettingsForm(isOpen: boolean) {
  const [formData, setFormData] = useState<Partial<Config>>({})
  const [originalFormData, setOriginalFormData] = useState<Partial<Config>>({})
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pluginAutoUpdate, setPluginAutoUpdate] = useState(true)
  const [originalPluginAutoUpdate, setOriginalPluginAutoUpdate] = useState(true)

  useEffect(() => {
    if (!isOpen) return

    const fetchData = async () => {
      setIsLoading(true)
      setError(null)

      try {
        // Fetch config
        const [configResponse, stored] = await Promise.all([
          sdk.global.config.get(),
          ideBridge.storageGet("global", [automaticUpdateStorageKey]),
        ])

        if (configResponse.error) {
          throw new Error("Failed to load config")
        }

        if (configResponse.data) {
          const configData = structuredClone(configResponse.data)
          setFormData(configData)
          setOriginalFormData(configData)
        } else {
          setFormData({})
          setOriginalFormData({})
        }
        const autoUpdate = stored?.[automaticUpdateStorageKey] !== "false"
        setPluginAutoUpdate(autoUpdate)
        setOriginalPluginAutoUpdate(autoUpdate)
      } catch (err) {
        setError(String(err))
      } finally {
        setIsLoading(false)
      }
    }

    fetchData()
  }, [isOpen])

  return {
    formData,
    setFormData,
    originalFormData,
    setOriginalFormData,
    isLoading,
    error,
    pluginAutoUpdate,
    setPluginAutoUpdate,
    originalPluginAutoUpdate,
    setOriginalPluginAutoUpdate,
    pluginAutoUpdateAvailable: ideBridge.isInstalled(),
  }
}
