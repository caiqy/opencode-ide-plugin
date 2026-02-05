import { useState, useEffect } from "react"
import { sdk } from "../lib/api/sdkClient"
import type { Provider } from "@opencode-ai/sdk/client"
import { useDropdown } from "../hooks/useDropdown"
import { formatDate } from "../utils/formatting"

interface ModelSelectorProps {
  selectedProviderId?: string
  selectedModelId?: string
  onSelect: (providerId: string, modelId: string) => void | Promise<void>
  disabled?: boolean
}

export function ModelSelector({ selectedProviderId, selectedModelId, onSelect, disabled }: ModelSelectorProps) {
  const { isOpen, searchTerm, setSearchTerm, dropdownRef, close, toggle } = useDropdown()
  const [providers, setProviders] = useState<Provider[]>([])
  const [defaultIds, setDefaultIds] = useState<{ [key: string]: string }>({})
  const [isLoading, setIsLoading] = useState(true)
  const [recent, setRecent] = useState<Array<{ provider_id: string; model_id: string; last_used: string }>>([])

  // Load providers on mount
  useEffect(() => {
    let active = true

    async function loadProviders() {
      setIsLoading(true)
      try {
        const response = await sdk.config.providers()

        if (!active) return

        if (response.error) {
          console.error("[ModelSelector] Failed to load providers:", response.error)
          setIsLoading(false)
          return
        }

        if (response.data) {
          setProviders(response.data.providers)
          setDefaultIds(response.data.default)
        }

        // Load recent models from state for the "Recent" group
        const stateRes = await sdk.state.get()
        if (stateRes.data?.recently_used_models) {
          const list = [...stateRes.data.recently_used_models]
            .sort((a, b) => new Date(b.last_used).getTime() - new Date(a.last_used).getTime())
            .slice(0, 2)
          setRecent(list)
        } else {
          setRecent([])
        }
      } catch (err) {
        if (active) {
          console.error("[ModelSelector] Failed to load providers:", err)
        }
      } finally {
        if (active) {
          setIsLoading(false)
        }
      }
    }

    loadProviders()
    return () => {
      active = false
    }
  }, [])

  // Get current selection display
  const getCurrentDisplay = () => {
    const effectiveProviderId = selectedProviderId || defaultIds.provider
    const effectiveModelId = selectedModelId || defaultIds.model

    if (!effectiveProviderId || !effectiveModelId) {
      return "Select Model"
    }

    const provider = providers.find((p) => p.id === effectiveProviderId)
    if (!provider) return "Select Model"

    const model = provider.models[effectiveModelId]
    return model?.name || "Select Model"
  }

  const handleSelect = async (providerId: string, modelId: string) => {
    await onSelect(providerId, modelId)

    try {
      const stateRes = await sdk.state.get()
      if (stateRes.data?.recently_used_models) {
        const list = [...stateRes.data.recently_used_models]
          .sort((a, b) => new Date(b.last_used).getTime() - new Date(a.last_used).getTime())
          .slice(0, 2)
        setRecent(list)
      }
    } catch (err) {
      console.error("[ModelSelector] Failed to refresh recent models:", err)
    }

    close()
  }

  // Filter models based on search term
  const filterModels = (provider: Provider) => {
    if (!searchTerm) return Object.entries(provider.models)

    const lowerSearch = searchTerm.toLowerCase()
    return Object.entries(provider.models).filter(
      ([, model]) =>
        model.name.toLowerCase().includes(lowerSearch) || provider.name.toLowerCase().includes(lowerSearch),
    )
  }

  // Filter recent items based on search term
  const filterRecent = () => {
    if (!searchTerm) return recent
    const q = searchTerm.toLowerCase()
    return recent.filter((r) => r.model_id.toLowerCase().includes(q) || r.provider_id.toLowerCase().includes(q))
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={toggle}
        disabled={disabled || isLoading}
        className="h-6 px-1.5 text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 rounded disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-0.5"
        title="Select model"
        data-tip="Select model"
      >
        {getCurrentDisplay()}
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-0 mb-1 min-w-[300px] w-max max-w-[500px] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 max-h-96 overflow-hidden flex flex-col">
          {/* Search input */}
          <div className="p-2 border-b border-gray-200 dark:border-gray-700">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search models..."
              className="w-full px-2 py-1 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              autoFocus
            />
          </div>

          {/* Models list */}
          <div className="overflow-y-auto flex-1">
            {isLoading ? (
              <div className="p-4 text-xs text-gray-500 dark:text-gray-400 text-center">Loading models...</div>
            ) : providers.length === 0 ? (
              <div className="p-4 text-xs text-gray-500 dark:text-gray-400 text-center">No providers configured</div>
            ) : (
              <>
                {/* Recent group */}
                {filterRecent().length > 0 && (
                  <div className="border-b border-gray-100 dark:border-gray-800">
                    <div className="px-3 py-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800">
                      Recent
                    </div>
                    {filterRecent().map((item) => {
                      const isSelected = selectedProviderId === item.provider_id && selectedModelId === item.model_id

                      // Find model name from providers list
                      const provider = providers.find((p) => p.id === item.provider_id)
                      const modelName = provider?.models[item.model_id]?.name || item.model_id

                      return (
                        <button
                          key={`${item.provider_id}:${item.model_id}:${item.last_used}`}
                          onClick={() => handleSelect(item.provider_id, item.model_id)}
                          className={`w-full px-3 py-2 text-xs text-left hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-between ${
                            isSelected
                              ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400"
                              : "text-gray-900 dark:text-gray-100"
                          }`}
                        >
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <span className="font-medium truncate">{modelName}</span>
                            <span className="text-[10px] text-gray-400 dark:text-gray-500 flex-shrink-0">
                              {formatDate(item.last_used)}
                            </span>
                            <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate max-w-[6rem]">
                              {item.provider_id}
                            </span>
                          </div>
                          {isSelected && (
                            <svg className="w-4 h-4 ml-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                              <path
                                fillRule="evenodd"
                                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                clipRule="evenodd"
                              />
                            </svg>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}

                {/* Provider groups */}
                {providers.map((provider) => {
                  const filteredModels = filterModels(provider)
                  if (filteredModels.length === 0) return null

                  return (
                    <div key={provider.id} className="border-b border-gray-100 dark:border-gray-800 last:border-0">
                      <div className="px-3 py-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800">
                        {provider.name}
                      </div>
                      {filteredModels.map(([modelId, model]) => {
                        const isSelected = selectedProviderId === provider.id && selectedModelId === modelId
                        const isDefault = defaultIds.provider === provider.id && defaultIds.model === modelId

                        return (
                          <button
                            key={modelId}
                            onClick={() => handleSelect(provider.id, modelId)}
                            className={`w-full px-3 py-2 text-xs text-left hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-between ${
                              isSelected
                                ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400"
                                : "text-gray-900 dark:text-gray-100"
                            }`}
                          >
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              <span className="font-medium truncate">{model.name}</span>
                              <div className="flex items-center gap-1.5 text-[10px] text-gray-400 dark:text-gray-500 flex-shrink-0">
                                {/*<span>{formatDate(model.release_date)}</span>*/}
                                {model.capabilities.reasoning && (
                                  <span className="px-1 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded text-[9px] leading-none">
                                    reasoning
                                  </span>
                                )}
                                {isDefault && (
                                  <span className="px-1 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded text-[9px] leading-none">
                                    default
                                  </span>
                                )}
                              </div>
                            </div>
                            {isSelected && (
                              <svg className="w-4 h-4 ml-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                <path
                                  fillRule="evenodd"
                                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                  clipRule="evenodd"
                                />
                              </svg>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  )
                })}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
