import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { Context, Effect } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { pollWithTimeout } from "../lib/effect"

const context = Context.empty() as Context.Context<unknown>

function app(directory: string) {
  const web = HttpRouter.toWebHandler(HttpApiApp.createRoutes(), { disableLogger: true })
  return {
    [Symbol.asyncDispose]: web.dispose,
    request() {
      return web.handler(
        new Request(new URL("/api/reference", "http://localhost"), {
          headers: { "x-opencode-directory": directory },
        }),
        context,
      )
    },
  }
}

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("reference HttpApi", () => {
  test("lists usable references resolved in the server workspace", async () => {
    await using tmp = await tmpdir({
      config: {
        formatter: false,
        lsp: false,
        references: {
          docs: "./docs",
          effect: { repository: "Effect-TS/effect", branch: "main" },
          bad: "not-a-repo",
        },
      },
    })
    await using server = app(tmp.path)

    const body = await Effect.runPromise(
      pollWithTimeout(
        Effect.promise(async () => {
          const response = await server.request()
          expect(response.status).toBe(200)
          const body = await response.json()
          return body.data.length === 0 ? undefined : body
        }),
        "references were not loaded",
      ),
    )
    expect(body).toMatchObject({ location: { directory: tmp.path } })
    expect(body.data).toEqual([
      {
        name: "docs",
        path: path.join(tmp.path, "docs"),
        source: {
          type: "local",
          path: path.join(tmp.path, "docs"),
        },
      },
      {
        name: "effect",
        path: path.join(Global.Path.repos, "github.com", "Effect-TS", "effect@main"),
        source: {
          type: "git",
          repository: "Effect-TS/effect",
          branch: "main",
        },
      },
    ])
  })
})
