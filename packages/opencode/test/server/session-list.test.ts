import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { EventTable } from "@opencode-ai/core/event/sql"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Session as SessionNs } from "@/session/session"
import { EventV2Bridge } from "@/event-v2-bridge"
import { disposeAllInstances, provideInstance, TestInstance } from "../fixture/fixture"
import { mkdir } from "fs/promises"
import path from "path"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { eq } from "drizzle-orm"
import { testEffect } from "../lib/effect"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { NotFoundError } from "@/storage/storage"

const layer = (experimentalWorkspaces: boolean) =>
  AppNodeBuilder.build(LayerNode.group([Database.node, SessionNs.node, SessionProjector.node]), [
    [RuntimeFlags.node, RuntimeFlags.layer({ experimentalWorkspaces })],
  ])
const it = testEffect(layer(false))
const itWorkspaces = testEffect(layer(true))

const deleteBeforeUpdateLayer = Layer.effect(
  EventV2Bridge.Service,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const decode = Schema.decodeUnknownSync(SessionV1.Event.Updated.data)
    const encode = Schema.encodeUnknownSync(SessionV1.Event.Updated.data)
    let deleted = false
    const publish: EventV2.Interface["publish"] = (definition, data, options) =>
      Effect.gen(function* () {
        if (!deleted && definition.type === SessionV1.Event.Updated.type) {
          deleted = true
          const updated = decode(encode(data))
          yield* events.publish(SessionV1.Event.Deleted, updated)
          yield* events.remove(updated.sessionID)
        }
        return yield* events.publish(definition, data, options)
      })
    return EventV2Bridge.Service.of({ ...events, publish })
  }),
)
const itDeleteRace = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node, SessionNs.node, SessionProjector.node]), [
    [RuntimeFlags.node, RuntimeFlags.layer({ experimentalWorkspaces: false })],
    [EventV2Bridge.node, deleteBeforeUpdateLayer],
  ]),
)

const withSession = (input?: Parameters<SessionNs.Interface["create"]>[0]) =>
  Effect.acquireRelease(SessionNs.use.create(input), (created) =>
    SessionNs.Service.use((session) => session.remove(created.id).pipe(Effect.ignore)),
  )

afterEach(async () => {
  await disposeAllInstances()
})

