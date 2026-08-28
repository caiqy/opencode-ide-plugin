import { afterEach, describe, expect } from "bun:test"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Cause, Deferred, Effect, Exit, Fiber, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { BackgroundJob } from "@/background/job"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Config } from "@/config/config"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Session } from "@/session/session"
import type { SessionPrompt } from "../../src/session/prompt"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"

import { TaskTool, type TaskPromptOps } from "../../src/tool/task"
import { Truncate } from "@/tool/truncate"
import { ToolRegistry } from "@/tool/registry"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { disposeAllInstances } from "../fixture/fixture"
import { pollWithTimeout, testEffect } from "../lib/effect"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { ApprovalV1 } from "@opencode-ai/core/v1/approval"
import { Approval } from "@opencode-ai/core/approval"

afterEach(async () => {
  await disposeAllInstances()
})

const ref = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test-model"),
}

const layer = (flags: Partial<RuntimeFlags.Info> = {}) =>
  LayerNode.compile(
    LayerNode.group([
      Agent.node,
      BackgroundJob.node,
      EventV2Bridge.node,
      Config.node,
      CrossSpawnSpawner.node,
      Session.node,
      SessionProjector.node,
      SessionRunState.node,
      SessionStatus.node,
      Truncate.node,
      ToolRegistry.node,
      Database.node,
      RuntimeFlags.node,
      Ripgrep.node,
    ]),
    [[RuntimeFlags.node, RuntimeFlags.layer(flags)]],
  )

const it = testEffect(layer())
const background = testEffect(layer({ experimentalBackgroundSubagents: true }))
const backgroundLimited = testEffect(layer({ experimentalBackgroundSubagents: true }))

function defer<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const seed = Effect.fn("TaskToolTest.seed")(function* (title = "Pinned", tools?: Record<string, boolean>) {
  const session = yield* Session.Service
  const chat = yield* session.create({ title })
  const user = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID: chat.id,
    agent: "build",
    model: ref,
    tools,
    time: { created: Date.now() },
  })
  const assistant: SessionV1.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    parentID: user.id,
    sessionID: chat.id,
    mode: "build",
    agent: "build",
    cost: 0,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    variant: "xhigh",
    time: { created: Date.now() },
  }
  yield* session.updateMessage(assistant)
  return { chat, assistant }
})

function stubOps(opts?: { onPrompt?: (input: SessionPrompt.PromptInput) => void; text?: string }): TaskPromptOps {
  return {
    cancel: () => Effect.void,
    resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
    prompt: (input) =>
      Effect.sync(() => {
        opts?.onPrompt?.(input)
        return reply(input, opts?.text ?? "done")
      }),
  }
}

function reply(input: SessionPrompt.PromptInput, text: string): SessionV1.WithParts {
  const id = MessageID.ascending()
  return {
    info: {
      id,
      role: "assistant",
      parentID: input.messageID ?? MessageID.ascending(),
      sessionID: input.sessionID,
      mode: input.agent ?? "general",
      agent: input.agent ?? "general",
      cost: 0,
      path: { cwd: "/tmp", root: "/tmp" },
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: input.model?.modelID ?? ref.modelID,
      providerID: input.model?.providerID ?? ref.providerID,
      time: { created: Date.now() },
      finish: "stop",
    },
    parts: [
      {
        id: PartID.ascending(),
        messageID: id,
        sessionID: input.sessionID,
        type: "text",
        text,
      },
    ],
  }
}

