import { afterEach, describe, expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { Effect, Layer, ManagedRuntime } from "effect"
import * as DateTime from "effect/DateTime"
import { Flag } from "@opencode-ai/core/flag/flag"
import { SessionMessage } from "@opencode-ai/core/session-message"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import * as Log from "@opencode-ai/core/util/log"
import { memoMap } from "@opencode-ai/core/effect/memo-map"
import { eq } from "drizzle-orm"
import { Bus } from "../../src/bus"
import { registerAdapter } from "../../src/control-plane/adapters"
import type { WorkspaceAdapter } from "../../src/control-plane/types"
import { Workspace } from "../../src/control-plane/workspace"
import { AppLayer, AppRuntime } from "../../src/effect/app-runtime"
import { attach } from "../../src/effect/run-service"
import { PermissionID } from "../../src/permission/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { InstanceBootstrap as InstanceBootstrapService } from "../../src/project/bootstrap-service"
import { Instance } from "../../src/project/instance"
import { InstanceStore } from "../../src/project/instance-store"
import { Project } from "../../src/project/project"
import { Server, createApp } from "../../src/server/server"
import { setForegroundReadTestGate } from "../../src/server/routes/instance/httpapi/session"
import { SessionPaths } from "../../src/server/routes/instance/httpapi/groups/session"
import { setStandardForegroundReadTestGate } from "../../src/server/routes/instance/session"
import { MessageV2 } from "../../src/session/message-v2"
import { Session } from "../../src/session/session"
import { PartID, MessageID, SessionID, type SessionID as SessionIDType } from "../../src/session/schema"
import { SessionSummaryScheduler } from "../../src/session/summary-scheduler"
import { Database } from "../../src/storage/db"
import { SessionMessageTable, SessionTable } from "../../src/session/session.sql"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, TestInstance, tmpdir } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

void Log.init({ print: false })

const originalWorkspaces = Flag.OPENCODE_EXPERIMENTAL_WORKSPACES
const workspaceLayer = Workspace.defaultLayer.pipe(
  Layer.provide(InstanceStore.defaultLayer),
  Layer.provide(InstanceBootstrap.defaultLayer),
)
const instanceStoreLayer = InstanceStore.defaultLayer.pipe(
  Layer.provide(
    Layer.succeed(InstanceBootstrapService.Service, InstanceBootstrapService.Service.of({ run: Effect.void })),
  ),
)
const it = testEffect(Layer.mergeAll(instanceStoreLayer, Project.defaultLayer, Session.defaultLayer, workspaceLayer))
const summaryRuntime = ManagedRuntime.make(SessionSummaryScheduler.defaultLayer.pipe(Layer.provideMerge(AppLayer)), {
  memoMap,
})

function app() {
  return Server.Default().app
}

function bridgeApp() {
  return createApp({})
}

function pathFor(template: string, params: Record<string, string>) {
  return Object.entries(params).reduce((result, [key, value]) => result.replace(`:${key}`, value), template)
}

function runSession<A, E>(fx: Effect.Effect<A, E, Session.Service>) {
  return Effect.runPromise(fx.pipe(Effect.provide(Session.defaultLayer)))
}

function createSession(input?: Session.CreateInput) {
  return Session.Service.use((svc) => svc.create(input))
}

async function createSessionInDirectory(directory: string, input?: Session.CreateInput) {
  return Instance.provide({
    directory,
    fn: () => Session.create(input),
  })
}

function createTextMessage(sessionID: SessionIDType, text: string) {
  return Effect.gen(function* () {
    const svc = yield* Session.Service
    const info = yield* svc.updateMessage({
      id: MessageID.ascending(),
      role: "user",
      sessionID,
      agent: "build",
      model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test") },
      time: { created: Date.now() },
    })
    const part = yield* svc.updatePart({
      id: PartID.ascending(),
      sessionID,
      messageID: info.id,
      type: "text",
      text,
    })
    return { info, part }
  })
}

