import { useEffect, useState } from "react"
import type { Config } from "@opencode-ai/sdk/client"
import { sdk } from "../../lib/api/sdkClient"
import { ConfirmModal } from "../ConfirmModal"
import { GeneralTab } from "../settings/GeneralTab"
import { AgentConfigTab } from "../settings/AgentConfigTab"
import { AdvancedTab } from "../settings/AdvancedTab"
import { QuickPhrasesTab } from "../settings/QuickPhrasesTab"
import { ProviderSettingsTab } from "../settings/ProviderSettingsTab"
import { useSettingsForm } from "./hooks/useSettingsForm"
import { useUnsavedChanges } from "./hooks/useUnsavedChanges"
import { TabBar } from "./TabBar"
import { SettingsHeader } from "./SettingsHeader"
import { SettingsFooter } from "./SettingsFooter"

interface SettingsPanelProps {
  isOpen: boolean
  onClose: () => void
}

type TabType = "provider" | "general" | "agents" | "advanced" | "quick-phrases"

export function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<TabType>("provider")
  const [isSaving, setIsSaving] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const { formData, setFormData, originalFormData, setOriginalFormData, isLoading, error } = useSettingsForm(isOpen)

  const { hasUnsavedChanges, showCloseConfirm, setShowCloseConfirm } = useUnsavedChanges(formData, originalFormData)

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
      if (e.defaultPrevented) return
      if (e.key === "Escape" && !isSaving) {
        handleClose()
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [isOpen, isSaving, hasUnsavedChanges])

  const handleSave = async () => {
    setIsSaving(true)
    setSuccessMessage(null)

    try {
      // Save config if it changed
      if (JSON.stringify(formData) !== JSON.stringify(originalFormData)) {
        // Only send fields that actually changed to avoid unnecessary instance disposal
        const patch: Record<string, unknown> = {}
        for (const key of Object.keys(formData)) {
          if (
            JSON.stringify((formData as Record<string, unknown>)[key]) !==
            JSON.stringify((originalFormData as Record<string, unknown>)[key])
          ) {
            patch[key] = (formData as Record<string, unknown>)[key]
          }
        }

        const configResponse = await sdk.global.config.update({
          body: (Object.keys(patch).length > 0 ? patch : formData) as Partial<Config>,
        })

        if (configResponse.error) {
          throw new Error("保存设置失败")
        }

        if (configResponse.data) {
          const savedData = structuredClone(configResponse.data)
          setFormData(savedData)
          setOriginalFormData(savedData)
        }
      }

      setSuccessMessage("设置已保存")
      setTimeout(() => {
        setSuccessMessage(null)
        onClose()
      }, 1500)
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err))
    } finally {
      setIsSaving(false)
    }
  }

  if (!isOpen) return null

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <div className="modern-card w-full max-w-3xl mx-4 max-h-[90vh] flex flex-col shadow-2xl">
          <SettingsHeader onClose={handleClose} />

          <TabBar activeTab={activeTab} onTabChange={setActiveTab} />

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-3 py-3">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="text-gray-500 dark:text-gray-400">正在加载设置…</div>
              </div>
            ) : error ? (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-3 text-sm text-red-800 dark:text-red-200">
                {error}
              </div>
            ) : (
              <>
                {activeTab === "provider" && (
                  <ProviderSettingsTab
                    formData={formData}
                    setFormData={setFormData}
                    onReloadConfig={setOriginalFormData}
                  />
                )}

                {activeTab === "general" && <GeneralTab formData={formData} setFormData={setFormData} />}

                {activeTab === "agents" && (
                  <AgentConfigTab formData={formData} setFormData={setFormData} onReloadConfig={setOriginalFormData} />
                )}

                {activeTab === "advanced" && <AdvancedTab formData={formData} setFormData={setFormData} />}

                {activeTab === "quick-phrases" && <QuickPhrasesTab />}
              </>
            )}
          </div>

          <SettingsFooter
            isSaving={isSaving}
            isLoading={isLoading}
            hasUnsavedChanges={hasUnsavedChanges()}
            successMessage={successMessage}
            onSave={handleSave}
            onCancel={handleClose}
          />
        </div>
      </div>

      {/* Unsaved changes confirmation */}
      <ConfirmModal
        isOpen={showCloseConfirm}
        onClose={() => setShowCloseConfirm(false)}
        onConfirm={forceClose}
        title="未保存的更改"
        message="有未保存的更改。确定要直接关闭且不保存吗？"
        confirmText="放弃更改"
        cancelText="继续编辑"
        variant="warning"
      />
    </>
  )
}
