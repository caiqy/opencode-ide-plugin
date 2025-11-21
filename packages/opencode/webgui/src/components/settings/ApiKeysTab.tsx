import type { Provider } from "@opencode-ai/sdk/client"
import { useEffect, useState, useMemo, useRef } from "react"
import { sdk } from "../../lib/api/sdkClient"
import { ideBridge } from "../../lib/ideBridge"
import { useDropdown } from "../../hooks/useDropdown"
import { useProviders } from "../../state/ProvidersContext"
import { ConfirmModal } from "../ConfirmModal"

interface ApiKeysTabProps {
  providers: Provider[]
  configuredProviders: string[]
  setConfiguredProviders: (providers: string[]) => void
  apiKeys: Record<string, string>
  setApiKeys: (keys: Record<string, string>) => void
  showApiKeys: Record<string, boolean>
  setShowApiKeys: (show: Record<string, boolean>) => void
}

interface AuthMethod {
  label: string
  type: "oauth" | "api"
}

export function ApiKeysTab({
  providers,
  configuredProviders,
  setConfiguredProviders,
  apiKeys,
  setApiKeys,
  showApiKeys,
  setShowApiKeys,
}: ApiKeysTabProps) {
  const [methods, setMethods] = useState<Record<string, AuthMethod[]>>({})
  const [loadingMethods, setLoadingMethods] = useState<Record<string, boolean>>({})
  const [authStatus, setAuthStatus] = useState<Record<string, string>>({})
  const pollIntervals = useRef<Record<string, ReturnType<typeof setInterval>>>({})
  const [selectedProviderToAdd, setSelectedProviderToAdd] = useState<string>("")
  const [manualCodeState, setManualCodeState] = useState<{ providerId: string; id: string } | null>(null)
  const [manualCodeInput, setManualCodeInput] = useState("")
  const { isOpen, searchTerm, setSearchTerm, dropdownRef, close, toggle } = useDropdown()
  const [providerToDelete, setProviderToDelete] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const { markProvidersDirty } = useProviders()
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null)

  // Filter providers to only show configured ones + the one currently being added
  const displayedProviders = useMemo(() => {
    const configured = new Set(configuredProviders)
    return providers.filter((p) => configured.has(p.id) || p.id === selectedProviderToAdd)
  }, [providers, configuredProviders, selectedProviderToAdd])

  // Available providers for the dropdown (excluding already configured ones)
  const availableProviders = useMemo(() => {
    const configured = new Set(configuredProviders)
    return providers.filter((p) => !configured.has(p.id))
  }, [providers, configuredProviders])

  // Filtered available providers based on search term
  const filteredAvailableProviders = useMemo(() => {
    if (!searchTerm) return availableProviders
    const lower = searchTerm.toLowerCase()
    return availableProviders.filter((p) => p.name.toLowerCase().includes(lower))
  }, [availableProviders, searchTerm])

  const handleSelectProvider = (providerId: string) => {
    handleAddProvider(providerId)
    close()
  }

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

  const handleOAuthLogin = async (providerId: string, methodIndex: number) => {
    try {
      setAuthStatus((prev) => ({ ...prev, [providerId]: "Initializing..." }))
      const { id, url, method } = await sdk.auth.start(providerId, methodIndex, {})

      if (url) {
        window.open(url, "_blank")
        ideBridge.send({ type: "openUrl", payload: { url } })
      }

      if (method === "code") {
        setAuthStatus((prev) => ({ ...prev, [providerId]: "Waiting for code..." }))
        setManualCodeState({ providerId, id })
        setManualCodeInput("")
        return
      }

      setAuthStatus((prev) => ({ ...prev, [providerId]: "Waiting for browser..." }))

      // Poll
      const poll = setInterval(async () => {
        try {
          const status = await sdk.auth.status(id)
          if (status.status === "success") {
            clearInterval(poll)
            delete pollIntervals.current[providerId]
            setAuthStatus((prev) => ({ ...prev, [providerId]: "Connected!" }))
            // Add to configured providers list if not already there
            if (!configuredProviders.includes(providerId)) {
              setConfiguredProviders([...configuredProviders, providerId])
            }
            // Clear temporary selection if it was this provider
            if (selectedProviderToAdd === providerId) {
              setSelectedProviderToAdd("")
            }
            setTimeout(() => setAuthStatus((prev) => ({ ...prev, [providerId]: "" })), 3000)
            markProvidersDirty()
          } else if (status.status === "failed") {
            clearInterval(poll)
            delete pollIntervals.current[providerId]
            setAuthStatus((prev) => ({
              ...prev,
              [providerId]: "Failed: " + (status.result?.message || "Unknown error"),
            }))
          }
        } catch (e) {
          clearInterval(poll)
          delete pollIntervals.current[providerId]
          console.error("Error polling OAuth status:", e)
          setAuthStatus((prev) => ({ ...prev, [providerId]: "Error polling status" }))
        }
      }, 1000)
      pollIntervals.current[providerId] = poll

      // Timeout after 2 mins
      setTimeout(() => {
        if (pollIntervals.current[providerId] === poll) {
          clearInterval(poll)
          delete pollIntervals.current[providerId]
          setAuthStatus((prev) => {
            if (prev[providerId]?.startsWith("Waiting")) return { ...prev, [providerId]: "Timed out" }
            return prev
          })
        }
      }, 120000)
    } catch (e) {
      setAuthStatus((prev) => ({ ...prev, [providerId]: "Error starting login" }))
      console.error(e)
    }
  }

  const handleCancel = (providerId: string) => {
    if (pollIntervals.current[providerId]) {
      clearInterval(pollIntervals.current[providerId])
      delete pollIntervals.current[providerId]
    }
    setAuthStatus((prev) => ({ ...prev, [providerId]: "" }))
    if (manualCodeState?.providerId === providerId) {
      setManualCodeState(null)
      setManualCodeInput("")
    }
  }

  const handleManualCodeSubmit = async () => {
    if (!manualCodeState || !manualCodeInput) return

    const { providerId, id } = manualCodeState
    try {
      setAuthStatus((prev) => ({ ...prev, [providerId]: "Verifying code..." }))
      await sdk.auth.submit(id, manualCodeInput)

      // Check status immediately
      const status = await sdk.auth.status(id)
      if (status.status === "success") {
        setAuthStatus((prev) => ({ ...prev, [providerId]: "Connected!" }))
        if (!configuredProviders.includes(providerId)) {
          setConfiguredProviders([...configuredProviders, providerId])
        }
        if (selectedProviderToAdd === providerId) {
          setSelectedProviderToAdd("")
        }
        setManualCodeState(null)
        setManualCodeInput("")
        setTimeout(() => setAuthStatus((prev) => ({ ...prev, [providerId]: "" })), 3000)
        markProvidersDirty()
      } else {
        setAuthStatus((prev) => ({
          ...prev,
          [providerId]: "Failed: " + (status.result?.message || "Invalid code"),
        }))
      }
    } catch (e) {
      console.error("Error submitting code:", e)
      setAuthStatus((prev) => ({ ...prev, [providerId]: "Error submitting code" }))
    }
  }

  const handleAddProvider = (providerId: string) => {
    if (!providerId) return
    setSelectedProviderToAdd(providerId)
    setExpandedProvider(providerId)
    // Optimistically add to displayed list via selectedProviderToAdd state
    // It will be permanently added to configuredProviders when saved (API key) or logged in (OAuth)
  }

  const handleDeleteProvider = (providerId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setProviderToDelete(providerId)
  }

  const confirmDeleteProvider = async () => {
    if (!providerToDelete) return

    setIsDeleting(true)
    try {
      await sdk.auth.remove(providerToDelete)
      markProvidersDirty()
      setConfiguredProviders(configuredProviders.filter((id) => id !== providerToDelete))
      if (selectedProviderToAdd === providerToDelete) {
        setSelectedProviderToAdd("")
      }
      // Also clear any pending API key input
      const newApiKeys = { ...apiKeys }
      delete newApiKeys[providerToDelete]
      setApiKeys(newApiKeys)
    } catch (e) {
      console.error("Failed to remove provider", e)
      alert("Failed to remove provider")
    } finally {
      setIsDeleting(false)
      setProviderToDelete(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Configure API keys or login to AI providers. Keys are stored securely.
        </p>
      </div>

      {/* Add Provider Dropdown */}
      <div className="relative mb-4" ref={dropdownRef}>
        <button
          onClick={toggle}
          className="w-full flex items-center justify-between px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 hover:border-gray-400 dark:hover:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors text-sm shadow-sm"
        >
          <span className="font-medium">Add a provider...</span>
          <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {isOpen && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl z-50 max-h-60 overflow-hidden flex flex-col ring-1 ring-black/5">
            <div className="p-2 border-b border-gray-100 dark:border-gray-800">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search providers..."
                className="w-full px-2 py-1.5 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                autoFocus
              />
            </div>
            <div className="overflow-y-auto flex-1 p-1">
              {filteredAvailableProviders.length === 0 ? (
                <div className="p-3 text-sm text-gray-500 dark:text-gray-400 text-center">No providers found</div>
              ) : (
                filteredAvailableProviders.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => handleSelectProvider(p.id)}
                    className="w-full px-3 py-2 text-sm text-left hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-md transition-colors"
                  >
                    {p.name}
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2">
        {displayedProviders.length === 0 ? (
          <div className="text-sm text-gray-500 dark:text-gray-400 text-center py-8 border border-dashed border-gray-200 dark:border-gray-800 rounded-lg bg-gray-50/50 dark:bg-gray-900/50">
            No providers configured. Add one above.
          </div>
        ) : (
          displayedProviders.map((provider) => {
            const providerMethods = methods[provider.id] || []
            const oauthMethodIndex = providerMethods.findIndex((m) => m.type === "oauth")
            const hasOAuth = oauthMethodIndex !== -1
            const isLoading = loadingMethods[provider.id]
            const isTemporary = !configuredProviders.includes(provider.id)
            const isExpanded = expandedProvider === provider.id
            const isConnected = configuredProviders.includes(provider.id)

            return (
              <div
                key={provider.id}
                className={`border transition-all duration-200 rounded-lg overflow-hidden ${
                  isExpanded
                    ? "border-blue-200 dark:border-blue-900 bg-blue-50/30 dark:bg-blue-900/10 ring-1 ring-blue-500/20"
                    : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:border-gray-300 dark:hover:border-gray-700"
                }`}
              >
                <div
                  className="flex items-center justify-between px-3 py-2.5 cursor-pointer select-none"
                  onClick={() => setExpandedProvider(isExpanded ? null : provider.id)}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-2 h-2 rounded-full ${isConnected ? "bg-green-500" : "bg-gray-300 dark:bg-gray-600"}`}
                    />
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{provider.name}</span>
                    {isTemporary && (
                      <span className="text-[10px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 px-1.5 py-0.5 rounded-full">
                        New
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {isConnected ? "Connected" : "Not Configured"}
                    </span>
                    <button
                      onClick={(e) => handleDeleteProvider(provider.id, e)}
                      className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                      title="Remove provider"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                    <svg
                      className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>

                {isExpanded && (
                  <div className="px-3 pb-3 pt-0 border-t border-blue-100 dark:border-blue-900/30 mt-2">
                    <div className="pt-3 space-y-3">
                      {isLoading && <div className="text-xs text-gray-400 animate-pulse">Loading auth methods...</div>}

                      {hasOAuth && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleOAuthLogin(provider.id, oauthMethodIndex)}
                              disabled={!!authStatus[provider.id] && authStatus[provider.id] !== "Waiting for code..."}
                              className="px-3 py-1.5 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-md text-xs font-medium hover:bg-gray-800 dark:hover:bg-gray-200 transition-colors disabled:opacity-50 shadow-sm"
                            >
                              {providerMethods[oauthMethodIndex].label || `Login with ${provider.name}`}
                            </button>
                            {authStatus[provider.id] && (
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-blue-600 dark:text-blue-400 animate-pulse">
                                  {authStatus[provider.id]}
                                </span>
                                {(authStatus[provider.id].startsWith("Waiting") ||
                                  authStatus[provider.id] === "Initializing...") &&
                                  !manualCodeState && (
                                    <button
                                      onClick={() => handleCancel(provider.id)}
                                      className="px-2 py-1 text-xs border border-gray-200 dark:border-gray-700 rounded hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400"
                                    >
                                      Cancel
                                    </button>
                                  )}
                              </div>
                            )}
                          </div>

                          {manualCodeState?.providerId === provider.id && (
                            <div className="flex gap-2 p-2 bg-gray-50 dark:bg-gray-800/50 rounded-md border border-gray-100 dark:border-gray-800">
                              <input
                                type="text"
                                value={manualCodeInput}
                                onChange={(e) => setManualCodeInput(e.target.value)}
                                placeholder="Paste authorization code here"
                                className="flex-1 px-2 py-1.5 border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-xs"
                              />
                              <button
                                onClick={handleManualCodeSubmit}
                                disabled={!manualCodeInput}
                                className="px-2 py-1.5 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                Submit
                              </button>
                              <button
                                onClick={() => {
                                  setManualCodeState(null)
                                  setManualCodeInput("")
                                  setAuthStatus((prev) => ({ ...prev, [provider.id]: "" }))
                                }}
                                className="px-2 py-1.5 border border-gray-200 dark:border-gray-700 rounded text-xs hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400"
                              >
                                Cancel
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Show API Key input if no OAuth, or as alternative */}
                      {(!hasOAuth || providerMethods.some((m) => m.type === "api")) && !isLoading && (
                        <div className="space-y-2">
                          {hasOAuth && (
                            <div className="relative">
                              <div className="absolute inset-0 flex items-center">
                                <span className="w-full border-t border-gray-200 dark:border-gray-700" />
                              </div>
                              <div className="relative flex justify-center text-[10px] uppercase tracking-wider">
                                <span className="bg-white dark:bg-gray-900 px-2 text-gray-400">Or use API Key</span>
                              </div>
                            </div>
                          )}
                          <div className="flex gap-2">
                            <div className="relative flex-1">
                              <input
                                type={showApiKeys[provider.id] ? "text" : "password"}
                                value={apiKeys[provider.id] || ""}
                                onChange={(e) => {
                                  setApiKeys({ ...apiKeys, [provider.id]: e.target.value })
                                }}
                                placeholder={`Enter ${provider.name} API key`}
                                className="w-full pl-3 pr-8 py-1.5 border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-xs shadow-sm"
                              />
                              <button
                                onClick={() =>
                                  setShowApiKeys({ ...showApiKeys, [provider.id]: !showApiKeys[provider.id] })
                                }
                                className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded"
                                title={showApiKeys[provider.id] ? "Hide" : "Show"}
                              >
                                {showApiKeys[provider.id] ? (
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                      d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                                    />
                                  </svg>
                                ) : (
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                                    />
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                      d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                                    />
                                  </svg>
                                )}
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      <ConfirmModal
        isOpen={!!providerToDelete}
        onClose={() => setProviderToDelete(null)}
        onConfirm={confirmDeleteProvider}
        title="Remove Provider"
        message={`Are you sure you want to remove ${providerToDelete}? This will remove any stored authentication tokens.`}
        confirmText="Remove"
        cancelText="Cancel"
        variant="danger"
        isLoading={isDeleting}
      />
    </div>
  )
}
