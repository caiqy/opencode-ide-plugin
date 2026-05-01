import { afterEach, describe, expect, test } from "bun:test"
import type { UpgradeWebSocket } from "hono/ws"
import { Effect } from "effect"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Bus } from "../../src/bus"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Instance } from "../../src/project/instance"
import { createApp } from "../../src/server/server"
import { InstanceRoutes } from "../../src/server/routes/instance"
import { SessionPaths, setForegroundReadTestGate } from "../../src/server/routes/instance/httpapi/session"
import { setStandardForegroundReadTestGate } from "../../src/server/routes/instance/session"
import { MessageV2 } from "../../src/session/message-v2"
import { Session } from "../../src/session"
import { MessageID, type SessionID } from "../../src/session/schema"
import { SessionSummaryScheduler } from "../../src/session/summary-scheduler"
import { Log } from "../../src/util"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

const original = Flag.OPENCODE_EXPERIMENTAL_HTTPAPI
const websocket = (() => () => new Response(null, { status: 501 })) as unknown as UpgradeWebSocket

function app() {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = true
  return InstanceRoutes(websocket)
}

function standardApp() {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = false
  return createApp({})
}

function runSession<A, E>(fx: Effect.Effect<A, E, Session.Service>) {
  return Effect.runPromise(fx.pipe(Effect.provide(Session.defaultLayer)))
}

async function createSession(directory: string, input?: Session.CreateInput) {
  return Instance.provide({
    directory,
    fn: async () => runSession(Session.Service.use((svc) => svc.create(input))),
  })
}

async function createUserMessage(directory: string, sessionID: SessionID, time: number) {
  const id = MessageID.ascending()
  await Instance.provide({
    directory,
    fn: async () =>
      runSession(
        Session.Service.use((svc) =>
          svc.updateMessage({
            id,
            sessionID,
            role: "user",
            time: { created: time },
            agent: "test",
            model: { providerID: "test", modelID: "test" },
            tools: {},
            mode: "",
          } as unknown as never),
        ),
      ),
  })
  return id
}

async function createOlderMessagesRequest(directory: string, sessionID: SessionID) {
  const olderID = await createUserMessage(directory, sessionID, Date.now())
  await createUserMessage(directory, sessionID, Date.now() + 1)
  const page = await Instance.provide({
    directory,
    fn: async () => MessageV2.page({ sessionID, limit: 1 }),
  })
  if (!page.cursor) {
    throw new Error("expected paged messages cursor")
  }
  const url = new URL(SessionPaths.messages.replace(":sessionID", sessionID), "http://localhost")
  url.searchParams.set("before", page.cursor)
  url.searchParams.set("limit", "1")
  return { path: url.pathname + url.search, olderID }
}

async function runBus<A, E>(directory: string, fx: Effect.Effect<A, E, Bus.Service>) {
  return Instance.provide({
    directory,
    fn: async () => AppRuntime.runPromise(fx),
  })
}

async function runSummaryScheduler<A, E>(directory: string, fx: Effect.Effect<A, E, SessionSummaryScheduler.Service>) {
  return Instance.provide({
    directory,
    fn: async () => AppRuntime.runPromise(fx.pipe(Effect.provide(SessionSummaryScheduler.defaultLayer))),
  })
}

async function waitFor(check: () => boolean, timeout = 1000) {
  const startedAt = Date.now()
  while (!check()) {
    if (Date.now() - startedAt >= timeout) {
      throw new Error("timed out waiting for condition")
    }
    await Bun.sleep(10)
  }
}

