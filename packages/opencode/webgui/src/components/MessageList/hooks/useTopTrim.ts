import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react"
import { useHistoryMeasure } from "./useHistoryMeasure"
import { useHistoryWindow } from "./useHistoryWindow"
import { useHistoryScroll } from "./useHistoryScroll"

type Item = { id: string }

type ProgrammaticScroll = (cause: "history-restore" | "history-trim", fn: (parent: HTMLElement) => void) => void

interface Input<T extends Item> {
  sessionID?: string | null
  items: T[]
  ids?: string[]
  paused: boolean
  loading?: boolean
  ref: RefObject<HTMLDivElement | null>
  runProgrammaticScroll?: ProgrammaticScroll
}

function version(item: Item) {
  const next = item as Item & {
    kind?: string
    msg?: {
      info?: unknown
      parts?: unknown
    }
  }
  if (!next.msg) return item.id

  const parts = Array.isArray(next.msg.parts) ? next.msg.parts : []
  const key = parts
    .map((part) => {
      if (!part || typeof part !== "object") return ""
      const p = part as {
        id?: unknown
        type?: unknown
        text?: unknown
        state?: { status?: unknown }
      }
      const id = typeof p.id === "string" ? p.id : ""
      const type = typeof p.type === "string" ? p.type : ""
      const len = typeof p.text === "string" ? p.text.length : 0
      const status = typeof p.state?.status === "string" ? p.state.status : ""
      return `${id}:${type}:${len}:${status}`
    })
    .join("|")

  return `${item.id}:${next.kind ?? ""}:${parts.length}:${key}`
}

function widthOf(node: HTMLElement) {
  return node.getBoundingClientRect().width || node.clientWidth
}

