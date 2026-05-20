import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { Flag } from "@opencode-ai/core/flag/flag"
import { describe, expect, test } from "bun:test"
import path from "node:path"
import { Config, Context, Effect, FileSystem, Layer, Path } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/unstable/http"
import * as Socket from "effect/unstable/socket/Socket"
import { GlobalBus } from "@/bus/global"
import { WorkspaceID } from "../../src/control-plane/schema"
import { ProjectTable } from "../../src/project/project.sql"
import { ProjectID } from "../../src/project/schema"
import { Server } from "../../src/server/server"
import { ControlPaths } from "../../src/server/routes/instance/httpapi/groups/control"
import { InstancePaths } from "../../src/server/routes/instance/httpapi/groups/instance"
import { SessionPaths } from "../../src/server/routes/instance/httpapi/groups/session"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { HEADER as FenceHeader } from "../../src/server/shared/fence"
import { SessionTable } from "../../src/session/session.sql"
import { SessionID } from "../../src/session/schema"
import * as Database from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const testStateLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const originalWorkspaces = Flag.OPENCODE_EXPERIMENTAL_WORKSPACES
    Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true
    yield* Effect.promise(() => resetDatabase())
    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = originalWorkspaces
        await resetDatabase()
      }),
    )
  }),
)

const servedRoutes: Layer.Layer<never, Config.ConfigError, HttpServer.HttpServer> = HttpRouter.serve(HttpApiApp.routes, {
  disableListenLog: true,
  disableLogger: true,
})

const httpApiServerLayer = servedRoutes.pipe(
  Layer.provide(Socket.layerWebSocketConstructorGlobal),
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provideMerge(NodeServices.layer),
)

const it = testEffect(Layer.mergeAll(testStateLayer, httpApiServerLayer))
const handlerContext = Context.empty() as Context.Context<unknown>

const directoryHeader = (dir: string) => HttpClientRequest.setHeader("x-opencode-directory", dir)

function app() {
  return Server.Default().app
}

function pathFor(template: string, params: Record<string, string>) {
  return Object.entries(params).reduce((result, [key, value]) => result.replace(`:${key}`, value), template)
}

function waitDisposed(directory: string) {
  return new Promise<string | undefined>((resolve) => {
    const onEvent = (event: { directory?: string; payload: { type?: string } }) => {
      if (event.payload.type !== "server.instance.disposed") return
      GlobalBus.off("event", onEvent)
      resolve(event.directory)
    }
    GlobalBus.on("event", onEvent)
  }).then((value) => {
    expect(value).toBe(directory)
    return value
  })
}