async function assertVisibilitySync(
  input: {
    directory: string
    request: (sessionIDs: SessionID[]) => Response | Promise<Response>
  },
) {
  const session = await createSession(input.directory, { title: "visible" })
  const statuses: string[] = []
  const off = await runBus(
    input.directory,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      return yield* bus.subscribeCallback(Session.Event.DiffStatus, (event) => {
        if (event.properties.sessionID !== session.id) return
        statuses.push(event.properties.status)
      })
    }),
  )

  try {
    await runSummaryScheduler(
      input.directory,
      SessionSummaryScheduler.Service.use((svc) => svc.syncVisible([])),
    )
    await runSummaryScheduler(
      input.directory,
      SessionSummaryScheduler.Service.use((svc) =>
        svc.markDirty({
          sessionID: session.id,
          messageID: MessageID.ascending(),
          version: 1,
        }),
      ),
    )
    await runSummaryScheduler(input.directory, SessionSummaryScheduler.Service.use((svc) => svc.flush()))

    expect(statuses).toEqual([])

    const response = await json<{ sessionIDs: SessionID[] }>(await input.request([session.id]))
    expect(response).toEqual({ sessionIDs: [session.id] })

    await runSummaryScheduler(input.directory, SessionSummaryScheduler.Service.use((svc) => svc.flush()))
    await waitFor(() => statuses.includes("idle"))
    expect(statuses).toEqual(["scheduled", "running", "idle"])
  } finally {
    off()
  }
}

async function assertForegroundReadBlocksDirtyDiff(
  input: {
    directory: string
    kind: "messages" | "diff"
    setGate: (
      next?: (input: { kind: "messages" | "diff"; sessionID: SessionID }) => void | Promise<void>,
    ) => void
    request: (sessionID: SessionID) => Response | Promise<Response>
    assertResponse: (response: Response) => Promise<void>
  },
) {
  const session = await createSession(input.directory, { title: "visible" })
  const statuses: string[] = []
  const off = await runBus(
    input.directory,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      return yield* bus.subscribeCallback(Session.Event.DiffStatus, (event) => {
        if (event.properties.sessionID !== session.id) return
        statuses.push(event.properties.status)
      })
    }),
  )
  const release = Promise.withResolvers<void>()
  let started = false
  input.setGate(async (current) => {
    if (current.sessionID !== session.id || current.kind !== input.kind) return
    started = true
    await release.promise
  })

  try {
    await runSummaryScheduler(
      input.directory,
      SessionSummaryScheduler.Service.use((svc) => svc.syncVisible([session.id])),
    )

    const response = Promise.resolve().then(() => input.request(session.id))
    let responded = false
    void response.then(
      () => {
        responded = true
      },
      () => {
        responded = true
      },
    )
    await waitFor(() => started || responded, 1000)
    if (!started) {
      const resolved = await response
      throw new Error(`foreground gate was not hit before response: ${resolved.status} ${await resolved.text()}`)
    }

    await runSummaryScheduler(
      input.directory,
      SessionSummaryScheduler.Service.use((svc) =>
        svc.markDirty({
          sessionID: session.id,
          messageID: MessageID.ascending(),
          version: 1,
        }),
      ),
    )
    await runSummaryScheduler(input.directory, SessionSummaryScheduler.Service.use((svc) => svc.flush()))

    expect(statuses).toEqual([])

    release.resolve()

    const resolved = await response
    await input.assertResponse(resolved)

    await runSummaryScheduler(input.directory, SessionSummaryScheduler.Service.use((svc) => svc.flush()))
    await waitFor(() => statuses.includes("idle"))
    expect(statuses).toEqual(["scheduled", "running", "idle"])
  } finally {
    release.resolve()
    input.setGate(undefined)
    off()
  }
}

