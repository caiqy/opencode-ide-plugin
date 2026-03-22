import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { MESSAGE_TOP_MEASURE_FALLBACK } from "../../../state/sessionPaging"

type Item = { id: string }

type Store = {
  box: Record<string, number>
  version: Record<string, string>
}

function size(el: HTMLElement) {
  const next = el.getBoundingClientRect().height
  if (Number.isFinite(next) && next > 0) return next
  return el.offsetHeight
}

function next(map: Record<string, Store>, id: string | null | undefined) {
  if (!id) return { box: {}, version: {} }
  map[id] ??= { box: {}, version: {} }
  return map[id]
}

export function useHistoryMeasure(input: {
  sessionID?: string | null
  items: Array<Item & { version?: string }>
  onChange?: (input: { id: string; delta: number }) => void
}) {
  const cache = useRef<Record<string, Store>>({})
  const node = useRef<Record<string, HTMLElement | null>>({})
  const obs = useRef<Record<string, ResizeObserver | null>>({})
  const [tick, setTick] = useState(0)
  const store = next(cache.current, input.sessionID)

  for (const item of input.items) {
    const version = item.version ?? item.id
    if (store.version[item.id] === version) continue
    store.version[item.id] = version
    delete store.box[item.id]
  }

  const onMeasure = useCallback(
    (id: string, height: number) => {
      const prev = store.box[id]
      const next = Number.isFinite(height) && height > 0 ? height : MESSAGE_TOP_MEASURE_FALLBACK
      if (prev === next) return
      store.box[id] = next
      if (typeof prev === "number") input.onChange?.({ id, delta: next - prev })
      setTick((tick) => tick + 1)
    },
    [input, store],
  )

  const row = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      node.current[id] = el
      obs.current[id]?.disconnect()
      obs.current[id] = null
      if (!el) return

      onMeasure(id, size(el))
      if (typeof ResizeObserver === "undefined") return

      const child = new ResizeObserver(() => {
        onMeasure(id, size(el))
      })
      child.observe(el)
      obs.current[id] = child
    },
    [onMeasure],
  )

  useEffect(() => {
    return () => {
      for (const id in obs.current) {
        obs.current[id]?.disconnect()
      }
    }
  }, [])

  const prefix = useMemo(() => {
    void tick
    let top = 0
    return input.items.map((item) => {
      const value = top
      top += store.box[item.id] ?? MESSAGE_TOP_MEASURE_FALLBACK
      return value
    })
  }, [input.items, store, tick])

  const ledger = useCallback(
    (id: string) => {
      const index = input.items.findIndex((item) => item.id === id)
      if (index < 0) return 0
      return prefix[index] ?? 0
    },
    [input.items, prefix],
  )

  const height = useCallback((id: string) => store.box[id] ?? MESSAGE_TOP_MEASURE_FALLBACK, [store])

  const reset = useCallback(
    (ids = input.items.map((item) => item.id)) => {
      let dirty = false
      for (const id of ids) {
        if (!(id in store.box)) continue
        delete store.box[id]
        dirty = true
      }
      if (dirty) setTick((tick) => tick + 1)
    },
    [input.items, store],
  )

  return { prefix, ledger, onMeasure, row, height, reset }
}