async function createUserMessage(directory: string, sessionID: SessionIDType, time: number) {
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
            model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test") },
          }),
        ),
      ),
  })
  return id
}

const localAdapter = (directory: string): WorkspaceAdapter => ({
  name: "Local Test",
  description: "Create a local test workspace",
  configure: (info) => ({ ...info, name: "local-test", directory }),
  create: async () => {
    await mkdir(directory, { recursive: true })
  },
  async remove() {},
  target: () => ({ type: "local" as const, directory }),
})

const createLocalWorkspace = (input: { projectID: Project.Info["id"]; type: string; directory: string }) =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      registerAdapter(input.projectID, input.type, localAdapter(input.directory))
      return yield* Workspace.Service.use((svc) =>
        svc.create({
          type: input.type,
          branch: null,
          extra: null,
          projectID: input.projectID,
        }),
      )
    }),
    (info) => Workspace.Service.use((svc) => svc.remove(info.id)).pipe(Effect.ignore),
  )

const insertLegacyAssistantMessage = (sessionID: SessionIDType) =>
  Effect.sync(() => {
    const message = new SessionMessage.Assistant({
      id: SessionMessage.ID.create(),
      type: "assistant",
      agent: "build",
      model: {
        id: ModelV2.ID.make("model"),
        providerID: ProviderV2.ID.make("provider"),
        variant: ModelV2.VariantID.make("default"),
      },
      time: { created: DateTime.makeUnsafe(1) },
      content: [],
    })
    Database.use((db) =>
      db
        .insert(SessionMessageTable)
        .values([
          {
            id: message.id,
            session_id: sessionID,
            type: message.type,
            time_created: 1,
            data: {
              time: { created: 1 },
              agent: message.agent,
              model: message.model,
              content: message.content,
            } as NonNullable<(typeof SessionMessageTable.$inferInsert)["data"]>,
          },
        ])
        .run(),
    )
  })

const setLegacySummaryDiff = (sessionID: SessionIDType) =>
  Effect.sync(() =>
    Database.use((db) =>
      db
        .update(SessionTable)
        .set({
          summary_additions: 1,
          summary_deletions: 0,
          summary_files: 1,
          summary_diffs: [{ additions: 1, deletions: 0 }],
        })
        .where(eq(SessionTable.id, sessionID))
        .run(),
    ),
  )

const getWorkspaceID = (sessionID: SessionIDType) =>
  Effect.sync(() =>
    Database.use((db) =>
      db
        .select({ workspaceID: SessionTable.workspace_id })
        .from(SessionTable)
        .where(eq(SessionTable.id, sessionID))
        .get(),
    ),
  )

const clearSessionPath = (sessionID: SessionIDType) =>
  Effect.sync(() =>
    Database.use((db) => db.update(SessionTable).set({ path: null }).where(eq(SessionTable.id, sessionID)).run()),
  )

function request(path: string, init?: RequestInit) {
  return Effect.promise(async () => app().request(path, init))
}

function json<T>(response: Response) {
  return Effect.promise(async () => {
    if (response.status !== 200) throw new Error(await response.text())
    return (await response.json()) as T
  })
}

async function createOlderMessagesRequest(directory: string, sessionID: SessionIDType) {
  const olderID = await createUserMessage(directory, sessionID, Date.now())
  await createUserMessage(directory, sessionID, Date.now() + 1)
  const page = await Instance.provide({
    directory,
    fn: async () => AppRuntime.runPromise(MessageV2.page({ sessionID, limit: 1 })),
  })
  if (!page.cursor) throw new Error("expected paged messages cursor")
  const url = new URL(pathFor(SessionPaths.messages, { sessionID }), "http://localhost")
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
    fn: async () => summaryRuntime.runPromise(attach(fx)),
  })
}

