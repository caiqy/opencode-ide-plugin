import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react"
import { sdk } from "../lib/api/sdkClient"

interface UISettingsContextValue {
  autoExpandMessageParts: boolean
  setAutoExpandMessageParts: (next: boolean) => Promise<void>
}

const UISettingsContext = createContext<UISettingsContextValue | null>(null)

export function useUISettings() {
  const value = useContext(UISettingsContext)
  if (!value) {
    throw new Error("useUISettings must be used within a UISettingsProvider")
  }
  return value
}

export function UISettingsProvider(props: { children: ReactNode }) {
  const [autoExpandMessageParts, setAutoExpandMessagePartsState] = useState(true)

  useEffect(() => {
    let mounted = true

    const load = async () => {
      const response = await sdk.kv.get()
      const value = response.data?.webgui_message_parts_auto_expand
      if (!mounted) return
      if (typeof value === "boolean") {
        setAutoExpandMessagePartsState(value)
      }
    }

    load().catch((error) => {
      console.error("[UISettingsContext] Failed to load UI settings:", error)
    })

    return () => {
      mounted = false
    }
  }, [])

  const setAutoExpandMessageParts = useCallback(async (next: boolean) => {
    setAutoExpandMessagePartsState(next)
    const response = await sdk.kv.update({
      body: {
        webgui_message_parts_auto_expand: next,
      },
    })
    if (response.error) {
      console.error("[UISettingsContext] Failed to save UI settings:", response.error)
    }
  }, [])

  return (
    <UISettingsContext.Provider
      value={{
        autoExpandMessageParts,
        setAutoExpandMessageParts,
      }}
    >
      {props.children}
    </UISettingsContext.Provider>
  )
}
