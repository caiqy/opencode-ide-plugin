import { useCallback, useMemo, useRef, useState } from "react"
import { MESSAGE_TOP_SENTINEL_THRESHOLD, MESSAGE_TOP_UNLOAD_THRESHOLD } from "../../../state/sessionPaging"

function sum(list: number[]) {
  let top = 0
  return list.map((size) => {
    const value = top
    top += size
    return value
  })
}

function pick(prefix: number[], sizes: number[], top: number, height: number) {
  const limit = top - Math.max(MESSAGE_TOP_UNLOAD_THRESHOLD, height)
  if (limit <= 0) return 0
  let index = 0
  while (index < sizes.length) {
    const next = (prefix[index] ?? 0) + (sizes[index] ?? 0)
    if (next > limit) break
    index += 1
  }
  return index
}

function clamp(start: number, size: number) {
  if (size <= 0) return 0
  return Math.min(start, size - 1)
}

export function useHistoryWindow(input: { sessionID?: string | null; sizes: number[] }) {
  const cache = useRef<Record<string, number>>({})
  const size = useRef<Record<string, number>>({})
  const prefix = useMemo(() => sum(input.sizes), [input.sizes])
  const [, setTick] = useState(0)
  const prev = input.sessionID ? size.current[input.sessionID] : undefined
  const shrink = typeof prev === "number" && input.sizes.length < prev
  const start = shrink ? 0 : clamp(input.sessionID ? (cache.current[input.sessionID] ?? 0) : 0, input.sizes.length)

  if (input.sessionID) {
    cache.current[input.sessionID] = start
    size.current[input.sessionID] = input.sizes.length
  }

  const onScroll = useCallback(
    (top: number, height = 0) => {
      const prev = clamp(input.sessionID ? (cache.current[input.sessionID] ?? 0) : 0, input.sizes.length)
      const next = pick(prefix, input.sizes, top, height)
      const keep =
        prev > 0 &&
        next < prev &&
        top > (prefix[prev] ?? 0) + MESSAGE_TOP_SENTINEL_THRESHOLD &&
        height <= MESSAGE_TOP_UNLOAD_THRESHOLD
          ? clamp(prev, input.sizes.length)
          : clamp(next, input.sizes.length)
      if (input.sessionID) cache.current[input.sessionID] = keep
      if (keep !== prev) setTick((tick) => tick + 1)
    },
    [input.sessionID, input.sizes, prefix],
  )

  const reset = useCallback(() => {
    if (input.sessionID) {
      cache.current[input.sessionID] = 0
      size.current[input.sessionID] = input.sizes.length
    }
    setTick((tick) => tick + 1)
  }, [input.sessionID, input.sizes.length])

  return { start, top: prefix[start] ?? 0, prefix, onScroll, reset }
}
