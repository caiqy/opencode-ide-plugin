import { useCallback, useRef } from "react"

export function useHistoryScroll(input: { ids: string[] }) {
  const anchor = useRef<{ id: string; offset: number } | null>(null)
  const delta = useRef(0)

  const capture = useCallback((next: { id: string; offset: number }) => {
    anchor.current = next
    delta.current = 0
  }, [])

  const onHeightChange = useCallback(
    (next: { id: string; delta: number }) => {
      const current = anchor.current
      if (!current) return
      const a = input.ids.indexOf(current.id)
      const b = input.ids.indexOf(next.id)
      if (a < 0 || b < 0 || b >= a) return
      delta.current += next.delta
    },
    [input.ids],
  )

  const nextTop = useCallback(() => delta.current, [])

  const apply = useCallback((parent: { scrollTop: number }) => {
    if (!anchor.current || !delta.current) return 0
    const top = delta.current
    parent.scrollTop += top
    delta.current = 0
    return top
  }, [])

  const restore = useCallback(
    (
      parent: { scrollTop: number },
      rows: Record<string, { getBoundingClientRect: () => { top: number } } | null>,
      base: number,
    ) => {
      const current = anchor.current
      if (!current) return null
      const start = input.ids.indexOf(current.id)
      const id = input.ids.slice(start < 0 ? 0 : start).find((id) => rows[id])
      const row = id ? rows[id] : null
      if (!row) return null
      const next = row.getBoundingClientRect().top - base - current.offset + delta.current
      parent.scrollTop += next
      anchor.current = null
      delta.current = 0
      return next
    },
    [input.ids],
  )

  const clear = useCallback(() => {
    anchor.current = null
    delta.current = 0
  }, [])

  return { capture, onHeightChange, nextTop, apply, restore, clear }
}
