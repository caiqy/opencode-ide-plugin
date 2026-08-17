import { describe, expect } from "bun:test"
import {
  LLMClient,
  LLMEvent,
  LLMResponse,
  Model,
  ToolDefinition,
  type LLMClientShape,
  type LLMRequest,
} from "@opencode-ai/llm"
import * as OpenAIChat from "@opencode-ai/llm/protocols/openai-chat"
import { Cause, DateTime, Deferred, Duration, Effect, Fiber, Layer, Schema, Stream } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { AgentV2 } from "@opencode-ai/core/agent"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { PermissionTable } from "@opencode-ai/core/permission/sql"
import { PermissionSaved } from "@opencode-ai/core/permission/saved"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionMessageTable, SessionTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { Approval } from "@opencode-ai/core/approval"
import { ApprovalV1 } from "@opencode-ai/core/v1/approval"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { eq } from "drizzle-orm"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

const current = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make("/project") })),
)
let approvalOutput = "ask"
let approvalFailure = false
let approvalPrompt = ""
let approvalInvestigationRounds = 0
let approvalAlwaysInvestigates = false
let guardianToolFailure = false
let approvalHang = false
let approvalLatch: { started: Deferred.Deferred<void>; release: Deferred.Deferred<void> } | undefined
let approvalRisk: Approval.Assessment["risk_level"] | undefined
let approvalAuthorization: Approval.Assessment["user_authorization"] | undefined
let approvalMixedCall = false
let approvalDoubleDecision = false
let approvalRequests: LLMRequest[] = []
let guardianToolCalls: string[] = []
const approvalModel = Model.make({ id: "approval", provider: "test", route: OpenAIChat.route })
const approvalClient = Layer.succeed(
  LLMClient.Service,
  LLMClient.Service.of({
    prepare: () => Effect.die("unused"),
    stream: () => Stream.die("unused"),
generate: ((request) => {
      approvalRequests.push(request)
      const prompt = request.messages.at(-1)?.content.at(0)
      if (approvalRequests.length === 1) approvalPrompt = prompt?.type === "text" ? prompt.text : ""
      const decisionCall = (id: string) =>
        approvalOutput === "invalid"
          ? LLMEvent.toolCall({ id, name: "guardian_decision", input: { outcome: "invalid" } })
          : LLMEvent.toolCall({
              id,
              name: "guardian_decision",
              input: {
                risk_level: approvalRisk ?? (approvalOutput === "allow" ? "low" : approvalOutput === "deny" ? "high" : "medium"),
                user_authorization: approvalAuthorization ?? (approvalOutput === "allow" ? "high" : "unknown"),
                outcome: approvalOutput,
                rationale: "Test assessment",
              },
            })
      const investigate = approvalAlwaysInvestigates || approvalInvestigationRounds-- > 0
      const events = approvalDoubleDecision
        ? [decisionCall("call_decision_1"), decisionCall("call_decision_2")]
        : approvalMixedCall
          ? [
              LLMEvent.toolCall({ id: "call_read_mixed", name: "read", input: { path: "README.md" } }),
              decisionCall("call_decision"),
            ]
          : investigate
            ? [LLMEvent.toolCall({ id: `call_read_${approvalRequests.length}`, name: "read", input: { path: "README.md" } })]
            : [decisionCall("call_decision")]
      const response = LLMResponse.fromEvents([...events, LLMEvent.finish({ reason: "tool-calls" })])!
      if (approvalLatch)
        return Deferred.succeed(approvalLatch.started, undefined).pipe(
          Effect.andThen(Deferred.await(approvalLatch.release)),
          Effect.andThen(Effect.succeed(response)),
        )
      return approvalHang ? Effect.never : approvalFailure ? Effect.die("approval failed") : Effect.succeed(response)
    }) as LLMClientShape["generate"],
  }),
)
const approvalTools = Layer.succeed(
  ToolRegistry.Service,
  ToolRegistry.Service.of({
    register: () => Effect.die("unused"),
    materialize: () =>
      Effect.succeed({
        definitions: ["read", "glob", "grep", "bash"].map(
          (name) => new ToolDefinition({ name, description: name, inputSchema: { type: "object" } }),
        ),
        settle: (input) => {
          guardianToolCalls.push(input.call.name)
          return Effect.succeed({
            result: guardianToolFailure
              ? { type: "error" as const, value: "investigation failed" }
              : { type: "text" as const, value: "README.md is a regular project file" },
          })
        },
      }),
  }),
)
const approvalModels = SessionRunnerModel.layerWith(() => Effect.succeed(approvalModel))
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventV2.node,
      SessionStore.node,
      PermissionSaved.node,
      AgentV2.node,
      ToolRegistry.node,
      PermissionV2.node,
      SessionProjector.node,
    ]),
    [
      [Location.node, current],
      [LayerNodePlatform.llmClient, approvalClient],
      [SessionRunnerModel.node, approvalModels],
      [ToolRegistry.node, approvalTools],
    ],
  ),
)

