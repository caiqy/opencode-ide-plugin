import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { Config } from "../../src/config/config"
import { MCP } from "../../src/mcp"
import { McpRoutes } from "../../src/server/routes/mcp"
import { Log } from "../../src/util/log"

Log.init({ print: false })

type Tool = {
  id: string
  name: string
}

type ToolsByServer = {
  connected: boolean
  tools: Tool[]
}

const mcp = MCP as unknown as {
  toolsByServer?: (name: string) => Promise<ToolsByServer>
}

const originalToolsByServer = mcp.toolsByServer

let cfg: Record<string, boolean> = {}
let payload: ToolsByServer = { connected: false, tools: [] }
let cfgSpy: ReturnType<typeof spyOn<typeof Config, "get">>
let mcpSpy: ReturnType<typeof spyOn<typeof MCP, "toolsByServer">>

beforeEach(() => {
  cfg = {}
  payload = { connected: false, tools: [] }
  cfgSpy = spyOn(Config, "get").mockImplementation(
    async () =>
      ({
        tools: cfg,
      }) as Awaited<ReturnType<typeof Config.get>>,
  )
  mcpSpy = spyOn(MCP, "toolsByServer").mockImplementation(
    async () => payload as Awaited<ReturnType<typeof MCP.toolsByServer>>,
  )
})

afterEach(() => {
  cfgSpy.mockRestore()
  mcpSpy.mockRestore()
})

describe("mcp tools route", () => {
  test("returns tools for connected server", async () => {
    payload = {
      connected: true,
      tools: [
        { id: "docs_search", name: "search" },
        { id: "docs_fetch", name: "fetch" },
      ],
    }

    const response = await McpRoutes().request("/docs/tools")
    const result = (await response.json()) as {
      server: string
      connected: boolean
      tools: Array<{ id: string; name: string; enabled: boolean }>
    }

    expect(response.status).toBe(200)
    expect(result).toEqual({
      server: "docs",
      connected: true,
      tools: [
        { id: "docs_search", name: "search", enabled: true },
        { id: "docs_fetch", name: "fetch", enabled: true },
      ],
    })
  })

  test("returns empty tools when server is not connected", async () => {
    payload = {
      connected: false,
      tools: [{ id: "docs_search", name: "search" }],
    }

    const response = await McpRoutes().request("/docs/tools")
    const result = (await response.json()) as {
      server: string
      connected: boolean
      tools: Array<{ id: string; name: string; enabled: boolean }>
    }

    expect(response.status).toBe(200)
    expect(result).toEqual({
      server: "docs",
      connected: false,
      tools: [],
    })
  })

  test("marks tool disabled when config.tools[id] is false", async () => {
    cfg = {
      docs_search: false,
    }
    payload = {
      connected: true,
      tools: [
        { id: "docs_search", name: "search" },
        { id: "docs_fetch", name: "fetch" },
      ],
    }

    const response = await McpRoutes().request("/docs/tools")
    const result = (await response.json()) as {
      server: string
      connected: boolean
      tools: Array<{ id: string; name: string; enabled: boolean }>
    }

    expect(response.status).toBe(200)
    expect(result).toEqual({
      server: "docs",
      connected: true,
      tools: [
        { id: "docs_search", name: "search", enabled: false },
        { id: "docs_fetch", name: "fetch", enabled: true },
      ],
    })
  })
})