describe("session.list", () => {
  it.instance(
    "does not filter by directory when directory is omitted",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* Effect.promise(() => mkdir(path.join(test.directory, "packages", "opencode"), { recursive: true }))
        yield* Effect.promise(() => mkdir(path.join(test.directory, "packages", "app"), { recursive: true }))

        const root = yield* withSession({ title: "root" })
        const parent = yield* withSession({ title: "parent" }).pipe(
          provideInstance(path.join(test.directory, "packages")),
        )
        const current = yield* withSession({ title: "current" }).pipe(
          provideInstance(path.join(test.directory, "packages", "opencode")),
        )
        const sibling = yield* withSession({ title: "sibling" }).pipe(
          provideInstance(path.join(test.directory, "packages", "app")),
        )

        const ids = (yield* SessionNs.use.list()).map((session) => session.id)
        expect(ids).toContain(root.id)
        expect(ids).toContain(parent.id)
        expect(ids).toContain(current.id)
        expect(ids).toContain(sibling.id)
      }),
    { git: true },
  )

  it.instance(
    "filters by directory when directory is provided",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* Effect.promise(() => mkdir(path.join(test.directory, "packages", "opencode"), { recursive: true }))
        yield* Effect.promise(() => mkdir(path.join(test.directory, "packages", "app"), { recursive: true }))

        const root = yield* withSession({ title: "root" })
        const parent = yield* withSession({ title: "parent" }).pipe(
          provideInstance(path.join(test.directory, "packages")),
        )
        const current = yield* withSession({ title: "current" }).pipe(
          provideInstance(path.join(test.directory, "packages", "opencode")),
        )
        const sibling = yield* withSession({ title: "sibling" }).pipe(
          provideInstance(path.join(test.directory, "packages", "app")),
        )

        const ids = (yield* SessionNs.Service.use((session) =>
          session.list({ directory: path.join(test.directory, "packages", "opencode") }),
        )).map((session) => session.id)
        expect(ids).not.toContain(root.id)
        expect(ids).not.toContain(parent.id)
        expect(ids).toContain(current.id)
        expect(ids).not.toContain(sibling.id)
      }),
    { git: true },
  )

  itWorkspaces.instance(
    "filters by directory when experimental workspaces are enabled",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* Effect.promise(() => mkdir(path.join(test.directory, "packages", "opencode"), { recursive: true }))
        yield* Effect.promise(() => mkdir(path.join(test.directory, "packages", "app"), { recursive: true }))

        const current = yield* withSession({ title: "current" }).pipe(
          provideInstance(path.join(test.directory, "packages", "opencode")),
        )
        const sibling = yield* withSession({ title: "sibling" }).pipe(
          provideInstance(path.join(test.directory, "packages", "app")),
        )

        const ids = (yield* SessionNs.Service.use((session) =>
          session.list({ directory: path.join(test.directory, "packages", "opencode") }),
        )).map((session) => session.id)
        expect(ids).toContain(current.id)
        expect(ids).not.toContain(sibling.id)
      }),
    { git: true },
  )

  it.instance(
    "matches a session regardless of directory separator on Windows",
    () =>
      Effect.gen(function* () {
        if (process.platform !== "win32") return
        const test = yield* TestInstance
        const dir = path.join(test.directory, "packages", "opencode")
        yield* Effect.promise(() => mkdir(dir, { recursive: true }))

        const created = yield* withSession({ title: "separator" }).pipe(provideInstance(dir))

        // A forward-slash query (e.g. from the SDK/HTTP layer) must still find it —
        // this is the regression: backslash-stored vs forward-slash-queried.
        const forwardIDs = (yield* SessionNs.Service.use((session) =>
          session.list({ directory: dir.replaceAll("\\", "/") }),
        )).map((session) => session.id)
        expect(forwardIDs).toContain(created.id)

        // The native form must keep matching too.
        const nativeIDs = (yield* SessionNs.Service.use((session) => session.list({ directory: dir }))).map(
          (session) => session.id,
        )
        expect(nativeIDs).toContain(created.id)
      }),
    { git: true },
  )

  it.instance(
    "filters by path and ignores directory when path is provided",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* Effect.promise(() =>
          mkdir(path.join(test.directory, "packages", "opencode", "src", "deep"), { recursive: true }),
        )
        yield* Effect.promise(() => mkdir(path.join(test.directory, "packages", "app"), { recursive: true }))

        const parent = yield* withSession({ title: "parent" }).pipe(
          provideInstance(path.join(test.directory, "packages", "opencode")),
        )
        const current = yield* withSession({ title: "current" }).pipe(
          provideInstance(path.join(test.directory, "packages", "opencode", "src")),
        )
        const deeper = yield* withSession({ title: "deeper" }).pipe(
          provideInstance(path.join(test.directory, "packages", "opencode", "src", "deep")),
        )
        const sibling = yield* withSession({ title: "sibling" }).pipe(
          provideInstance(path.join(test.directory, "packages", "app")),
        )

        const pathIDs = (yield* SessionNs.Service.use((session) =>
          session.list({
            directory: path.join(test.directory, "packages", "app"),
            path: "packages/opencode/src",
          }),
        )).map((session) => session.id)
        expect(pathIDs).not.toContain(parent.id)
        expect(pathIDs).toContain(current.id)
        expect(pathIDs).toContain(deeper.id)
        expect(pathIDs).not.toContain(sibling.id)

        if (process.platform === "win32") {
          const windowsPathIDs = (yield* SessionNs.Service.use((session) =>
            session.list({ path: "packages\\opencode\\src" }),
          )).map((session) => session.id)
          expect(windowsPathIDs).toContain(current.id)
          expect(windowsPathIDs).toContain(deeper.id)
        }
      }),
    { git: true },
  )

  it.instance(
    "falls back to directory when filtering legacy sessions without path",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* Effect.promise(() =>
          mkdir(path.join(test.directory, "packages", "opencode", "src"), { recursive: true }),
        )
        yield* Effect.promise(() => mkdir(path.join(test.directory, "packages", "app"), { recursive: true }))

        const current = yield* withSession({ title: "legacy-current" }).pipe(
          provideInstance(path.join(test.directory, "packages", "opencode", "src")),
        )
        const sibling = yield* withSession({ title: "legacy-sibling" }).pipe(
          provideInstance(path.join(test.directory, "packages", "app")),
        )

        const { db } = yield* Database.Service
        yield* db
          .update(SessionTable)
          .set({ path: null })
          .where(eq(SessionTable.id, current.id))
          .run()
          .pipe(Effect.orDie)
        yield* db
          .update(SessionTable)
          .set({ path: null })
          .where(eq(SessionTable.id, sibling.id))
          .run()
          .pipe(Effect.orDie)

        const pathIDs = (yield* SessionNs.Service.use((session) =>
          session.list({
            directory: path.join(test.directory, "packages", "opencode", "src"),
            path: "packages/opencode/src",
          }),
        )).map((session) => session.id)
        expect(pathIDs).toContain(current.id)
        expect(pathIDs).not.toContain(sibling.id)
      }),
    { git: true },
  )

  it.instance(
    "filters root sessions",
    () =>
      Effect.gen(function* () {
        const root = yield* withSession({ title: "root-session" })
        const child = yield* withSession({ title: "child-session", parentID: root.id })

        const sessions = yield* SessionNs.use.list({ roots: true })
        const ids = sessions.map((session) => session.id)

        expect(ids).toContain(root.id)
        expect(ids).not.toContain(child.id)
      }),
    { git: true },
  )

  it.instance(
    "prioritizes pinned sessions before applying the limit",
    () =>
      Effect.gen(function* () {
        const pinned = yield* withSession({ title: "pinned", metadata: { keep: "value" } })
        const recent = yield* withSession({ title: "recent" })
        const invalid = yield* withSession({
          title: "invalid",
          metadata: { [SessionNs.PinnedMetadataKey]: "true" },
        })
        const { db } = yield* Database.Service
        yield* db
          .update(SessionTable)
          .set({ time_updated: 100 })
          .where(eq(SessionTable.id, pinned.id))
          .run()
          .pipe(Effect.orDie)
        yield* db
          .update(SessionTable)
          .set({ time_updated: 200 })
          .where(eq(SessionTable.id, recent.id))
          .run()
          .pipe(Effect.orDie)
        yield* db
          .update(SessionTable)
          .set({ time_updated: 50 })
          .where(eq(SessionTable.id, invalid.id))
          .run()
          .pipe(Effect.orDie)

        const session = yield* SessionNs.Service
        yield* session.setPinned({ sessionID: pinned.id, pinned: true })

        const stored = yield* session.get(pinned.id)
        expect(stored.time.updated).toBe(100)
        expect(SessionNs.isPinned(stored)).toBe(true)
        expect((yield* session.list({ roots: true, pinnedFirst: true, limit: 1 }))[0]?.id).toBe(pinned.id)
        expect((yield* session.list({ roots: true, limit: 1 }))[0]?.id).toBe(recent.id)

        yield* session.setPinned({ sessionID: pinned.id, pinned: false })
        expect((yield* session.get(pinned.id)).metadata).toEqual({ keep: "value" })
      }),
    { git: true },
  )

  it.instance(
    "clears a persisted pin when it is the only metadata entry",
    () =>
      Effect.gen(function* () {
        const created = yield* withSession({ title: "pinned" })
        const session = yield* SessionNs.Service

        yield* session.setPinned({ sessionID: created.id, pinned: true })
        yield* session.setPinned({ sessionID: created.id, pinned: false })

        const stored = yield* session.get(created.id)
        expect(SessionNs.isPinned(stored)).toBe(false)
        expect(stored.metadata).toBeUndefined()
      }),
    { git: true },
  )

  itDeleteRace.instance(
    "returns typed not-found when a session is deleted before pin projection",
    () =>
      Effect.gen(function* () {
        const created = yield* withSession({ title: "deleted" })
        const session = yield* SessionNs.Service
        const { db } = yield* Database.Service

        const error = yield* session.setPinned({ sessionID: created.id, pinned: true }).pipe(Effect.flip)
        expect(NotFoundError.isInstance(error)).toBe(true)
        expect(yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, created.id)).all()).toEqual([])
      }),
    { git: true },
  )

  it.instance(
    "does not copy pinned state when forking",
    () =>
      Effect.gen(function* () {
        const original = yield* withSession({ title: "original", metadata: { keep: "value" } })
        const session = yield* SessionNs.Service
        yield* session.setPinned({ sessionID: original.id, pinned: true })
        const forked = yield* Effect.acquireRelease(session.fork({ sessionID: original.id }), (created) =>
          session.remove(created.id).pipe(Effect.ignore),
        )

        expect(SessionNs.isPinned(forked)).toBe(false)
        expect(forked.metadata).toEqual({ keep: "value" })
      }),
    { git: true },
  )

  it.instance(
    "filters by start time",
    () =>
      Effect.gen(function* () {
        yield* withSession({ title: "new-session" })
        const sessions = yield* SessionNs.Service.use((session) => session.list({ start: Date.now() + 86400000 }))
        expect(sessions.length).toBe(0)
      }),
    { git: true },
  )

  it.instance(
    "filters by search term",
    () =>
      Effect.gen(function* () {
        yield* withSession({ title: "unique-search-term-abc" })
        yield* withSession({ title: "other-session-xyz" })

        const sessions = yield* SessionNs.use.list({ search: "unique-search" })
        const titles = sessions.map((session) => session.title)

        expect(titles).toContain("unique-search-term-abc")
        expect(titles).not.toContain("other-session-xyz")
      }),
    { git: true },
  )

  it.instance(
    "respects limit parameter",
    () =>
      Effect.gen(function* () {
        yield* withSession({ title: "session-1" })
        yield* withSession({ title: "session-2" })
        yield* withSession({ title: "session-3" })

        const sessions = yield* SessionNs.use.list({ limit: 2 })
        expect(sessions.length).toBe(2)
      }),
    { git: true },
  )

  it.instance(
    "includes metadata in listed sessions",
    () =>
      Effect.gen(function* () {
        const meta = { source: "sdk", trace: { id: "abc" } }
        const created = yield* withSession({ title: "meta-session", metadata: meta })

        const listed = (yield* SessionNs.Service.use((session) => session.list({ search: "meta-session" }))).find(
          (item) => item.id === created.id,
        )

        expect(listed?.metadata).toEqual(meta)
      }),
    { git: true },
  )
})