export function useTopTrim<T extends Item>(input: Input<T>) {
  const topRef = useRef<HTMLDivElement>(null)
  const node = useRef<Record<string, HTMLDivElement | null>>({})
  const pending = useRef<{ first?: string; head?: string; end?: boolean } | null>(null)
  const load = useRef<boolean | null>(null)
  const startRef = useRef(0)
  const width = useRef<number | null>(null)
  const [full, setFull] = useState(false)
  const ids = input.ids ?? input.items.map((item) => item.id)
  const head = ids[0] ?? ""
  const len = ids.length
  const loading = input.loading ?? false
  const set = useMemo(() => new Set(input.items.map((item) => item.id)), [input.items])
  const scroll = useHistoryScroll({ ids })
  const pushRef = useRef<(top: number, height?: number) => void>(() => {})
  const mutateScroll = useCallback(
    (cause: "history-restore" | "history-trim", parent: HTMLElement, fn: () => void) => {
      if (input.runProgrammaticScroll) {
        input.runProgrammaticScroll(cause, () => {
          void parent
          fn()
        })
        return
      }
      fn()
    },
    [input.runProgrammaticScroll],
  )
  const capture = scroll.capture
  const onHeightChange = scroll.onHeightChange
  const nextTop = scroll.nextTop
  const apply = scroll.apply
  const restore = scroll.restore
  const clear = scroll.clear

  const snap = useCallback(() => {
    if (input.paused || pending.current) return
    const parent = input.ref.current?.parentElement as HTMLElement | null
    if (!parent) return
    const base = parent.getBoundingClientRect().top
    const list = input.items.slice(startRef.current)
    const hit = list.find((item) => {
      const row = node.current[item.id]
      if (!row) return false
      return row.getBoundingClientRect().bottom > base
    })
    const row = hit ? node.current[hit.id] : null
    if (!hit || !row) return
    capture({ id: hit.id, offset: row.getBoundingClientRect().top - base })
  }, [capture, input.items, input.paused, input.ref])

  const measure = useHistoryMeasure({
    sessionID: input.sessionID,
    items: input.items.map((item) => ({ id: item.id, version: version(item) })),
    onChange: (next) => {
      snap()
      onHeightChange(next)
      if (input.paused || pending.current) return
      const parent = input.ref.current?.parentElement as HTMLElement | null
      if (!parent) return
      const top = nextTop()
      if (top) {
        mutateScroll("history-trim", parent, () => {
          apply(parent)
        })
        pushRef.current(parent.scrollTop, parent.clientHeight)
        return
      }
      const row = node.current[next.id]
      if (!row || row.getBoundingClientRect().top >= parent.getBoundingClientRect().top) return
      mutateScroll("history-trim", parent, () => {
        parent.scrollTop += next.delta
      })
      pushRef.current(parent.scrollTop, parent.clientHeight)
    },
  })
  const win = useHistoryWindow({
    sessionID: input.sessionID,
    sizes: input.items.map((item) => measure.height(item.id)),
  })
  const push = win.onScroll
  const reset = win.reset
  pushRef.current = push
  const start = win.start
  startRef.current = start
  const top = win.top

  useLayoutEffect(() => {
    pending.current = null
    width.current = null
    setFull(false)
    clear()
  }, [clear, input.sessionID])

  useLayoutEffect(() => {
    if (!input.paused) return
    pending.current = null
    setFull(false)
    clear()
  }, [clear, input.paused])

  const row = useCallback(
    (id: string) => (el: HTMLDivElement | null) => {
      node.current[id] = el
      if (!set.has(id)) return
      measure.row(id)(el)
    },
    [measure, set],
  )

  const sync = useCallback(
    (parent: HTMLElement) => {
      const next = widthOf(parent)
      const prev = width.current
      width.current = next
      if (prev === null || prev <= 0 || next === prev) return false
      pending.current = null
      clear()
      measure.reset()
      reset()
      setFull(true)
      return true
    },
    [clear, measure, reset],
  )

  const preparePrepend = useCallback(() => {
    if (input.paused) return
    const parent = input.ref.current?.parentElement as HTMLElement | null
    if (!parent) return
    const first = input.items[start]?.id ?? ids[start]
    if (!first) return
    const box = first ? node.current[first] : null
    const base = parent.getBoundingClientRect().top
    if (first && box) {
      capture({
        id: first,
        offset: box.getBoundingClientRect().top - base,
      })
    }
    pending.current = { first, head: ids[0], end: false }
  }, [capture, ids, input.items, input.paused, input.ref, start])

  const cancelPrepend = useCallback(() => {
    pending.current = null
  }, [])

  useEffect(() => {
    const parent = input.ref.current?.parentElement as HTMLElement | null
    if (!parent) return
    width.current = widthOf(parent)
    const onScroll = () => {
      if (sync(parent)) return
      if (full) setFull(false)
      if (!input.paused) push(parent.scrollTop, parent.clientHeight)
      snap()
    }
    parent.addEventListener("scroll", onScroll)
    if (!input.paused) push(parent.scrollTop, parent.clientHeight)
    return () => {
      parent.removeEventListener("scroll", onScroll)
    }
  }, [full, input.paused, input.ref, push, snap, sync])

  useEffect(() => {
    const parent = input.ref.current?.parentElement as HTMLElement | null
    if (!parent || input.paused) return
    push(parent.scrollTop, parent.clientHeight)
  }, [input.items, input.paused, input.ref, push])

  useEffect(() => {
    const parent = input.ref.current?.parentElement as HTMLElement | null
    if (!parent || input.paused) return
    if (typeof ResizeObserver === "undefined") return

    const obs = new ResizeObserver(() => {
      if (sync(parent)) return
      push(parent.scrollTop, parent.clientHeight)
    })
    width.current = widthOf(parent)
    obs.observe(parent)

    return () => {
      obs.disconnect()
    }
  }, [input.paused, input.ref, push])

  useLayoutEffect(() => {
    snap()
  }, [snap, start])

  useLayoutEffect(() => {
    const prev = load.current
    load.current = loading
    const last = pending.current
    if (!last) return
    if (prev && !loading) last.end = true
    if (loading) last.end = false
  }, [loading])

  useLayoutEffect(() => {
    const parent = input.ref.current?.parentElement as HTMLElement | null
    const last = pending.current
    if (!parent || !last) return
    if (last.head && head !== last.head) {
      const index = ids.indexOf(last.head)
      if (index > 0) {
        mutateScroll("history-restore", parent, () => {
          restore(parent, node.current, parent.getBoundingClientRect().top)
        })
        pending.current = null
        if (!input.paused) push(parent.scrollTop, parent.clientHeight)
        return
      }
    }
    if (last.end) {
      if (nextTop()) {
        mutateScroll("history-restore", parent, () => {
          apply(parent)
        })
        pushRef.current(parent.scrollTop, parent.clientHeight)
      }
      pending.current = null
    }
  }, [apply, head, ids, input.paused, input.ref, len, loading, mutateScroll, nextTop, push, restore])

  const offset = full ? 0 : top
  const visible = useMemo(() => input.items.slice(full ? 0 : start), [full, input.items, start])

  return { topRef, top: offset, visible, row, preparePrepend, cancelPrepend }
}
