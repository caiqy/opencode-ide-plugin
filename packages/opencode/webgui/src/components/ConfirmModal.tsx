import { useEffect } from "react"

interface ConfirmModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  variant?: "danger" | "warning" | "info"
  isLoading?: boolean
}

export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "danger",
  isLoading = false,
}: ConfirmModalProps) {
  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isLoading) {
        onClose()
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [isOpen, isLoading, onClose])

  if (!isOpen) return null

  const variantStyles = {
    danger: {
      button: "modern-button-danger",
      text: "text-red-900 dark:text-red-100",
    },
    warning: {
      button: "bg-amber-500 hover:bg-amber-600 text-white border-transparent",
      text: "text-amber-900 dark:text-amber-100",
    },
    info: {
      button: "modern-button-primary",
      text: "text-blue-900 dark:text-blue-100",
    },
  }

  const styles = variantStyles[variant]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm transition-all" onClick={onClose}>
      <div
        className="modern-card max-w-md w-full mx-4 overflow-hidden transform transition-all scale-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800">
          <h3 className={`text-lg font-semibold ${styles.text}`}>{title}</h3>
        </div>

        {/* Body */}
        <div className="px-4 py-4">
          <p className="text-sm text-gray-700 dark:text-gray-300">{message}</p>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 bg-gray-50 dark:bg-gray-950/50 border-t border-gray-200 dark:border-gray-800 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={isLoading}
            className="modern-button modern-button-secondary"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className={`modern-button ${styles.button}`}
          >
            {isLoading ? "Processing..." : confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