describe("instance HttpApi", () => {
  it.live("serves the OpenAPI document", () =>
    Effect.gen(function* () {
      const response = yield* HttpClient.get("/doc")

      expect(response.status).toBe(200)
      expect(response.headers["content-type"]).toContain("application/json")
      expect(yield* response.json).toMatchObject({
        openapi: expect.any(String),
        info: expect.any(Object),
        paths: expect.objectContaining({
          "/global/health": expect.any(Object),
          "/session": expect.any(Object),
        }),
      })
    }),
  )

  it.live("emits a sync fence header for fixed-workspace mutations", () =>
    Effect.gen(function* () {
      const originalWorkspaceID = Flag.OPENCODE_WORKSPACE_ID
      Flag.OPENCODE_WORKSPACE_ID = WorkspaceID.ascending()
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          Flag.OPENCODE_WORKSPACE_ID = originalWorkspaceID
        }),
      )

      const dir = yield* tmpdirScoped({ git: true })
      const response = yield* HttpClientRequest.post(SessionPaths.create).pipe(
        directoryHeader(dir),
        HttpClientRequest.bodyJson({ title: "fenced" }),
        Effect.flatMap(HttpClient.execute),
      )

      expect(response.status).toBe(200)
      expect(JSON.parse(response.headers[FenceHeader] ?? "{}")).not.toEqual({})
    }),
  )

  it.live("does not emit sync fence headers for fixed-workspace reads or no-op mutations", () =>
    Effect.gen(function* () {
      const originalWorkspaceID = Flag.OPENCODE_WORKSPACE_ID
      Flag.OPENCODE_WORKSPACE_ID = WorkspaceID.ascending()
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          Flag.OPENCODE_WORKSPACE_ID = originalWorkspaceID
        }),
      )

      const dir = yield* tmpdirScoped({ git: true })
      const read = yield* HttpClientRequest.get(InstancePaths.path).pipe(directoryHeader(dir), HttpClient.execute)
      const log = yield* HttpClientRequest.post(ControlPaths.log).pipe(
        directoryHeader(dir),
        HttpClientRequest.bodyJson({ service: "fence-test", level: "info", message: "noop" }),
        Effect.flatMap(HttpClient.execute),
      )

      expect(read.status).toBe(200)
      expect(read.headers[FenceHeader]).toBeUndefined()
      expect(log.status).toBe(200)
      expect(log.headers[FenceHeader]).toBeUndefined()
    }),
  )

  it.live("rejects malformed permission and question request ids", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const request = (path: string, init?: RequestInit) =>
        Effect.promise(() =>
          HttpApiApp.webHandler().handler(
            new Request(`http://localhost${path}`, {
              ...init,
              headers: { "x-opencode-directory": dir, "content-type": "application/json", ...init?.headers },
            }),
            handlerContext,
          ),
        )
      const [permission, questionReply, questionReject] = yield* Effect.all(
        [
          request("/permission/invalid-permission-id/reply", {
            method: "POST",
            body: JSON.stringify({ reply: "once" }),
          }),
          request("/question/invalid-question-id/reply", {
            method: "POST",
            body: JSON.stringify({ answers: [["Yes"]] }),
          }),
          request("/question/invalid-question-id/reject", { method: "POST" }),
        ],
        { concurrency: "unbounded" },
      )

      expect(permission.status).toBe(400)
      expect(questionReply.status).toBe(400)
      expect(questionReject.status).toBe(400)
    }),
  )

  it.live("serves path and VCS read endpoints", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      yield* fs.writeFileString(path.join(dir, "changed.txt"), "hello")

      const [paths, vcs, diff] = yield* Effect.all(
        [
          HttpClientRequest.get(InstancePaths.path).pipe(directoryHeader(dir), HttpClient.execute),
          HttpClientRequest.get(InstancePaths.vcs).pipe(directoryHeader(dir), HttpClient.execute),
          HttpClientRequest.get(InstancePaths.vcsDiff).pipe(
            HttpClientRequest.setUrlParam("mode", "git"),
            directoryHeader(dir),
            HttpClient.execute,
          ),
        ],
        { concurrency: "unbounded" },
      )

      expect(paths.status).toBe(200)
      expect(yield* paths.json).toMatchObject({
        directory: dir,
        worktree: dir,
        configFile: expect.stringMatching(/opencode\.(jsonc|json)$|config\.json$/),
      })

      expect(vcs.status).toBe(200)
      expect(yield* vcs.json).toMatchObject({ branch: expect.any(String) })

      expect(diff.status).toBe(200)
      expect(yield* diff.json).toContainEqual(expect.objectContaining({ file: "changed.txt", additions: 1, status: "added" }))
    }),
  )

  test("serves skill enabled state and toggle through compat app", async () => {
    await using tmp = await tmpdir({
      config: { formatter: false, lsp: false, permission: { skill: { "*": "deny", "route-skill": "allow" } } },
      init: async (dir) => {
        await Bun.write(
          path.join(dir, ".opencode", "skill", "route-skill", "SKILL.md"),
          `---\nname: route-skill\ndescription: Route skill.\n---\n\n# Route Skill\n`,
        )
      },
    })

    const listed = await app().request(InstancePaths.skill, { headers: { "x-opencode-directory": tmp.path } })
    expect(listed.status).toBe(200)
    expect(await listed.json()).toContainEqual(expect.objectContaining({ name: "route-skill", enabled: true }))

    const toggled = await app().request(`${InstancePaths.skill}/route-skill/enabled`, {
      method: "PATCH",
      headers: { "x-opencode-directory": tmp.path, "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    })

    expect(toggled.status).toBe(200)
    expect(await toggled.json()).toBe(true)

    const refreshed = await app().request(InstancePaths.skill, { headers: { "x-opencode-directory": tmp.path } })
    expect(await refreshed.json()).toContainEqual(expect.objectContaining({ name: "route-skill", enabled: false }))
  })

  test("returns 404 when toggling an unknown skill through compat app", async () => {
    await using tmp = await tmpdir({ config: { formatter: false, lsp: false } })

    const response = await app().request(`${InstancePaths.skill}/missing-skill/enabled`, {
      method: "PATCH",
      headers: { "x-opencode-directory": tmp.path, "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      name: "NotFoundError",
      data: { message: "Skill not found: missing-skill" },
    })
    expect(await Bun.file(path.join(tmp.path, "opencode.json")).json()).not.toHaveProperty(["permission", "skill", "missing-skill"])
  })

  test("serves project git init through compat app", async () => {
    await using tmp = await tmpdir({ config: { formatter: false, lsp: false } })
    const disposed = waitDisposed(tmp.path)

    const response = await app().request("/project/git/init", {
      method: "POST",
      headers: { "x-opencode-directory": tmp.path },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ vcs: "git", worktree: tmp.path })
    await disposed

    const current = await app().request("/project/current", { headers: { "x-opencode-directory": tmp.path } })
    expect(current.status).toBe(200)
    expect(await current.json()).toMatchObject({ vcs: "git", worktree: tmp.path })
  })

  test("serves project update through compat app", async () => {
    await using tmp = await tmpdir({ config: { formatter: false, lsp: false } })

    const current = await app().request("/project/current", { headers: { "x-opencode-directory": tmp.path } })
    expect(current.status).toBe(200)
    const project = (await current.json()) as { id: string }

    const response = await app().request(`/project/${project.id}`, {
      method: "PATCH",
      headers: { "x-opencode-directory": tmp.path, "content-type": "application/json" },
      body: JSON.stringify({ name: "patched-project", commands: { start: "bun dev" } }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      id: project.id,
      name: "patched-project",
      commands: { start: "bun dev" },
    })

    const list = await app().request("/project", { headers: { "x-opencode-directory": tmp.path } })
    expect(list.status).toBe(200)
    expect(await list.json()).toContainEqual(expect.objectContaining({ id: project.id, name: "patched-project", commands: { start: "bun dev" } }))
  })

  test("does not expose orphaned legacy global project rows through the project list route", async () => {
    await using tmp = await tmpdir({ config: { formatter: false, lsp: false } })

    const now = Date.now()
    const sessionID = SessionID.make(crypto.randomUUID())

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

      db
        .insert(SessionTable)
        .values({
          id: sessionID,
          project_id: ProjectID.global,
          slug: sessionID,
          directory: tmp.path,
          title: "legacy-route-visible",
          version: "0.0.0-test",
          time_created: now,
          time_updated: now,
        })
        .run()
    })

    const list = await app().request("/project", { headers: { "x-opencode-directory": tmp.path } })
    expect(list.status).toBe(200)

    const projects = (await list.json()) as Array<{ id: string; worktree: string }>
    expect(projects.some((project) => project.id === "global")).toBe(false)
    expect(projects).toContainEqual(expect.objectContaining({ id: ProjectID.nonGit(tmp.path), worktree: tmp.path }))
  })

  test("serves instance dispose through compat app", async () => {
    await using tmp = await tmpdir()
    const disposed = waitDisposed(tmp.path)

    const response = await app().request(InstancePaths.dispose, {
      method: "POST",
      headers: { "x-opencode-directory": tmp.path },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toBe(true)
    await disposed
  })
})