async function waitFor(check: () => boolean, timeout = 1000) {
  const startedAt = Date.now()
  while (!check()) {
    if (Date.now() - startedAt >= timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

async function assertForegroundReadBlocksDirtyDiff(input: {
  directory: string
  kind: "messages" | "diff"
  setGate: (next?: (input: { kind: "messages" | "diff"; sessionID: SessionIDType }) => void | Promise<void>) => void
  request: (sessionID: SessionIDType) => Response | Promise<Response>
  assertResponse: (response: Response) => Promise<void>
}) {
  const session = await createSessionInDirectory(input.directory, { title: "visible" })
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

function responseJson(response: Response) {
  return Effect.promise(() => response.json())
}

function requestJson<T>(path: string, init?: RequestInit) {
  return request(path, init).pipe(Effect.flatMap(json<T>))
}

afterEach(async () => {
  Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = originalWorkspaces
  await disposeAllInstances()
  await resetDatabase()
})

describe("session HttpApi", () => {
  test("summary scheduler runtime can initialize after loading httpapi public modules", async () => {
    // This only reproduces with a fresh module loader: the current test process has
    // already evaluated parts of the graph, so we need a clean process plus imports
    // in the failing order to hit the initialization cycle.
    const okMarker = "__SUMMARY_RUNTIME_OK__"
    const probe = [
      "await import('./src/server/routes/instance/httpapi/public')",
      "const { Effect, Layer, ManagedRuntime } = await import('effect')",
      "const { memoMap } = await import('@opencode-ai/core/effect/memo-map')",
      "const { AppLayer } = await import('./src/effect/app-runtime')",
      "const { SessionSummaryScheduler } = await import('./src/session/summary-scheduler')",
      "const runtime = ManagedRuntime.make(SessionSummaryScheduler.defaultLayer.pipe(Layer.provideMerge(AppLayer)), { memoMap })",
      `try { await runtime.runPromise(SessionSummaryScheduler.Service.use((svc) => Effect.succeed(typeof svc.flush))); console.log('${okMarker}') } finally { await runtime.dispose() }`,
    ].join("; ")

    const proc = Bun.spawn([process.execPath, "-e", probe], {
      cwd: path.resolve(import.meta.dir, "..", ".."),
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    if (exitCode !== 0) {
      throw new Error(stderr.trim() || stdout.trim() || `summary runtime probe exited with ${exitCode}`)
    }

    expect(stdout).toContain(okMarker)
  })

  test("bridge messages request keeps dirty diff pending until foreground read finishes", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const headers = { "x-opencode-directory": tmp.path }
    await assertForegroundReadBlocksDirtyDiff({
      directory: tmp.path,
      kind: "messages",
      setGate: setForegroundReadTestGate,
      request: (sessionID) =>
        bridgeApp().request(pathFor(SessionPaths.messages, { sessionID }), {
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
        bridgeApp().request(pathFor(SessionPaths.diff, { sessionID }), {
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
        app().request(pathFor(SessionPaths.messages, { sessionID }), {
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
        app().request(pathFor(SessionPaths.diff, { sessionID }), {
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
        return bridgeApp().request(prepared.path, {
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

  it.instance(
    "returns declared not found errors for read routes",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-opencode-directory": test.directory }
        const missingSession = SessionID.descending()
        const missingSessionBody = {
          name: "NotFoundError",
          data: { message: `Session not found: ${missingSession}` },
        }

        const get = yield* request(pathFor(SessionPaths.get, { sessionID: missingSession }), { headers })
        expect(get.status).toBe(404)
        expect(yield* responseJson(get)).toEqual(missingSessionBody)

        const children = yield* request(pathFor(SessionPaths.children, { sessionID: missingSession }), { headers })
        expect(children.status).toBe(404)
        expect(yield* responseJson(children)).toEqual(missingSessionBody)

        const todo = yield* request(pathFor(SessionPaths.todo, { sessionID: missingSession }), { headers })
        expect(todo.status).toBe(404)
        expect(yield* responseJson(todo)).toEqual(missingSessionBody)

        const messages = yield* request(pathFor(SessionPaths.messages, { sessionID: missingSession }), { headers })
        expect(messages.status).toBe(404)
        expect(yield* responseJson(messages)).toEqual(missingSessionBody)

        const remove = yield* request(pathFor(SessionPaths.remove, { sessionID: missingSession }), {
          headers,
          method: "DELETE",
        })
        expect(remove.status).toBe(404)
        expect(yield* responseJson(remove)).toEqual(missingSessionBody)

        const prompt = yield* request(pathFor(SessionPaths.prompt, { sessionID: missingSession }), {
          headers: { ...headers, "content-type": "application/json" },
          method: "POST",
          body: JSON.stringify({ agent: "build", noReply: true, parts: [{ type: "text", text: "hello" }] }),
        })
        expect(prompt.status).toBe(404)
        expect(yield* responseJson(prompt)).toEqual(missingSessionBody)

        const abort = yield* request(pathFor(SessionPaths.abort, { sessionID: missingSession }), {
          headers,
          method: "POST",
        })
        expect(abort.status).toBe(200)
        expect(yield* responseJson(abort)).toBe(true)

        const session = yield* createSession({ title: "missing message" })
        const missingMessage = MessageID.ascending()
        const message = yield* request(pathFor(SessionPaths.message, { sessionID: session.id, messageID: missingMessage }), {
          headers,
        })
        expect(message.status).toBe(404)
        expect(yield* responseJson(message)).toEqual({
          name: "NotFoundError",
          data: { message: `Message not found: ${missingMessage}` },
        })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "serves read routes",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-opencode-directory": test.directory }
        const parent = yield* createSession({ title: "parent" })
        const child = yield* createSession({ title: "child", parentID: parent.id })
        const message = yield* createTextMessage(parent.id, "hello")
        yield* createTextMessage(parent.id, "world")

        const listed = yield* requestJson<Session.Info[]>(`${SessionPaths.list}?roots=true`, { headers })
        expect(listed.map((item) => item.id)).toContain(parent.id)
        expect(Object.hasOwn(listed[0]!, "parentID")).toBe(false)

        expect(yield* requestJson<Record<string, unknown>>(SessionPaths.status, { headers })).toEqual({})

        expect(yield* requestJson<Session.Info>(pathFor(SessionPaths.get, { sessionID: parent.id }), { headers })).toMatchObject({
          id: parent.id,
          title: "parent",
        })

        expect(
          (yield* requestJson<Session.Info[]>(pathFor(SessionPaths.children, { sessionID: parent.id }), {
            headers,
          })).map((item) => item.id),
        ).toEqual([child.id])

        expect(yield* requestJson<unknown[]>(pathFor(SessionPaths.todo, { sessionID: parent.id }), { headers })).toEqual([])

        expect(yield* requestJson<unknown[]>(pathFor(SessionPaths.diff, { sessionID: parent.id }), { headers })).toEqual([])

        const messages = yield* request(`${pathFor(SessionPaths.messages, { sessionID: parent.id })}?limit=1`, { headers })
        const messagePage = yield* json<MessageV2.WithParts[]>(messages)
        const nextCursor = messages.headers.get("x-next-cursor")
        expect(nextCursor).toBeTruthy()
        expect(messagePage[0]?.parts[0]).toMatchObject({ type: "text" })

        expect(
          (yield* request(`${pathFor(SessionPaths.messages, { sessionID: parent.id })}?before=${nextCursor}`, { headers })).status,
        ).toBe(400)
        expect(
          (yield* request(`${pathFor(SessionPaths.messages, { sessionID: parent.id })}?limit=1&before=invalid`, {
            headers,
          })).status,
        ).toBe(400)

        expect(
          yield* requestJson<MessageV2.WithParts>(pathFor(SessionPaths.message, { sessionID: parent.id, messageID: message.info.id }), {
            headers,
          }),
        ).toMatchObject({ info: { id: message.info.id } })

        yield* insertLegacyAssistantMessage(parent.id)

        expect((yield* requestJson<{ items: SessionMessage.Message[] }>(`/api/session/${parent.id}/message`, { headers })).items).toMatchObject([
          { type: "assistant" },
        ])
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "serves sessions with migrated summary diffs missing file details",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const session = yield* createSession({ title: "legacy diff" })
        yield* setLegacySummaryDiff(session.id)

        const response = yield* request(pathFor(SessionPaths.get, { sessionID: session.id }), {
          headers: { "x-opencode-directory": test.directory },
        })

        expect(response.status).toBe(200)
        expect((yield* json<Session.Info>(response)).summary?.diffs).toEqual([{ additions: 1, deletions: 0 }])
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "serves lifecycle mutation routes",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }

        const createdEmpty = yield* requestJson<Session.Info>(SessionPaths.create, {
          method: "POST",
          headers,
        })
        expect(createdEmpty.id).toBeTruthy()

        const created = yield* requestJson<Session.Info>(SessionPaths.create, {
          method: "POST",
          headers,
          body: JSON.stringify({ title: "created" }),
        })
        expect(created.title).toBe("created")

        const updated = yield* requestJson<Session.Info>(pathFor(SessionPaths.update, { sessionID: created.id }), {
          method: "PATCH",
          headers,
          body: JSON.stringify({ title: "updated", time: { archived: 1 } }),
        })
        expect(updated).toMatchObject({ id: created.id, title: "updated", time: { archived: 1 } })

        const forked = yield* requestJson<Session.Info>(pathFor(SessionPaths.fork, { sessionID: created.id }), {
          method: "POST",
          headers,
        })
        expect(forked.id).not.toBe(created.id)

        expect(
          yield* requestJson<boolean>(pathFor(SessionPaths.abort, { sessionID: created.id }), {
            method: "POST",
            headers,
          }),
        ).toBe(true)

        expect(
          yield* requestJson<boolean>(pathFor(SessionPaths.remove, { sessionID: created.id }), {
            method: "DELETE",
            headers,
          }),
        ).toBe(true)
      }),
    { git: true, config: { formatter: false, lsp: false, share: "disabled" } },
  )

  it.instance(
    "persists selected workspace id when creating a session",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true
        const project = yield* Project.use.fromDirectory(test.directory)
        const workspace = yield* createLocalWorkspace({
          projectID: project.project.id,
          type: "session-create-workspace",
          directory: path.join(test.directory, ".workspace-local"),
        })

        const created = yield* requestJson<Session.Info>(`${SessionPaths.create}?workspace=${workspace.id}`, {
          method: "POST",
          headers: { "x-opencode-directory": test.directory, "content-type": "application/json" },
          body: JSON.stringify({ title: "workspace session" }),
        })
        const messages = yield* request(`${pathFor(SessionPaths.messages, { sessionID: created.id })}?workspace=${workspace.id}`, {
          headers: { "x-opencode-directory": test.directory },
        })

        expect(created).toMatchObject({ id: created.id, workspaceID: workspace.id })
        expect(messages.status).toBe(200)
        expect(yield* getWorkspaceID(created.id)).toEqual({ workspaceID: workspace.id })
      }),
    { git: true, config: { formatter: false, lsp: false, share: "disabled" } },
  )

  it.instance(
    "validates archived timestamp values",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }
        const session = yield* createSession({ title: "archived" })
        const body = JSON.stringify({ time: { archived: -1 } })

        const response = yield* request(pathFor(SessionPaths.update, { sessionID: session.id }), {
          method: "PATCH",
          headers,
          body,
        })
        expect(response.status).toBe(200)
        expect((yield* json<Session.Info>(response)).time.archived).toBe(-1)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "uses project-scoped path and directory precedence",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const currentDir = path.join(test.directory, "packages", "opencode", "src")
        yield* Effect.promise(() => mkdir(currentDir, { recursive: true }))

        const store = yield* InstanceStore.Service
        const { pathSession, pathlessSession } = yield* store.provide(
          { directory: currentDir },
          Effect.gen(function* () {
            return {
              pathSession: yield* createSession(),
              pathlessSession: yield* createSession(),
            }
          }).pipe(Effect.provideService(TestInstance, { directory: currentDir }), Effect.provide(Session.defaultLayer)),
        )
        yield* clearSessionPath(pathlessSession.id)

        const query = new URLSearchParams({
          scope: "project",
          path: "packages/opencode/src",
          directory: currentDir,
        })
        const headers = { "x-opencode-directory": test.directory }
        const sessions = (yield* json<Session.Info[]>(yield* request(`${SessionPaths.list}?${query}`, { headers }))).map(
          (item) => item.id,
        )

        expect(sessions).toContain(pathSession.id)
        expect(sessions).not.toContain(pathlessSession.id)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "serves paginated message link headers",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-opencode-directory": test.directory }
        const session = yield* createSession({ title: "messages" })
        yield* createTextMessage(session.id, "first")
        yield* createTextMessage(session.id, "second")
        const route = `${pathFor(SessionPaths.messages, { sessionID: session.id })}?limit=1`

        const response = yield* request(route, { headers })

        expect(response.headers.get("x-next-cursor")).toBeTruthy()
        expect(response.headers.get("link")).toContain("limit=1")
        expect(response.headers.get("access-control-expose-headers")?.toLowerCase()).toContain("x-next-cursor")
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "serves message mutation routes",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }
        const session = yield* createSession({ title: "messages" })
        const first = yield* createTextMessage(session.id, "first")
        const second = yield* createTextMessage(session.id, "second")

        const updated = yield* requestJson<MessageV2.Part>(
          pathFor(SessionPaths.updatePart, {
            sessionID: session.id,
            messageID: first.info.id,
            partID: first.part.id,
          }),
          {
            method: "PATCH",
            headers,
            body: JSON.stringify({ ...first.part, text: "updated" }),
          },
        )
        expect(updated).toMatchObject({ id: first.part.id, type: "text", text: "updated" })

        expect(
          yield* requestJson<boolean>(
            pathFor(SessionPaths.deletePart, {
              sessionID: session.id,
              messageID: first.info.id,
              partID: first.part.id,
            }),
            { method: "DELETE", headers },
          ),
        ).toBe(true)

        expect(
          yield* requestJson<boolean>(pathFor(SessionPaths.deleteMessage, { sessionID: session.id, messageID: second.info.id }), {
            method: "DELETE",
            headers,
          }),
        ).toBe(true)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "rejects part updates whose path and body ids disagree",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }
        const session = yield* createSession({ title: "part mismatch" })
        const message = yield* createTextMessage(session.id, "first")
        const response = yield* request(
          pathFor(SessionPaths.updatePart, {
            sessionID: session.id,
            messageID: message.info.id,
            partID: message.part.id,
          }),
          {
            method: "PATCH",
            headers,
            body: JSON.stringify({ ...message.part, id: PartID.ascending() }),
          },
        )

        expect(response.status).toBe(400)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "serves remaining non-LLM session mutation routes",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }
        const session = yield* createSession({ title: "remaining" })

        expect(
          yield* requestJson<Session.Info>(pathFor(SessionPaths.revert, { sessionID: session.id }), {
            method: "POST",
            headers,
            body: JSON.stringify({ messageID: MessageID.ascending() }),
          }),
        ).toMatchObject({ id: session.id })

        expect(
          yield* requestJson<Session.Info>(pathFor(SessionPaths.unrevert, { sessionID: session.id }), {
            method: "POST",
            headers,
          }),
        ).toMatchObject({ id: session.id })

        expect(
          yield* requestJson<boolean>(
            pathFor(SessionPaths.permissions, {
              sessionID: session.id,
              permissionID: String(PermissionID.ascending()),
            }),
            {
              method: "POST",
              headers,
              body: JSON.stringify({ response: "once" }),
            },
          ),
        ).toBe(true)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )
})
