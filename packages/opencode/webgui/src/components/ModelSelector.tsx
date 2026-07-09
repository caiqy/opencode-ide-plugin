import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { createPortal } from "react-dom"
import { sdk } from "../lib/api/sdkClient"
import type { Provider } from "@opencode-ai/sdk/client"
import { useDropdown } from "../hooks/useDropdown"
import { addRecentModel, loadModelPrefs, updateModelPrefs } from "../state/repo/modelPrefsRepo"

interface ModelSelectorProps {
  selectedProviderId?: string
  selectedModelId?: string
  onSelect: (providerId: string, modelId: string) => void | Promise<void>
  disabled?: boolean
  placeholder?: string
  allowClear?: boolean
  clearLabel?: string
  onClear?: () => void | Promise<void>
  buttonClassName?: string
  dropdownPlacement?: "top" | "bottom"
  /** Pre-loaded providers array; when supplied the component skips its own sdk.config.providers() call */
  providersData?: Provider[]
  /** Pre-loaded default ids (e.g. { provider, model }); paired with providersData */
  defaultIdsData?: Record<string, string>
  /** Render dropdown in a portal to escape overflow clipping */
  renderInPortal?: boolean
}

interface ModelEntry {
  providerID: string
  modelID: string
}

const MAX_RECENT = 10

function favoriteKey(entry: ModelEntry) {
  return `${entry.providerID}/${entry.modelID}`
}

function StarIcon({
  filled,
  label,
  onClick,
}: {
  filled: boolean
  label: string
  onClick: (e: React.MouseEvent) => void
}) {
  return (
    <button
      onClick={onClick}
      onKeyDown={(e) => e.stopPropagation()}
      aria-label={label}
      className="flex-shrink-0 p-0.5 hover:scale-110 transition-transform"
      title={label}
    >
      <svg
        className="w-3.5 h-3.5"
        viewBox="0 0 20 20"
        fill={filled ? "#eab308" : "none"}
        stroke={filled ? "#eab308" : "currentColor"}
        strokeWidth={1.5}
      >
        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
      </svg>
    </button>
  )
}

function ModelSelectionIndicator({ selected }: { selected: boolean }) {
  return (
    <span
      data-slot="model-selection-indicator"
      aria-hidden="true"
      className="inline-flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center"
    >
      <span
        className={`h-1.5 w-1.5 rounded-full transition-opacity duration-200 ${
          selected
            ? "bg-blue-500 dark:bg-blue-400 shadow-[0_0_0_4px_rgba(0,120,212,0.22)] dark:shadow-[0_0_0_4px_rgba(77,170,252,0.22)] model-selection-dot-breathe"
            : "opacity-0"
        }`}
      />
    </span>
  )
}

