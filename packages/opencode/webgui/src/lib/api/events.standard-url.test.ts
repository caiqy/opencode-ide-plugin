import { afterEach, describe, expect, it, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"
import { useEventStream } from "./events"

class MockSource {
  static all: MockSource[] = []
  url: string
  close = vi.fn()
  onopen: ((this: EventSource, ev: Event) => unknown) | null = null
  onmessage: ((this: EventSource, ev: MessageEvent) => unknown) | null = null
  onerror: ((this: EventSource, ev: Event) => unknown) | null = null

  constructor(url: string) {
    this.url = url
    MockSource.all.push(this)
  }
}

describe("useEventStream", () => {
  afterEach(() => {
    MockSource.all = []
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

  it("已连接后短暂断开时应标记为 disconnected 而不是 error", () => {
    vi.stubGlobal("EventSource", MockSource as unknown as typeof EventSource)

    const { result, unmount } = renderHook(() => useEventStream())
    const source = MockSource.all[0]

    act(() => {
      source.onopen?.call(source as unknown as EventSource, new Event("open"))
    })
    expect(result.current.connectionState).toBe("connected")

    act(() => {
      source.onerror?.call(source as unknown as EventSource, new Event("error"))
    })

    expect(result.current.connectionState).toBe("disconnected")
    unmount()
  })
})
