import { afterEach, describe, expect, it, vi } from "vitest"
import { sdk } from "./sdkClient"

type Mcp = typeof sdk.mcp & {
  tools: (input: { path: { name: string } }) => Promise<{ data: unknown; error: { message: string } | null }>
  setEnabled: (input: { path: { name: string }; body: { enabled: boolean } }) => Promise<{
    data: unknown
    error: { message: string } | null
  }>
  setToolEnabled: (input: {
    path: { name: string; toolId: string }
    body: { enabled: boolean }
  }) => Promise<{ data: unknown; error: { message: string } | null }>
}

function url(input: unknown) {
  if (typeof input === "string") return input
  if (input instanceof Request) return input.url
  return ""
}

describe("sdkClient mcp tools wrapper", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("sdk.mcp.tools 请求 /mcp/:name/tools", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ tools: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )

    const api = sdk.mcp as Mcp
    await api.tools({ path: { name: "x" } })

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(url(fetch.mock.calls[0][0])).toContain("/mcp/x/tools")
  })

  it("sdk.mcp.tools 成功时透传 data", async () => {
    const data = {
      server: "x",
      connected: true,
      tools: [{ id: "x.read", name: "Read", enabled: true }],
    }
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(data), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )

    const api = sdk.mcp as Mcp
    const res = await api.tools({ path: { name: "x" } })

    expect(res.error).toBeNull()
    expect(res.data).toEqual(data)
  })

  it("sdk.mcp.tools 非 2xx 时返回 error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("boom", { status: 500 }))

    const api = sdk.mcp as Mcp
    const res = await api.tools({ path: { name: "x" } })

    expect(res.data).toBeNull()
    expect(res.error).toEqual({ message: "Failed to load MCP tools" })
  })

  it("sdk.mcp.tools 异常时返回 error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("boom"))

    const api = sdk.mcp as Mcp
    const res = await api.tools({ path: { name: "x" } })

    expect(res.data).toBeNull()
    expect(res.error).toEqual({ message: "boom" })
  })

  it("sdk.mcp.setEnabled 请求 PATCH /mcp/:name/enabled", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(true), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )

    const api = sdk.mcp as Mcp
    await api.setEnabled({ path: { name: "x" }, body: { enabled: false } })

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(url(fetch.mock.calls[0][0])).toContain("/mcp/x/enabled")
    expect(fetch.mock.calls[0][1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({ enabled: false }),
    })
  })

  it("sdk.mcp.setToolEnabled 请求 PATCH /mcp/:name/tools/:toolId", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(true), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )

    const api = sdk.mcp as Mcp
    await api.setToolEnabled({
      path: { name: "x", toolId: "x.read" },
      body: { enabled: false },
    })

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(url(fetch.mock.calls[0][0])).toContain("/mcp/x/tools/x.read")
    expect(fetch.mock.calls[0][1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({ enabled: false }),
    })
  })
})

describe("sdkClient session approval wrapper", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("只发送当前审批模式 marker", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "s1", permission: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )
    const session = sdk.session as typeof sdk.session & {
      setApproval: (input: { sessionID: string; approval: "manual" | "automatic" | "full" }) => Promise<unknown>
    }

    expect(session.setApproval).toBeTypeOf("function")
    await session.setApproval({ sessionID: "s1", approval: "automatic" })

    expect(url(fetch.mock.calls[0][0])).toContain("/session/s1")
    expect(fetch.mock.calls[0][1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({
        permission: [{ permission: "opencode_approval_mode", pattern: "automatic", action: "ask" }],
      }),
    })
  })
})
