import { useCallback, useState } from "react"
import type { Config } from "@opencode-ai/sdk/client"

export function useUnsavedChanges(formData: Partial<Config>, originalFormData: Partial<Config>) {
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)

  const hasUnsavedChanges = useCallback(() => {
    return JSON.stringify(formData) !== JSON.stringify(originalFormData)
  }, [formData, originalFormData])

  return {
    hasUnsavedChanges,
    showCloseConfirm,
    setShowCloseConfirm,
  }
}
