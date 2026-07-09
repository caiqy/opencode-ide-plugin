import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Permission } from "../../src/permission"
import { Server } from "../../src/server/server"
import { Skill } from "../../src/skill"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { provideInstance, testInstanceStoreLayer, tmpdir } from "../fixture/fixture"

Log.init({ print: false })

const skillLayer = Layer.mergeAll(
  LayerNode.compile(Skill.node),
  LayerNode.compile(CrossSpawnSpawner.node),
  testInstanceStoreLayer,
)

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

async function patchSkill(dir: string, name: string, enabled: boolean) {
  return await Server.createApp({}).request(`/skill/${encodeURIComponent(name)}/enabled`, {
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
      config: { formatter: false, lsp: false },
      init: (dir) => writeSkill(dir),
    })

    const response = await patchSkill(tmp.path, "route-skill", false)

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

    const config = await Server.createApp({}).request("/config", {
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
      config: { formatter: false, lsp: false, permission: { skill: { "route-skill": "deny" } } },
      init: (dir) => writeSkill(dir),
    })

    const response = await patchSkill(tmp.path, "route-skill", true)

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
      config: { formatter: false, lsp: false, permission: { skill: "deny" } },
      init: async (dir) => {
        await writeSkill(dir, "route-skill")
        await writeSkill(dir, "other-skill")
      },
    })

    const response = await patchSkill(tmp.path, "route-skill", true)

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
      }).pipe(provideInstance(tmp.path), Effect.provide(skillLayer)),
    )

    expect(names).toContain("route-skill")
    expect(names).not.toContain("other-skill")
  })

  test("GET /skill returns backend effective enabled states", async () => {
    await using tmp = await tmpdir({
      config: { formatter: false, lsp: false, permission: { skill: { "*": "deny", "route-skill": "allow" } } },
      init: async (dir) => {
        await writeSkill(dir, "route-skill")
        await writeSkill(dir, "other-skill")
      },
    })

    const response = await Server.createApp({}).request("/skill", {
      headers: { "x-opencode-directory": tmp.path },
    })

    expect(response.status).toBe(200)
    const skills = (await response.json()) as Array<{ name: string; enabled: boolean }>
    expect(skills.find((item) => item.name === "route-skill")?.enabled).toBe(true)
    expect(skills.find((item) => item.name === "other-skill")?.enabled).toBe(false)
  })

  test("unknown skill returns 404 and does not write config", async () => {
    await using tmp = await tmpdir({ config: { formatter: false, lsp: false } })

    const response = await patchSkill(tmp.path, "missing-skill", false)

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
      config: { formatter: false, lsp: false },
      init: async (dir) => {
        await writeSkill(dir, "route-skill")
        await writeSkill(dir, "other-skill")
      },
    })

    const response = await patchSkill(tmp.path, "route-skill", false)
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
      }).pipe(provideInstance(tmp.path), Effect.provide(skillLayer)),
    )

    expect(names).not.toContain("route-skill")
    expect(names).toContain("other-skill")
  })

  test("disable then enable updates an already loaded Skill service without reload", async () => {
    await using tmp = await tmpdir({
      config: { formatter: false, lsp: false },
      init: (dir) => writeSkill(dir, "route-skill"),
    })

    const snapshots = await Effect.runPromise(
      Effect.gen(function* () {
        const skill = yield* Skill.Service
        const agent = { name: "build", mode: "primary" as const, permission: [], options: {} }
        const before = (yield* skill.available(agent)).map((item) => item.name)
        const disabled = yield* Effect.promise(() => patchSkill(tmp.path, "route-skill", false))
        const afterDisable = (yield* skill.available(agent)).map((item) => item.name)
        const enabled = yield* Effect.promise(() => patchSkill(tmp.path, "route-skill", true))
        const afterEnable = (yield* skill.available(agent)).map((item) => item.name)
        return { before, disabled: disabled.status, afterDisable, enabled: enabled.status, afterEnable }
      }).pipe(provideInstance(tmp.path), Effect.provide(skillLayer)),
    )

    expect(snapshots.before).toContain("route-skill")
    expect(snapshots.disabled).toBe(200)
    expect(snapshots.afterDisable).not.toContain("route-skill")
    expect(snapshots.enabled).toBe(200)
    expect(snapshots.afterEnable).toContain("route-skill")
  })
})