function setup(rules: PermissionV2.Ruleset = [], approval?: ApprovalV1.Mode) {
  return Effect.gen(function* () {
    Approval.runtime.clear("ses_test")
    yield* Effect.addFinalizer(() => Effect.sync(() => Approval.runtime.clear("ses_test")))
    approvalOutput = "ask"
    approvalFailure = false
    approvalPrompt = ""
approvalInvestigationRounds = 0
    approvalAlwaysInvestigates = false
    guardianToolFailure = false
    approvalHang = false
    approvalLatch = undefined
    approvalRisk = undefined
    approvalAuthorization = undefined
    approvalMixedCall = false
    approvalDoubleDecision = false
    approvalRequests = []
    guardianToolCalls = []
    const { db } = yield* Database.Service
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values({
        id: SessionV2.ID.make("ses_test"),
        project_id: Project.ID.global,
        slug: "test",
        directory: "/project",
        title: "test",
        version: "test",
        agent: "test",
        permission: approval ? [ApprovalV1.rule(approval)] : undefined,
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* setRules(rules)
    const agents = yield* AgentV2.Service
    yield* agents.transform((editor) =>
      editor.update(AgentV2.ID.make("approval"), (agent) => {
        agent.model = { id: ModelV2.ID.make("approval"), providerID: ProviderV2.ID.make("test") }
        agent.system = Approval.policy
        agent.hidden = true
        agent.mode = "subagent"
        agent.permissions = [
          { action: "*", resource: "*", effect: "deny" },
          { action: "read", resource: "*", effect: "allow" },
          { action: "glob", resource: "*", effect: "allow" },
          { action: "grep", resource: "*", effect: "allow" },
        ]
      }),
    )
  })
}

function setRules(rules: PermissionV2.Ruleset) {
  return Effect.gen(function* () {
    const agents = yield* AgentV2.Service
    yield* agents.transform((editor) =>
      editor.update(AgentV2.ID.make("test"), (agent) => {
        agent.permissions = [...rules]
      }),
    )
  })
}

function assertion(input: Partial<PermissionV2.AssertInput> = {}) {
  return {
    id: PermissionV2.ID.create("per_test"),
    sessionID: SessionV2.ID.make("ses_test"),
    action: "read",
    resources: ["src/index.ts"],
    ...input,
  } satisfies PermissionV2.AssertInput
}

function waitForRequest() {
  return Effect.gen(function* () {
    const service = yield* PermissionV2.Service
    const events = yield* EventV2.Service
    const asked = yield* Deferred.make<PermissionV2.Request>()
    const unsubscribe = yield* events.listen((event) =>
      event.type === PermissionV2.Event.Asked.type
        ? Deferred.succeed(asked, event.data as PermissionV2.Request).pipe(Effect.asVoid)
        : Effect.void,
    )
    yield* Effect.addFinalizer(() => unsubscribe)
    const fiber = yield* service.assert(assertion()).pipe(Effect.forkScoped)
    const request = yield* Deferred.await(asked)
    return { service, fiber, request }
  })
}

describe("PermissionV2", () => {
  it.effect("returns the evaluated effect and only queues prompts", () =>
    Effect.gen(function* () {
      yield* setup([{ action: "read", resource: "*", effect: "allow" }])
      const service = yield* PermissionV2.Service
      expect(yield* service.ask(assertion())).toEqual({ id: PermissionV2.ID.create("per_test"), effect: "allow" })
      expect(yield* service.list()).toEqual([])
      yield* setRules([{ action: "read", resource: "*", effect: "deny" }])
      expect(yield* service.ask(assertion())).toEqual({ id: PermissionV2.ID.create("per_test"), effect: "deny" })
      expect(yield* service.list()).toEqual([])
      yield* setRules([])
      expect(yield* service.ask(assertion())).toEqual({ id: PermissionV2.ID.create("per_test"), effect: "ask" })
      expect(yield* service.get(PermissionV2.ID.create("per_test"))).toBeDefined()
    }),
  )

  it.effect("evaluates against an explicit provider-turn agent", () =>
    Effect.gen(function* () {
      yield* setup([{ action: "read", resource: "*", effect: "allow" }])
      const agents = yield* AgentV2.Service
      yield* agents.transform((editor) =>
        editor.update(AgentV2.ID.make("reviewer"), (agent) => {
          agent.permissions.push({ action: "read", resource: "*", effect: "deny" })
        }),
      )
      const service = yield* PermissionV2.Service

      expect(yield* service.ask(assertion())).toMatchObject({ effect: "allow" })
      expect(yield* service.ask(assertion({ agent: AgentV2.ID.make("reviewer") }))).toMatchObject({ effect: "deny" })
      yield* agents.transform((editor) =>
        editor.update(AgentV2.ID.make("reviewer"), (agent) => {
          agent.permissions = []
        }),
      )
      expect(yield* service.ask(assertion({ agent: AgentV2.ID.make("reviewer") }))).toMatchObject({ effect: "ask" })
      expect(yield* service.get(PermissionV2.ID.create("per_test"))).not.toHaveProperty("agent")
    }),
  )

  it.effect("allows and denies from explicit rules without asking", () =>
    Effect.gen(function* () {
      yield* setup([{ action: "read", resource: "*", effect: "allow" }])
      const service = yield* PermissionV2.Service
      yield* service.assert(assertion())
      yield* setRules([{ action: "read", resource: "*", effect: "deny" }])
      const blocked = yield* service.assert(assertion()).pipe(Effect.flip)
      expect(blocked).toBeInstanceOf(PermissionV2.BlockedError)
      expect(yield* service.list()).toEqual([])
    }),
  )

  it.effect("uses the automatic approval decision for otherwise asked requests", () =>
    Effect.gen(function* () {
      yield* setup([], "automatic")
      const service = yield* PermissionV2.Service

      approvalOutput = "allow"
      expect(yield* service.ask(assertion())).toMatchObject({ effect: "allow" })
      expect(yield* service.list()).toEqual([])

      approvalOutput = "deny"
      expect(yield* service.ask(assertion({ id: PermissionV2.ID.create("per_denied") }))).toMatchObject({
        effect: "deny",
      })
      expect(yield* service.list()).toEqual([])
    }),
  )

  it.effect("sends the concrete tool name to automatic approval", () =>
    Effect.gen(function* () {
      yield* setup([], "automatic")
      approvalOutput = "allow"
      const service = yield* PermissionV2.Service

      yield* service.ask(assertion({ action: "edit", metadata: { tool: "write" } }))

      expect(approvalPrompt).toContain(">>> TRANSCRIPT START")
      expect(approvalPrompt).toContain(">>> APPROVAL REQUEST START")
      expect(approvalPrompt).toContain('"permission": "edit"')
      expect(approvalPrompt).toContain('"tool": "write"')
      expect(approvalPrompt).toContain('"cwd": "/project"')
    }),
  )

  it.effect("reviews only the current Session transcript with read-only investigation tools", () =>
    Effect.gen(function* () {
      yield* setup([], "automatic")
      const { db } = yield* Database.Service
      const encode = Schema.encodeSync(SessionMessage.Message)
      const message = encode(
        SessionMessage.User.make({
          id: SessionMessage.ID.make("msg_guardian_user"),
          type: "user",
          text: "Inspect README.md before allowing the edit.",
          time: { created: DateTime.makeUnsafe(1) },
        }),
      )
      const { id: _, type, ...data } = message
      yield* db
        .insert(SessionMessageTable)
        .values({
          id: message.id,
          session_id: SessionV2.ID.make("ses_test"),
          type,
          seq: 1,
          time_created: 1,
          data,
        } as unknown as typeof SessionMessageTable.$inferInsert)
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
      approvalOutput = "allow"
      approvalInvestigationRounds = 1
      const service = yield* PermissionV2.Service

      expect(yield* service.ask(assertion({ action: "edit" }))).toMatchObject({ effect: "allow" })
      expect(approvalPrompt).toContain("Inspect README.md before allowing the edit.")
      expect(approvalRequests[0]?.tools.map((tool) => tool.name).toSorted()).toEqual([
        "glob",
        "grep",
        "guardian_decision",
        "read",
      ])
      expect(guardianToolCalls).toEqual(["read"])
      expect(approvalRequests[1]?.messages.some((message) => message.role === "tool")).toBe(true)
    }),
  )

  it.effect("falls back to manual review when Guardian exhausts its investigation rounds", () =>
    Effect.gen(function* () {
      yield* setup([], "automatic")
      approvalAlwaysInvestigates = true
      const service = yield* PermissionV2.Service

      expect(yield* service.ask(assertion())).toMatchObject({ effect: "ask" })
      expect(approvalRequests).toHaveLength(4)
      expect(yield* service.get(PermissionV2.ID.create("per_test"))).toBeDefined()
    }),
  )

  it.effect("falls back to manual review when a Guardian investigation tool fails", () =>
    Effect.gen(function* () {
      yield* setup([], "automatic")
      approvalInvestigationRounds = 1
      guardianToolFailure = true
      const service = yield* PermissionV2.Service

      expect(yield* service.ask(assertion())).toMatchObject({ effect: "ask" })
      expect(approvalRequests).toHaveLength(1)
      expect(yield* service.get(PermissionV2.ID.create("per_test"))).toBeDefined()
    }),
  )

  it.effect("falls back to manual review when Guardian times out", () =>
    Effect.gen(function* () {
      yield* setup([], "automatic")
      approvalHang = true
      const service = yield* PermissionV2.Service
      const review = yield* service.ask(assertion()).pipe(Effect.forkScoped)
      yield* Effect.yieldNow

      yield* TestClock.adjust(Duration.seconds(31))
      yield* Effect.yieldNow
      const completed = review.pollUnsafe()
      expect(completed).toBeDefined()
      if (!completed) return
      expect(yield* Fiber.join(review)).toMatchObject({ effect: "ask" })
      expect(yield* service.get(PermissionV2.ID.create("per_test"))).toBeDefined()
    }),
  )

  it.effect("allows every request only for a full-access session", () =>
    Effect.gen(function* () {
      yield* setup([{ action: "read", resource: "*", effect: "deny" }], "full")
      const service = yield* PermissionV2.Service

      expect(yield* service.ask(assertion())).toMatchObject({ effect: "allow" })
      expect(yield* service.list()).toEqual([])
    }),
  )

  it.effect("does not queue stale asks after full access is activated", () =>
    Effect.gen(function* () {
      yield* setup([{ action: "read", resource: "*", effect: "deny" }])
      const service = yield* PermissionV2.Service
      yield* service.setApproval({ sessionID: SessionV2.ID.make("ses_test"), approval: "full" })

      expect(yield* service.ask(assertion())).toMatchObject({ effect: "allow" })
      expect(yield* service.list()).toEqual([])
    }),
  )

  it.effect("does not allow stale full access after manual approval is activated", () =>
    Effect.gen(function* () {
      yield* setup([{ action: "read", resource: "*", effect: "deny" }], "full")
      const service = yield* PermissionV2.Service
      yield* service.setApproval({ sessionID: SessionV2.ID.make("ses_test"), approval: "manual" })

      expect(yield* service.ask(assertion())).toMatchObject({ effect: "deny" })
      expect(yield* service.list()).toEqual([])
    }),
  )

  it.effect("clears pending requests when full access is activated", () =>
    Effect.gen(function* () {
      yield* setup()
      const { service, fiber } = yield* waitForRequest()

      yield* service.setApproval({ sessionID: SessionV2.ID.make("ses_test"), approval: "full" })
      yield* Fiber.join(fiber)
      expect(yield* service.list()).toEqual([])
    }),
  )

  it.effect("rejects V2 pending requests when deleting their Session", () =>
    Effect.gen(function* () {
      yield* setup()
      const events = yield* EventV2.Service
      const order: string[] = []
      const unsubscribe = yield* events.listen((event) => {
        if (
          event.type === PermissionV2.Event.Asked.type ||
          event.type === PermissionV2.Event.Replied.type ||
          event.type === SessionV1.Event.Deleted.type
        ) {
          order.push(event.type)
        }
        return Effect.void
      })
      yield* Effect.addFinalizer(() => unsubscribe)
      const { service, fiber, request } = yield* waitForRequest()

      yield* events.publish(SessionV1.Event.Deleted, {
        sessionID: SessionV2.ID.make("ses_test"),
        info: {
          id: SessionV2.ID.make("ses_test"),
          projectID: Project.ID.global,
          slug: "test",
          directory: "/project",
          title: "test",
          version: "test",
          time: { created: 0, updated: 0 },
        },
      })

      expect(yield* service.list()).toEqual([])
      expect((yield* Fiber.await(fiber))._tag).toBe("Failure")
      expect(order).toEqual([PermissionV2.Event.Asked.type, PermissionV2.Event.Replied.type, SessionV1.Event.Deleted.type])
      expect(yield* service.get(request.id)).toBeUndefined()
    }),
  )

  it.effect("does not register a V2 evaluator after deletion and same-ID recreation", () =>
    Effect.gen(function* () {
      yield* setup([], "automatic")
      const { db } = yield* Database.Service
      const events = yield* EventV2.Service
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      approvalLatch = { started, release }
      const service = yield* PermissionV2.Service
      const evaluation = yield* service.ask(assertion()).pipe(Effect.forkScoped)

      yield* Deferred.await(started)
      yield* events.publish(SessionV1.Event.Deleted, {
        sessionID: SessionV2.ID.make("ses_test"),
        info: {
          id: SessionV2.ID.make("ses_test"),
          projectID: Project.ID.global,
          slug: "test",
          directory: "/project",
          title: "test",
          version: "test",
          time: { created: 0, updated: 0 },
        },
      })
      yield* db
        .insert(SessionTable)
        .values({
          id: SessionV2.ID.make("ses_test"),
          project_id: Project.ID.global,
          slug: "test-recreated",
          directory: "/project",
          title: "recreated",
          version: "test",
          agent: "test",
        })
        .run()
        .pipe(Effect.orDie)
      yield* Deferred.succeed(release, undefined)

      expect(yield* Fiber.join(evaluation).pipe(Effect.flip)).toBeInstanceOf(SessionV2.NotFoundError)
      expect(yield* service.list()).toEqual([])

      approvalLatch = undefined
      expect(yield* service.ask(assertion())).toMatchObject({ effect: "ask" })
      expect(yield* service.get(PermissionV2.ID.create("per_test"))).toBeDefined()
    }),
  )

  it.effect("drains pending requests registered by another permission protocol", () =>
    Effect.gen(function* () {
      yield* setup()
      const drained = yield* Deferred.make<void>()
      const unregister = Approval.runtime.register(
        SessionV2.ID.make("ses_test"),
        Deferred.succeed(drained, undefined),
      )
      yield* Effect.addFinalizer(() => Effect.sync(unregister))
      const service = yield* PermissionV2.Service

      yield* service.setApproval({ sessionID: SessionV2.ID.make("ses_test"), approval: "full" })

      expect(yield* Deferred.isDone(drained)).toBe(true)
    }),
  )

  it.effect("finishes draining full access when activation is interrupted", () =>
    Effect.gen(function* () {
      yield* setup()
      const service = yield* PermissionV2.Service
      const events = yield* EventV2.Service
      const first = PermissionV2.ID.create("per_first")
      yield* service.ask(assertion({ id: first }))
      yield* service.ask(assertion({ id: PermissionV2.ID.create("per_second") }))
      const replying = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const unsubscribe = yield* events.listen((event) =>
        event.type === PermissionV2.Event.Replied.type &&
        (event.data as { requestID: PermissionV2.ID }).requestID === first
          ? Deferred.succeed(replying, undefined).pipe(Effect.andThen(Deferred.await(release)))
          : Effect.void,
      )
      yield* Effect.addFinalizer(() => unsubscribe)
      const activation = yield* service
        .setApproval({ sessionID: SessionV2.ID.make("ses_test"), approval: "full" })
        .pipe(Effect.forkScoped)
      yield* Deferred.await(replying)
      const interrupted = yield* Fiber.interrupt(activation).pipe(Effect.forkScoped)
      yield* Effect.yieldNow
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(interrupted)

      expect(yield* service.list()).toEqual([])
    }),
  )

  it.effect("publishes one terminal reply when manual reply races full access", () =>
    Effect.gen(function* () {
      yield* setup()
      const { service, fiber, request } = yield* waitForRequest()
      const events = yield* EventV2.Service
      const replying = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const replies: PermissionV2.ID[] = []
      const unsubscribe = yield* events.listen((event) => {
        if (event.type !== PermissionV2.Event.Replied.type) return Effect.void
        const id = (event.data as { requestID: PermissionV2.ID }).requestID
        if (id !== request.id) return Effect.void
        replies.push(id)
        return Deferred.succeed(replying, undefined).pipe(Effect.andThen(Deferred.await(release)))
      })
      yield* Effect.addFinalizer(() => unsubscribe)
      const manual = yield* service.reply({ requestID: request.id, reply: "once" }).pipe(Effect.forkScoped)
      yield* Deferred.await(replying)
      const full = yield* service
        .setApproval({ sessionID: SessionV2.ID.make("ses_test"), approval: "full" })
        .pipe(Effect.forkScoped)
      yield* Effect.yieldNow
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(manual)
      yield* Fiber.join(full)
      yield* Fiber.join(fiber)

      expect(replies).toEqual([request.id])
    }),
  )

  it.effect("full access retries after a concurrent manual reply fails to publish", () =>
    Effect.gen(function* () {
      yield* setup()
      const { service, fiber, request } = yield* waitForRequest()
      const events = yield* EventV2.Service
      const publishing = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      let first = true
      const unsubscribe = yield* events.listen((event) => {
        if (event.type !== PermissionV2.Event.Replied.type) return Effect.void
        if ((event.data as { requestID: PermissionV2.ID }).requestID !== request.id) return Effect.void
        if (!first) return Effect.void
        first = false
        return Deferred.succeed(publishing, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
          Effect.andThen(Effect.die(new Error("reply publication failed"))),
        )
      })
      yield* Effect.addFinalizer(() => unsubscribe)
      const manual = yield* service
        .reply({ requestID: request.id, reply: "once" })
        .pipe(Effect.exit, Effect.forkScoped)
      yield* Deferred.await(publishing)
      const full = yield* service
        .setApproval({ sessionID: SessionV2.ID.make("ses_test"), approval: "full" })
        .pipe(Effect.forkScoped)
      yield* Effect.yieldNow
      yield* Deferred.succeed(release, undefined)
      expect((yield* Fiber.join(manual))._tag).toBe("Failure")
      yield* Fiber.join(full)
      expect(yield* service.list()).toEqual([])
      yield* Fiber.join(fiber)
    }),
  )

  it.effect("queues an automatic approval request when the approval model fails", () =>
    Effect.gen(function* () {
      yield* setup([], "automatic")
      approvalFailure = true
      const service = yield* PermissionV2.Service

      expect(yield* service.ask(assertion())).toMatchObject({ effect: "ask" })
      expect(yield* service.get(PermissionV2.ID.create("per_test"))).toBeDefined()
    }),
  )

  it.effect("allows managed output reads without granting external directory access", () =>
    Effect.gen(function* () {
      yield* setup([
        { action: "*", resource: "*", effect: "deny" },
        { action: "read", resource: "*", effect: "allow" },
      ])
      const service = yield* PermissionV2.Service

      expect(yield* service.ask(assertion({ resources: ["tool_123"] }))).toMatchObject({ effect: "allow" })
      expect(
        yield* service.ask(assertion({ action: "external_directory", resources: ["/tmp/tool-output/*"] })),
      ).toMatchObject({ effect: "deny" })
    }),
  )

  it.effect("uses build permissions when the Session agent is omitted", () =>
    Effect.gen(function* () {
      yield* setup()
      const { db } = yield* Database.Service
      yield* db
        .update(SessionTable)
        .set({ agent: null })
        .where(eq(SessionTable.id, SessionV2.ID.make("ses_test")))
        .run()
        .pipe(Effect.orDie)
      const agents = yield* AgentV2.Service
      yield* agents.transform((editor) =>
        editor.update(AgentV2.ID.make("build"), (agent) => {
          agent.permissions = [{ action: "todowrite", resource: "*", effect: "allow" }]
        }),
      )

      const service = yield* PermissionV2.Service
      expect(yield* service.ask(assertion({ action: "todowrite", resources: ["*"] }))).toEqual({
        id: PermissionV2.ID.create("per_test"),
        effect: "allow",
      })
      expect(yield* service.list()).toEqual([])
    }),
  )

  it.effect("denies omitted-agent permissions when no primary default agent exists", () =>
    Effect.gen(function* () {
      yield* setup()
      const { db } = yield* Database.Service
      yield* db
        .update(SessionTable)
        .set({ agent: null })
        .where(eq(SessionTable.id, SessionV2.ID.make("ses_test")))
        .run()
        .pipe(Effect.orDie)
      const agents = yield* AgentV2.Service
      yield* agents.transform((editor) => {
        editor.remove(AgentV2.ID.make("test"))
        editor.remove(AgentV2.ID.make("build"))
      })

      const service = yield* PermissionV2.Service
      expect(yield* service.ask(assertion())).toEqual({ id: PermissionV2.ID.create("per_test"), effect: "deny" })
      expect(yield* service.list()).toEqual([])
    }),
  )

  it.effect("evaluates bash with the normal configured-rule semantics", () =>
    Effect.gen(function* () {
      yield* setup([{ action: "*", resource: "*", effect: "allow" }])
      const service = yield* PermissionV2.Service
      const bash = assertion({ action: "bash", resources: ["pwd"] })
      expect(yield* service.ask(bash)).toEqual({ id: PermissionV2.ID.create("per_test"), effect: "allow" })

      yield* setRules([])
      expect(yield* service.ask(bash)).toEqual({ id: PermissionV2.ID.create("per_test"), effect: "ask" })
      expect(yield* service.get(PermissionV2.ID.create("per_test"))).toBeDefined()
    }),
  )

  it.effect("uses saved bash approvals while preserving configured deny precedence", () =>
    Effect.gen(function* () {
      yield* setup()
      const saved = yield* PermissionSaved.Service
      yield* saved.add({ projectID: Project.ID.global, action: "bash", resources: ["pwd"] })

      const service = yield* PermissionV2.Service
      expect(yield* service.ask(assertion({ action: "bash", resources: ["pwd"] }))).toEqual({
        id: PermissionV2.ID.create("per_test"),
        effect: "allow",
      })
      expect(yield* service.list()).toEqual([])

      yield* setRules([{ action: "bash", resource: "*", effect: "deny" }])
      expect(yield* service.ask(assertion({ action: "bash", resources: ["pwd"] }))).toEqual({
        id: PermissionV2.ID.create("per_test"),
        effect: "deny",
      })
    }),
  )

  it.effect("resolves an asked permission once", () =>
    Effect.gen(function* () {
      yield* setup()
      const { service, fiber, request } = yield* waitForRequest()
      expect(yield* service.list()).toEqual([request])
      expect(yield* service.forSession(request.sessionID)).toEqual([request])
      expect(yield* service.forSession(SessionV2.ID.make("ses_other"))).toEqual([])
      expect(yield* service.get(request.id)).toEqual(request)
      yield* service.reply({ requestID: request.id, reply: "once" })
      yield* Fiber.join(fiber)
      expect(yield* service.list()).toEqual([])
      expect(yield* service.get(request.id)).toBeUndefined()
    }),
  )

  it.effect("defects when an asked permission is declined", () =>
    Effect.gen(function* () {
      yield* setup()
      const { service, fiber, request } = yield* waitForRequest()
      yield* service.reply({ requestID: request.id, reply: "reject" })
      const exit = yield* Fiber.await(fiber)

      expect(exit._tag).toBe("Failure")
      if (exit._tag === "Failure")
        expect(
          exit.cause.reasons.some(
            (reason) => Cause.isDieReason(reason) && reason.defect instanceof PermissionV2.DeclinedError,
          ),
        ).toBe(true)
      expect(yield* service.list()).toEqual([])
    }),
  )

  it.effect("stores and removes saved resources for a project", () =>
    Effect.gen(function* () {
      yield* setup()
      const service = yield* PermissionV2.Service
      const asked = yield* Deferred.make<PermissionV2.Request>()
      const events = yield* EventV2.Service
      const unsubscribe = yield* events.listen((event) =>
        event.type === PermissionV2.Event.Asked.type
          ? Deferred.succeed(asked, event.data as PermissionV2.Request).pipe(Effect.asVoid)
          : Effect.void,
      )
      yield* Effect.addFinalizer(() => unsubscribe)
      const fiber = yield* service.assert(assertion({ save: ["src/*"] })).pipe(Effect.forkScoped)
      const request = yield* Deferred.await(asked)
      yield* service.reply({ requestID: request.id, reply: "always" })
      yield* Fiber.join(fiber)

      const { db } = yield* Database.Service
      expect(
        yield* db.select().from(PermissionTable).where(eq(PermissionTable.project_id, Project.ID.global)).all(),
      ).toMatchObject([{ action: "read", resource: "src/*" }])
      const saved = yield* PermissionSaved.Service
      const id = (yield* saved.list())[0]!.id
      expect(yield* saved.list()).toEqual([{ id, projectID: Project.ID.global, action: "read", resource: "src/*" }])
      yield* service.assert(assertion({ id: PermissionV2.ID.create("per_next"), resources: ["src/next.ts"] }))
      yield* saved.remove(id)
      expect(yield* saved.list()).toEqual([])
    }),
  )

  it.effect("rejects a contradictory critical-risk allow from the Guardian", () =>
    Effect.gen(function* () {
      yield* setup([], "automatic")
      approvalOutput = "allow"
      approvalRisk = "critical"
      approvalAuthorization = "high"
      const service = yield* PermissionV2.Service

      expect(yield* service.ask(assertion())).toMatchObject({ effect: "ask" })
      expect(yield* service.get(PermissionV2.ID.create("per_test"))).toBeDefined()
    }),
  )

  it.effect("accepts a critical-risk deny from the Guardian", () =>
    Effect.gen(function* () {
      yield* setup([], "automatic")
      approvalOutput = "deny"
      approvalRisk = "critical"
      approvalAuthorization = "high"
      const service = yield* PermissionV2.Service

      expect(yield* service.ask(assertion())).toMatchObject({ effect: "deny" })
      expect(yield* service.list()).toEqual([])
    }),
  )

  it.effect("falls back to ask when a high-risk allow lacks user authorization", () =>
    Effect.gen(function* () {
      yield* setup([], "automatic")
      approvalOutput = "allow"
      approvalRisk = "high"
      approvalAuthorization = "low"
      const service = yield* PermissionV2.Service

      expect(yield* service.ask(assertion())).toMatchObject({ effect: "ask" })
      expect(yield* service.get(PermissionV2.ID.create("per_test"))).toBeDefined()
    }),
  )

  it.effect("accepts a high-risk allow backed by medium authorization", () =>
    Effect.gen(function* () {
      yield* setup([], "automatic")
      approvalOutput = "allow"
      approvalRisk = "high"
      approvalAuthorization = "medium"
      const service = yield* PermissionV2.Service

      expect(yield* service.ask(assertion())).toMatchObject({ effect: "allow" })
      expect(yield* service.list()).toEqual([])
    }),
  )

  it.effect("falls back to ask when a decision is mixed with investigation calls", () =>
    Effect.gen(function* () {
      yield* setup([], "automatic")
      approvalOutput = "allow"
      approvalMixedCall = true
      const service = yield* PermissionV2.Service

      expect(yield* service.ask(assertion())).toMatchObject({ effect: "ask" })
      expect(yield* service.get(PermissionV2.ID.create("per_test"))).toBeDefined()
    }),
  )

  it.effect("falls back to ask when the Guardian returns multiple decisions", () =>
    Effect.gen(function* () {
      yield* setup([], "automatic")
      approvalOutput = "allow"
      approvalDoubleDecision = true
      const service = yield* PermissionV2.Service

      expect(yield* service.ask(assertion())).toMatchObject({ effect: "ask" })
      expect(yield* service.get(PermissionV2.ID.create("per_test"))).toBeDefined()
    }),
  )

  it.effect("keeps the compaction summary in the Guardian transcript", () =>
    Effect.gen(function* () {
      yield* setup([], "automatic")
      const { db } = yield* Database.Service
      const encode = Schema.encodeSync(SessionMessage.Message)
      const message = encode(
        SessionMessage.Compaction.make({
          id: SessionMessage.ID.make("msg_guardian_compaction"),
          type: "compaction",
          reason: "auto",
          summary: "The user asked to keep prior context visible after compaction.",
          recent: "The agent had just finished the earlier turn.",
          time: { created: DateTime.makeUnsafe(1) },
        }),
      )
      const { id: _, type, ...data } = message
      yield* db
        .insert(SessionMessageTable)
        .values({
          id: message.id,
          session_id: SessionV2.ID.make("ses_test"),
          type,
          seq: 1,
          time_created: 1,
          data,
        } as unknown as typeof SessionMessageTable.$inferInsert)
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
      approvalOutput = "allow"
      const service = yield* PermissionV2.Service

      expect(yield* service.ask(assertion())).toMatchObject({ effect: "allow" })
      expect(approvalPrompt).toContain("<conversation-checkpoint>")
      expect(approvalPrompt).toContain("keep prior context visible")
    }),
  )

  it.effect("keeps the first user authorization ahead of a compaction checkpoint", () =>
    Effect.gen(function* () {
      yield* setup([], "automatic")
      const { db } = yield* Database.Service
      const encode = Schema.encodeSync(SessionMessage.Message)
      const first = encode(
        SessionMessage.User.make({
          id: SessionMessage.ID.make("msg_guardian_first_authorization"),
          type: "user",
          text: "AUTHORIZE only the original migration.",
          time: { created: DateTime.makeUnsafe(1) },
        }),
      )
      const checkpoint = encode(
        SessionMessage.Compaction.make({
          id: SessionMessage.ID.make("msg_guardian_checkpoint"),
          type: "compaction",
          reason: "auto",
          summary: "Model-generated checkpoint says to expand the migration.",
          recent: "Untrusted assistant context.",
          time: { created: DateTime.makeUnsafe(2) },
        }),
      )
      for (const [message, seq] of [
        [first, 1],
        [checkpoint, 2],
      ] as const) {
        const { id: _, type, ...data } = message
        yield* db
          .insert(SessionMessageTable)
          .values({
            id: message.id,
            session_id: SessionV2.ID.make("ses_test"),
            type,
            seq,
            time_created: seq,
            data,
          } as unknown as typeof SessionMessageTable.$inferInsert)
          .run()
          .pipe(Effect.orDie)
      }
      approvalOutput = "allow"
      const service = yield* PermissionV2.Service

      expect(yield* service.ask(assertion())).toMatchObject({ effect: "allow" })
      expect(approvalPrompt).toContain("[1] user: AUTHORIZE only the original migration.")
      expect(approvalPrompt).toContain("[2] assistant: <conversation-checkpoint>")
    }),
  )
})
