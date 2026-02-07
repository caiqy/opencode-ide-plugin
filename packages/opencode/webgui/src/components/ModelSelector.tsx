import { useState, useEffect } from "react"
import { sdk } from "../lib/api/sdkClient"
import type { Provider } from "@opencode-ai/sdk/client"
import { useDropdown } from "../hooks/useDropdown"
import { useLocalStorage } from "../hooks/useLocalStorage"
import { ideBridge } from "../lib/ideBridge"
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
  const [favorites, setFavorites] = useLocalStorage<string[]>("opencode_favorite_models_v1", [], {
    syncAcrossTabs: true,
  })
  const [hydrated, setHydrated] = useState(false)
  const favoriteSet = new Set(favorites)

  useEffect(() => {
    const sync = async () => {
      if (!ideBridge.isInstalled()) {
        setHydrated(true)
        return
      }

      const local = window.localStorage.getItem("opencode_favorite_models_v1")
      const reply = await ideBridge.request("storageGet", {
        keys: ["opencode_favorite_models_v1"],
      })
      const host =
        typeof reply.result?.opencode_favorite_models_v1 === "string" ? reply.result.opencode_favorite_models_v1 : null

      if (host) {
        const next = JSON.parse(host)
        if (Array.isArray(next)) {
          setFavorites(next.filter((x): x is string => typeof x === "string"))
        }
        setHydrated(true)
        return
      }

      if (local) {
        await ideBridge.request("storageSet", {
          key: "opencode_favorite_models_v1",
          value: local,
        })
      }

      setHydrated(true)
    }

    sync()
  }, [setFavorites])

  useEffect(() => {
    if (!hydrated || !ideBridge.isInstalled()) {
      return
    }

    ideBridge.request("storageSet", {
      key: "opencode_favorite_models_v1",
      value: JSON.stringify(favorites),
    })
  }, [favorites, hydrated])

  const toggleFavorite = (providerId: string, modelId: string) => {
    const key = `${providerId}/${modelId}`
    setFavorites((prev) => (prev.includes(key) ? prev.filter((x) => x !== key) : [key, ...prev]))
  }

  const FavoriteButton = (props: { providerId: string; modelId: string }) => {
    const key = `${props.providerId}/${props.modelId}`
    const active = favoriteSet.has(key)
    const label = `Toggle favorite ${key}`

    return (
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          toggleFavorite(props.providerId, props.modelId)
        }}
        className={
          active
            ? "w-5 h-5 flex items-center justify-center text-yellow-500 hover:text-yellow-600"
            : "w-5 h-5 flex items-center justify-center text-gray-300 hover:text-gray-400"
        }
      >
        <svg
          className="w-4 h-4"
          viewBox="0 0 20 20"
          fill={active ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            d="M10 1.5l2.59 5.25 5.8.84-4.2 4.09.99 5.78L10 14.77 4.82 17.5l.99-5.78L1.61 7.59l5.8-.84L10 1.5z"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    )
  }

  const ModelSelectionIndicator = (props: { selected: boolean }) => {
    return (
      <span
        data-slot="model-selection-indicator"
        aria-hidden="true"
        className="inline-flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center"
      >
        <span
          className={`h-1.5 w-1.5 rounded-full transition-opacity duration-200 ${
            props.selected
              ? "bg-blue-500 dark:bg-blue-400 shadow-[0_0_0_4px_rgba(59,130,246,0.22)] dark:shadow-[0_0_0_4px_rgba(96,165,250,0.22)] model-selection-dot-breathe"
              : "opacity-0"
          }`}
        />
      </span>
    )
  }

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

  const favoriteList = (() => {
    const needle = searchTerm.trim().toLowerCase()
    return favorites
      .map((key) => {
        const index = key.indexOf("/")
        if (index === -1) return null
        const providerID = key.slice(0, index)
        const modelID = key.slice(index + 1)
        const provider = providers.find((p) => p.id === providerID)
        const model = provider?.models[modelID]
        if (!provider || !model) return null
        const name = model.name || modelID
        const matches =
          needle.length === 0
            ? true
            : name.toLowerCase().includes(needle) || provider.name.toLowerCase().includes(needle)
        if (!matches) return null
        return { provider_id: providerID, model_id: modelID, name, provider: provider.name }
      })
      .filter(Boolean) as Array<{ provider_id: string; model_id: string; name: string; provider: string }>
  })()

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={toggle}
        disabled={disabled || isLoading}
        className="h-6 px-1.5 text-xs text-gray-600 dark:text-gray-200 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 rounded disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-0.5"
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
                {/* Favorites group */}
                {favoriteList.length > 0 && (
                  <div className="border-b border-gray-100 dark:border-gray-800">
                    <div className="px-3 py-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800">
                      Favorites
                    </div>
                    {favoriteList.map((item) => {
                      const isSelected = selectedProviderId === item.provider_id && selectedModelId === item.model_id
                      return (
                        <div
                          key={`fav:${item.provider_id}:${item.model_id}`}
                          onClick={() => handleSelect(item.provider_id, item.model_id)}
                          role="button"
                          tabIndex={0}
                          className={`w-full px-3 py-2 text-xs text-left hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-between ${
                            isSelected
                              ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400"
                              : "text-gray-900 dark:text-gray-100"
                          }`}
                        >
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <ModelSelectionIndicator selected={isSelected} />
                            <span className="font-medium truncate">{item.name}</span>
                            <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate max-w-[10rem]">
                              {item.provider}
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            <FavoriteButton providerId={item.provider_id} modelId={item.model_id} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

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
                            <ModelSelectionIndicator selected={isSelected} />
                            <span className="font-medium truncate">{modelName}</span>
                            <span className="text-[10px] text-gray-400 dark:text-gray-500 flex-shrink-0">
                              {formatDate(item.last_used)}
                            </span>
                            <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate max-w-[6rem]">
                              {item.provider_id}
                            </span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}

                {/* Provider groups */}
                {providers.map((provider) => {
                  const filteredModels = filterModels(provider).filter(([modelId]) => {
                    if (searchTerm.trim().length > 0) return true
                    return !favoriteSet.has(`${provider.id}/${modelId}`)
                  })
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
                          <div
                            key={modelId}
                            onClick={() => handleSelect(provider.id, modelId)}
                            role="button"
                            tabIndex={0}
                            className={`w-full px-3 py-2 text-xs text-left hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-between ${
                              isSelected
                                ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400"
                                : "text-gray-900 dark:text-gray-100"
                            }`}
                          >
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              <ModelSelectionIndicator selected={isSelected} />
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
                            <div className="flex items-center gap-1">
                              <FavoriteButton providerId={provider.id} modelId={modelId} />
                            </div>
                          </div>
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