export function ModelSelector({
  selectedProviderId,
  selectedModelId,
  onSelect,
  disabled,
  placeholder,
  allowClear = false,
  clearLabel = "默认",
  onClear,
  buttonClassName,
  dropdownPlacement = "top",
  providersData,
  defaultIdsData,
  renderInPortal = false,
}: ModelSelectorProps) {
  const hasExplicitPlaceholder = placeholder !== undefined
  const effectivePlaceholder = placeholder ?? "选择模型"
  const portalRef = useRef<HTMLDivElement>(null)
  const excludeRefs = useMemo(
    () => (renderInPortal ? [portalRef as React.RefObject<HTMLElement>] : undefined),
    [renderInPortal],
  )
  const { isOpen, searchTerm, setSearchTerm, dropdownRef, close, toggle } = useDropdown({
    excludeRefs,
  })
  const [providers, setProviders] = useState<Provider[]>(providersData ?? [])
  const [defaultIds, setDefaultIds] = useState<Record<string, string>>(defaultIdsData ?? {})
  const [isLoading, setIsLoading] = useState(!providersData)
  const [recent, setRecent] = useState<ModelEntry[]>([])
  const [favorite, setFavorite] = useState<ModelEntry[]>([])
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [portalStyle, setPortalStyle] = useState<React.CSSProperties>({})

  const favoriteSet = new Set(favorite.map(favoriteKey))

  const isFavorite = useCallback(
    (providerID: string, modelID: string) => favorite.some((f) => f.providerID === providerID && f.modelID === modelID),
    [favorite],
  )

  useEffect(() => {
    if (providersData) {
      setProviders(providersData)
      setDefaultIds(defaultIdsData ?? {})
    }
  }, [providersData, defaultIdsData])

  useEffect(() => {
    let active = true

    async function load() {
      if (!providersData) setIsLoading(true)
      try {
        const tasks: [
          Promise<Awaited<ReturnType<typeof sdk.config.providers>>> | undefined,
          Promise<{ recent: ModelEntry[]; favorite: ModelEntry[] }>,
        ] = [providersData ? undefined : sdk.config.providers(), loadModelPrefs()]
        const [provRes, modelPrefs] = await Promise.all(tasks)

        if (!active) return

        if (provRes) {
          if ("error" in provRes && provRes.error) {
            console.error("[ModelSelector] Failed to load providers:", provRes.error)
            setIsLoading(false)
            return
          }
          if (provRes.data) {
            setProviders(provRes.data.providers)
            setDefaultIds(provRes.data.default)
          }
        }

        setRecent(modelPrefs.recent.slice(0, MAX_RECENT))
        setFavorite(modelPrefs.favorite)
      } catch (err) {
        if (active) console.error("[ModelSelector] Failed to load:", err)
      } finally {
        if (active) {
          setIsLoading(false)
        }
      }
    }

    load()
    return () => {
      active = false
    }
  }, [])

  // Refresh prefs each time the dropdown opens so sibling instances see latest recent/favorite
  useEffect(() => {
    if (!isOpen) return
    let active = true
    loadModelPrefs()
      .then((prefs) => {
        if (!active) return
        setRecent(prefs.recent.slice(0, MAX_RECENT))
        setFavorite(prefs.favorite)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [isOpen])

  const updatePortalPosition = useCallback(() => {
    if (!renderInPortal || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const style: React.CSSProperties = {
      position: "fixed",
      minWidth: Math.max(rect.width, 300),
      left: rect.left,
      zIndex: 9999,
    }
    if (dropdownPlacement === "bottom") {
      style.top = rect.bottom + 4
    } else {
      style.bottom = window.innerHeight - rect.top + 4
    }
    setPortalStyle(style)
  }, [renderInPortal, dropdownPlacement])

  // Keep portal aligned with its trigger while the settings panel scrolls or viewport changes.
  useEffect(() => {
    if (!isOpen || !renderInPortal) return
    updatePortalPosition()
    window.addEventListener("resize", updatePortalPosition)
    window.addEventListener("scroll", updatePortalPosition, true)
    return () => {
      window.removeEventListener("resize", updatePortalPosition)
      window.removeEventListener("scroll", updatePortalPosition, true)
    }
  }, [isOpen, renderInPortal, updatePortalPosition])

  const getCurrentDisplay = () => {
    if (!selectedProviderId || !selectedModelId) {
      if (hasExplicitPlaceholder || (!selectedProviderId && !selectedModelId)) {
        if (hasExplicitPlaceholder) return effectivePlaceholder
        const pid = defaultIds.provider
        const mid = defaultIds.model
        if (!pid || !mid) return effectivePlaceholder
        const provider = providers.find((p) => p.id === pid)
        if (!provider) return `${pid}/${mid}`
        return provider.models[mid]?.name || `${pid}/${mid}`
      }
      return effectivePlaceholder
    }
    const provider = providers.find((p) => p.id === selectedProviderId)
    if (!provider) return `${selectedProviderId}/${selectedModelId}`
    return provider.models[selectedModelId]?.name || `${selectedProviderId}/${selectedModelId}`
  }

  const handleSelect = async (providerID: string, modelID: string) => {
    await onSelect(providerID, modelID)

    const entry = { providerID, modelID }
    const deduped = [entry, ...recent.filter((r) => r.providerID !== providerID || r.modelID !== modelID)]
    if (deduped.length > MAX_RECENT) deduped.length = MAX_RECENT
    setRecent(deduped)

    addRecentModel(entry)
      .then((value) => {
        setRecent(value.recent)
        setFavorite(value.favorite)
      })
      .catch((err) => console.error("[ModelSelector] Failed to update recent:", err))

    close()
  }

  const handleClear = async () => {
    await onClear?.()
    close()
  }

  const toggleFavorite = async (providerID: string, modelID: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const exists = isFavorite(providerID, modelID)
    const next = exists
      ? favorite.filter((f) => f.providerID !== providerID || f.modelID !== modelID)
      : [{ providerID, modelID }, ...favorite]
    setFavorite(next)

    updateModelPrefs((value) => {
      const active = value.favorite.some((f) => f.providerID === providerID && f.modelID === modelID)
      return {
        recent: value.recent,
        favorite: active
          ? value.favorite.filter((f) => f.providerID !== providerID || f.modelID !== modelID)
          : [{ providerID, modelID }, ...value.favorite],
      }
    })
      .then((value) => {
        setRecent(value.recent)
        setFavorite(value.favorite)
      })
      .catch((err) => console.error("[ModelSelector] Failed to update favorites:", err))
  }

  const filterModels = (provider: Provider) => {
    if (!searchTerm) return Object.entries(provider.models)
    const q = searchTerm.toLowerCase()
    return Object.entries(provider.models).filter(
      ([, model]) => model.name.toLowerCase().includes(q) || provider.name.toLowerCase().includes(q),
    )
  }

  const filteredFavorites = () => {
    if (!searchTerm) return favorite
    const q = searchTerm.toLowerCase()
    return favorite.filter((f) => {
      const provider = providers.find((p) => p.id === f.providerID)
      const name = provider?.models[f.modelID]?.name || f.modelID
      return name.toLowerCase().includes(q) || f.providerID.toLowerCase().includes(q)
    })
  }

  const filteredRecent = () => {
    const list = recent.filter((r) => !isFavorite(r.providerID, r.modelID))
    if (!searchTerm) return list
    const q = searchTerm.toLowerCase()
    return list.filter((r) => {
      const provider = providers.find((p) => p.id === r.providerID)
      const name = provider?.models[r.modelID]?.name || r.modelID
      return name.toLowerCase().includes(q) || r.providerID.toLowerCase().includes(q)
    })
  }

  const renderModelRow = (providerID: string, modelID: string, extraLabel?: React.ReactNode) => {
    const isSelected = selectedProviderId === providerID && selectedModelId === modelID
    const provider = providers.find((p) => p.id === providerID)
    const model = provider?.models[modelID]
    const name = model?.name || modelID
    const label = `切换收藏 ${providerID}/${modelID}`

    return (
      <div
        key={`${providerID}:${modelID}`}
        onClick={() => handleSelect(providerID, modelID)}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return
          event.preventDefault()
          void handleSelect(providerID, modelID)
        }}
        className={`w-full px-3 py-2 text-xs text-left hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-between ${
          isSelected
            ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400"
            : "text-gray-900 dark:text-gray-100"
        }`}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <ModelSelectionIndicator selected={isSelected} />
          <span className="font-medium truncate">{name}</span>
          {extraLabel}
          <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate max-w-[6rem]">
            {provider?.name || providerID}
          </span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <StarIcon
            filled={isFavorite(providerID, modelID)}
            label={label}
            onClick={(e) => toggleFavorite(providerID, modelID, e)}
          />
        </div>
      </div>
    )
  }

  const buttonClasses =
    buttonClassName ||
    "h-6 px-1.5 text-xs text-gray-600 dark:text-gray-200 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 rounded disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-0.5"

  const dropdownBase =
    "min-w-[300px] w-max max-w-[500px] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 max-h-96 overflow-hidden flex flex-col"
  const inlineDropdownClasses =
    dropdownPlacement === "bottom"
      ? `absolute left-0 ${dropdownBase} top-full mt-1`
      : `absolute left-0 ${dropdownBase} bottom-full mb-1`

  const dropdownContent = (
    <div
      ref={renderInPortal ? portalRef : undefined}
      className={renderInPortal ? dropdownBase : inlineDropdownClasses}
      style={renderInPortal ? portalStyle : undefined}
      data-testid={renderInPortal ? "model-selector-portal" : undefined}
    >
      <div className="p-2 border-b border-gray-200 dark:border-gray-700">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="搜索模型…"
          className="w-full px-2 py-1 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          autoFocus
        />
      </div>

      <div className="overflow-y-auto flex-1">
        {allowClear && (
          <button
            type="button"
            onClick={handleClear}
            className="w-full px-3 py-2 text-xs text-left hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2 border-b border-gray-100 dark:border-gray-800 text-gray-900 dark:text-gray-100"
          >
            <ModelSelectionIndicator selected={!selectedProviderId && !selectedModelId} />
            <span className="font-medium">{clearLabel}</span>
          </button>
        )}
        {isLoading ? (
          <div className="p-4 text-xs text-gray-500 dark:text-gray-400 text-center">正在加载模型…</div>
        ) : providers.length === 0 ? (
          <div className="p-4 text-xs text-gray-500 dark:text-gray-400 text-center">尚未配置提供方</div>
        ) : (
          <>
            {/* Favorites group */}
            {filteredFavorites().length > 0 && (
              <div className="border-b border-gray-100 dark:border-gray-800">
                <div className="px-3 py-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800">
                  收藏
                </div>
                {filteredFavorites().map((item) => renderModelRow(item.providerID, item.modelID))}
              </div>
            )}

            {/* Recent group (excluding favorites) */}
            {filteredRecent().length > 0 && (
              <div className="border-b border-gray-100 dark:border-gray-800">
                <div className="px-3 py-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800">
                  最近
                </div>
                {filteredRecent().map((item) => renderModelRow(item.providerID, item.modelID))}
              </div>
            )}

            {/* Provider groups */}
            {providers.map((provider) => {
              const filtered = filterModels(provider).filter(([modelId]) => {
                if (searchTerm.trim().length > 0) return true
                return !favoriteSet.has(`${provider.id}/${modelId}`)
              })
              if (filtered.length === 0) return null

              return (
                <div key={provider.id} className="border-b border-gray-100 dark:border-gray-800 last:border-0">
                  <div className="px-3 py-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800">
                    {provider.name}
                  </div>
                  {filtered.map(([modelId, model]) => {
                    const isDefault = defaultIds.provider === provider.id && defaultIds.model === modelId

                    return renderModelRow(
                      provider.id,
                      modelId,
                      <div className="flex items-center gap-1.5 text-[10px] text-gray-400 dark:text-gray-500 flex-shrink-0">
                        {model.capabilities.reasoning && (
                          <span className="px-1 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded text-[9px] leading-none">
                            推理
                          </span>
                        )}
                        {isDefault && (
                          <span className="px-1 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded text-[9px] leading-none">
                            默认
                          </span>
                        )}
                      </div>,
                    )
                  })}
                </div>
              )
            })}
          </>
        )}
      </div>
    </div>
  )

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        ref={triggerRef}
        onClick={toggle}
        disabled={disabled || isLoading}
        className={buttonClasses}
        title="选择模型"
        data-tip="选择模型"
      >
        {getCurrentDisplay()}
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (renderInPortal ? createPortal(dropdownContent, document.body) : dropdownContent)}
    </div>
  )
}
