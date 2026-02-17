import { afterEach, describe, expect, it, vi } from "vitest"
import { renderHook } from "@testing-library/react"
import { useEventStream } from "./events"

describe("useEventStream", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("默认使用标准 /event 端点", () => {
    const source = vi.fn(function (this: any, url: string) {
      this.url = url
      this.close = vi.fn()
      this.onopen = null
      this.onmessage = null
      this.onerror = null
    })
    vi.stubGlobal("EventSource", source)

    const { unmount } = renderHook(() => useEventStream())

    expect(source).toHaveBeenCalledTimes(1)
    expect(source.mock.calls[0][0]).toBe("/event")
    unmount()
  })
})
