import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"

type ToolStatus = "pending" | "running" | "completed" | "error"

export type PartOpenItem =
  | { type: "reasoning"; id: string; text?: string; end?: number }
  | { type: "tool"; id: string; tool: string; status?: ToolStatus; metadata?: Record<string, unknown> }

interface PartOpenValue {
  isOpen: (id: string) => boolean
  setOpen: (id: string, open: boolean) => void
  toggle: (id: string) => void
}

const PartOpenContext = createContext<PartOpenValue | undefined>(undefined)

// Tools that use "auto-expand last, collapse previous" behavior
const AUTO_EXPAND_TOOLS = new Set(["task"])

// Tools that should be collapsed by default (user can still click to expand)
const COLLAPSED_BY_DEFAULT_TOOLS = new Set(["bash", "skill", "websearch"])

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

  // Find the last auto-expand tool ID (task)
  const lastAutoExpandToolId = useMemo(() => {
    for (let i = props.items.length - 1; i >= 0; i--) {
      const item = props.items[i]
      if (item.type === "tool" && AUTO_EXPAND_TOOLS.has(item.tool)) return item.id
    }
    return null
  }, [props.items])

  // Set of all reasoning IDs for quick lookup
  const reasoningIds = useMemo(
    () => new Set(props.items.filter((item) => item.type === "reasoning").map((item) => item.id)),
    [props.items],
  )

  // Set of all auto-expand tool IDs for quick lookup
  const autoExpandToolIds = useMemo(
    () =>
      new Set(
        props.items.filter((item) => item.type === "tool" && AUTO_EXPAND_TOOLS.has(item.tool)).map((item) => item.id),
      ),
    [props.items],
  )

  // Track previous last IDs to auto-close when new ones appear
  const prevLastReasoningIdRef = useRef<string | null>(lastReasoningId)
  const prevLastAutoExpandToolIdRef = useRef<string | null>(lastAutoExpandToolId)

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
      const prevLastReasoning = prevLastReasoningIdRef.current
      if (
        lastReasoningId &&
        prevLastReasoning &&
        lastReasoningId !== prevLastReasoning &&
        itemIDs.has(prevLastReasoning)
      ) {
        if (next.get(prevLastReasoning) !== false) {
          next.set(prevLastReasoning, false)
          changed = true
        }
      }

      // Auto-close previous last auto-expand tool when a new one appears
      const prevLastTool = prevLastAutoExpandToolIdRef.current
      if (lastAutoExpandToolId && prevLastTool && lastAutoExpandToolId !== prevLastTool && itemIDs.has(prevLastTool)) {
        if (next.get(prevLastTool) !== false) {
          next.set(prevLastTool, false)
          changed = true
        }
      }

      return changed ? next : prev
    })

    prevLastReasoningIdRef.current = lastReasoningId
    prevLastAutoExpandToolIdRef.current = lastAutoExpandToolId
  }, [itemIDs, lastReasoningId, lastAutoExpandToolId])

  const isOpen = useCallback(
    (id: string) => {
      const overridden = overrides.get(id)
      if (typeof overridden === "boolean") return overridden

      // Reasoning items: only the last one is expanded by default
      if (reasoningIds.has(id)) {
        return id === lastReasoningId
      }

      // Auto-expand tools (task): only the last one is expanded by default
      if (autoExpandToolIds.has(id)) {
        return id === lastAutoExpandToolId
      }

      // Collapsed-by-default tools (skill, invalidTool, etc.)
      const toolItem = props.items.find((item) => item.id === id)
      if (toolItem?.type === "tool") {
        if (
          COLLAPSED_BY_DEFAULT_TOOLS.has(toolItem.tool) ||
          toolItem.tool.startsWith("invalid") ||
          toolItem.metadata?.source === "mcp"
        ) {
          return false
        }
      }

      // Other tool items: follow defaultExpanded
      return defaultExpanded
    },
    [overrides, defaultExpanded, reasoningIds, lastReasoningId, autoExpandToolIds, lastAutoExpandToolId, props.items],
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
