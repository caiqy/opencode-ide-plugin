import { describe, expect, test } from "bun:test"
import path from "path"
import { Effect } from "effect"
import { Agent } from "../../src/agent/agent"
import { Config } from "../../src/config"
import { Permission } from "../../src/permission"
import { Instance } from "../../src/project/instance"
import { SystemPrompt } from "../../src/session/system"
import { provideInstance, tmpdir } from "../fixture/fixture"

function load<A>(dir: string, fn: (svc: Agent.Interface) => Effect.Effect<A>) {
  return Effect.runPromise(provideInstance(dir)(Agent.Service.use(fn)).pipe(Effect.provide(Agent.defaultLayer)))
}

describe("session.system", () => {
  test("skills output is sorted by name and stable across calls", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        for (const [name, description] of [
          ["zeta-skill", "Zeta skill."],
          ["alpha-skill", "Alpha skill."],
          ["middle-skill", "Middle skill."],
        ]) {
          const skillDir = path.join(dir, ".opencode", "skill", name)
          await Bun.write(
            path.join(skillDir, "SKILL.md"),
            `---
name: ${name}
description: ${description}
---

# ${name}
`,
          )
        }
      },
    })

    const home = process.env.OPENCODE_TEST_HOME
    process.env.OPENCODE_TEST_HOME = tmp.path

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const build = await load(tmp.path, (svc) => svc.get("build"))
          const runSkills = Effect.gen(function* () {
            const svc = yield* SystemPrompt.Service
            return yield* svc.skills(build!)
          }).pipe(Effect.provide(SystemPrompt.defaultLayer))

          const first = await Effect.runPromise(runSkills)
          const second = await Effect.runPromise(runSkills)

          expect(first).toBe(second)

          const alpha = first!.indexOf("<name>alpha-skill</name>")
          const middle = first!.indexOf("<name>middle-skill</name>")
          const zeta = first!.indexOf("<name>zeta-skill</name>")

          expect(alpha).toBeGreaterThan(-1)
          expect(middle).toBeGreaterThan(alpha)
          expect(zeta).toBeGreaterThan(middle)
        },
      })
    } finally {
      process.env.OPENCODE_TEST_HOME = home
    }
  })

  test("skills output omits skills denied by runtime overlay", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        for (const name of ["visible-skill", "hidden-skill"]) {
          await Bun.write(
            path.join(dir, ".opencode", "skill", name, "SKILL.md"),
            `---
name: ${name}
description: ${name} description.
---

# ${name}
`,
          )
        }
      },
    })

    const home = process.env.OPENCODE_TEST_HOME
    process.env.OPENCODE_TEST_HOME = tmp.path

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          Config.setSkillPermissionOverlay(tmp.path, "hidden-skill", "deny")
          const build = await load(tmp.path, (svc) => svc.get("build"))
          const output = await Effect.runPromise(
            Effect.gen(function* () {
              const svc = yield* SystemPrompt.Service
              return yield* svc.skills(build!)
            }).pipe(Effect.provide(SystemPrompt.defaultLayer)),
          )

          expect(output).toContain("<name>visible-skill</name>")
          expect(output).not.toContain("<name>hidden-skill</name>")
        },
      })
    } finally {
      process.env.OPENCODE_TEST_HOME = home
    }
  })

  test("skills output allows runtime overlay to override cached agent skill deny", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(
          path.join(dir, ".opencode", "skill", "restored-skill", "SKILL.md"),
          `---
name: restored-skill
description: Restored skill description.
---

# restored-skill
`,
        )
      },
    })

    const home = process.env.OPENCODE_TEST_HOME
    process.env.OPENCODE_TEST_HOME = tmp.path

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          try {
            Config.setSkillPermissionOverlay(tmp.path, "restored-skill", "allow")
            const agent: Agent.Info = {
              name: "cached-agent",
              mode: "primary",
              native: true,
              options: {},
              permission: Permission.fromConfig({ skill: "deny" }),
            }

            const output = await Effect.runPromise(
              Effect.gen(function* () {
                const svc = yield* SystemPrompt.Service
                return yield* svc.skills(agent)
              }).pipe(Effect.provide(SystemPrompt.defaultLayer)),
            )

            expect(output).toContain("<name>restored-skill</name>")
          } finally {
            Config.clearSkillPermissionOverlay(tmp.path)
          }
        },
      })
    } finally {
      process.env.OPENCODE_TEST_HOME = home
    }
  })
})
