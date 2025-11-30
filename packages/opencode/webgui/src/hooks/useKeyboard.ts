import { useEffect, useCallback } from "react"

/**
 * Keyboard event handler configuration
 */
export interface KeyboardHandler {
  key: string
  modKey?: boolean // Ctrl/Cmd
  shiftKey?: boolean
  altKey?: boolean
  handler: () => void
  preventDefault?: boolean
  stopPropagation?: boolean
}

/**
 * Options for useKeyboard hook
 */
export interface UseKeyboardOptions {
  /**
   * List of keyboard handlers to register
   */
  handlers: KeyboardHandler[]

  /**
   * Whether to enable handlers (default: true)
   */
  enabled?: boolean

  /**
   * Whether to prevent handlers when typing in input fields (default: true)
   */
  preventInInputs?: boolean

  /**
   * Event type to listen for (default: "keydown")
   */
  eventType?: "keydown" | "keyup" | "keypress"

  /**
   * Element to attach listeners to (default: document)
   */
  target?: HTMLElement | Document | Window
}

/**
 * Custom hook for managing keyboard shortcuts
 *
 * @example
 * ```tsx
 * useKeyboard({
 *   handlers: [
 *     { key: "s", modKey: true, handler: () => save() },
 *     { key: "Escape", handler: () => close() }
 *   ]
 * })
 * ```
 */
export function useKeyboard({
  handlers,
  enabled = true,
  preventInInputs = true,
  eventType = "keydown",
  target = document,
}: UseKeyboardOptions) {
  const handleKeyEvent = useCallback(
    (event: Event) => {
      const e = event as KeyboardEvent
      const isMod = e.metaKey || e.ctrlKey

      // Check if typing in input field
      if (preventInInputs) {
        const targetElement = e.target as HTMLElement
        const isInputField =
          targetElement.tagName === "INPUT" || targetElement.tagName === "TEXTAREA" || targetElement.isContentEditable

        if (isInputField) {
          return
        }
      }

      // Process handlers
      for (const handler of handlers) {
        const modKeyMatch = handler.modKey ? isMod : true
        const shiftKeyMatch = handler.shiftKey !== undefined ? e.shiftKey === handler.shiftKey : true
        const altKeyMatch = handler.altKey !== undefined ? e.altKey === handler.altKey : true
        const keyMatch = e.key === handler.key

        if (modKeyMatch && shiftKeyMatch && altKeyMatch && keyMatch) {
          if (handler.preventDefault !== false) {
            e.preventDefault()
          }
          if (handler.stopPropagation) {
            e.stopPropagation()
          }
          handler.handler()
          return
        }
      }
    },
    [handlers, preventInInputs],
  )

  useEffect(() => {
    if (!enabled) return

    target.addEventListener(eventType, handleKeyEvent)
    return () => target.removeEventListener(eventType, handleKeyEvent)
  }, [enabled, eventType, target, handleKeyEvent])
}

/**
 * Simple hook for a single keyboard shortcut
 *
 * @example
 * ```tsx
 * useKeyboardShortcut("s", () => save(), { modKey: true })
 * ```
 */
export function useKeyboardShortcut(
  key: string,
  handler: () => void,
  options?: {
    modKey?: boolean
    shiftKey?: boolean
    altKey?: boolean
    enabled?: boolean
    preventInInputs?: boolean
    preventDefault?: boolean
  },
) {
  useKeyboard({
    handlers: [
      {
        key,
        handler,
        modKey: options?.modKey,
        shiftKey: options?.shiftKey,
        altKey: options?.altKey,
        preventDefault: options?.preventDefault,
      },
    ],
    enabled: options?.enabled,
    preventInInputs: options?.preventInInputs,
  })
}
