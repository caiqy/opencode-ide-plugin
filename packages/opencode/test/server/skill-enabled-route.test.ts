import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Global } from "@opencode-ai/core/global"
import { afterEach, describe, expect, test } from "bun:test"
import { Context, Effect, Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Permission } from "../../src/permission"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { Skill } from "../../src/skill"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { provideInstance, testInstanceStoreLayer, tmpdir } from "../fixture/fixture"

Log.init({ print: false })

const context = Context.empty() as Context.Context<unknown>

function app() {
  const replacements = [[Global.node, Global.layerWith({ home: process.env.OPENCODE_TEST_HOME! })]] as const
  const web = HttpRouter.toWebHandler(HttpApiApp.createRoutes(undefined, replacements), { disableLogger: true })
  return {
    [Symbol.asyncDispose]: web.dispose,
    skillLayer: Layer.mergeAll(
      LayerNode.compile(Skill.node, replacements),
      LayerNode.compile(CrossSpawnSpawner.node),
      testInstanceStoreLayer,
    ),
    request(route: string, init?: RequestInit) {
      return web.handler(new Request(new URL(route, "http://localhost"), init), context)
    },
  }
}

afterEach(async () => {
  await Instance.disposeAll()
  await resetDatabase()
})

async function writeSkill(dir: string, name = "route-skill") {
  await Bun.write(
    path.join(dir, ".opencode", "skill", name, "SKILL.md"),
    `---
name: ${name}
description: Route skill.
---

# Route Skill
`,
  )
}

async function patchSkill(server: ReturnType<typeof app>, dir: string, name: string, enabled: boolean) {
  return await server.request(`/skill/${encodeURIComponent(name)}/enabled`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "x-opencode-directory": dir,
    },
    body: JSON.stringify({ enabled }),
  })
}

describe("skill enabled route", () => {
  test("disabling a skill writes a deny permission", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { formatter: false, lsp: false },
      init: (dir) => writeSkill(dir),
    })
    await using server = app()

    const response = await patchSkill(server, tmp.path, "route-skill", false)

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("application/json")
    expect(await response.json()).toBe(true)
    expect(await Bun.file(path.join(tmp.path, "opencode.json")).json()).toMatchObject({
      permission: {
        skill: {
          "route-skill": "deny",
        },
      },
    })

    const config = await server.request("/config", {
      headers: { "x-opencode-directory": tmp.path },
    })

    expect(config.status).toBe(200)
    expect(await config.json()).toMatchObject({
      permission: {
        skill: {
          "route-skill": "deny",
        },
      },
    })
  })

  test("enabling a skill writes an allow permission", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { formatter: false, lsp: false, permission: { skill: { "route-skill": "deny" } } },
      init: (dir) => writeSkill(dir),
    })
    await using server = app()

    const response = await patchSkill(server, tmp.path, "route-skill", true)

    expect(response.status).toBe(200)
    expect(await response.json()).toBe(true)
    expect(await Bun.file(path.join(tmp.path, "opencode.json")).json()).toMatchObject({
      permission: {
        skill: {
          "route-skill": "allow",
        },
      },
    })
  })

  test("enabling a skill preserves shorthand deny as wildcard fallback", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { formatter: false, lsp: false, permission: { skill: "deny" } },
      init: async (dir) => {
        await writeSkill(dir, "route-skill")
        await writeSkill(dir, "other-skill")
      },
    })
    await using server = app()

    const response = await patchSkill(server, tmp.path, "route-skill", true)

    expect(response.status).toBe(200)
    expect(await Bun.file(path.join(tmp.path, "opencode.json")).json()).toMatchObject({
      permission: {
        skill: {
          "*": "deny",
          "route-skill": "allow",
        },
      },
    })

    const names = await Effect.runPromise(
      Effect.gen(function* () {
        const skill = yield* Skill.Service
        const list = yield* skill.available({
          name: "build",
          mode: "primary",
          permission: Permission.fromConfig({ skill: "deny" }),
          options: {},
        })
        return list.map((item) => item.name)
      }).pipe(provideInstance(tmp.path), Effect.provide(server.skillLayer)),
    )

    expect(names).toContain("route-skill")
    expect(names).not.toContain("other-skill")
  })

  test("GET /skill returns backend effective enabled states", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { formatter: false, lsp: false, permission: { skill: { "*": "deny", "route-skill": "allow" } } },
      init: async (dir) => {
        await writeSkill(dir, "route-skill")
        await writeSkill(dir, "other-skill")
      },
    })
    await using server = app()

    const response = await server.request("/skill", {
      headers: { "x-opencode-directory": tmp.path },
    })

    expect(response.status).toBe(200)
    const skills = (await response.json()) as Array<{ name: string; location: string; enabled: boolean }>
    expect(skills.every((item) => item.location === "<built-in>" || item.location.startsWith(tmp.path))).toBe(true)
    expect(skills.find((item) => item.name === "route-skill")?.enabled).toBe(true)
    expect(skills.find((item) => item.name === "other-skill")?.enabled).toBe(false)
  })

  test("unknown skill returns 404 and does not write config", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    await using server = app()

    const response = await patchSkill(server, tmp.path, "missing-skill", false)

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      name: "NotFoundError",
      data: { message: "Skill not found: missing-skill" },
    })
    expect(await Bun.file(path.join(tmp.path, "opencode.json")).json()).not.toHaveProperty([
      "permission",
      "skill",
      "missing-skill",
    ])
  })

  test("route overlay immediately filters Skill.available in the same instance", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { formatter: false, lsp: false },
      init: async (dir) => {
        await writeSkill(dir, "route-skill")
        await writeSkill(dir, "other-skill")
      },
    })
    await using server = app()

    const response = await patchSkill(server, tmp.path, "route-skill", false)
    expect(response.status).toBe(200)

    const names = await Effect.runPromise(
      Effect.gen(function* () {
        const skill = yield* Skill.Service
        const list = yield* skill.available({
          name: "build",
          mode: "primary",
          permission: [],
          options: {},
        })
        return list.map((item) => item.name)
      }).pipe(provideInstance(tmp.path), Effect.provide(server.skillLayer)),
    )

    expect(names).not.toContain("route-skill")
    expect(names).toContain("other-skill")
  })

  test("disable then enable updates an already loaded Skill service without reload", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { formatter: false, lsp: false },
      init: (dir) => writeSkill(dir, "route-skill"),
    })
    await using server = app()

    const snapshots = await Effect.runPromise(
      Effect.gen(function* () {
        const skill = yield* Skill.Service
        const agent = { name: "build", mode: "primary" as const, permission: [], options: {} }
        const before = (yield* skill.available(agent)).map((item) => item.name)
        const disabled = yield* Effect.promise(() => patchSkill(server, tmp.path, "route-skill", false))
        const afterDisable = (yield* skill.available(agent)).map((item) => item.name)
        const enabled = yield* Effect.promise(() => patchSkill(server, tmp.path, "route-skill", true))
        const afterEnable = (yield* skill.available(agent)).map((item) => item.name)
        return { before, disabled: disabled.status, afterDisable, enabled: enabled.status, afterEnable }
      }).pipe(provideInstance(tmp.path), Effect.provide(server.skillLayer)),
    )

    expect(snapshots.before).toContain("route-skill")
    expect(snapshots.disabled).toBe(200)
    expect(snapshots.afterDisable).not.toContain("route-skill")
    expect(snapshots.enabled).toBe(200)
    expect(snapshots.afterEnable).toContain("route-skill")
  })
})
