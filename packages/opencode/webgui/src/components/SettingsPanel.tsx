import { useEffect, useState, useCallback } from "react"
import { sdk } from "../lib/api/sdkClient"
import type { Config, Provider } from "@opencode-ai/sdk/client"
import { ConfirmModal } from "./ConfirmModal"
import { GeneralTab } from "./settings/GeneralTab"
import { ApiKeysTab } from "./settings/ApiKeysTab"
import { ModelsTab } from "./settings/ModelsTab"
import { AdvancedTab } from "./settings/AdvancedTab"
import { useProviders } from "../state/ProvidersContext.tsx"

interface SettingsPanelProps {
  isOpen: boolean
  onClose: () => void
}

type TabType = "general" | "api-keys" | "models" | "advanced"

interface ProviderWithAuth extends Provider {
  hasAuth?: boolean
  authKey?: string
}

export function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<TabType>("general")
  const [providers, setProviders] = useState<ProviderWithAuth[]>([])
  const [configuredProviders, setConfiguredProviders] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)
  const { markProvidersDirty } = useProviders()

  // Form state
  const [formData, setFormData] = useState<Partial<Config>>({})
  const [originalFormData, setOriginalFormData] = useState<Partial<Config>>({})
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({})
  const [showApiKeys, setShowApiKeys] = useState<Record<string, boolean>>({})

  // Fetch config and providers
  useEffect(() => {
    if (!isOpen) return

    const fetchData = async () => {
      setIsLoading(true)
      setError(null)

      try {
        // Fetch config
        const configResponse = await sdk.config.get()

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

        // Fetch providers
        const providersRes = await sdk.config.allProviders()
        if (providersRes.error) {
          throw new Error("Failed to load providers")
        }
        if (providersRes.data) {
          setProviders(providersRes.data.providers.sort((a, b) => a.name.localeCompare(b.name)))
        }

        // Fetch configured providers
        const authList = await sdk.auth.list()
        setConfiguredProviders(Object.keys(authList))

        // Reset API keys to empty (they should be entered fresh)
        setApiKeys({})
      } catch (err) {
        setError(String(err))
      } finally {
        setIsLoading(false)
      }
    }

    fetchData()
  }, [isOpen])

  // Check if there are unsaved changes
  const hasUnsavedChanges = useCallback(() => {
    // Check if form data changed
    const formChanged = JSON.stringify(formData) !== JSON.stringify(originalFormData)

    // Check if any API keys were entered
    const apiKeysEntered = Object.values(apiKeys).some((key) => key.trim() !== "")

    return formChanged || apiKeysEntered
  }, [formData, originalFormData, apiKeys])

  // Close handler with unsaved changes check
  const handleClose = () => {
    if (hasUnsavedChanges() && !isSaving) {
      setShowCloseConfirm(true)
    } else {
      onClose()
    }
  }

  // Force close without confirmation
  const forceClose = () => {
    setShowCloseConfirm(false)
    onClose()
  }

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isSaving) {
        handleClose()
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [isOpen, isSaving, hasUnsavedChanges])

  const handleSave = async () => {
    setIsSaving(true)
    setError(null)
    setSuccessMessage(null)

    try {
      // Save config if it changed
      if (JSON.stringify(formData) !== JSON.stringify(originalFormData)) {
        const configResponse = await sdk.config.update({
          body: formData,
        })

        if (configResponse.error) {
          throw new Error("Failed to save config")
        }

        if (configResponse.data) {
          const savedData = structuredClone(configResponse.data)
          setFormData(savedData)
          setOriginalFormData(savedData)
        }
      }

      // Save API keys
      const apiKeyEntries = Object.entries(apiKeys).filter(([_, key]) => key && key.trim())

      for (const [providerID, key] of apiKeyEntries) {
        await sdk.auth.set(providerID, {
          type: "api",
          key: key.trim(),
        })
      }

      // Clear API keys after successful save
      setApiKeys({})

      setSuccessMessage("Settings saved successfully")
      markProvidersDirty()
      setTimeout(() => {
        setSuccessMessage(null)
        onClose()
      }, 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsSaving(false)
    }
  }

  if (!isOpen) return null

  const tabs: { id: TabType; label: string; icon: string }[] = [
    { id: "general", label: "General", icon: "⚙️" },
    { id: "api-keys", label: "API Keys", icon: "🔑" },
    { id: "models", label: "Models", icon: "🤖" },
    { id: "advanced", label: "Advanced", icon: "🔧" },
  ]

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
        <div className="bg-white dark:bg-gray-900 rounded-lg shadow-lg w-full max-w-3xl mx-4 border border-gray-200 dark:border-gray-800 max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Settings</h2>
            <button
              onClick={handleClose}
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              title="Close"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Tabs */}
          <div className="border-b border-gray-200 dark:border-gray-800">
            <div className="flex px-4">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === tab.id
                    ? "border-blue-600 text-blue-600 dark:border-blue-500 dark:text-blue-500"
                    : "border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
                    }`}
                >
                  <span className="mr-1.5">{tab.icon}</span>
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-4 py-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="text-gray-500 dark:text-gray-400">Loading settings...</div>
              </div>
            ) : error ? (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-3 text-sm text-red-800 dark:text-red-200">
                {error}
              </div>
            ) : (
              <>
                {activeTab === "general" && <GeneralTab formData={formData} setFormData={setFormData} />}

                {activeTab === "api-keys" && (
                  <ApiKeysTab
                    providers={providers}
                    configuredProviders={configuredProviders}
                    setConfiguredProviders={setConfiguredProviders}
                    apiKeys={apiKeys}
                    setApiKeys={setApiKeys}
                    showApiKeys={showApiKeys}
                    setShowApiKeys={setShowApiKeys}
                  />
                )}

                {activeTab === "models" && (
                  <ModelsTab
                    formData={formData}
                    setFormData={setFormData}
                    providers={providers}
                    configuredProviders={configuredProviders}
                  />
                )}

                {activeTab === "advanced" && <AdvancedTab formData={formData} setFormData={setFormData} />}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-3 bg-gray-50 dark:bg-gray-950 border-t border-gray-200 dark:border-gray-800 flex items-center justify-between">
            <div>
              {successMessage && <span className="text-sm text-green-600 dark:text-green-400">{successMessage}</span>}
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleClose}
                disabled={isSaving}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving || isLoading || !hasUnsavedChanges()}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-800 rounded disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSaving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Unsaved changes confirmation */}
      <ConfirmModal
        isOpen={showCloseConfirm}
        onClose={() => setShowCloseConfirm(false)}
        onConfirm={forceClose}
        title="Unsaved Changes"
        message="You have unsaved changes. Are you sure you want to close without saving?"
        confirmText="Discard Changes"
        cancelText="Keep Editing"
        variant="warning"
      />
    </>
  )
}
