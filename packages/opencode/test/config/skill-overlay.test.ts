import { describe, expect, test } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect } from "effect"
import { Config } from "../../src/config/config"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(Config.node))

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

  it.instance(
    "Config.get preserves shorthand skill permission as wildcard fallback when overlay is active",
    () =>
      Effect.gen(function* () {
        const config = yield* Config.Service
        const instance = yield* TestInstance
        Config.setSkillPermissionOverlay(instance.directory, "allowed-skill", "allow")
        yield* Effect.addFinalizer(() => Effect.sync(() => Config.clearSkillPermissionOverlay(instance.directory)))

        expect((yield* config.get()).permission?.skill).toEqual({
          "*": "deny",
          "allowed-skill": "allow",
        })
      }),
    { git: true, config: { permission: { skill: "deny" } } },
  )

  it.instance(
    "Config.get applies skill overlay after instance config is cached",
    () =>
      Effect.gen(function* () {
        const config = yield* Config.Service
        const instance = yield* TestInstance
        expect((yield* config.get()).permission?.skill).toBeUndefined()

        Config.setSkillPermissionOverlay(instance.directory, "cached-skill", "deny")
        yield* Effect.addFinalizer(() => Effect.sync(() => Config.clearSkillPermissionOverlay(instance.directory)))

        expect((yield* config.get()).permission?.skill).toEqual({
          "cached-skill": "deny",
        })
      }),
    { git: true },
  )
})