async function assertDelayedVisibilityKeepsDirtyDiffPendingUntilForegroundReadAndSync(
  input: {
    directory: string
    kind: "messages" | "diff"
    setGate: (
      next?: (input: { kind: "messages" | "diff"; sessionID: SessionID }) => void | Promise<void>,
    ) => void
    request: (sessionID: SessionID) => Response | Promise<Response>
    visibilityRequest: (sessionIDs: SessionID[]) => Response | Promise<Response>
    assertResponse: (response: Response) => Promise<void>
  },
) {
  const session = await createSession(input.directory, { title: "visible" })
  const statuses: string[] = []
  const off = await runBus(
    input.directory,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      return yield* bus.subscribeCallback(Session.Event.DiffStatus, (event) => {
        if (event.properties.sessionID !== session.id) return
        statuses.push(event.properties.status)
      })
    }),
  )
  const release = Promise.withResolvers<void>()
  let started = false
  input.setGate(async (current) => {
    if (current.sessionID !== session.id || current.kind !== input.kind) return
    started = true
    await release.promise
  })

  try {
    await runSummaryScheduler(
      input.directory,
      SessionSummaryScheduler.Service.use((svc) => svc.syncVisible([])),
    )

    const response = Promise.resolve().then(() => input.request(session.id))
    let responded = false
    void response.then(
      () => {
        responded = true
      },
      () => {
        responded = true
      },
    )
    await waitFor(() => started || responded, 1000)
    if (!started) {
      const resolved = await response
      throw new Error(`foreground gate was not hit before response: ${resolved.status} ${await resolved.text()}`)
    }

    await runSummaryScheduler(
      input.directory,
      SessionSummaryScheduler.Service.use((svc) =>
        svc.markDirty({
          sessionID: session.id,
          messageID: MessageID.ascending(),
          version: 1,
        }),
      ),
    )
    await runSummaryScheduler(input.directory, SessionSummaryScheduler.Service.use((svc) => svc.flush()))

    expect(statuses).toEqual([])
    expect(responded).toBe(false)

    release.resolve()

    const resolved = await response
    await input.assertResponse(resolved)

    await runSummaryScheduler(input.directory, SessionSummaryScheduler.Service.use((svc) => svc.flush()))
    expect(statuses).toEqual([])

    const visibility = await json(await input.visibilityRequest([session.id]))
    expect(visibility).toEqual({ sessionIDs: [session.id] })

    await runSummaryScheduler(input.directory, SessionSummaryScheduler.Service.use((svc) => svc.flush()))
    await waitFor(() => statuses.includes("idle"))
    expect(statuses).toEqual(["scheduled", "running", "idle"])
  } finally {
    release.resolve()
    input.setGate(undefined)
    off()
  }
}

async function json<T>(response: Response) {
  if (response.status !== 200) throw new Error(await response.text())
  return (await response.json()) as T
}

afterEach(async () => {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = original
  await Instance.disposeAll()
  await resetDatabase()
})

