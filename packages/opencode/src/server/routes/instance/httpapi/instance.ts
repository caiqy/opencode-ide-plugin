import { Agent } from "@/agent/agent"
import { Command } from "@/command"
import { Config } from "@/config"
import { globalConfigFile } from "@/config/config"
import { Format } from "@/format"
import { Global } from "@opencode-ai/core/global"
import { LSP } from "@/lsp"
import { Permission } from "@/permission"
import { Vcs } from "@/project"
import { Skill } from "@/skill"
import * as InstanceState from "@/effect/instance-state"
import { Effect, Layer, Schema } from "effect"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "./auth"
import { markInstanceForDisposal } from "./lifecycle"

const PathInfo = Schema.Struct({
  home: Schema.String,
  state: Schema.String,
  config: Schema.String,
  configFile: Schema.String,
  worktree: Schema.String,
  directory: Schema.String,
}).annotate({ identifier: "Path" })

const SkillInfo = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  location: Schema.String,
  content: Schema.String,
  enabled: Schema.Boolean,
}).annotate({ identifier: "Skill" })

const SkillEnabledPayload = Schema.Struct({
  enabled: Schema.Boolean,
})

const VcsDiffQuery = Schema.Struct({
  mode: Vcs.Mode,
})

export const InstancePaths = {
  dispose: "/instance/dispose",
  path: "/path",
  vcs: "/vcs",
  vcsDiff: "/vcs/diff",
  command: "/command",
  agent: "/agent",
  skill: "/skill",
  skillEnabled: "/skill/:name/enabled",
  lsp: "/lsp",
  formatter: "/formatter",
} as const

export const InstanceApi = HttpApi.make("instance")
  .add(
    HttpApiGroup.make("instance")
      .add(
        HttpApiEndpoint.post("dispose", InstancePaths.dispose, {
          success: Schema.Boolean,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "instance.dispose",
            summary: "Dispose instance",
            description: "Clean up and dispose the current OpenCode instance, releasing all resources.",
          }),
        ),
        HttpApiEndpoint.get("path", InstancePaths.path, {
          success: PathInfo,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "path.get",
            summary: "Get paths",
            description:
              "Retrieve the current working directory and related path information for the OpenCode instance.",
          }),
        ),
        HttpApiEndpoint.get("vcs", InstancePaths.vcs, {
          success: Vcs.Info,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "vcs.get",
            summary: "Get VCS info",
            description:
              "Retrieve version control system (VCS) information for the current project, such as git branch.",
          }),
        ),
        HttpApiEndpoint.get("vcsDiff", InstancePaths.vcsDiff, {
          query: VcsDiffQuery,
          success: Schema.Array(Vcs.FileDiff),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "vcs.diff",
            summary: "Get VCS diff",
            description: "Retrieve the current git diff for the working tree or against the default branch.",
          }),
        ),
        HttpApiEndpoint.get("command", InstancePaths.command, {
          success: Schema.Array(Command.Info),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "command.list",
            summary: "List commands",
            description: "Get a list of all available commands in the OpenCode system.",
          }),
        ),
        HttpApiEndpoint.get("agent", InstancePaths.agent, {
          success: Schema.Array(Agent.Info),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "app.agents",
            summary: "List agents",
            description: "Get a list of all available AI agents in the OpenCode system.",
          }),
        ),
        HttpApiEndpoint.get("skill", InstancePaths.skill, {
          success: Schema.Array(SkillInfo),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "app.skills",
            summary: "List skills",
            description: "Get a list of all available skills in the OpenCode system.",
          }),
        ),
        HttpApiEndpoint.patch("skillEnabled", InstancePaths.skillEnabled, {
          params: { name: Schema.String },
          payload: SkillEnabledPayload,
          success: Schema.Boolean,
          error: HttpApiError.NotFound,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "app.skill.enabled",
            summary: "Enable or disable skill",
            description: "Persist and apply the enabled state for one skill.",
          }),
        ),
        HttpApiEndpoint.get("lsp", InstancePaths.lsp, {
          success: Schema.Array(LSP.Status),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "lsp.status",
            summary: "Get LSP status",
            description: "Get LSP server status",
          }),
        ),
        HttpApiEndpoint.get("formatter", InstancePaths.formatter, {
          success: Schema.Array(Format.Status),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "formatter.status",
            summary: "Get formatter status",
            description: "Get formatter status",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "instance",
          description: "Experimental HttpApi instance routes.",
        }),
      )
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )

export const instanceHandlers = Layer.unwrap(
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const command = yield* Command.Service
    const format = yield* Format.Service
    const lsp = yield* LSP.Service
    const skill = yield* Skill.Service
    const config = yield* Config.Service
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
        configFile: globalConfigFile(),
        worktree: ctx.worktree,
        directory: ctx.directory,
      }
    })

    const getVcs = Effect.fn("InstanceHttpApi.vcs")(function* () {
      const [branch, default_branch] = yield* Effect.all([vcs.branch(), vcs.defaultBranch()], { concurrency: 2 })
      return { branch, default_branch }
    })

    const getVcsDiff = Effect.fn("InstanceHttpApi.vcsDiff")(function* (ctx: { query: { mode: Vcs.Mode } }) {
      return yield* vcs.diff(ctx.query.mode)
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
      payload: typeof SkillEnabledPayload.Type
    }) {
      if (!(yield* skill.get(ctx.params.name))) return yield* new HttpApiError.NotFound({})
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
      Config.setSkillPermissionOverlay(directory, ctx.params.name, action)
      return true
    })

    const getLsp = Effect.fn("InstanceHttpApi.lsp")(function* () {
      return yield* lsp.status()
    })

    const getFormatter = Effect.fn("InstanceHttpApi.formatter")(function* () {
      return yield* format.status()
    })

    return HttpApiBuilder.group(InstanceApi, "instance", (handlers) =>
      handlers
        .handle("dispose", dispose)
        .handle("path", getPath)
        .handle("vcs", getVcs)
        .handle("vcsDiff", getVcsDiff)
        .handle("command", getCommand)
        .handle("agent", getAgent)
        .handle("skill", getSkill)
        .handle("skillEnabled", setSkillEnabled)
        .handle("lsp", getLsp)
        .handle("formatter", getFormatter),
    )
  }),
).pipe(
  Layer.provide(Agent.defaultLayer),
  Layer.provide(Command.defaultLayer),
  Layer.provide(Format.defaultLayer),
  Layer.provide(LSP.defaultLayer),
  Layer.provide(Skill.defaultLayer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(Vcs.defaultLayer),
)
