import { Agent } from "@/agent/agent"
import { Command } from "@/command"
import * as ConfigFile from "@/config/config"
import * as InstanceState from "@/effect/instance-state"
import { Format } from "@/format"
import { Global } from "@opencode-ai/core/global"
import { LSP } from "@/lsp/lsp"
import { Permission } from "@/permission"
import { Vcs } from "@/project/vcs"
import { Skill } from "@/skill"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { notFound } from "../errors"
import { ApiVcsApplyError } from "../groups/instance"
import { markInstanceForDisposal } from "../lifecycle"

export const instanceHandlers = HttpApiBuilder.group(InstanceHttpApi, "instance", (handlers) =>
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const command = yield* Command.Service
    const format = yield* Format.Service
    const lsp = yield* LSP.Service
    const skill = yield* Skill.Service
    const config = yield* ConfigFile.Service
    const vcs = yield* Vcs.Service

    const dispose = Effect.fn("InstanceHttpApi.dispose")(function* () {
      yield* markInstanceForDisposal(yield* InstanceState.context)
      return true
    })

    const getPath = Effect.fn("InstanceHttpApi.path")(function* () {
      const ctx = yield* InstanceState.context
      return {
        home: Global.Path.home,
        state: Global.Path.state,
        config: Global.Path.config,
        configFile: ConfigFile.globalConfigFile(),
        worktree: ctx.worktree,
        directory: ctx.directory,
      }
    })

    const getVcs = Effect.fn("InstanceHttpApi.vcs")(function* () {
      const [branch, default_branch] = yield* Effect.all([vcs.branch(), vcs.defaultBranch()], {
        concurrency: "unbounded",
      })
      return { branch, default_branch }
    })

    const getVcsStatus = Effect.fn("InstanceHttpApi.vcsStatus")(function* () {
      return yield* vcs.status()
    })

    const getVcsDiff = Effect.fn("InstanceHttpApi.vcsDiff")(function* (ctx: {
      query: { mode: Vcs.Mode; context?: number }
    }) {
      return yield* vcs.diff(ctx.query.mode, { context: ctx.query.context })
    })

    const getVcsDiffRaw = Effect.fn("InstanceHttpApi.vcsDiffRaw")(function* () {
      return yield* vcs.diffRaw()
    })

    const applyVcs = Effect.fn("InstanceHttpApi.vcsApply")(function* (ctx: { payload: Vcs.ApplyInput }) {
      return yield* vcs.apply(ctx.payload).pipe(
        Effect.mapError(
          (error) =>
            new ApiVcsApplyError({
              name: "VcsApplyError",
              data: {
                message: error.message,
                reason: error.reason,
              },
            }),
        ),
      )
    })

    const getCommand = Effect.fn("InstanceHttpApi.command")(function* () {
      return yield* command.list()
    })

    const getAgent = Effect.fn("InstanceHttpApi.agent")(function* () {
      return yield* agent.list()
    })

    const getSkill = Effect.fn("InstanceHttpApi.skill")(function* () {
      const ruleset = Permission.fromConfig({ skill: (yield* config.get()).permission?.skill ?? {} })
      return (yield* skill.all()).map((item) => ({
        ...item,
        enabled: Permission.evaluate("skill", item.name, ruleset).action !== "deny",
      }))
    })

    const setSkillEnabled = Effect.fn("InstanceHttpApi.skillEnabled")(function* (ctx: {
      params: { name: string }
      payload: { enabled: boolean }
    }) {
      if (!(yield* skill.get(ctx.params.name))) return yield* notFound(`Skill not found: ${ctx.params.name}`)

      const action = ctx.payload.enabled ? "allow" : "deny"
      const directory = yield* InstanceState.directory
      const current = yield* config.get()
      const perm = current.permission as Record<string, unknown> | undefined
      const global = yield* config.getGlobal()
      const globalPerm = global.permission as Record<string, unknown> | undefined
      const existing = perm?.skill ?? globalPerm?.skill

      if (typeof existing === "string") {
        yield* config.patchProjectField(["permission", "skill"], undefined)
        yield* config.patchProjectField(["permission", "skill", "*"], existing)
      }

      yield* config.patchProjectField(["permission", "skill", ctx.params.name], action)
      ConfigFile.setSkillPermissionOverlay(directory, ctx.params.name, action)
      yield* agent.reloadModelConfig()
      return true
    })

    const getLsp = Effect.fn("InstanceHttpApi.lsp")(function* () {
      return yield* lsp.status()
    })

    const getFormatter = Effect.fn("InstanceHttpApi.formatter")(function* () {
      return yield* format.status()
    })

    return handlers
      .handle("dispose", dispose)
      .handle("path", getPath)
      .handle("vcs", getVcs)
      .handle("vcsStatus", getVcsStatus)
      .handle("vcsDiff", getVcsDiff)
      .handle("vcsDiffRaw", getVcsDiffRaw)
      .handle("vcsApply", applyVcs)
      .handle("command", getCommand)
      .handle("agent", getAgent)
      .handle("skill", getSkill)
      .handle("skillEnabled", setSkillEnabled)
      .handle("lsp", getLsp)
      .handle("formatter", getFormatter)
  }),
)
