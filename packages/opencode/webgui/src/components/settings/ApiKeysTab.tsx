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
    // Optimistically add to displayed list via selectedProviderToAdd state
    // It will be permanently added to configuredProviders when saved (API key) or logged in (OAuth)
  }

  const handleDeleteProvider = (providerId: string) => {
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
      <div className="relative mb-6" ref={dropdownRef}>
        <button
          onClick={toggle}
          className="w-full flex items-center justify-between px-3 py-2 border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
        >
          <span>Add a provider...</span>
          <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {isOpen && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 max-h-60 overflow-hidden flex flex-col">
            <div className="p-2 border-b border-gray-200 dark:border-gray-700">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search providers..."
                className="w-full px-2 py-1 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                autoFocus
              />
            </div>
            <div className="overflow-y-auto flex-1">
              {filteredAvailableProviders.length === 0 ? (
                <div className="p-3 text-sm text-gray-500 dark:text-gray-400 text-center">No providers found</div>
              ) : (
                filteredAvailableProviders.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => handleSelectProvider(p.id)}
                    className="w-full px-3 py-2 text-sm text-left hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-900 dark:text-gray-100"
                  >
                    {p.name}
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {displayedProviders.length === 0 ? (
        <div className="text-sm text-gray-500 dark:text-gray-400 text-center py-8 border border-dashed border-gray-300 dark:border-gray-700 rounded">
          No providers configured. Add one above.
        </div>
      ) : (
        displayedProviders.map((provider) => {
          const providerMethods = methods[provider.id] || []
          const oauthMethodIndex = providerMethods.findIndex((m) => m.type === "oauth")
          const hasOAuth = oauthMethodIndex !== -1
          const isLoading = loadingMethods[provider.id]
          const isTemporary = !configuredProviders.includes(provider.id)

          return (
            <div key={provider.id} className="border border-gray-200 dark:border-gray-700 rounded p-3 relative group">
              <button
                onClick={() => handleDeleteProvider(provider.id)}
                className="absolute top-2 right-2 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                title="Remove provider"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>

              <div className="flex items-center justify-between mb-2 pr-6">
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{provider.name}</label>
                  {isTemporary && (
                    <span className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 px-1.5 py-0.5 rounded">
                      New
                    </span>
                  )}
                </div>
                {provider.env.length > 0 && (
                  <span className="text-xs text-gray-500 dark:text-gray-400">{provider.env[0]}</span>
                )}
              </div>

              <div className="space-y-2">
                {isLoading && <div className="text-xs text-gray-400">Loading auth methods...</div>}

                {hasOAuth && (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleOAuthLogin(provider.id, oauthMethodIndex)}
                        disabled={!!authStatus[provider.id] && authStatus[provider.id] !== "Waiting for code..."}
                        className="px-4 py-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded text-sm font-medium hover:bg-gray-800 dark:hover:bg-gray-200 transition-colors disabled:opacity-50"
                      >
                        {providerMethods[oauthMethodIndex].label || `Login with ${provider.name}`}
                      </button>
                      {authStatus[provider.id] && (
                        <>
                          <span className="text-sm text-blue-600 dark:text-blue-400 animate-pulse">
                            {authStatus[provider.id]}
                          </span>
                          {(authStatus[provider.id].startsWith("Waiting") ||
                            authStatus[provider.id] === "Initializing...") &&
                            !manualCodeState && (
                              <button
                                onClick={() => handleCancel(provider.id)}
                                className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-700 rounded hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400"
                              >
                                Cancel
                              </button>
                            )}
                        </>
                      )}
                    </div>

                    {manualCodeState?.providerId === provider.id && (
                      <div className="flex gap-2 mt-2">
                        <input
                          type="text"
                          value={manualCodeInput}
                          onChange={(e) => setManualCodeInput(e.target.value)}
                          placeholder="Paste authorization code here"
                          className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                        />
                        <button
                          onClick={handleManualCodeSubmit}
                          disabled={!manualCodeInput}
                          className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Submit
                        </button>
                        <button
                          onClick={() => {
                            setManualCodeState(null)
                            setManualCodeInput("")
                            setAuthStatus((prev) => ({ ...prev, [provider.id]: "" }))
                          }}
                          className="px-3 py-2 border border-gray-300 dark:border-gray-700 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Show API Key input if no OAuth, or as alternative */}
                {(!hasOAuth || providerMethods.some((m) => m.type === "api")) && !isLoading && (
                  <>
                    {hasOAuth && (
                      <div className="relative my-3">
                        <div className="absolute inset-0 flex items-center">
                          <span className="w-full border-t border-gray-200 dark:border-gray-700" />
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                          <span className="bg-white dark:bg-gray-900 px-2 text-gray-500">Or use API Key</span>
                        </div>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <input
                        type={showApiKeys[provider.id] ? "text" : "password"}
                        value={apiKeys[provider.id] || ""}
                        onChange={(e) => {
                          setApiKeys({ ...apiKeys, [provider.id]: e.target.value })
                          // If user starts typing, ensure it's treated as being added (though save is required to persist)
                          if (!configuredProviders.includes(provider.id)) {
                            // We don't add to configuredProviders yet, that happens on save
                            // But we keep it in selectedProviderToAdd so it stays visible
                          }
                        }}
                        placeholder={`Enter ${provider.name} API key`}
                        className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                      />
                      <button
                        onClick={() => setShowApiKeys({ ...showApiKeys, [provider.id]: !showApiKeys[provider.id] })}
                        className="px-3 py-2 border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
                        title={showApiKeys[provider.id] ? "Hide" : "Show"}
                      >
                        {showApiKeys[provider.id] ? "👁️" : "👁️‍🗨️"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )
        })
      )}
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
