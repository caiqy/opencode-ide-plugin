import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from "react"
import { ToastContainer, type Toast } from "../components/Toast"

interface ToastContextState {
  toasts: Toast[]
  showToast: (message: string, options?: Partial<Omit<Toast, "id" | "message">>) => string
  dismissToast: (id: string) => void
  clearAllToasts: () => void
}

const ToastContext = createContext<ToastContextState | null>(null)

/**
 * Hook to access toast context
 *
 * @throws Error if used outside ToastProvider
 */
export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider")
  }
  return context
}

interface ToastProviderProps {
  children: ReactNode
  defaultDuration?: number // default auto-dismiss duration in ms (0 = never)
}

/**
 * Toast provider component
 *
 * Manages global toast notifications state and provides toast actions.
 * Wraps the application to enable toast notifications anywhere.
 */
export function ToastProvider({ children, defaultDuration = 5000 }: ToastProviderProps) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const toastIdCounter = useRef(0)

  /**
   * Show a new toast notification
   *
   * @param message Toast message
   * @param options Toast options (title, variant, duration)
   * @returns Toast ID
   */
  const showToast = useCallback(
    (message: string, options?: Partial<Omit<Toast, "id" | "message">>): string => {
      const id = `toast-${++toastIdCounter.current}-${Date.now()}`
      const newToast: Toast = {
        id,
        message,
        variant: options?.variant ?? "info",
        title: options?.title,
        duration: options?.duration ?? defaultDuration,
      }

      setToasts((prev) => [...prev, newToast])
      return id
    },
    [defaultDuration],
  )

  /**
   * Dismiss a specific toast
   *
   * @param id Toast ID
   */
  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  /**
   * Clear all toasts
   */
  const clearAllToasts = useCallback(() => {
    setToasts([])
  }, [])

  const value: ToastContextState = {
    toasts,
    showToast,
    dismissToast,
    clearAllToasts,
  }

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  )
}
