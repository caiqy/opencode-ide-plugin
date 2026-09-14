import { afterEach, describe, expect, it, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"
import { useEventStream, type ServerEvent } from "./events"

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

  it("默认使用全项目 /global/event 端点", () => {
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
    expect(source.mock.calls[0][0]).toBe("/global/event")
    unmount()
  })

  it("解包全局事件信封并按原类型分发", () => {
    vi.stubGlobal("EventSource", MockSource as unknown as typeof EventSource)

    const { result, unmount } = renderHook(() => useEventStream())
    const source = MockSource.all[0]
    const received: ServerEvent[] = []
    act(() => {
      result.current.emitter.subscribe("session.idle", (event) => received.push(event))
    })

    act(() => {
      source.onmessage?.call(source as unknown as EventSource, {
        data: JSON.stringify({
          directory: "D:\\repo\\hosts\\vscode-plugin\\test-fixtures",
          project: "proj",
          payload: { id: "evt_1", type: "session.idle", properties: { sessionID: "ses_other" } },
        }),
      } as MessageEvent)
    })

    expect(received).toEqual([{ id: "evt_1", type: "session.idle", properties: { sessionID: "ses_other" } }])
    unmount()
  })

  it("兼容平铺的 legacy 事件", () => {
    vi.stubGlobal("EventSource", MockSource as unknown as typeof EventSource)

    const { result, unmount } = renderHook(() => useEventStream())
    const source = MockSource.all[0]
    const received: ServerEvent[] = []
    act(() => {
      result.current.emitter.subscribe("session.idle", (event) => received.push(event))
    })

    act(() => {
      source.onmessage?.call(source as unknown as EventSource, {
        data: JSON.stringify({ type: "session.idle", properties: { sessionID: "ses_flat" } }),
      } as MessageEvent)
    })

    expect(received).toEqual([{ type: "session.idle", properties: { sessionID: "ses_flat" } }])
    unmount()
  })

  it("忽略不携带 UI 事件的 sync 信封", () => {
    vi.stubGlobal("EventSource", MockSource as unknown as typeof EventSource)

    const { result, unmount } = renderHook(() => useEventStream())
    const source = MockSource.all[0]
    const received: ServerEvent[] = []
    act(() => {
      result.current.emitter.on("*", (event) => received.push(event))
    })

    act(() => {
      source.onmessage?.call(source as unknown as EventSource, {
        data: JSON.stringify({ directory: "D:\\repo", project: "proj", payload: { type: "sync", syncEvent: {} } }),
      } as MessageEvent)
    })

    expect(received).toHaveLength(0)
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
