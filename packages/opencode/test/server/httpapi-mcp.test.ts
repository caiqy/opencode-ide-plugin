import path from "node:path"
import { describe, expect } from "bun:test"
import { Context, Effect, Layer } from "effect"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { McpPaths } from "../../src/server/routes/instance/httpapi/groups/mcp"
import { Server } from "../../src/server/server"
import { resetDatabase } from "../fixture/db"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const context = Context.empty() as Context.Context<unknown>
const testStateLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    yield* Effect.promise(() => resetDatabase())
    yield* Effect.addFinalizer(() => Effect.promise(() => resetDatabase()).pipe(Effect.ignore))
  }),
)
const it = testEffect(testStateLayer)

function app() {
  return Server.Default().app
}
type TestApp = ReturnType<typeof app>
type TestHandler = ReturnType<typeof HttpApiApp.webHandler>

const request = Effect.fnUntraced(function* (
  handler: TestHandler,
  route: string,
  directory: string,
  init?: RequestInit,
) {
  const headers = new Headers(init?.headers)
  headers.set("x-opencode-directory", directory)
  return yield* Effect.promise(() =>
    Promise.resolve(
      handler.handler(
        new Request(`http://localhost${route}`, {
          ...init,
          headers,
        }),
        context,
      ),
    ),
  )
})

const json = <A>(response: Response) => Effect.promise(() => response.json() as Promise<A>)

const readResponse = Effect.fnUntraced(function* (input: { app: TestApp; path: string; headers: HeadersInit }) {
  const response = yield* Effect.promise(() =>
    Promise.resolve(input.app.request(input.path, { method: "POST", headers: input.headers })),
  )
  return {
    status: response.status,
    body: yield* Effect.promise(() => response.text()),
  }
})

