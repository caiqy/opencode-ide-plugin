import { createContext, useContext, type ReactNode } from "react"

// eslint-disable-next-line @typescript-eslint/no-empty-interface
interface UISettingsContextValue {}

const UISettingsContext = createContext<UISettingsContextValue | null>(null)

export function useUISettings() {
  const value = useContext(UISettingsContext)
  if (!value) {
    throw new Error("useUISettings must be used within a UISettingsProvider")
  }
  return value
}

export function UISettingsProvider(props: { children: ReactNode }) {
  return <UISettingsContext.Provider value={{}}>{props.children}</UISettingsContext.Provider>
}
