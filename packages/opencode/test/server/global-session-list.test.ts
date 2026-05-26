import { describe, expect, test } from "bun:test"
import { Deferred, Effect, Layer } from "effect"
import { Project } from "@/project/project"
import { Session as SessionNs } from "@/session/session"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import * as Log from "@opencode-ai/core/util/log"
import { provideInstance, TestInstance, tmpdir, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import path from "path"
import { pathToFileURL } from "url"
import { ProjectID } from "../../src/project/schema"

void Log.init({ print: false })

const it = testEffect(Layer.mergeAll(SessionNs.defaultLayer, Project.defaultLayer, CrossSpawnSpawner.defaultLayer))
const modulePath = (file: string) => JSON.stringify(pathToFileURL(file).href)

const withSession = (input?: Parameters<SessionNs.Interface["create"]>[0]) =>
  Effect.acquireRelease(
    SessionNs.Service.use((session) => session.create(input)),
    (created) => SessionNs.Service.use((session) => session.remove(created.id).pipe(Effect.ignore)),
  )

describe("session.listGlobal", () => {
  it.instance(
    "lists sessions across projects with project metadata",
    () =>
      Effect.gen(function* () {
        const first = yield* TestInstance
        const second = yield* tmpdirScoped({ git: true })

        const firstSession = yield* withSession({ title: "first-session" })
        const secondSession = yield* withSession({ title: "second-session" }).pipe(provideInstance(second))

        const sessions = yield* Effect.sync(() => [...SessionNs.listGlobal({ limit: 200 })])
        const ids = sessions.map((session) => session.id)

        expect(ids).toContain(firstSession.id)
        expect(ids).toContain(secondSession.id)

        const firstProject = yield* Project.Service.use((project) => project.get(firstSession.projectID))
        const secondProject = yield* Project.Service.use((project) => project.get(secondSession.projectID))

        const firstItem = sessions.find((session) => session.id === firstSession.id)
        const secondItem = sessions.find((session) => session.id === secondSession.id)

        expect(firstItem?.project?.id).toBe(firstProject?.id)
        expect(firstItem?.project?.worktree).toBe(firstProject?.worktree)
        expect(secondItem?.project?.id).toBe(secondProject?.id)
        expect(secondItem?.project?.worktree).toBe(secondProject?.worktree)
        expect(first.directory).not.toBe(second)
      }),
    { git: true },
  )

  it.instance(
    "excludes archived sessions by default",
    () =>
      Effect.gen(function* () {
        const archived = yield* withSession({ title: "archived-session" })

        yield* SessionNs.Service.use((session) => session.setArchived({ sessionID: archived.id, time: Date.now() }))

        const sessions = yield* Effect.sync(() => [...SessionNs.listGlobal({ limit: 200 })])
        const ids = sessions.map((session) => session.id)

        expect(ids).not.toContain(archived.id)

        const allSessions = yield* Effect.sync(() => [...SessionNs.listGlobal({ limit: 200, archived: true })])
        const allIds = allSessions.map((session) => session.id)

        expect(allIds).toContain(archived.id)
      }),
    { git: true },
  )

  it.instance(
    "supports cursor pagination",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance

        const first = yield* withSession({ title: "page-one" })
        const ready = yield* Deferred.make<void>()
        yield* Deferred.succeed(ready, undefined).pipe(Effect.delay("5 millis"), Effect.forkScoped)
        yield* Deferred.await(ready).pipe(
          Effect.timeoutOrElse({
            duration: "1 second",
            orElse: () => Effect.fail(new Error("timed out waiting between session creates")),
          }),
        )
        const second = yield* withSession({ title: "page-two" })

        const page = yield* Effect.sync(() => [...SessionNs.listGlobal({ directory: test.directory, limit: 1 })])
        expect(page.length).toBe(1)
        expect(page[0].id).toBe(second.id)

        const next = yield* Effect.sync(() => [
          ...SessionNs.listGlobal({ directory: test.directory, limit: 10, cursor: page[0].time.updated }),
        ])
        const ids = next.map((session) => session.id)

        expect(ids).toContain(first.id)
        expect(ids).not.toContain(second.id)
      }),
    { git: true },
  )

  it.live("keeps non-git sessions attached to different project metadata per directory", () =>
    Effect.gen(function* () {
      const first = yield* tmpdirScoped()
      const second = yield* tmpdirScoped()

      const firstSession = yield* withSession({ title: "plain-first" }).pipe(provideInstance(first))
      const secondSession = yield* withSession({ title: "plain-second" }).pipe(provideInstance(second))

      const sessions = yield* Effect.sync(() => [...SessionNs.listGlobal({ limit: 200 })])
      const firstItem = sessions.find((session) => session.id === firstSession.id)
      const secondItem = sessions.find((session) => session.id === secondSession.id)

      expect(firstItem?.project?.id).toBe(firstSession.projectID)
      expect(secondItem?.project?.id).toBe(secondSession.projectID)
      expect(firstItem?.project?.id).not.toBe(secondItem?.project?.id)
      expect(firstItem?.project?.worktree).toBe(first)
      expect(secondItem?.project?.worktree).toBe(second)
    }),
  )

  test(
    "does not leave legacy non-git sessions attached to global project metadata after a fresh database boot",
    async () => {
      await using tmp = await tmpdir()

      const dbPath = path.join(tmp.path, "legacy.db")
      const xdgRoot = path.join(tmp.path, "xdg")
      const seedScript = path.join(tmp.path, "seed-legacy.ts")
      const verifyScript = path.join(tmp.path, "verify-legacy.ts")

      await Bun.write(
        seedScript,
        `
import { AppRuntime } from ${modulePath(path.join(import.meta.dir, "../../src/effect/app-runtime.ts"))}
import { initProjectors } from ${modulePath(path.join(import.meta.dir, "../../src/server/projectors.ts"))}
import { Instance } from ${modulePath(path.join(import.meta.dir, "../../src/project/instance.ts"))}
import { Session } from ${modulePath(path.join(import.meta.dir, "../../src/session/index.ts"))}
import { ProjectTable } from ${modulePath(path.join(import.meta.dir, "../../src/project/project.sql.ts"))}
import { ProjectID } from ${modulePath(path.join(import.meta.dir, "../../src/project/schema.ts"))}
import { SessionTable } from ${modulePath(path.join(import.meta.dir, "../../src/session/session.sql.ts"))}
import { Database, eq } from ${modulePath(path.join(import.meta.dir, "../../src/storage/index.ts"))}
import * as Log from ${modulePath(path.join(import.meta.dir, "../../../core/src/util/log.ts"))}

void Log.init({ print: false, dev: true, level: "DEBUG" })
initProjectors()

const directory = ${JSON.stringify(tmp.path)}

const session = await Instance.provide({
  directory,
  fn: async () => AppRuntime.runPromise(Session.Service.use((svc) => svc.create({ title: "legacy-visible" }))),
})

const now = Date.now()
Database.use((db) => {
  db
    .insert(ProjectTable)
    .values({
      id: ProjectID.global,
      worktree: "/",
      time_created: now,
      time_updated: now,
      sandboxes: [],
    })
    .onConflictDoNothing()
    .run()

  db.update(SessionTable).set({ project_id: ProjectID.global }).where(eq(SessionTable.id, session.id)).run()
})

Database.close()
console.log(JSON.stringify({ sessionID: session.id, projectID: session.projectID }))
process.exit(0)
`,
      )

      await Bun.write(
        verifyScript,
        `
import { initProjectors } from ${modulePath(path.join(import.meta.dir, "../../src/server/projectors.ts"))}
import { Session } from ${modulePath(path.join(import.meta.dir, "../../src/session/index.ts"))}
import * as Log from ${modulePath(path.join(import.meta.dir, "../../../core/src/util/log.ts"))}

void Log.init({ print: false, dev: true, level: "DEBUG" })
initProjectors()

const directory = ${JSON.stringify(tmp.path)}
const sessionID = ${JSON.stringify("__SESSION_ID__")}
const projectID = ${JSON.stringify("__PROJECT_ID__")}

const items = [...Session.listGlobal({ directory, limit: 50 })]
const match = items.find((item) => item.id === sessionID)

console.log(JSON.stringify({
  projectID: match?.project?.id ?? null,
  worktree: match?.project?.worktree ?? null,
  expectedProjectID: projectID,
}))
process.exit(0)
`,
      )

      const env = {
        ...process.env,
        OPENCODE_DB: dbPath,
        XDG_DATA_HOME: path.join(xdgRoot, "share"),
        XDG_CACHE_HOME: path.join(xdgRoot, "cache"),
        XDG_CONFIG_HOME: path.join(xdgRoot, "config"),
        XDG_STATE_HOME: path.join(xdgRoot, "state"),
        OPENCODE_TEST_HOME: path.join(xdgRoot, "home"),
        OPENCODE_TEST_MANAGED_CONFIG_DIR: path.join(xdgRoot, "managed"),
        OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
        OPENCODE_MODELS_PATH: path.join(import.meta.dir, "../tool/fixtures/models-api.json"),
      }

      const runScript = async (script: string) => {
        const child = Bun.spawn([process.execPath, script], {
          cwd: path.join(import.meta.dir, "../.."),
          env,
          stdout: "pipe",
          stderr: "pipe",
        })
        const stdout = await new Response(child.stdout).text()
        const stderr = await new Response(child.stderr).text()
        const code = await child.exited
        return { stdout, stderr, code }
      }

      const seeded = await runScript(seedScript)
      expect(seeded.code, seeded.stderr).toBe(0)

      const seededInfo = JSON.parse(seeded.stdout.trim()) as { sessionID: string; projectID: string }

      await Bun.write(
        verifyScript,
        (await Bun.file(verifyScript).text()).replace("__SESSION_ID__", seededInfo.sessionID).replace("__PROJECT_ID__", seededInfo.projectID),
      )

      const verified = await runScript(verifyScript)
      expect(verified.code, verified.stderr).toBe(0)

      const result = JSON.parse(verified.stdout.trim()) as {
        projectID: string | null
        worktree: string | null
        expectedProjectID: string
      }

      expect(result.projectID).toBe(seededInfo.projectID)
      expect(result.worktree).toBe(tmp.path)
      expect(result.projectID).not.toBe(ProjectID.global)
    },
    30_000,
  )
})
