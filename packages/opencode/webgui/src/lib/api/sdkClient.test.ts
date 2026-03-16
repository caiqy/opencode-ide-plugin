import { afterEach, describe, expect, it, vi } from "vitest"
import { sdk } from "./sdkClient"

type Mcp = typeof sdk.mcp & {
  tools: (input: { path: { name: string } }) => Promise<{ data: unknown; error: { message: string } | null }>
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
})
