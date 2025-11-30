import type { Provider } from "@opencode-ai/sdk/client"
import { useMemo } from "react"

/**
 * Filter providers to only show configured ones + the one currently being added
 */
export function useDisplayedProviders(
  providers: Provider[],
  configuredProviders: string[],
  selectedProviderToAdd: string,
) {
  return useMemo(() => {
    const configured = new Set(configuredProviders)
    return providers.filter((p) => configured.has(p.id) || p.id === selectedProviderToAdd)
  }, [providers, configuredProviders, selectedProviderToAdd])
}

/**
 * Get available providers for the dropdown (excluding already configured ones)
 */
export function useAvailableProviders(providers: Provider[], configuredProviders: string[]) {
  return useMemo(() => {
    const configured = new Set(configuredProviders)
    return providers.filter((p) => !configured.has(p.id))
  }, [providers, configuredProviders])
}

/**
 * Filter available providers based on search term
 */
export function useFilteredProviders(providers: Provider[], searchTerm: string) {
  return useMemo(() => {
    if (!searchTerm) return providers
    const lower = searchTerm.toLowerCase()
    return providers.filter((p) => p.name.toLowerCase().includes(lower))
  }, [providers, searchTerm])
}
