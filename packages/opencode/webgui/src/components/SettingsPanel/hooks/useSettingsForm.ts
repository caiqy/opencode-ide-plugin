import { useState, useEffect } from "react"
import { sdk } from "../../../lib/api/sdkClient"
import type { Config } from "@opencode-ai/sdk/client"

export function useSettingsForm(isOpen: boolean) {
  const [formData, setFormData] = useState<Partial<Config>>({})
  const [originalFormData, setOriginalFormData] = useState<Partial<Config>>({})
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return

    const fetchData = async () => {
      setIsLoading(true)
      setError(null)

      try {
        // Fetch config
        const configResponse = await sdk.global.config.get()

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
  }
}
