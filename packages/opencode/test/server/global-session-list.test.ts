import { describe, expect, test } from "bun:test"
import path from "path"
import { Effect } from "effect"
import z from "zod"
import { Instance } from "../../src/project/instance"
import { Project } from "../../src/project"
import { ProjectID } from "../../src/project/schema"
import { Session as SessionNs } from "../../src/session"
import { Log } from "../../src/util"
import { tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

function run<A, E>(fx: Effect.Effect<A, E, SessionNs.Service>) {
  return Effect.runPromise(fx.pipe(Effect.provide(SessionNs.defaultLayer)))
}

const svc = {
  ...SessionNs,
  create(input?: SessionNs.CreateInput) {
    return run(SessionNs.Service.use((svc) => svc.create(input)))
  },
  setArchived(input: z.output<typeof SessionNs.SetArchivedInput.zod>) {
    return run(SessionNs.Service.use((svc) => svc.setArchived(input)))
  },
}

describe("session.listGlobal", () => {
  test("lists sessions across projects with project metadata", async () => {
    await using first = await tmpdir({ git: true })
    await using second = await tmpdir({ git: true })

    const firstSession = await Instance.provide({
      directory: first.path,
      fn: async () => svc.create({ title: "first-session" }),
    })
    const secondSession = await Instance.provide({
      directory: second.path,
      fn: async () => svc.create({ title: "second-session" }),
    })

    const sessions = [...svc.listGlobal({ limit: 200 })]
    const ids = sessions.map((session) => session.id)

    expect(ids).toContain(firstSession.id)
    expect(ids).toContain(secondSession.id)

    const firstProject = Project.get(firstSession.projectID)
    const secondProject = Project.get(secondSession.projectID)

    const firstItem = sessions.find((session) => session.id === firstSession.id)
    const secondItem = sessions.find((session) => session.id === secondSession.id)

    expect(firstItem?.project?.id).toBe(firstProject?.id)
    expect(firstItem?.project?.worktree).toBe(firstProject?.worktree)
    expect(secondItem?.project?.id).toBe(secondProject?.id)
    expect(secondItem?.project?.worktree).toBe(secondProject?.worktree)
  })

  test("excludes archived sessions by default", async () => {
    await using tmp = await tmpdir({ git: true })

    const archived = await Instance.provide({
      directory: tmp.path,
      fn: async () => svc.create({ title: "archived-session" }),
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => svc.setArchived({ sessionID: archived.id, time: Date.now() }),
    })

    const sessions = [...svc.listGlobal({ limit: 200 })]
    const ids = sessions.map((session) => session.id)

    expect(ids).not.toContain(archived.id)

    const allSessions = [...svc.listGlobal({ limit: 200, archived: true })]
    const allIds = allSessions.map((session) => session.id)

    expect(allIds).toContain(archived.id)
  })

  test("supports cursor pagination", async () => {
    await using tmp = await tmpdir({ git: true })

    const first = await Instance.provide({
      directory: tmp.path,
      fn: async () => svc.create({ title: "page-one" }),
    })
    await new Promise((resolve) => setTimeout(resolve, 5))
    const second = await Instance.provide({
      directory: tmp.path,
      fn: async () => svc.create({ title: "page-two" }),
    })

    const page = [...svc.listGlobal({ directory: tmp.path, limit: 1 })]
    expect(page.length).toBe(1)
    expect(page[0].id).toBe(second.id)

    const next = [...svc.listGlobal({ directory: tmp.path, limit: 10, cursor: page[0].time.updated })]
    const ids = next.map((session) => session.id)

    expect(ids).toContain(first.id)
    expect(ids).not.toContain(second.id)
  })

  test("keeps non-git sessions attached to different project metadata per directory", async () => {
    await using first = await tmpdir()
    await using second = await tmpdir()

    const firstSession = await Instance.provide({
      directory: first.path,
      fn: async () => svc.create({ title: "plain-first" }),
    })
    const secondSession = await Instance.provide({
      directory: second.path,
      fn: async () => svc.create({ title: "plain-second" }),
    })

    const sessions = [...svc.listGlobal({ limit: 200 })]
    const firstItem = sessions.find((session) => session.id === firstSession.id)
    const secondItem = sessions.find((session) => session.id === secondSession.id)

    expect(firstItem?.project?.id).toBe(firstSession.projectID)
    expect(secondItem?.project?.id).toBe(secondSession.projectID)
    expect(firstItem?.project?.id).not.toBe(secondItem?.project?.id)
    expect(firstItem?.project?.worktree).toBe(first.path)
    expect(secondItem?.project?.worktree).toBe(second.path)
  })

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
import { AppRuntime } from ${JSON.stringify(path.join(import.meta.dir, "../../src/effect/app-runtime.ts"))}
import { initProjectors } from ${JSON.stringify(path.join(import.meta.dir, "../../src/server/projectors.ts"))}
import { Instance } from ${JSON.stringify(path.join(import.meta.dir, "../../src/project/instance.ts"))}
import { Session } from ${JSON.stringify(path.join(import.meta.dir, "../../src/session/index.ts"))}
import { ProjectTable } from ${JSON.stringify(path.join(import.meta.dir, "../../src/project/project.sql.ts"))}
import { ProjectID } from ${JSON.stringify(path.join(import.meta.dir, "../../src/project/schema.ts"))}
import { SessionTable } from ${JSON.stringify(path.join(import.meta.dir, "../../src/session/session.sql.ts"))}
import { Database, eq } from ${JSON.stringify(path.join(import.meta.dir, "../../src/storage/index.ts"))}
import { Log } from ${JSON.stringify(path.join(import.meta.dir, "../../src/util/index.ts"))}

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
import { initProjectors } from ${JSON.stringify(path.join(import.meta.dir, "../../src/server/projectors.ts"))}
import { Session } from ${JSON.stringify(path.join(import.meta.dir, "../../src/session/index.ts"))}
import { Log } from ${JSON.stringify(path.join(import.meta.dir, "../../src/util/index.ts"))}

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
      expect(seeded.code).toBe(0)

      const seededInfo = JSON.parse(seeded.stdout.trim()) as { sessionID: string; projectID: string }

      await Bun.write(
        verifyScript,
        (
          await Bun.file(verifyScript).text()
        )
          .replace("__SESSION_ID__", seededInfo.sessionID)
          .replace("__PROJECT_ID__", seededInfo.projectID),
      )

      const verified = await runScript(verifyScript)
      expect(verified.code).toBe(0)

      const result = JSON.parse(verified.stdout.trim()) as {
      projectID: string | null
      worktree: string | null
      expectedProjectID: string
      }

      expect(result.projectID).toBe(seededInfo.projectID)
      expect(result.worktree).toBe(tmp.path)
      expect(result.projectID).not.toBe(ProjectID.global)
    },
    30000,
  )
})
