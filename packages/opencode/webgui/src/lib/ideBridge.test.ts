import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

class MockEventSource {
  static all: MockEventSource[] = []
  url: string
  readyState = 1
  onopen: ((this: EventSource, ev: Event) => unknown) | null = null
  onmessage: ((this: EventSource, ev: MessageEvent) => unknown) | null = null
  onerror: ((this: EventSource, ev: Event) => unknown) | null = null
  private map = new Map<string, Array<(ev: MessageEvent) => void>>()

  constructor(url: string | URL) {
    this.url = String(url)
    MockEventSource.all.push(this)
  }

  addEventListener(type: string, listener: (ev: MessageEvent) => void) {
    const list = this.map.get(type) ?? []
    this.map.set(type, [...list, listener])
  }

  close() {
    this.readyState = 2
  }

  emit(type: string, data: unknown) {
    const ev = { data: JSON.stringify(data) } as MessageEvent
    for (const item of this.map.get(type) ?? []) item(ev)
  }
}

describe("ideBridge connected metadata", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    MockEventSource.all = []
    window.history.replaceState({}, "", "?ideBridge=http://127.0.0.1:3721&ideBridgeToken=t")
    vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource)
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }))
  })

  afterEach(() => {
    window.history.replaceState({}, "", "/")
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("connected 缺省 restartMode 时会清空旧能力", async () => {
    const { ideBridge } = await import("./ideBridge")
    ideBridge.init()

    const source = MockEventSource.all[0]
    expect(source).toBeDefined()

    source.emit("connected", { restartMode: "window" })
    expect(ideBridge.restartMode).toBe("window")

    source.emit("connected", {})
    expect(ideBridge.restartMode).toBeNull()
  })

  it("restartHost 请求超时会 reject", async () => {
    const { ideBridge } = await import("./ideBridge")
    ideBridge.init()

    const source = MockEventSource.all[0]
    expect(source).toBeDefined()
    source.onopen?.call(source as unknown as EventSource, new Event("open"))

    const bad = vi.fn()
    ideBridge.request("restartHost").catch(bad)

    await vi.advanceTimersByTimeAsync(5001)

    expect(bad).toHaveBeenCalledTimes(1)
    expect(bad.mock.calls[0]?.[0]).toBeInstanceOf(Error)
    expect(String(bad.mock.calls[0]?.[0])).toContain("restartHost")
  })

  it("checkForUpdates 请求超时会 reject", async () => {
    const { ideBridge } = await import("./ideBridge")
    ideBridge.init()

    const source = MockEventSource.all[0]
    expect(source).toBeDefined()
    source.onopen?.call(source as unknown as EventSource, new Event("open"))

    const bad = vi.fn()
    ideBridge.request("checkForUpdates").catch(bad)

    await vi.advanceTimersByTimeAsync(15001)

    expect(bad).toHaveBeenCalledTimes(1)
    expect(bad.mock.calls[0]?.[0]).toBeInstanceOf(Error)
    expect(String(bad.mock.calls[0]?.[0])).toContain("checkForUpdates")
  })

  it("checkForUpdates 不应早于 Marketplace 请求超时", async () => {
    const { ideBridge } = await import("./ideBridge")
    ideBridge.init()

    const source = MockEventSource.all[0]
    expect(source).toBeDefined()
    source.onopen?.call(source as unknown as EventSource, new Event("open"))

    const bad = vi.fn()
    ideBridge.request("checkForUpdates").catch(bad)

    await vi.advanceTimersByTimeAsync(8001)

    expect(bad).not.toHaveBeenCalled()
  })

  it("bridge 断连时 pending request 会 reject", async () => {
    const { ideBridge } = await import("./ideBridge")
    ideBridge.init()

    const source = MockEventSource.all[0]
    expect(source).toBeDefined()
    source.onopen?.call(source as unknown as EventSource, new Event("open"))

    const bad = vi.fn()
    ideBridge.request("storageGet", { scope: "workspace", keys: ["foo"] }).catch(bad)

    source.onerror?.call(source as unknown as EventSource, new Event("error"))
    await Promise.resolve()

    expect(bad).toHaveBeenCalledTimes(1)
    expect(bad.mock.calls[0]?.[0]).toBeInstanceOf(Error)
    expect(String(bad.mock.calls[0]?.[0])).toContain("disconnected")
  })

  it("/send 返回 4xx 时 request 会 reject", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400 }))

    const { ideBridge } = await import("./ideBridge")
    ideBridge.init()

    const source = MockEventSource.all[0]
    expect(source).toBeDefined()
    source.onopen?.call(source as unknown as EventSource, new Event("open"))

    const bad = vi.fn()
    ideBridge.request("storageGet", { scope: "workspace", keys: ["foo"] }).catch(bad)
    await vi.waitFor(() => expect(bad).toHaveBeenCalledTimes(1))

    expect(String(bad.mock.calls[0]?.[0])).toContain("400")
  })

  it("收到 ok:false 的 replyTo 消息时 request 会 reject", async () => {
    let done: ((value: { ok: boolean; status: number }) => void) | undefined
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            done = resolve
          }),
      ),
    )

    const { ideBridge } = await import("./ideBridge")
    ideBridge.init()

    const source = MockEventSource.all[0]
    expect(source).toBeDefined()
    source.onopen?.call(source as unknown as EventSource, new Event("open"))

    const bad = vi.fn()
    ideBridge.request("storageGet", { scope: "workspace", keys: ["foo"] }).catch(bad)
    await Promise.resolve()

    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body ?? "{}"))
    source.onmessage?.call(
      source as unknown as EventSource,
      {
        data: JSON.stringify({
          replyTo: body.id,
          ok: false,
          error: "bad request",
        }),
      } as MessageEvent,
    )

    done?.({ ok: false, status: 400 })

    await vi.waitFor(() => expect(bad).toHaveBeenCalledTimes(1))
    expect(String(bad.mock.calls[0]?.[0])).toContain("bad request")
  })

  it("网络错误重试耗尽后 request 会 reject", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")))

    const { ideBridge } = await import("./ideBridge")
    ideBridge.init()

    const source = MockEventSource.all[0]
    expect(source).toBeDefined()
    source.onopen?.call(source as unknown as EventSource, new Event("open"))

    const bad = vi.fn()
    ideBridge.request("storageGet", { scope: "workspace", keys: ["foo"] }).catch(bad)

    await vi.advanceTimersByTimeAsync(7001)

    expect(bad).toHaveBeenCalledTimes(1)
    expect(String(bad.mock.calls[0]?.[0])).toContain("offline")
  })

  it.each([
    ["网络错误", () => Promise.reject(new Error("offline"))],
    ["HTTP 5xx", () => Promise.resolve({ ok: false, status: 500 })],
  ])("易失通知遇到%s后断线重连也不会补发", async (_name, fail) => {
    const send = vi.fn().mockImplementationOnce(fail).mockResolvedValue({ ok: true })
    vi.stubGlobal("fetch", send)
    vi.spyOn(document, "hasFocus").mockReturnValue(false)
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" })

    const { ideBridge } = await import("./ideBridge")
    const { sendIdeNotification } = await import("./ideNotifications")
    ideBridge.init()

    const source = MockEventSource.all[0]
    expect(source).toBeDefined()
    source.onopen?.call(source as unknown as EventSource, new Event("open"))

    expect(sendIdeNotification("finished", "s1", null)).toBe(true)
    await Promise.resolve()
    await Promise.resolve()

    source.onerror?.call(source as unknown as EventSource, new Event("error"))
    await vi.advanceTimersByTimeAsync(1000)

    const next = MockEventSource.all[1]
    expect(next).toBeDefined()
    next.onopen?.call(next as unknown as EventSource, new Event("open"))
    await vi.runAllTimersAsync()

    expect(send).toHaveBeenCalledTimes(1)
  })

  it("timeout 后不会再触发 fetch/send", async () => {
    const send = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal("fetch", send)

    const { ideBridge } = await import("./ideBridge")
    ideBridge.init()

    const bad = vi.fn()
    ideBridge.request("restartHost").catch(bad)

    await vi.advanceTimersByTimeAsync(5001)
    expect(bad).toHaveBeenCalledTimes(1)

    const source = MockEventSource.all[0]
    expect(source).toBeDefined()
    source.onopen?.call(source as unknown as EventSource, new Event("open"))
    await Promise.resolve()

    expect(send).not.toHaveBeenCalled()
  })

  it("disconnect reject 后重连也不会补发该 request", async () => {
    const send = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal("fetch", send)

    const { ideBridge } = await import("./ideBridge")
    ideBridge.init()

    const source = MockEventSource.all[0]
    expect(source).toBeDefined()

    const bad = vi.fn()
    ideBridge.request("storageGet", { scope: "workspace", keys: ["foo"] }).catch(bad)
    await Promise.resolve()

    source.onerror?.call(source as unknown as EventSource, new Event("error"))
    await Promise.resolve()
    expect(bad).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledTimes(0)

    await vi.advanceTimersByTimeAsync(1000)

    const next = MockEventSource.all[1]
    expect(next).toBeDefined()
    next.onopen?.call(next as unknown as EventSource, new Event("open"))
    await Promise.resolve()

    expect(send).toHaveBeenCalledTimes(0)
  })
})
