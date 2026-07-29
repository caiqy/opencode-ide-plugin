import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Context, Effect, Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import path from "path"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { FilePaths } from "../../src/server/routes/instance/httpapi/groups/file"
import { GlobalPaths } from "../../src/server/routes/instance/httpapi/groups/global"
import { InstancePaths } from "../../src/server/routes/instance/httpapi/groups/instance"
import { disposeMiddleware } from "../../src/server/routes/instance/httpapi/lifecycle"
import { InstanceBootstrap } from "../../src/project/bootstrap-service"
import { InstanceStore } from "../../src/project/instance-store"
import { tmpdir } from "../fixture/fixture"

const context = Context.empty() as Context.Context<unknown>
const noopBootstrap = Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void }))
const web = HttpRouter.toWebHandler(
  HttpApiApp.createRoutes(undefined, [[InstanceStore.bootstrapNode, noopBootstrap]]),
  { disableLogger: true, middleware: disposeMiddleware },
)

function request(directory: string | undefined, route: string, query?: Record<string, string>, init?: RequestInit) {
  const url = new URL(`http://localhost${route}`)
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value)
  const headers = new Headers(init?.headers)
  if (directory) headers.set("x-opencode-directory", directory)
  return web.handler(new Request(url, { ...init, headers }), context)
}

function app(directory: string) {
  return {
    [Symbol.asyncDispose]: async () => void (await request(directory, InstancePaths.dispose, undefined, { method: "POST" })),
    request(route: string, query?: Record<string, string>) {
      return request(directory, route, query)
    },
  }
}

beforeAll(async () => {
  const response = await request(undefined, GlobalPaths.health)
  if (!response.ok) throw new Error(`failed to initialize file HttpApi test handler: ${response.status}`)
})

afterAll(() => web.dispose())

describe("file HttpApi", () => {
  test("serves read endpoints", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    await Bun.write(path.join(tmp.path, "hello.txt"), "hello")
    await using server = app(tmp.path)

    const [list, content, status] = await Promise.all([
      server.request(FilePaths.list, { path: "." }),
      server.request(FilePaths.content, { path: "hello.txt" }),
      server.request(FilePaths.status),
    ])

    expect(list.status).toBe(200)
    expect(await list.json()).toContainEqual(
      expect.objectContaining({ name: "hello.txt", path: "hello.txt", type: "file" }),
    )

    expect(content.status).toBe(200)
    expect(await content.json()).toMatchObject({ type: "text", content: "hello" })

    expect(status.status).toBe(200)
    expect(await status.json()).toEqual([])
  })

  test("serves search endpoints", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    await Bun.write(path.join(tmp.path, "hello.txt"), "needle")
    await using server = app(tmp.path)

    const [text, symbols] = await Promise.all([
      server.request(FilePaths.findText, { pattern: "needle" }),
      server.request(FilePaths.findSymbol, { query: "hello" }),
    ])
    const files = await server.request(FilePaths.findFile, { query: "hello", type: "file" })
    const filesBody = await files.json()

    expect(text.status).toBe(200)
    expect(await text.json()).toContainEqual(expect.objectContaining({ line_number: 1 }))

    expect(files.status).toBe(200)
    expect(filesBody).toContain("hello.txt")

    expect(symbols.status).toBe(200)
    expect(await symbols.json()).toEqual([])
  })
})
