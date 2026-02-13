import { createContext, useCallback, useContext, useMemo, useState } from "react"
import type { ReactNode } from "react"

interface SubtaskDrawerParent {
  sessionId: string
  messageId?: string
  partId?: string
}

export interface OpenSubtaskDrawerInput {
  sessionId: string
  title?: string | null
  parent?: SubtaskDrawerParent | null
}

interface SubtaskDrawerState {
  isOpen: boolean
  sessionId: string | null
  title: string | null
  parent: SubtaskDrawerParent | null
  openSubtaskDrawer: (input: OpenSubtaskDrawerInput) => void
  closeSubtaskDrawer: () => void
}

const Ctx = createContext<SubtaskDrawerState | null>(null)

export function useSubtaskDrawer() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useSubtaskDrawer must be used within a SubtaskDrawerProvider")
  return ctx
}

export function SubtaskDrawerProvider(props: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [title, setTitle] = useState<string | null>(null)
  const [parent, setParent] = useState<SubtaskDrawerParent | null>(null)

  const openSubtaskDrawer = useCallback((input: OpenSubtaskDrawerInput) => {
    setIsOpen(true)
    setSessionId(input.sessionId)
    setTitle(input.title ?? null)
    setParent(input.parent ?? null)
  }, [])

  const closeSubtaskDrawer = useCallback(() => {
    setIsOpen(false)
    setSessionId(null)
    setTitle(null)
    setParent(null)
  }, [])

  const value = useMemo<SubtaskDrawerState>(
    () => ({
      isOpen,
      sessionId,
      title,
      parent,
      openSubtaskDrawer,
      closeSubtaskDrawer,
    }),
    [isOpen, sessionId, title, parent, openSubtaskDrawer, closeSubtaskDrawer],
  )

  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>
}