describe("session HttpApi", () => {
  test("serves visibility endpoint through Hono bridge", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const headers = { "x-opencode-directory": tmp.path, "content-type": "application/json" }
    await assertVisibilitySync({
      directory: tmp.path,
      request: (sessionIDs) =>
        app().request(SessionPaths.visibility, {
          method: "PUT",
          headers,
          body: JSON.stringify({ sessionIDs }),
        }),
    })
  })

  test("serves visibility endpoint through standard Hono routes", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const headers = { "x-opencode-directory": tmp.path, "content-type": "application/json" }
    await assertVisibilitySync({
      directory: tmp.path,
      request: (sessionIDs) =>
        standardApp().request(SessionPaths.visibility, {
          method: "PUT",
          headers,
          body: JSON.stringify({ sessionIDs }),
        }),
    })
  })

  test("bridge messages request keeps dirty diff pending until foreground read finishes", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const headers = { "x-opencode-directory": tmp.path }
    await assertForegroundReadBlocksDirtyDiff({
      directory: tmp.path,
      kind: "messages",
      setGate: setForegroundReadTestGate,
      request: (sessionID) =>
        app().request(SessionPaths.messages.replace(":sessionID", sessionID), {
          method: "GET",
          headers,
        }),
      assertResponse: async (response) => {
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual([])
      },
    })
  })

  test("bridge diff request keeps dirty diff pending until foreground read finishes", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const headers = { "x-opencode-directory": tmp.path }
    await assertForegroundReadBlocksDirtyDiff({
      directory: tmp.path,
      kind: "diff",
      setGate: setForegroundReadTestGate,
      request: (sessionID) =>
        app().request(SessionPaths.diff.replace(":sessionID", sessionID), {
          method: "GET",
          headers,
        }),
      assertResponse: async (response) => {
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual([])
      },
    })
  })

  test("standard messages request keeps dirty diff pending until foreground read finishes", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const headers = { "x-opencode-directory": tmp.path }
    await assertForegroundReadBlocksDirtyDiff({
      directory: tmp.path,
      kind: "messages",
      setGate: setStandardForegroundReadTestGate,
      request: (sessionID) =>
        standardApp().request(SessionPaths.messages.replace(":sessionID", sessionID), {
          method: "GET",
          headers,
        }),
      assertResponse: async (response) => {
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual([])
      },
    })
  })

  test("standard diff request keeps dirty diff pending until foreground read finishes", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const headers = { "x-opencode-directory": tmp.path }
    await assertForegroundReadBlocksDirtyDiff({
      directory: tmp.path,
      kind: "diff",
      setGate: setStandardForegroundReadTestGate,
      request: (sessionID) =>
        standardApp().request(SessionPaths.diff.replace(":sessionID", sessionID), {
          method: "GET",
          headers,
        }),
      assertResponse: async (response) => {
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual([])
        },
      })
  })

  test("bridge older messages request keeps dirty diff pending until foreground read finishes", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const headers = { "x-opencode-directory": tmp.path }
    let olderID: MessageID | undefined
    await assertForegroundReadBlocksDirtyDiff({
      directory: tmp.path,
      kind: "messages",
      setGate: setForegroundReadTestGate,
      request: async (sessionID) => {
        const prepared = await createOlderMessagesRequest(tmp.path, sessionID)
        olderID = prepared.olderID
        return app().request(prepared.path, {
          method: "GET",
          headers,
        })
      },
      assertResponse: async (response) => {
        expect(response.status).toBe(200)
        expect((await response.json()) as Array<{ info: { id: MessageID } }>).toEqual([
          expect.objectContaining({ info: expect.objectContaining({ id: olderID }) }),
        ])
      },
    })
  })

  test("standard older messages request keeps dirty diff pending until foreground read finishes", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const headers = { "x-opencode-directory": tmp.path }
    let olderID: MessageID | undefined
    await assertForegroundReadBlocksDirtyDiff({
      directory: tmp.path,
      kind: "messages",
      setGate: setStandardForegroundReadTestGate,
      request: async (sessionID) => {
        const prepared = await createOlderMessagesRequest(tmp.path, sessionID)
        olderID = prepared.olderID
        return standardApp().request(prepared.path, {
          method: "GET",
          headers,
        })
      },
      assertResponse: async (response) => {
        expect(response.status).toBe(200)
        expect((await response.json()) as Array<{ info: { id: MessageID } }>).toEqual([
          expect.objectContaining({ info: expect.objectContaining({ id: olderID }) }),
        ])
      },
    })
  })

  test("bridge first diff plus delayed visibility only resumes dirty diff after foreground read and sync", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const headers = { "x-opencode-directory": tmp.path, "content-type": "application/json" }
    await assertDelayedVisibilityKeepsDirtyDiffPendingUntilForegroundReadAndSync({
      directory: tmp.path,
      kind: "diff",
      setGate: setForegroundReadTestGate,
      request: (sessionID) =>
        app().request(SessionPaths.diff.replace(":sessionID", sessionID), {
          method: "GET",
          headers,
        }),
      visibilityRequest: (sessionIDs) =>
        app().request(SessionPaths.visibility, {
          method: "PUT",
          headers,
          body: JSON.stringify({ sessionIDs }),
        }),
      assertResponse: async (response) => {
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual([])
      },
    })
  })
})
