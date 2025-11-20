import { createContext, useContext, useState, type ReactNode } from "react"

interface ProvidersContextState {
  providersDirty: boolean
  markProvidersDirty: () => void
  clearProvidersDirty: () => void
}

const ProvidersContext = createContext<ProvidersContextState | null>(null)

// eslint-disable-next-line react-refresh/only-export-components
export function useProviders() {
  const ctx = useContext(ProvidersContext)
  if (!ctx) throw new Error("useProviders must be used within a ProvidersProvider")
  return ctx
}

interface ProvidersProviderProps {
  children: ReactNode
}

export function ProvidersProvider({ children }: ProvidersProviderProps) {
  const [dirty, setDirty] = useState(false)

  const value: ProvidersContextState = {
    providersDirty: dirty,
    markProvidersDirty: () => setDirty(true),
    clearProvidersDirty: () => setDirty(false),
  }

  return <ProvidersContext.Provider value={value}>{children}</ProvidersContext.Provider>
}
