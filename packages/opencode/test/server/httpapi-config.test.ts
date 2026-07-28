import { afterEach, describe, expect } from "bun:test"
import path from "path"
import { Server } from "../../src/server/server"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Effect, Fiber } from "effect"
import { Global } from "@opencode-ai/core/global"
import { Config } from "../../src/config/config"
import { InstanceRuntime } from "../../src/project/instance-runtime"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { it } from "../lib/effect"
import { waitGlobalBusEvent } from "./global-bus"

function app() {
  return Server.Default().app
}

function waitDisposed(directory: string) {
  return waitGlobalBusEvent({
    message: "timed out waiting for instance disposal",
    predicate: (event) => event.payload.type === "server.instance.disposed" && event.directory === directory,
  })
}

function waitGlobalDisposed() {
  return waitGlobalBusEvent({
    message: "timed out waiting for global disposal",
    predicate: (event) => event.payload.type === "global.disposed" && event.directory === "global",
  })
}

const tmpdirEffect = (options: Parameters<typeof tmpdir>[0]) =>
  Effect.acquireRelease(
    Effect.promise(() => tmpdir(options)),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  )

function withGlobalConfigDir<A, E, R>(dir: string, effect: Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.gen(function* () {
      const prev = Global.Path.config
      ;(Global.Path as { config: string }).config = dir
      yield* Effect.promise(() => AppRuntime.runPromise(Config.use.invalidate()))
      return prev
    }),
    () => effect,
    (prev) =>
      Effect.gen(function* () {
        ;(Global.Path as { config: string }).config = prev
        yield* Effect.promise(() => AppRuntime.runPromise(Config.use.invalidate()))
      }),
  )
}

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("config HttpApi", () => {
  it.live(
    "serves config update through the default server app",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({ config: { formatter: false, lsp: false } })
      const disposed = yield* waitDisposed(tmp.path).pipe(Effect.forkScoped({ startImmediately: true }))

      const response = yield* Effect.promise(() =>
        Promise.resolve(
          app().request("/config", {
            method: "PATCH",
            headers: {
              "content-type": "application/json",
              "x-opencode-directory": tmp.path,
            },
            body: JSON.stringify({ username: "patched-user", formatter: false, lsp: false }),
          }),
        ),
      )

      expect(response.status).toBe(200)
      expect(yield* Effect.promise(() => response.json())).toMatchObject({
        username: "patched-user",
        formatter: false,
        lsp: false,
      })
      yield* Fiber.join(disposed)
      expect(yield* Effect.promise(() => Bun.file(path.join(tmp.path, "config.json")).json())).toMatchObject({
        username: "patched-user",
        formatter: false,
        lsp: false,
      })
    }),
  )

  it.live(
    "serves config with active provider model status",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({
        config: {
          formatter: false,
          lsp: false,
          provider: {
            omniroute: {
              models: {
                "gpt-4o": {
                  status: "active",
                },
              },
            },
          },
        },
      })

      const response = yield* Effect.promise(() =>
        Promise.resolve(
          app().request("/config", {
            headers: {
              "x-opencode-directory": tmp.path,
            },
          }),
        ),
      )

      expect(response.status).toBe(200)
      expect(yield* Effect.promise(() => response.json())).toMatchObject({
        provider: {
          omniroute: {
            models: {
              "gpt-4o": {
                status: "active",
              },
            },
          },
        },
      })
    }),
  )

  it.live(
    "reloads active instance agent config after a lightweight global replace",
    Effect.gen(function* () {
      const global = yield* tmpdirEffect({
        init: (dir) =>
          Bun.write(
            path.join(dir, "opencode.jsonc"),
            JSON.stringify({
              agent: {
                build: {
                  description: "before",
                },
              },
            }),
          ),
      })
      const instance = yield* tmpdirEffect({ config: { formatter: false, lsp: false } })

      yield* withGlobalConfigDir(
        global.path,
        Effect.gen(function* () {
          const getAgents = () =>
            Effect.promise(() =>
              Promise.resolve(
                app().request("/agent", {
                  headers: {
                    "x-opencode-directory": instance.path,
                  },
                }),
              ).then((response) => response.json() as Promise<Array<{ name: string; description?: string }>>),
            )

          expect((yield* getAgents()).find((agent) => agent.name === "build")?.description).toBe("before")
          const active = yield* Effect.promise(() => InstanceRuntime.load({ directory: instance.path }))

          const response = yield* Effect.promise(() =>
            Promise.resolve(
              app().request("/global/config", {
                method: "PUT",
                headers: {
                  "content-type": "application/json",
                },
                body: JSON.stringify({
                  agent: {
                    build: {
                      description: "after",
                    },
                  },
                }),
              }),
            ),
          )

          expect(response.status).toBe(200)
          expect((yield* getAgents()).find((agent) => agent.name === "build")?.description).toBe("after")
          expect(yield* Effect.promise(() => InstanceRuntime.load({ directory: instance.path }))).toBe(active)
        }),
      )
    }),
  )

  it.live(
    "serves global config replace through the default server app",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({
        init: async (dir) => {
          await Bun.write(
            path.join(dir, "opencode.jsonc"),
            JSON.stringify({
              snapshot: true,
              provider: {
                openai: {
                  options: {
                    baseURL: "https://old.example.com/v1",
                    apiKey: "old-key",
                    timeout: 1000,
                  },
                  whitelist: ["old-model"],
                },
                stale: {
                  options: {
                    apiKey: "stale-key",
                  },
                },
              },
            }),
          )
        },
      })

      yield* withGlobalConfigDir(
        tmp.path,
        Effect.gen(function* () {
          const response = yield* Effect.promise(() =>
            Promise.resolve(
              app().request("/global/config", {
                method: "PUT",
                headers: {
                  "content-type": "application/json",
                },
                body: JSON.stringify({
                  provider: {
                    openai: {
                      options: {
                        timeout: 2000,
                      },
                      whitelist: ["new-model"],
                    },
                  },
                }),
              }),
            ),
          )

          expect(response.status).toBe(200)
          const body = (yield* Effect.promise(() => response.json())) as {
            snapshot?: boolean
            provider?: Record<string, { options?: Record<string, unknown>; whitelist?: string[] }>
          }
          expect(body.snapshot).toBeUndefined()
          expect(body.provider?.openai?.options?.baseURL).toBeUndefined()
          expect(body.provider?.openai?.options?.apiKey).toBeUndefined()
          expect(body.provider?.openai?.options?.timeout).toBe(2000)
          expect(body.provider?.openai?.whitelist).toEqual(["new-model"])
          expect(body.provider?.stale).toBeUndefined()

          const written = (yield* Effect.promise(() => Bun.file(path.join(tmp.path, "opencode.jsonc")).json())) as {
            snapshot?: boolean
            provider?: Record<string, { options?: Record<string, unknown>; whitelist?: string[] }>
          }
          expect(written.snapshot).toBeUndefined()
          expect(written.provider?.openai?.options?.baseURL).toBeUndefined()
          expect(written.provider?.openai?.options?.apiKey).toBeUndefined()
          expect(written.provider?.openai?.options?.timeout).toBe(2000)
          expect(written.provider?.openai?.whitelist).toEqual(["new-model"])
          expect(written.provider?.stale).toBeUndefined()
        }),
      )
    }),
  )

  it.live(
    "disposes instances when global config replace removes a heavy field",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({
        init: async (dir) => {
          await Bun.write(
            path.join(dir, "opencode.jsonc"),
            JSON.stringify({
              provider: {
                openai: {
                  options: {
                    apiKey: "old-key",
                  },
                },
              },
            }),
          )
        },
      })

      yield* withGlobalConfigDir(
        tmp.path,
        Effect.gen(function* () {
          const disposed = yield* waitGlobalDisposed().pipe(Effect.forkScoped)
          const response = yield* Effect.promise(() =>
            Promise.resolve(
              app().request("/global/config", {
                method: "PUT",
                headers: {
                  "content-type": "application/json",
                },
                body: JSON.stringify({ username: "replace-user" }),
              }),
            ),
          )

          expect(response.status).toBe(200)
          expect(yield* Effect.promise(() => response.json())).toMatchObject({ username: "replace-user" })
          yield* Fiber.join(disposed)
        }),
      )
    }),
  )

  it.live(
    "serves provider catalog models without applying config whitelist",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({
        config: {
          formatter: false,
          lsp: false,
          provider: {
            anthropic: {
              whitelist: ["missing-model-for-httpapi-test"],
            },
          },
        },
      })

      const response = yield* Effect.promise(() =>
        Promise.resolve(
          app().request("/config/providers/anthropic/models", {
            headers: {
              "x-opencode-directory": tmp.path,
            },
          }),
        ),
      )

      expect(response.status).toBe(200)
      const body = (yield* Effect.promise(() => response.json())) as {
        providerID: string
        models: Array<{ id: string; name: string; status: string }>
      }
      expect(body.providerID).toBe("anthropic")
      expect(body.models.length).toBeGreaterThan(1)
    }),
  )
})
