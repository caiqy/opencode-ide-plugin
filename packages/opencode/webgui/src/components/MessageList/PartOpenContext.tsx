import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"

type ToolStatus = "pending" | "running" | "completed" | "error"

export type PartOpenItem =
  | { type: "reasoning"; id: string; text?: string; end?: number }
  | { type: "tool"; id: string; tool: string; status?: ToolStatus }

export type PartOpenState = { type: "reasoning" | "tool"; id: string } | null

interface PartOpenValue {
  open: PartOpenState
  openManual: (open: PartOpenState) => void
}

const PartOpenContext = createContext<PartOpenValue | undefined>(undefined)

function findReasoning(items: PartOpenItem[]) {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (item.type !== "reasoning") continue
    if (item.end) continue
    const text = (item.text || "").trim()
    if (!text) continue
    return item
  }
}

function findBash(items: PartOpenItem[]) {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (item.type !== "tool") continue
    if (item.tool !== "bash") continue
    if (item.status !== "pending" && item.status !== "running") continue
    return item
  }
}

function findEnd(items: PartOpenItem[], id: string) {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (item.type !== "reasoning") continue
    if (item.id !== id) continue
    return item.end
  }
}

export function PartOpenProvider(props: { items: PartOpenItem[]; children: ReactNode }) {
  const [open, setOpen] = useState<PartOpenState>(null)
  const [mode, setMode] = useState<"auto" | "manual">("auto")
  const closed = useRef<Set<string>>(new Set())

  const openManual = useCallback((next: PartOpenState) => {
    const nextMode = next ? "manual" : "auto"
    setMode(nextMode)
    setOpen(next)
  }, [])

  useEffect(() => {
    if (mode === "auto" && open?.type === "reasoning") {
      const end = findEnd(props.items, open.id)
      const done = typeof end === "number"
      const once = !closed.current.has(open.id)
      if (done && once) {
        closed.current.add(open.id)
        setOpen(null)
        return
      }
    }

    if (mode !== "auto") return
    if (open) return

    const r = findReasoning(props.items)
    if (r) {
      setOpen({ type: "reasoning", id: r.id })
      return
    }

    const b = findBash(props.items)
    if (!b) return
    setOpen({ type: "tool", id: b.id })
  }, [props.items, open, mode])

  return <PartOpenContext.Provider value={{ open, openManual }}>{props.children}</PartOpenContext.Provider>
}

export function usePartOpen() {
  const value = useContext(PartOpenContext)
  if (!value) throw new Error("usePartOpen must be used within a PartOpenProvider")
  return value
}