describe("mcp HttpApi", () => {
  it.instance(
    "serves status endpoint",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const handler = HttpApiApp.webHandler()
        const response = yield* request(handler, McpPaths.status, tmp.directory)

        expect(response.status).toBe(200)
        expect(yield* json(response)).toEqual({ demo: { status: "disabled" } })
      }),
    {
      config: {
        mcp: {
          demo: {
            type: "local",
            command: ["echo", "demo"],
            enabled: false,
          },
        },
      },
    },
  )

  it.instance(
    "serves tools endpoint as JSON",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const handler = HttpApiApp.webHandler()
        const response = yield* request(handler, "/mcp/demo/tools", tmp.directory)

        expect(response.status).toBe(200)
        expect(response.headers.get("content-type")).toContain("application/json")
        expect(yield* json<{ server: string; connected: boolean; tools: unknown[] }>(response)).toEqual({
          server: "demo",
          connected: false,
          tools: [],
        })
      }),
    {
      config: {
        mcp: {
          demo: {
            type: "local",
            command: ["echo", "demo"],
            enabled: false,
          },
        },
      },
    },
  )

  it.instance(
    "serves server enabled patch endpoint",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const handler = HttpApiApp.webHandler()
        const response = yield* request(handler, "/mcp/demo/enabled", tmp.directory, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled: true }),
        })

        expect(response.status).toBe(200)
        expect(yield* json(response)).toBe(true)

        const refreshed = yield* request(handler, McpPaths.status, tmp.directory)
        expect(refreshed.status).toBe(200)
        expect((yield* json<Record<string, { status: string }>>(refreshed)).demo?.status).toBe("failed")

        expect(yield* Effect.promise(() => Bun.file(path.join(tmp.directory, "opencode.json")).json())).toMatchObject({
          mcp: {
            demo: {
              enabled: true,
            },
          },
        })
      }),
    {
      config: {
        mcp: {
          demo: {
            type: "local",
            command: ["echo", "demo"],
            enabled: false,
          },
        },
      },
    },
  )

  it.instance(
    "serves tool enabled patch endpoint",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const handler = HttpApiApp.webHandler()
        const response = yield* request(handler, "/mcp/demo/tools/demo_read", tmp.directory, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled: false }),
        })

        expect(response.status).toBe(200)
        expect(yield* json(response)).toBe(true)

        expect(yield* Effect.promise(() => Bun.file(path.join(tmp.directory, "opencode.json")).json())).toMatchObject({
          tools: {
            demo_read: false,
          },
        })
      }),
    {
      config: {
        mcp: {
          demo: {
            type: "local",
            command: ["echo", "demo"],
            enabled: true,
          },
        },
      },
    },
  )

  it.instance(
    "rejects tool enabled patch when tool does not belong to server",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const handler = HttpApiApp.webHandler()
        const response = yield* request(handler, "/mcp/demo/tools/other_read", tmp.directory, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled: false }),
        })

        expect(response.status).toBe(400)

        expect(
          yield* Effect.promise(() => Bun.file(path.join(tmp.directory, "opencode.json")).json()),
        ).not.toMatchObject({
          tools: {
            other_read: false,
          },
        })
      }),
    {
      config: {
        mcp: {
          demo: {
            type: "local",
            command: ["echo", "demo"],
            enabled: true,
          },
        },
      },
    },
  )

  it.instance(
    "serves add, connect, and disconnect endpoints",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const handler = HttpApiApp.webHandler()
        const added = yield* request(handler, McpPaths.status, tmp.directory, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "added",
            config: {
              type: "local",
              command: ["echo", "added"],
              enabled: false,
            },
          }),
        })
        expect(added.status).toBe(200)
        expect(yield* json(added)).toMatchObject({ added: { status: "disabled" } })

        const addedDisconnected = yield* request(handler, "/mcp/added/disconnect", tmp.directory, { method: "POST" })
        expect(addedDisconnected.status).toBe(200)
        expect(yield* json(addedDisconnected)).toBe(true)

        const connected = yield* request(handler, "/mcp/demo/connect", tmp.directory, { method: "POST" })
        expect(connected.status).toBe(200)
        expect(yield* json(connected)).toBe(true)

        const disconnected = yield* request(handler, "/mcp/demo/disconnect", tmp.directory, { method: "POST" })
        expect(disconnected.status).toBe(200)
        expect(yield* json(disconnected)).toBe(true)
      }),
    {
      config: {
        mcp: {
          demo: {
            type: "local",
            command: ["echo", "demo"],
            enabled: false,
          },
        },
      },
    },
  )

  it.instance(
    "serves deterministic OAuth endpoints",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const handler = HttpApiApp.webHandler()
        const start = yield* request(handler, "/mcp/demo/auth", tmp.directory, { method: "POST" })
        expect(start.status).toBe(400)

        const authenticate = yield* request(handler, "/mcp/demo/auth/authenticate", tmp.directory, { method: "POST" })
        expect(authenticate.status).toBe(400)

        const removed = yield* request(handler, "/mcp/demo/auth", tmp.directory, { method: "DELETE" })
        expect(removed.status).toBe(200)
        expect(yield* json(removed)).toEqual({ success: true })
      }),
    {
      config: {
        mcp: {
          demo: {
            type: "local",
            command: ["echo", "demo"],
            enabled: false,
          },
        },
      },
    },
  )

  it.instance(
    "returns unsupported OAuth error responses",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const dir = tmp.directory
        const headers = { "x-opencode-directory": dir }

        yield* Effect.forEach(["/mcp/demo/auth", "/mcp/demo/auth/authenticate"], (path) =>
          Effect.gen(function* () {
            const response = yield* readResponse({ app: app(), path, headers })

            expect(response).toEqual({
              status: 400,
              body: JSON.stringify({ error: "MCP server demo does not support OAuth" }),
            })
          }),
        )
      }),
    {
      config: {
        formatter: false,
        lsp: false,
        mcp: {
          demo: {
            type: "local",
            command: ["echo", "demo"],
            enabled: false,
          },
        },
      },
    },
  )

  it.instance(
    "returns typed not found errors for missing MCP servers",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const handler = HttpApiApp.webHandler()

        for (const input of [
          { method: "POST", route: "/mcp/missing/auth" },
          { method: "POST", route: "/mcp/missing/auth/authenticate" },
          { method: "POST", route: "/mcp/missing/auth/callback", body: JSON.stringify({ code: "code" }) },
          { method: "DELETE", route: "/mcp/missing/auth" },
          { method: "POST", route: "/mcp/missing/connect" },
          { method: "POST", route: "/mcp/missing/disconnect" },
        ]) {
          const response = yield* request(handler, input.route, tmp.directory, {
            method: input.method,
            headers: input.body ? { "content-type": "application/json" } : undefined,
            body: input.body,
          })

          expect(response.status).toBe(404)
          expect(yield* json(response)).toEqual({
            _tag: "McpServerNotFoundError",
            name: "missing",
            message: "MCP server not found: missing",
          })
        }
      }),
    { config: { mcp: {} } },
  )
})