describe("tool.task", () => {
  it.instance(
    "description sorts subagents by name and is stable across calls",
    () =>
      Effect.gen(function* () {
        const agent = yield* Agent.Service
        const build = yield* agent.get("build")
        const registry = yield* ToolRegistry.Service
        const get = Effect.fnUntraced(function* () {
          const tools = yield* registry.tools({ ...ref, agent: build })
          return tools.find((tool) => tool.id === TaskTool.id)?.description ?? ""
        })
        const first = yield* get()
        const second = yield* get()

        expect(first).toBe(second)

        const alpha = first.indexOf("- alpha: Alpha agent")
        const explore = first.indexOf("- explore:")
        const general = first.indexOf("- general:")
        const zebra = first.indexOf("- zebra: Zebra agent")

        expect(alpha).toBeGreaterThan(-1)
        expect(explore).toBeGreaterThan(alpha)
        expect(general).toBeGreaterThan(explore)
        expect(zebra).toBeGreaterThan(general)
      }),
    {
      config: {
        agent: {
          zebra: {
            description: "Zebra agent",
            mode: "subagent",
          },
          alpha: {
            description: "Alpha agent",
            mode: "subagent",
          },
        },
      },
    },
  )

  it.instance(
    "description hides denied subagents for the caller",
    () =>
      Effect.gen(function* () {
        const agent = yield* Agent.Service
        const build = yield* agent.get("build")
        const registry = yield* ToolRegistry.Service
        const description =
          (yield* registry.tools({ ...ref, agent: build })).find((tool) => tool.id === TaskTool.id)?.description ?? ""

        expect(description).toContain("- alpha: Alpha agent")
        expect(description).not.toContain("- zebra: Zebra agent")
      }),
    {
      config: {
        permission: {
          task: {
            "*": "allow",
            zebra: "deny",
          },
        },
        agent: {
          zebra: {
            description: "Zebra agent",
            mode: "subagent",
          },
          alpha: {
            description: "Alpha agent",
            mode: "subagent",
          },
        },
      },
    },
  )

  it.instance(
    "execute exposes provider retry config to the task child session",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const config = yield* Config.Service
        const { chat, assistant } = yield* seed()
        const tool = yield* TaskTool
        const def = yield* tool.init()
        let seen = false
        const promptOps: TaskPromptOps = {
          cancel: () => Effect.void,
          resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
          prompt: (input) =>
            Effect.gen(function* () {
              expect((yield* sessions.get(input.sessionID).pipe(Effect.orDie)).parentID).toBe(chat.id)
              expect((yield* config.get()).provider_retry?.max_retries).toBe(0)
              seen = true
              return reply(input, "done")
            }),
        }

        yield* def.execute(
          {
            description: "inspect retry",
            prompt: "check retry config",
            subagent_type: "general",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

        expect(seen).toBe(true)
      }),
    { config: { provider_retry: { max_retries: 0 } } },
  )

  it.instance("execute resumes an existing task session from task_id", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed("Pinned", { bash: false })
      yield* sessions.setPermission({ sessionID: chat.id, permission: [ApprovalV1.rule("full")] })
      Approval.runtime.set(chat.id, "manual")
      const child = yield* sessions.create({
        parentID: chat.id,
        title: "Existing child",
        agent: "general",
        permission: [{ permission: "bash", pattern: "rm *", action: "deny" }, ApprovalV1.rule("manual")],
      })
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let seen: SessionPrompt.PromptInput | undefined
      const promptOps = stubOps({ text: "resumed", onPrompt: (input) => (seen = input) })

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          task_id: child.id,
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const kids = yield* sessions.children(chat.id)
      expect(kids).toHaveLength(1)
      expect(kids[0]?.id).toBe(child.id)
      expect(result.metadata.sessionId).toBe(child.id)
      expect(result.output).toContain(`<task id="${child.id}" state="completed">`)
      expect(seen?.sessionID).toBe(child.id)
      expect(seen?.variant).toBe("xhigh")
      expect(seen?.tools).toEqual({ bash: false })
      const resumed = yield* sessions.get(child.id)
      expect(ApprovalV1.modeFromRuleset(resumed.permission ?? [])).toBe("full")
      expect(Approval.runtime.get(child.id)).toBe("manual")
      expect(resumed.permission).toContainEqual({ permission: "bash", pattern: "rm *", action: "deny" })
    }),
  )

  it.instance("execute preserves a child approval marker when the parent has no approval source", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const child = yield* sessions.create({
        parentID: chat.id,
        title: "Automatic child",
        agent: "general",
        permission: [ApprovalV1.rule("automatic")],
      })
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let reviewed = 0
      const unregister = Approval.runtime.register(
        child.id,
        Effect.void,
        Effect.void,
        Approval.runtime.revision(child.id),
        Approval.runtime.lifecycle(child.id),
        Effect.sync(() => reviewed++),
      )
      yield* Effect.addFinalizer(() => Effect.sync(() => unregister?.()))

      yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          task_id: child.id,
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps: stubOps() },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      expect(ApprovalV1.modeFromRuleset((yield* sessions.get(child.id)).permission ?? [])).toBe("automatic")
      expect(Approval.runtime.get(child.id)).toBe("automatic")
      expect(reviewed).toBe(1)
    }),
  )

  it.instance("execute keeps runtime-only parent approval out of the child marker", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      Approval.runtime.set(chat.id, "full")
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps: stubOps() },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const child = yield* sessions.get(result.metadata.sessionId)
      expect(child.permission?.some((rule) => rule.permission === ApprovalV1.RulePermission)).not.toBe(true)
      expect(Approval.runtime.get(child.id)).toBe("full")
    }),
  )

  it.instance("execute does not restore a cleared parent marker while resuming task_id", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      yield* sessions.setPermission({ sessionID: chat.id, permission: [ApprovalV1.rule("full")] })
      Approval.runtime.clear(chat.id)
      const child = yield* sessions.create({
        parentID: chat.id,
        title: "Stale full child",
        agent: "general",
        permission: [ApprovalV1.rule("full")],
      })
      const tool = yield* TaskTool
      const def = yield* tool.init()

      yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          task_id: child.id,
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps: stubOps() },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      expect(Approval.runtime.get(child.id)).toBeUndefined()
      expect((yield* sessions.get(child.id)).permission).not.toContainEqual(
        expect.objectContaining({ permission: ApprovalV1.RulePermission }),
      )
    }),
  )

  it.instance("execute rejects task_id owned by another parent or agent", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const other = yield* sessions.create({ title: "Other parent" })
      const foreign = yield* sessions.create({ parentID: other.id, title: "Foreign child", agent: "general" })
      const wrongAgent = yield* sessions.create({ parentID: chat.id, title: "Wrong agent", agent: "explore" })
      const tool = yield* TaskTool
      const def = yield* tool.init()

      for (const child of [foreign, wrongAgent, chat]) {
        const exit = yield* def
          .execute(
            {
              description: "inspect bug",
              prompt: "look into the cache key path",
              subagent_type: "general",
              task_id: child.id,
            },
            {
              sessionID: chat.id,
              messageID: assistant.id,
              agent: "build",
              abort: new AbortController().signal,
              extra: { promptOps: stubOps() },
              messages: [],
              metadata: () => Effect.void,
              ask: () => Effect.void,
            },
          )
          .pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("does not belong")
      }
    }),
  )

  it.instance(
    "execute rejects an ancestor task_id without taking the ancestor lock",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const { chat, assistant: rootAssistant } = yield* seed()
        const parent = yield* sessions.create({ parentID: chat.id, title: "Parent", agent: "general" })
        const child = yield* sessions.create({ parentID: parent.id, title: "Child", agent: "general" })
        const user = yield* sessions.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: child.id,
          agent: "general",
          model: ref,
          time: { created: Date.now() },
        })
        const assistant = yield* sessions.updateMessage({
          ...rootAssistant,
          id: MessageID.ascending(),
          parentID: user.id,
          sessionID: child.id,
          mode: "general",
          agent: "general",
        })
        const tool = yield* TaskTool
        const def = yield* tool.init()

        const exit = yield* def
          .execute(
            {
              description: "inspect ancestor",
              prompt: "inspect the parent",
              subagent_type: "general",
              task_id: parent.id,
            },
            {
              sessionID: child.id,
              messageID: assistant.id,
              agent: "general",
              abort: new AbortController().signal,
              extra: { promptOps: stubOps() },
              messages: [],
              metadata: () => Effect.void,
              ask: () => Effect.void,
            },
          )
          .pipe(Effect.exit)

        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("does not belong")
      }),
    { config: { subagent_depth: 3 } },
  )

  it.instance("execute asks by default and skips checks when bypassed", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const calls: unknown[] = []
      const promptOps = stubOps()

      const exec = (extra?: Record<string, any>) =>
        def.execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "general",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps, ...extra },
            messages: [],
            metadata: () => Effect.void,
            ask: (input) =>
              Effect.sync(() => {
                calls.push(input)
              }),
          },
        )

      yield* exec()
      yield* exec({ bypassAgentCheck: true })

      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({
        permission: "task",
        patterns: ["general"],
        always: ["*"],
        metadata: {
          description: "inspect bug",
          subagent_type: "general",
        },
      })
    }),
  )

  it.instance("execute cancels child session when abort signal fires", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const ready = defer<SessionPrompt.PromptInput>()
      const cancelled = defer<SessionID>()
      const abort = new AbortController()
      const promptOps: TaskPromptOps = {
        cancel: (sessionID) =>
          Effect.sync(() => {
            cancelled.resolve(sessionID)
          }),
        resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
        prompt: (input) =>
          Effect.promise(() => {
            ready.resolve(input)
            return cancelled.promise
          }).pipe(Effect.as(reply(input, "cancelled"))),
      }

      const fiber = yield* def
        .execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "general",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: abort.signal,
            extra: { promptOps },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )
        .pipe(Effect.forkChild)

      const input = yield* Effect.promise(() => ready.promise)
      abort.abort()
      expect(yield* Effect.promise(() => cancelled.promise)).toBe(input.sessionID)

      const exit = yield* Fiber.await(fiber)
      expect(Exit.isSuccess(exit)).toBe(true)
    }),
  )

  it.instance("execute rejects an already aborted task before requesting permission", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const abort = new AbortController()
      abort.abort()
      let asked = false

      const exit = yield* def
        .execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "general",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: abort.signal,
            extra: { promptOps: stubOps() },
            messages: [],
            metadata: () => Effect.void,
            ask: () =>
              Effect.sync(() => {
                asked = true
              }),
          },
        )
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("Task cancelled")
      expect(asked).toBe(false)
    }),
  )

  it.instance("execute creates a child when task_id does not exist", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let seen: SessionPrompt.PromptInput | undefined
      const promptOps = stubOps({ text: "created", onPrompt: (input) => (seen = input) })

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          task_id: "ses_missing",
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const kids = yield* sessions.children(chat.id)
      expect(kids).toHaveLength(1)
      expect(kids[0]?.id).toBe(result.metadata.sessionId)
      expect(result.metadata.sessionId).not.toBe("ses_missing")
      expect(result.output).toContain(`<task id="${result.metadata.sessionId}" state="completed">`)
      expect(seen?.sessionID).toBe(result.metadata.sessionId)
    }),
  )

  it.instance("prevents subagents from launching subagents by default", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const child = yield* sessions.create({ parentID: chat.id, title: "child" })
      const nestedAssistant = yield* sessions.updateMessage({
        ...assistant,
        id: MessageID.ascending(),
        parentID: MessageID.ascending(),
        sessionID: child.id,
      })
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let asked = false

      const exit = yield* def
        .execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "general",
          },
          {
            sessionID: child.id,
            messageID: nestedAssistant.id,
            agent: "general",
            abort: new AbortController().signal,
            extra: { promptOps: stubOps() },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.sync(() => (asked = true)),
          },
        )
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      expect(asked).toBe(false)
      expect(yield* sessions.children(child.id)).toHaveLength(0)
    }),
  )

  it.instance("rejects hidden agents like approval as task targets", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const exit = yield* def
        .execute(
          {
            description: "approve something",
            prompt: "assess this permission request",
            subagent_type: "approval",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps: stubOps() },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("hidden")
      expect(yield* sessions.children(chat.id)).toHaveLength(0)
    }),
  )

  it.instance(
    "allows nested subagents up to the configured depth",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const { chat, assistant } = yield* seed()
        const child = yield* sessions.create({ parentID: chat.id, title: "child" })
        const nestedUser = yield* sessions.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: child.id,
          agent: "general",
          model: ref,
          time: { created: Date.now() },
        })
        const nestedAssistant = yield* sessions.updateMessage({
          ...assistant,
          id: MessageID.ascending(),
          parentID: nestedUser.id,
          sessionID: child.id,
        })
        const tool = yield* TaskTool
        const def = yield* tool.init()

        const result = yield* def.execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "general",
          },
          {
            sessionID: child.id,
            messageID: nestedAssistant.id,
            agent: "general",
            abort: new AbortController().signal,
            extra: { promptOps: stubOps() },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

        const grandchild = yield* sessions.get(result.metadata.sessionId)
        expect(grandchild.parentID).toBe(child.id)
        expect(child.permission?.some((rule) => rule.permission === ApprovalV1.RulePermission)).not.toBe(true)
        expect(grandchild.permission?.some((rule) => rule.permission === ApprovalV1.RulePermission)).not.toBe(true)
      }),
    { config: { subagent_depth: 2 } },
  )

  it.instance(
    "execute shapes child permissions for task, todowrite, and primary tools",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const { chat, assistant } = yield* seed()
        const tool = yield* TaskTool
        const def = yield* tool.init()
        let seen: SessionPrompt.PromptInput | undefined
        const promptOps = stubOps({ onPrompt: (input) => (seen = input) })

        const result = yield* def.execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "reviewer",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

        const child = yield* sessions.get(result.metadata.sessionId)
        expect(child.parentID).toBe(chat.id)
        expect(child.agent).toBe("reviewer")
        expect(child.permission).toEqual([
          {
            permission: "todowrite",
            pattern: "*",
            action: "deny",
          },
          {
            permission: "task",
            pattern: "*",
            action: "deny",
          },
          {
            permission: "bash",
            pattern: "*",
            action: "deny",
          },
          {
            permission: "read",
            pattern: "*",
            action: "deny",
          },
        ])
        expect(seen?.tools).toBeUndefined()
      }),
    {
      config: {
        agent: {
          reviewer: {
            mode: "subagent",
            permission: {
              task: "allow",
            },
          },
        },
        experimental: {
          primary_tools: ["bash", "read"],
        },
      },
    },
  )

  it.instance("rejects background execution when the experiment is disabled", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const exit = yield* def
        .execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "general",
            background: true,
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps: stubOps() },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )

  it.instance("promotes a running foreground task without restarting it", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const { chat, assistant } = yield* seed("Pinned", { bash: false })
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const ready = yield* Deferred.make<void>()
      const done = yield* Deferred.make<void>()
      const injected = yield* Deferred.make<{
        input: SessionPrompt.PromptInput
        options: SessionPrompt.PromptOptions | undefined
      }>()
      let runs = 0
      const promptOps: TaskPromptOps = {
        cancel: () => Effect.void,
        resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
        prompt: (input, options) => {
          if (input.sessionID === chat.id) {
            return Deferred.succeed(injected, { input, options }).pipe(Effect.as(reply(input, "injected")))
          }
          return Effect.gen(function* () {
            runs += 1
            yield* Deferred.succeed(ready, undefined)
            yield* Deferred.await(done)
            return reply(input, "background done")
          })
        },
      }

      const fiber = yield* def
        .execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "general",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )
        .pipe(Effect.forkChild)

      yield* Deferred.await(ready)
      const job = (yield* jobs.list())[0]
      expect(job).toBeDefined()
      if (!job) throw new Error("task job not found")
      expect(job.metadata?.parentSessionId).toBe(chat.id)
      yield* jobs.promote(job.id)

      const result = yield* Fiber.join(fiber)
      expect(result.metadata.background).toBe(true)
      expect(result.output).toContain(`state="running"`)
      expect((yield* jobs.get(result.metadata.sessionId))?.status).toBe("running")
      expect(runs).toBe(1)

      yield* Deferred.succeed(done, undefined)
      expect((yield* jobs.wait({ id: result.metadata.sessionId })).info?.output).toBe("background done")
      const notification = yield* Deferred.await(injected)
      expect(notification.input.parts[0]?.type).toBe("text")
      expect(notification.input.tools).toEqual({ bash: false })
      expect(notification.options).toEqual({ persistTools: false })
      expect(runs).toBe(1)
    }),
  )

  background.instance("execute launches background tasks without waiting for completion", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          background: true,
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: {
            promptOps: {
              ...stubOps(),
              prompt: () => Effect.never,
            } satisfies TaskPromptOps,
          },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const job = yield* jobs.get(result.metadata.sessionId)
      expect(result.metadata.background).toBe(true)
      expect(result.output).toContain(`state="running"`)
      expect(job?.status).toBe("running")
    }),
  )

  backgroundLimited.instance(
    "background tasks retain their queue slot until completion",
    () =>
      Effect.gen(function* () {
        const jobs = yield* BackgroundJob.Service
        const { chat, assistant } = yield* seed()
        const tool = yield* TaskTool
        const def = yield* tool.init()
        const firstStarted = defer<void>()
        const firstDone = defer<void>()
        const secondStarted = defer<void>()
        let runs = 0
        const promptOps: TaskPromptOps = {
          ...stubOps(),
          prompt: (input) => {
            if (input.sessionID === chat.id) return Effect.succeed(reply(input, "notified"))
            runs++
            if (runs === 1)
              return Effect.promise(() => {
                firstStarted.resolve()
                return firstDone.promise
              }).pipe(Effect.as(reply(input, "first done")))
            secondStarted.resolve()
            return Effect.succeed(reply(input, "second done"))
          },
        }
        const context = (abort: AbortSignal) => ({
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        })

        const first = yield* def.execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "general",
            background: true,
          },
          context(new AbortController().signal),
        )
        yield* Effect.promise(() => firstStarted.promise)

        const second = yield* def.execute(
          {
            description: "inspect follow-up",
            prompt: "look into the follow-up path",
            subagent_type: "general",
            background: true,
          },
          context(new AbortController().signal),
        )

        expect(second.metadata.background).toBe(true)
        expect(runs).toBe(1)
        firstDone.resolve()
        yield* Effect.promise(() => secondStarted.promise)
        expect(runs).toBe(2)
        expect((yield* jobs.wait({ id: first.metadata.sessionId })).info?.status).toBe("completed")
      }),
    { config: { parallel_limit: { subagent: 1 } } },
  )

  backgroundLimited.instance(
    "cancelling a queued background task frees the next slot",
    () =>
      Effect.gen(function* () {
        const jobs = yield* BackgroundJob.Service
        const { chat, assistant } = yield* seed()
        const tool = yield* TaskTool
        const def = yield* tool.init()
        const firstStarted = defer<void>()
        const firstDone = defer<void>()
        const thirdStarted = defer<void>()
        let runs = 0
        const promptOps: TaskPromptOps = {
          ...stubOps(),
          prompt: (input) => {
            if (input.sessionID === chat.id) return Effect.succeed(reply(input, "notified"))
            runs++
            if (runs === 1)
              return Effect.promise(() => {
                firstStarted.resolve()
                return firstDone.promise
              }).pipe(Effect.as(reply(input, "first done")))
            thirdStarted.resolve()
            return Effect.succeed(reply(input, "third done"))
          },
        }
        const context = {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        }
        const first = yield* def.execute(
          {
            description: "first task",
            prompt: "first prompt",
            subagent_type: "general",
            background: true,
          },
          context,
        )
        yield* Effect.promise(() => firstStarted.promise)
        const second = yield* def.execute(
          {
            description: "second task",
            prompt: "second prompt",
            subagent_type: "general",
            background: true,
          },
          context,
        )

        yield* jobs.cancel(second.metadata.sessionId)
        firstDone.resolve()
        expect((yield* jobs.wait({ id: first.metadata.sessionId })).info?.status).toBe("completed")

        const third = yield* def.execute(
          {
            description: "third task",
            prompt: "third prompt",
            subagent_type: "general",
            background: true,
          },
          context,
        )
        yield* Effect.promise(() => thirdStarted.promise)

        expect(third.metadata.background).toBe(true)
        expect(runs).toBe(2)
      }),
    { config: { parallel_limit: { subagent: 1 } } },
  )

  backgroundLimited.instance(
    "promoting a queued task returns before it receives a slot",
    () =>
      Effect.gen(function* () {
        const jobs = yield* BackgroundJob.Service
        const sessions = yield* Session.Service
        const { chat, assistant } = yield* seed()
        const queued = yield* sessions.create({ parentID: chat.id, title: "Queued", agent: "general" })
        const tool = yield* TaskTool
        const def = yield* tool.init()
        const firstStarted = defer<void>()
        const firstDone = defer<void>()
        let runs = 0
        const promptOps: TaskPromptOps = {
          ...stubOps(),
          prompt: (input) => {
            if (input.sessionID === chat.id) return Effect.succeed(reply(input, "notified"))
            runs++
            if (runs === 1)
              return Effect.promise(() => {
                firstStarted.resolve()
                return firstDone.promise
              }).pipe(Effect.as(reply(input, "first done")))
            return Effect.succeed(reply(input, "queued done"))
          },
        }
        const context = {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        }
        yield* def.execute(
          {
            description: "first task",
            prompt: "first prompt",
            subagent_type: "general",
            background: true,
          },
          context,
        )
        yield* Effect.promise(() => firstStarted.promise)

        const pending = yield* def
          .execute(
            {
              description: "queued task",
              prompt: "queued prompt",
              subagent_type: "general",
              task_id: queued.id,
            },
            context,
          )
          .pipe(Effect.forkChild)
        yield* pollWithTimeout(
          jobs.get(queued.id).pipe(Effect.map((job) => (job?.status === "running" ? true : undefined))),
          "queued task never started",
        )

        yield* jobs.promote(queued.id)
        const result = yield* Fiber.join(pending)

        expect(result.metadata.background).toBe(true)
        expect(runs).toBe(1)
        firstDone.resolve()
      }),
    { config: { parallel_limit: { subagent: 1 } } },
  )

  background.instance("does not extend a background task after cancellation during permission", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const started = defer<void>()
      let runs = 0
      const promptOps: TaskPromptOps = {
        ...stubOps(),
        prompt: (input) => {
          if (input.sessionID === chat.id) return Effect.succeed(reply(input, "notified"))
          runs++
          started.resolve()
          return Effect.never
        },
      }
      const context = (abort: AbortSignal, ask = () => Effect.void) => ({
        sessionID: chat.id,
        messageID: assistant.id,
        agent: "build",
        abort,
        extra: { promptOps },
        messages: [],
        metadata: () => Effect.void,
        ask,
      })
      const first = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          background: true,
        },
        context(new AbortController().signal),
      )
      yield* Effect.promise(() => started.promise)

      const abort = new AbortController()
      const exit = yield* def
        .execute(
          {
            description: "inspect follow-up",
            prompt: "look into the follow-up path",
            subagent_type: "general",
            task_id: first.metadata.sessionId,
          },
          context(abort.signal, () =>
            Effect.sync(() => {
              abort.abort()
            }),
          ),
        )
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      expect(runs).toBe(1)
      yield* jobs.cancel(first.metadata.sessionId)
    }),
  )

  background.instance("background task completion waits for running updates", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const first = defer<void>()
      const second = defer<void>()
      const updated = defer<SessionPrompt.PromptInput>()
      const injected = defer<SessionPrompt.PromptInput>()
      let prompts = 0
      const promptOps: TaskPromptOps = {
        ...stubOps(),
        prompt: (input) => {
          if (input.sessionID === chat.id) {
            injected.resolve(input)
            return Effect.succeed(reply(input, "done"))
          }
          prompts++
          if (prompts === 1) return Effect.promise(() => first.promise).pipe(Effect.as(reply(input, "first done")))
          updated.resolve(input)
          return Effect.promise(() => second.promise).pipe(Effect.as(reply(input, "second done")))
        },
      }
      const context = {
        sessionID: chat.id,
        messageID: assistant.id,
        agent: "build",
        abort: new AbortController().signal,
        extra: { promptOps },
        messages: [],
        metadata: () => Effect.void,
        ask: () => Effect.void,
      }

      const started = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          background: true,
        },
        context,
      )
      const result = yield* def.execute(
        {
          description: "add investigation scope",
          prompt: "also inspect cancellation",
          subagent_type: "general",
          task_id: started.metadata.sessionId,
        },
        context,
      )

      expect(result.metadata.sessionId).toBe(started.metadata.sessionId)
      expect(result.metadata.background).toBe(true)
      expect(result.output).toContain("Background task updated")
      first.resolve()
      expect((yield* jobs.get(started.metadata.sessionId))?.status).toBe("running")
      expect((yield* Effect.promise(() => updated.promise)).parts).toEqual([
        { type: "text", text: "also inspect cancellation" },
      ])

      second.resolve()
      const waited = yield* jobs.wait({ id: started.metadata.sessionId, timeout: 1_000 })
      expect(waited.info?.status).toBe("completed")
      expect(waited.info?.output).toBe("second done")
      const notification = yield* Effect.promise(() => injected.promise)
      expect(notification.variant).toBe("xhigh")
      expect(notification.parts[0]?.type).toBe("text")
      if (notification.parts[0]?.type === "text") expect(notification.parts[0].text).toContain("second done")
    }),
  )

  background.instance("background tasks complete through the background job service", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          background: true,
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps: stubOps({ text: "background done" }) },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const waited = yield* jobs.wait({ id: result.metadata.sessionId, timeout: 1_000 })
      expect(waited.timedOut).toBe(false)
      expect(waited.info?.status).toBe("completed")
      expect(waited.info?.output).toBe("background done")
    }),
  )

  background.instance("background task completion does not wait for the parent async prompt", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          background: true,
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: {
            promptOps: {
              ...stubOps({ text: "background done" }),
              prompt: (input) =>
                input.sessionID === chat.id ? Effect.never : Effect.succeed(reply(input, "background done")),
            } satisfies TaskPromptOps,
          },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const waited = yield* jobs.wait({ id: result.metadata.sessionId, timeout: 1_000 })
      expect(waited.timedOut).toBe(false)
      expect(waited.info?.status).toBe("completed")
    }),
  )

  background.instance("removing the parent session cancels running background tasks", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          background: true,
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: {
            promptOps: {
              ...stubOps(),
              prompt: () => Effect.never,
            } satisfies TaskPromptOps,
          },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      yield* sessions.remove(chat.id)
      const waited = yield* jobs.wait({ id: result.metadata.sessionId, timeout: 1_000 })
      expect(waited.timedOut).toBe(false)
      expect(waited.info?.status).toBe("cancelled")
    }),
  )

  background.instance("removing the child task session cancels its running background task", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          background: true,
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: {
            promptOps: {
              ...stubOps(),
              prompt: () => Effect.never,
            } satisfies TaskPromptOps,
          },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      yield* sessions.remove(result.metadata.sessionId)
      const waited = yield* jobs.wait({ id: result.metadata.sessionId, timeout: 1_000 })
      expect(waited.timedOut).toBe(false)
      expect(waited.info?.status).toBe("cancelled")
    }),
  )

  background.instance(
    "cancelling an intermediate ancestor closes descendant task admission",
    () =>
      Effect.gen(function* () {
        const jobs = yield* BackgroundJob.Service
        const runState = yield* SessionRunState.Service
        const sessions = yield* Session.Service
        const { chat, assistant: rootAssistant } = yield* seed()
        const middle = yield* sessions.create({ parentID: chat.id, title: "Middle", agent: "general" })
        const parent = yield* sessions.create({ parentID: middle.id, title: "Parent", agent: "general" })
        const user = yield* sessions.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: parent.id,
          agent: "general",
          model: ref,
          time: { created: Date.now() },
        })
        const assistant = yield* sessions.updateMessage({
          ...rootAssistant,
          id: MessageID.ascending(),
          parentID: user.id,
          sessionID: parent.id,
          mode: "general",
          agent: "general",
        })
        const tool = yield* TaskTool
        const def = yield* tool.init()

        yield* runState.cancel(middle.id)
        const exit = yield* def
          .execute(
            {
              description: "late descendant",
              prompt: "start after ancestor cancellation",
              subagent_type: "general",
              background: true,
            },
            {
              sessionID: parent.id,
              messageID: assistant.id,
              agent: "general",
              abort: new AbortController().signal,
              extra: { promptOps: { ...stubOps(), prompt: () => Effect.never } satisfies TaskPromptOps },
              messages: [],
              metadata: () => Effect.void,
              ask: () => Effect.void,
            },
          )
          .pipe(Effect.exit)

        expect(Exit.isFailure(exit)).toBe(true)
        expect((yield* jobs.list()).filter((job) => job.metadata?.parentSessionId === parent.id)).toHaveLength(0)
        expect(yield* sessions.children(parent.id)).toHaveLength(0)
      }),
    { config: { subagent_depth: 3 } },
  )

  background.instance("removing a parent fences task registration after child creation", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const childCreated = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const task = yield* def
        .execute(
          {
            description: "racing task",
            prompt: "register after deletion",
            subagent_type: "general",
            background: true,
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps: { ...stubOps(), prompt: () => Effect.never } satisfies TaskPromptOps },
            messages: [],
            metadata: () =>
              Deferred.succeed(childCreated, undefined).pipe(Effect.andThen(Deferred.await(release)), Effect.asVoid),
            ask: () => Effect.void,
          },
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(childCreated)

      yield* sessions.remove(chat.id)
      yield* Deferred.succeed(release, undefined)
      expect(Exit.isFailure(yield* Fiber.await(task))).toBe(true)
      expect(yield* jobs.list()).toHaveLength(0)
    }),
  )

  background.instance("cancelling the parent run cancels running background tasks", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const runState = yield* SessionRunState.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          background: true,
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: {
            promptOps: {
              ...stubOps(),
              prompt: () => Effect.never,
            } satisfies TaskPromptOps,
          },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      yield* runState.cancel(chat.id)
      const waited = yield* jobs.wait({ id: result.metadata.sessionId, timeout: 1_000 })
      expect(waited.timedOut).toBe(false)
      expect(waited.info?.status).toBe("cancelled")
    }),
  )

  it.instance("cancelling an old run does not cancel a new background task", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const runState = yield* SessionRunState.Service
      const { chat, assistant } = yield* seed()
      const started = yield* Deferred.make<void>()
      const interrupted = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const stopped = { info: assistant, parts: [] } satisfies SessionV1.WithParts

      yield* runState
        .ensureRunning(
          chat.id,
          Effect.succeed(stopped),
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.ensuring(Deferred.succeed(interrupted, undefined).pipe(Effect.andThen(Deferred.await(release)))),
          ),
        )
        .pipe(Effect.forkChild)

      yield* Deferred.await(started)
      const cancelling = yield* runState.cancel(chat.id).pipe(Effect.forkChild)
      yield* Deferred.await(interrupted)

      yield* runState
        .ensureRunning(
          chat.id,
          Effect.succeed(stopped),
          jobs
            .startOwnedIfOpen({
              id: "new-task",
              type: "task",
              metadata: { parentSessionId: chat.id },
              cancellationKeys: [chat.id],
              run: Effect.never,
            })
            .pipe(Effect.flatMap((job) => (job ? Effect.never : Effect.die("new task was rejected")))),
        )
        .pipe(Effect.forkChild)
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(cancelling)

      yield* pollWithTimeout(
        jobs.get("new-task").pipe(Effect.map((job) => (job?.status === "running" ? true : undefined))),
        "new task never started",
      )

      expect((yield* jobs.get("new-task"))?.status).toBe("running")
      yield* jobs.cancel("new-task")
    }),
  )

  background.instance("cancelling a run does not admit a task from its interrupt finalizer", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const runState = yield* SessionRunState.Service
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const started = yield* Deferred.make<void>()
      const stopped = { info: assistant, parts: [] } satisfies SessionV1.WithParts
      const context = {
        sessionID: chat.id,
        messageID: assistant.id,
        agent: "build",
        abort: new AbortController().signal,
        extra: {
          promptOps: {
            ...stubOps(),
            prompt: () => Effect.never,
          } satisfies TaskPromptOps,
        },
        messages: [],
        metadata: () => Effect.void,
        ask: () => Effect.void,
      }

      yield* runState
        .ensureRunning(
          chat.id,
          Effect.succeed(stopped),
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.ensuring(
              def
                .execute(
                  {
                    description: "late task",
                    prompt: "start after cancellation",
                    subagent_type: "general",
                    background: true,
                  },
                  context,
                )
                .pipe(Effect.asVoid),
            ),
          ),
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(started)

      yield* runState.cancel(chat.id)

      expect((yield* jobs.list()).filter((job) => job.metadata?.parentSessionId === chat.id)).toHaveLength(0)
      expect(yield* sessions.children(chat.id)).toHaveLength(0)
    }),
  )

  it.instance("cancelling a child run cancels its own pre-runner task job", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const runState = yield* SessionRunState.Service
      const sessions = yield* Session.Service
      const { chat } = yield* seed()
      const child = yield* sessions.create({ parentID: chat.id, title: "child" })

      yield* jobs.start({
        id: child.id,
        type: "task",
        metadata: { parentSessionId: chat.id, sessionId: child.id },
        run: Effect.never,
      })

      yield* runState.cancel(child.id)

      expect((yield* jobs.get(child.id))?.status).toBe("cancelled")
    }),
  )

  it.instance("cancelling a parent run recursively cancels descendant background tasks", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const runState = yield* SessionRunState.Service
      const sessions = yield* Session.Service
      const { chat } = yield* seed()
      const child = yield* sessions.create({ parentID: chat.id, title: "child" })
      const grandchild = yield* sessions.create({ parentID: child.id, title: "grandchild" })

      yield* jobs.start({
        id: child.id,
        type: "task",
        metadata: { parentSessionId: chat.id, sessionId: child.id },
        run: Effect.never,
      })
      yield* jobs.start({
        id: grandchild.id,
        type: "task",
        metadata: { parentSessionId: child.id, sessionId: grandchild.id },
        run: Effect.never,
      })

      yield* runState.cancel(chat.id)

      expect((yield* jobs.get(child.id))?.status).toBe("cancelled")
      expect((yield* jobs.get(grandchild.id))?.status).toBe("cancelled")
    }),
  )
})
