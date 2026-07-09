import { describe, expect, test } from "bun:test"
import { Config } from "../../src/config/config"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("config skill permission overlay", () => {
  test("set/get/clear skill permission overlay by directory", () => {
    const dir = `overlay-${Date.now()}-${Math.random().toString(36).slice(2)}`

    expect(Config.getSkillPermissionOverlay(dir)).toEqual({})

    Config.setSkillPermissionOverlay(dir, "brainstorming", "deny")
    Config.setSkillPermissionOverlay(dir, "debugging", "allow")

    expect(Config.getSkillPermissionOverlay(dir)).toEqual({
      brainstorming: "deny",
      debugging: "allow",
    })

    Config.clearSkillPermissionOverlay(dir)

    expect(Config.getSkillPermissionOverlay(dir)).toEqual({})
  })

  test("Config.get preserves shorthand skill permission as wildcard fallback when overlay is active", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { permission: { skill: "deny" } },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        try {
          Config.setSkillPermissionOverlay(tmp.path, "allowed-skill", "allow")

          const cfg = await AppRuntime.runPromise(Config.use.get())

          expect(cfg.permission?.skill).toEqual({
            "*": "deny",
            "allowed-skill": "allow",
          })
        } finally {
          Config.clearSkillPermissionOverlay(tmp.path)
        }
      },
    })
  })

  test("Config.get applies skill overlay after instance config is cached", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        try {
          expect((await AppRuntime.runPromise(Config.use.get())).permission?.skill).toBeUndefined()

          Config.setSkillPermissionOverlay(tmp.path, "cached-skill", "deny")

          expect((await AppRuntime.runPromise(Config.use.get())).permission?.skill).toEqual({
            "cached-skill": "deny",
          })
        } finally {
          Config.clearSkillPermissionOverlay(tmp.path)
        }
      },
    })
  })
})
