import { useState, useEffect } from "react"
import type { Provider } from "@opencode-ai/sdk/client"
import { sdk } from "../../../../lib/api/sdkClient"

interface AuthMethod {
  label: string
  type: "oauth" | "api"
}

export function useApiKeys(displayedProviders: Provider[]) {
  const [methods, setMethods] = useState<Record<string, AuthMethod[]>>({})
  const [loadingMethods, setLoadingMethods] = useState<Record<string, boolean>>({})

  useEffect(() => {
    const fetchMethods = async () => {
      const newLoading: Record<string, boolean> = {}

      // Set loading state
      displayedProviders.forEach((p) => {
        if (!methods[p.id]) {
          newLoading[p.id] = true
        }
      })

      if (Object.keys(newLoading).length === 0) return

      setLoadingMethods((prev) => ({ ...prev, ...newLoading }))

      // Fetch methods in parallel
      await Promise.all(
        displayedProviders.map(async (provider) => {
          if (methods[provider.id]) return
          try {
            const m = await sdk.auth.methods(provider.id)
            if (m && m.length > 0) {
              setMethods((prev) => ({ ...prev, [provider.id]: m }))
            }
          } catch (e) {
            console.error(`Failed to fetch methods for ${provider.id}`, e)
          } finally {
            setLoadingMethods((prev) => ({ ...prev, [provider.id]: false }))
          }
        }),
      )
    }

    if (displayedProviders.length > 0) {
      fetchMethods()
    }
  }, [displayedProviders, methods])

  return { methods, loadingMethods }
}
