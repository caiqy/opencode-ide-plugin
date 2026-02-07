import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"

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
      return changed ? next : prev
    })
  }, [itemIDs])

  const isOpen = useCallback(
    (id: string) => {
      const overridden = overrides.get(id)
      if (typeof overridden === "boolean") return overridden
      return defaultExpanded
    },
    [overrides, defaultExpanded],
  )

  const setOpen = useCallback(
    (id: string, open: boolean) => {
      setOverrides((prev) => {
        const current = prev.get(id)
        if (open === defaultExpanded) {
          if (typeof current === "undefined") return prev
          const next = new Map(prev)
          next.delete(id)
          return next
        }
        if (current === open) return prev
        const next = new Map(prev)
        next.set(id, open)
        return next
      })
    },
    [defaultExpanded],
  )

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
