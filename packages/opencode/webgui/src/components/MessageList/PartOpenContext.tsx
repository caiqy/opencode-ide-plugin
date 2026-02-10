import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"

type ToolStatus = "pending" | "running" | "completed" | "error"

export type PartOpenItem =
  | { type: "reasoning"; id: string; text?: string; end?: number }
  | { type: "tool"; id: string; tool: string; status?: ToolStatus }

interface PartOpenValue {
  isOpen: (id: string) => boolean
  setOpen: (id: string, open: boolean) => void
  toggle: (id: string) => void
}

const PartOpenContext = createContext<PartOpenValue | undefined>(undefined)

export function PartOpenProvider(props: { items: PartOpenItem[]; children: ReactNode; defaultExpanded?: boolean }) {
  const defaultExpanded = props.defaultExpanded ?? true
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map())

  const itemIDs = useMemo(() => new Set(props.items.map((item) => item.id)), [props.items])

  // Find the last reasoning item ID
  const lastReasoningId = useMemo(() => {
    for (let i = props.items.length - 1; i >= 0; i--) {
      if (props.items[i].type === "reasoning") return props.items[i].id
    }
    return null
  }, [props.items])

  // Set of all reasoning IDs for quick lookup
  const reasoningIds = useMemo(
    () => new Set(props.items.filter((item) => item.type === "reasoning").map((item) => item.id)),
    [props.items],
  )

  // Track previous last reasoning ID to auto-close it when a new one appears
  const prevLastReasoningIdRef = useRef<string | null>(lastReasoningId)

  useEffect(() => {
    setOverrides((prev) => {
      let changed = false
      const next = new Map<string, boolean>()
      for (const [id, isOpen] of prev) {
        if (!itemIDs.has(id)) {
          changed = true
          continue
        }
        next.set(id, isOpen)
      }

      // Auto-close previous last reasoning when a new one appears
      const prevLast = prevLastReasoningIdRef.current
      if (lastReasoningId && prevLast && lastReasoningId !== prevLast && itemIDs.has(prevLast)) {
        if (next.get(prevLast) !== false) {
          next.set(prevLast, false)
          changed = true
        }
      }

      return changed ? next : prev
    })

    prevLastReasoningIdRef.current = lastReasoningId
  }, [itemIDs, lastReasoningId])

  const isOpen = useCallback(
    (id: string) => {
      const overridden = overrides.get(id)
      if (typeof overridden === "boolean") return overridden

      // Reasoning items: only the last one is expanded by default
      if (reasoningIds.has(id)) {
        return id === lastReasoningId
      }

      // Tool items: follow defaultExpanded
      return defaultExpanded
    },
    [overrides, defaultExpanded, reasoningIds, lastReasoningId],
  )

  const setOpen = useCallback((id: string, open: boolean) => {
    setOverrides((prev) => {
      const current = prev.get(id)
      if (current === open) return prev
      const next = new Map(prev)
      next.set(id, open)
      return next
    })
  }, [])

  const toggle = useCallback(
    (id: string) => {
      setOpen(id, !isOpen(id))
    },
    [isOpen, setOpen],
  )

  return <PartOpenContext.Provider value={{ isOpen, setOpen, toggle }}>{props.children}</PartOpenContext.Provider>
}

export function usePartOpen() {
  const value = useContext(PartOpenContext)
  if (!value) throw new Error("usePartOpen must be used within a PartOpenProvider")
  return value
}
