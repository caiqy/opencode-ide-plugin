import { useCallback, useState } from "react"
import type { Config } from "@opencode-ai/sdk/client"

export function useUnsavedChanges(
  formData: Partial<Config>,
  originalFormData: Partial<Config>,
  apiKeys: Record<string, string>,
) {
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)

  const hasUnsavedChanges = useCallback(() => {
    // Check if form data changed
    const formChanged = JSON.stringify(formData) !== JSON.stringify(originalFormData)

    // Check if any API keys were entered
    const apiKeysEntered = Object.values(apiKeys).some((key) => key.trim() !== "")

    return formChanged || apiKeysEntered
  }, [formData, originalFormData, apiKeys])

  return {
    hasUnsavedChanges,
    showCloseConfirm,
    setShowCloseConfirm,
  }
}
