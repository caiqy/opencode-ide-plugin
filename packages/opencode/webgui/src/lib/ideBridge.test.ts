import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

class MockEventSource {
  static all: MockEventSource[] = []
  url: string
  onopen: ((this: EventSource, ev: Event) => any) | null = null
  onmessage: ((this: EventSource, ev: MessageEvent<any>) => any) | null = null
  onerror: ((this: EventSource, ev: Event) => any) | null = null
  private map = new Map<string, Array<(ev: MessageEvent) => void>>()

  constructor(url: string | URL) {
    this.url = String(url)
    MockEventSource.all.push(this)
  }

  addEventListener(type: string, listener: (ev: MessageEvent) => void) {
    const list = this.map.get(type) ?? []
    this.map.set(type, [...list, listener])
  }

  close() {}

  emit(type: string, data: unknown) {
    const ev = { data: JSON.stringify(data) } as MessageEvent
    for (const item of this.map.get(type) ?? []) item(ev)
  }
}

describe("ideBridge connected metadata", () => {
  beforeEach(() => {
    vi.resetModules()
    MockEventSource.all = []
    window.history.replaceState({}, "", "?ideBridge=http://127.0.0.1:3721&ideBridgeToken=t")
    vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource)
  })

  afterEach(() => {
    window.history.replaceState({}, "", "/")
    vi.unstubAllGlobals()
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
})
