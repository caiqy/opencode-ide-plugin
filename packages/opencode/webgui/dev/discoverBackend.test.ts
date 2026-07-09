import { describe, expect, it, vi } from "vitest"

type MockResponse = {
  ok: boolean
  status: number
  headers?: Record<string, string>
  json?: () => Promise<unknown>
}

function jsonResponse(data: unknown): MockResponse {
  return {
    ok: true,
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
    json: async () => data,
  }
}

describe("discoverBackend", () => {
  it("按 4300 优先、随后 4096-4100 顺序探测，命中后立即停止", async () => {
    const calls: string[] = []
    const fetcher = vi.fn(async (input: string) => {
      calls.push(input)
      if (input === "http://127.0.0.1:4300/global/config") {
        return jsonResponse({ theme: "dark", command: {} })
      }
      throw new Error("ECONNREFUSED")
    })

    const { discoverBackend } = await import("./discoverBackend")
    const found = await discoverBackend({ fetch: fetcher })

    expect(found).toEqual({
      url: "http://127.0.0.1:4300",
      port: 4300,
      probe: "http://127.0.0.1:4300/global/config",
    })
    expect(calls).toEqual(["http://127.0.0.1:4300/global/config"])
  })

  it("4300 不可用时应回退到 4096", async () => {
    const calls: string[] = []
    const fetcher = vi.fn(async (input: string) => {
      calls.push(input)
      if (input === "http://127.0.0.1:4096/global/config") {
        return jsonResponse({ theme: "dark", command: {} })
      }
      throw new Error("ECONNREFUSED")
    })

    const { discoverBackend } = await import("./discoverBackend")
    const found = await discoverBackend({ fetch: fetcher })

    expect(found).toEqual({
      url: "http://127.0.0.1:4096",
      port: 4096,
      probe: "http://127.0.0.1:4096/global/config",
    })
    expect(calls).toEqual(["http://127.0.0.1:4300/global/config", "http://127.0.0.1:4096/global/config"])
  })

  it("非 JSON 响应不应被识别为 opencode backend", async () => {
    const fetcher = vi.fn(async (_input: string) => ({
      ok: true,
      status: 200,
      headers: { "content-type": "text/html" },
      json: async () => ({}),
    }))

    const { discoverBackend } = await import("./discoverBackend")

    await expect(discoverBackend({ fetch: fetcher, ports: [4096] })).rejects.toThrow(
      "No running opencode backend found on localhost",
    )
  })

  it("JSON 存在但缺少关键配置字段时不应误判成功", async () => {
    const fetcher = vi.fn(async (_input: string) => jsonResponse({ ok: true }))

    const { discoverBackend } = await import("./discoverBackend")

    await expect(discoverBackend({ fetch: fetcher, ports: [4096] })).rejects.toThrow(
      "No running opencode backend found on localhost",
    )
  })

  it("全部端口失败时应抛出带尝试明细的错误", async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input === "http://127.0.0.1:4096/global/config") throw new Error("ECONNREFUSED")
      return jsonResponse({ ok: true })
    })

    const { discoverBackend, BackendDiscoveryError } = await import("./discoverBackend")

    await expect(discoverBackend({ fetch: fetcher, ports: [4096, 4097] })).rejects.toBeInstanceOf(BackendDiscoveryError)
  })
})
