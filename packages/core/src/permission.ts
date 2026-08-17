export * as PermissionV2 from "./permission"

import { makeLocationNode } from "./effect/app-node"
import { llmClient } from "./effect/app-node-platform"
import { LLM, LLMClient, Message, Tool, toDefinitions } from "@opencode-ai/llm"
import { Context, Deferred, Effect as EffectRuntime, Layer, Schema, Semaphore } from "effect"
import { Approval } from "./approval"
import { Permission } from "@opencode-ai/schema/permission"
import { EventV2 } from "./event"
import { Location } from "./location"
import { AgentV2 } from "./agent"
import { SessionV2 } from "./session"
import { SessionStore } from "./session/store"
import { Wildcard } from "./util/wildcard"
import { PermissionSaved } from "./permission/saved"
import { SessionRunnerModel } from "./session/runner/model"
import { SessionMessage } from "./session/message"
import { ToolRegistry } from "./tool/registry"

export { Effect, Rule, Ruleset } from "@opencode-ai/schema/permission"
const missingAgentPermissions: Permission.Ruleset = [{ action: "*", resource: "*", effect: "deny" }]
const guardianToolNames = new Set(["read", "glob", "grep"])
const guardianDecision = Tool.make({
  description: "Return the Guardian assessment.",
  parameters: Approval.Assessment,
  success: Schema.Unknown,
})
const guardianDecisionDefinition = toDefinitions({ guardian_decision: guardianDecision })[0]!
const decodeGuardianDecision = Schema.decodeUnknownEffect(Approval.Assessment)

export const ID = Permission.ID
export type ID = typeof ID.Type

export const Source = Permission.Source
export type Source = typeof Source.Type

const RequestFields = {
  sessionID: Permission.Request.fields.sessionID,
  action: Permission.Request.fields.action,
  resources: Permission.Request.fields.resources,
  save: Permission.Request.fields.save,
  metadata: Permission.Request.fields.metadata,
  source: Permission.Request.fields.source,
}

export const Request = Permission.Request
export type Request = typeof Request.Type

export const Reply = Permission.Reply
export type Reply = typeof Reply.Type

export const AssertInput = Schema.Struct({
  id: ID.pipe(Schema.optional),
  ...RequestFields,
  agent: AgentV2.ID.pipe(Schema.optional),
}).annotate({ identifier: "PermissionV2.AssertInput" })
export type AssertInput = typeof AssertInput.Type

export const ReplyInput = Schema.Struct({
  requestID: ID,
  reply: Reply,
  message: Schema.String.pipe(Schema.optional),
}).annotate({ identifier: "PermissionV2.ReplyInput" })
export type ReplyInput = typeof ReplyInput.Type

export const AskResult = Schema.Struct({
  id: ID,
  effect: Permission.Effect,
}).annotate({ identifier: "PermissionV2.AskResult" })
export type AskResult = typeof AskResult.Type

export const Event = Permission.Event

export class DeclinedError extends Schema.TaggedErrorClass<DeclinedError>()("PermissionV2.DeclinedError", {}) {}

export class CorrectedError extends Schema.TaggedErrorClass<CorrectedError>()("PermissionV2.CorrectedError", {
  feedback: Schema.String,
}) {}

export class BlockedError extends Schema.TaggedErrorClass<BlockedError>()("PermissionV2.BlockedError", {
  rules: Permission.Ruleset,
}) {}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("PermissionV2.NotFoundError", {
  requestID: ID,
}) {}

export type Error = BlockedError | CorrectedError

export function evaluate(action: string, resource: string, ...rulesets: Permission.Ruleset[]): Permission.Rule {
  return (
    rulesets
      .flat()
      .findLast((rule) => Wildcard.match(action, rule.action) && Wildcard.match(resource, rule.resource)) ?? {
      action,
      resource: "*",
      effect: "ask",
    }
  )
}

export function merge(...rulesets: Permission.Ruleset[]): Permission.Ruleset {
  return rulesets.flat()
}

export interface Interface {
  readonly ask: (input: AssertInput) => EffectRuntime.Effect<AskResult, SessionV2.NotFoundError>
  readonly assert: (input: AssertInput) => EffectRuntime.Effect<void, Error | SessionV2.NotFoundError>
  readonly setApproval: (input: {
    sessionID: SessionV2.ID
    approval: SessionV2.Approval
  }) => EffectRuntime.Effect<void>
  readonly reply: (input: ReplyInput) => EffectRuntime.Effect<void, NotFoundError>
  readonly get: (id: ID) => EffectRuntime.Effect<Request | undefined>
  readonly forSession: (sessionID: SessionV2.ID) => EffectRuntime.Effect<ReadonlyArray<Request>>
  readonly list: () => EffectRuntime.Effect<ReadonlyArray<Request>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Permission") {}

interface Pending {
  readonly request: Request
  readonly agent?: AgentV2.ID
  readonly deferred: Deferred.Deferred<void, DeclinedError | CorrectedError>
  readonly published: Deferred.Deferred<void>
  readonly unregister: () => void
  readonly lock: Semaphore.Semaphore
}

const layer = Layer.effect(
  Service,
  EffectRuntime.gen(function* () {
    const events = yield* EventV2.Service
    const location = yield* Location.Service
    const agents = yield* AgentV2.Service
    const llm = yield* LLMClient.Service
    const models = yield* SessionRunnerModel.Service
    const sessions = yield* SessionStore.Service
    const saved = yield* PermissionSaved.Service
    const registry = yield* ToolRegistry.Service
    const pending = new Map<ID, Pending>()

    yield* EffectRuntime.addFinalizer(() =>
      EffectRuntime.forEach(pending.values(), (item) => Deferred.fail(item.deferred, new DeclinedError()), {
        discard: true,
      }).pipe(
        EffectRuntime.ensuring(
          EffectRuntime.sync(() => {
            for (const item of pending.values()) item.unregister()
            pending.clear()
          }),
        ),
      ),
    )

    const savedRules = EffectRuntime.fnUntraced(function* () {
      return (yield* saved.list({ projectID: location.project.id })).map(
        (item): Permission.Rule => ({ action: item.action, resource: item.resource, effect: "allow" }),
      )
    })

    const configured = EffectRuntime.fn("PermissionV2.configured")(function* (
      sessionID: SessionV2.ID,
      agentID?: AgentV2.ID,
    ) {
      const session = yield* sessions.get(sessionID)
      if (!session) return yield* new SessionV2.NotFoundError({ sessionID })
      const agent = yield* agents.resolve(agentID ?? session.agent)
      return { session, rules: agent?.permissions ?? missingAgentPermissions }
    })

    const approve = EffectRuntime.fn("PermissionV2.approve")(function* (
      input: AssertInput,
      session: SessionV2.Info,
    ) {
      const agent = yield* agents.get(AgentV2.ID.make("approval"))
      if (!agent?.model) return "ask" as const
      const model = yield* models.resolve({ ...session, model: agent.model })
      const materialized = yield* registry.materialize(agent.permissions)
      const definitions = materialized.definitions.filter((tool) => guardianToolNames.has(tool.name))
      const action = Approval.input({
            permission: input.action,
            tool: typeof input.metadata?.tool === "string" ? input.metadata.tool : input.action,
            patterns: input.resources,
            metadata: input.metadata,
            source: input.source,
        cwd: location.directory,
        justification: justification(input.metadata),
      })
      let messages = [
        Message.user(
          Approval.guardianPrompt({
            sessionID: input.sessionID,
            transcript: guardianTranscript(yield* sessions.approvalContext(input.sessionID)),
            action,
          }),
        ),
      ]
      const assistantMessageID = SessionMessage.ID.create()
      for (let round = 0; round <= 3; round++) {
        const response = yield* llm.generate(
          LLM.request({
            model,
            system: Approval.policy,
            messages,
            tools: [...definitions, guardianDecisionDefinition],
            toolChoice: "required",
generation: { temperature: 0 },
          }),
        )
        const decisionCalls = response.toolCalls.filter((call) => call.name === guardianDecisionDefinition.name)
        if (decisionCalls.length > 0) {
          if (decisionCalls.length !== 1 || response.toolCalls.length !== 1) return "ask" as const
          return Approval.assess(yield* decodeGuardianDecision(decisionCalls[0]!.input))
        }
        const calls = response.toolCalls.filter((call) => call.providerExecuted !== true)
        if (calls.length === 0 || round === 3 || calls.some((call) => !guardianToolNames.has(call.name)))
          return yield* EffectRuntime.fail("Guardian did not return a decision within its investigation limit")
        const settlements = yield* EffectRuntime.forEach(calls, (call) =>
          materialized.settle({
            sessionID: input.sessionID,
            agent: agent.id,
            assistantMessageID,
            call,
          }),
        )
        if (settlements.some((settlement) => settlement.result.type === "error"))
          return yield* EffectRuntime.fail("Guardian investigation failed")
        messages = [
          ...messages,
          response.message,
          ...calls.map((call, index) =>
            Message.tool({ id: call.id, name: call.name, result: settlements[index]!.result }),
          ),
        ]
      }
      return "ask" as const
    })

    function denied(input: AssertInput, rules: Permission.Ruleset) {
      return input.resources.some((resource) => evaluate(input.action, resource, rules).effect === "deny")
    }

    function relevant(input: AssertInput, rules: Permission.Ruleset) {
      return rules.filter((rule) => Wildcard.match(input.action, rule.action))
    }

    const evaluateInput = EffectRuntime.fnUntraced(function* (input: AssertInput, lifecycle: number) {
      while (true) {
        const configuredPermission = yield* configured(input.sessionID, input.agent)
        if (Approval.runtime.lifecycle(input.sessionID) !== lifecycle)
          return yield* new SessionV2.NotFoundError({ sessionID: input.sessionID })
        const rules = configuredPermission.rules
        const revision = Approval.runtime.revision(input.sessionID)
        const mode = Approval.runtime.get(input.sessionID) ?? configuredPermission.session.approval
        // Full access intentionally supersedes configured denies for this Session only.
        if (mode === "full") return { effect: "allow" as const, rules, revision }
        if (denied(input, rules)) return { effect: "deny" as const, rules, revision }
        const all = [...rules, ...(yield* savedRules())]
        const effects = input.resources.map((resource) => evaluate(input.action, resource, all).effect)
        const effect: Permission.Effect = effects.includes("deny")
          ? "deny"
          : effects.includes("ask")
            ? "ask"
            : "allow"
        const decision =
          effect === "ask" && mode === "automatic"
            ? yield* Approval.decide(approve(input, configuredPermission.session).pipe(EffectRuntime.timeout("30 seconds")))
            : effect
        if (Approval.runtime.lifecycle(input.sessionID) !== lifecycle)
          return yield* new SessionV2.NotFoundError({ sessionID: input.sessionID })
        if (Approval.runtime.revision(input.sessionID) !== revision) continue
        return { effect: decision, rules: all, revision }
      }
    })

    function request(input: AssertInput): Request {
      return {
        id: input.id ?? ID.create(),
        sessionID: input.sessionID,
        action: input.action,
        resources: input.resources,
        save: input.save,
        metadata: input.metadata,
        source: input.source,
      }
    }

    const create = (request: Request, revision: number, lifecycle: number, agent?: AgentV2.ID) =>
      EffectRuntime.uninterruptible(
        EffectRuntime.gen(function* () {
          const deferred = yield* Deferred.make<void, DeclinedError | CorrectedError>()
          const published = yield* Deferred.make<void>()
          const created = yield* EffectRuntime.sync(() => {
            if (pending.has(request.id)) throw new Error(`Duplicate pending permission ID: ${request.id}`)
            const unregister = Approval.runtime.register(
              request.sessionID,
              Deferred.await(published).pipe(
                EffectRuntime.andThen(reply({ requestID: request.id, reply: "once" })),
                EffectRuntime.catchTag("PermissionV2.NotFoundError", () => EffectRuntime.void),
              ),
              Deferred.await(published).pipe(
                EffectRuntime.andThen(reply({ requestID: request.id, reply: "reject" })),
                EffectRuntime.catchTag("PermissionV2.NotFoundError", () => EffectRuntime.void),
              ),
              revision,
              lifecycle,
            )
            if (!unregister) return "retry" as const
            const item = {
              request,
              agent,
              deferred,
              published,
              lock: Semaphore.makeUnsafe(1),
              // Replied must not overtake the corresponding Asked event.
              unregister,
            }
            pending.set(request.id, item)
            return item
          })
          if (created === "retry") return created
          yield* events
            .publish(Event.Asked, request)
            .pipe(
              EffectRuntime.onError(() =>
                EffectRuntime.sync(() => {
                  created.unregister()
                  if (pending.get(request.id) === created) pending.delete(request.id)
                }),
              ),
              EffectRuntime.ensuring(Deferred.succeed(published, undefined)),
            )
          return created
        }),
      )

    const ask = EffectRuntime.fn("PermissionV2.ask")(function* (input: AssertInput) {
      const lifecycle = Approval.runtime.lifecycle(input.sessionID)
      while (true) {
        const result = yield* evaluateInput(input, lifecycle)
        if (Approval.runtime.lifecycle(input.sessionID) !== lifecycle)
          return yield* new SessionV2.NotFoundError({ sessionID: input.sessionID })
        if (Approval.runtime.revision(input.sessionID) !== result.revision) continue
        const value = request(input)
        const created = result.effect === "ask" ? yield* create(value, result.revision, lifecycle, input.agent) : undefined
        if (created === "retry") {
          if (Approval.runtime.lifecycle(input.sessionID) !== lifecycle)
            return yield* new SessionV2.NotFoundError({ sessionID: input.sessionID })
          continue
        }
        return { id: value.id, effect: result.effect }
      }
    })

    const assert = EffectRuntime.fn("PermissionV2.assert")((input: AssertInput) =>
      EffectRuntime.uninterruptibleMask((restore) =>
        EffectRuntime.gen(function* () {
          const lifecycle = Approval.runtime.lifecycle(input.sessionID)
          while (true) {
            const result = yield* evaluateInput(input, lifecycle)
            if (Approval.runtime.lifecycle(input.sessionID) !== lifecycle)
              return yield* new SessionV2.NotFoundError({ sessionID: input.sessionID })
            if (Approval.runtime.revision(input.sessionID) !== result.revision) continue
            if (result.effect === "deny") {
              return yield* new BlockedError({
                rules: relevant(input, result.rules),
              })
            }
            if (result.effect === "allow") return
            const item = yield* create(request(input), result.revision, lifecycle, input.agent)
            if (item === "retry") {
              if (Approval.runtime.lifecycle(input.sessionID) !== lifecycle)
                return yield* new SessionV2.NotFoundError({ sessionID: input.sessionID })
              continue
            }
            return yield* restore(Deferred.await(item.deferred)).pipe(
              EffectRuntime.catchTag("PermissionV2.DeclinedError", (error) => EffectRuntime.die(error)),
              EffectRuntime.ensuring(
                EffectRuntime.sync(() => {
                  item.unregister()
                  if (pending.get(item.request.id) === item) pending.delete(item.request.id)
                }),
              ),
            )
          }
        }),
      ),
    )

    const setApproval = EffectRuntime.fn("PermissionV2.setApproval")(
      (input: { sessionID: SessionV2.ID; approval: SessionV2.Approval }) =>
        EffectRuntime.uninterruptible(
          EffectRuntime.gen(function* () {
            yield* EffectRuntime.sync(() => {
              Approval.runtime.set(input.sessionID, input.approval)
            })
            if (input.approval === "full") yield* Approval.runtime.drain(input.sessionID)
          }),
        ),
    )

    const reply = EffectRuntime.fn("PermissionV2.reply")((input: ReplyInput) =>
      EffectRuntime.uninterruptible(
        EffectRuntime.gen(function* () {
          const item = pending.get(input.requestID)
          if (!item) return yield* new NotFoundError({ requestID: input.requestID })
          return yield* item.lock.withPermit(
            EffectRuntime.gen(function* () {
              if (pending.get(input.requestID) !== item)
                return yield* new NotFoundError({ requestID: input.requestID })
              yield* events.publish(Event.Replied, {
                sessionID: item.request.sessionID,
                requestID: item.request.id,
                reply: input.reply,
              })

              if (input.reply === "reject") {
                yield* Deferred.fail(
                  item.deferred,
                  input.message ? new CorrectedError({ feedback: input.message }) : new DeclinedError(),
                )
                item.unregister()
                if (pending.get(input.requestID) === item) pending.delete(input.requestID)
                for (const [id, pendingItem] of pending) {
                  if (pendingItem.request.sessionID !== item.request.sessionID) continue
                  yield* pendingItem.lock.withPermit(
                    EffectRuntime.gen(function* () {
                      if (pending.get(id) !== pendingItem) return
                      yield* events.publish(Event.Replied, {
                        sessionID: pendingItem.request.sessionID,
                        requestID: pendingItem.request.id,
                        reply: "reject",
                      })
                      yield* Deferred.fail(pendingItem.deferred, new DeclinedError())
                      pendingItem.unregister()
                      if (pending.get(id) === pendingItem) pending.delete(id)
                    }),
                  )
                }
                return
              }

              if (input.reply === "always" && item.request.save?.length) {
                yield* saved.add({
                  projectID: location.project.id,
                  action: item.request.action,
                  resources: item.request.save,
                })
              }
              yield* Deferred.succeed(item.deferred, undefined)
              item.unregister()
              if (pending.get(input.requestID) === item) pending.delete(input.requestID)
              if (input.reply !== "always" || !item.request.save?.length) return

              const rememberedRules = yield* savedRules()
              for (const [id, pendingItem] of pending) {
                const pendingInput = { ...pendingItem.request }
                const configuredPermission = yield* configured(pendingItem.request.sessionID, pendingItem.agent).pipe(
                  EffectRuntime.catchTag("Session.NotFoundError", () => EffectRuntime.succeed(undefined)),
                )
                if (!configuredPermission) continue
                const rules = configuredPermission.rules
                if (denied(pendingInput, rules)) continue
                const effective = [...rules, ...rememberedRules]
                if (
                  !pendingItem.request.resources.every(
                    (resource) => evaluate(pendingItem.request.action, resource, effective).effect === "allow",
                  )
                )
                  continue
                yield* pendingItem.lock.withPermit(
                  EffectRuntime.gen(function* () {
                    if (pending.get(id) !== pendingItem) return
                    yield* events.publish(Event.Replied, {
                      sessionID: pendingItem.request.sessionID,
                      requestID: pendingItem.request.id,
                      reply: "always",
                    })
                    yield* Deferred.succeed(pendingItem.deferred, undefined)
                    pendingItem.unregister()
                    if (pending.get(id) === pendingItem) pending.delete(id)
                  }),
                )
              }
            }),
          )
        }),
      ),
    )

    const list = EffectRuntime.fn("PermissionV2.list")(function* () {
      return Array.from(pending.values(), (item) => item.request)
    })

    const get = EffectRuntime.fn("PermissionV2.get")(function* (id: ID) {
      return pending.get(id)?.request
    })

    const forSession = EffectRuntime.fn("PermissionV2.forSession")(function* (sessionID: SessionV2.ID) {
      return Array.from(pending.values(), (item) => item.request).filter((request) => request.sessionID === sessionID)
    })

    return Service.of({ ask, assert, setApproval, reply, get, forSession, list })
  }),
)

export const locationLayer = layer.pipe(Layer.provideMerge(AgentV2.locationLayer))

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    EventV2.node,
    Location.node,
    AgentV2.node,
    SessionStore.node,
    PermissionSaved.node,
    SessionRunnerModel.node,
    ToolRegistry.node,
    llmClient,
  ],
})

function guardianTranscript(messages: ReadonlyArray<SessionMessage.Message>): Approval.TranscriptEntry[] {
  return messages.flatMap((message): Approval.TranscriptEntry[] => {
    if (message.type === "user") return [{ role: "user", text: message.text }]
    if (message.type === "compaction")
      return [{ role: "assistant", text: Approval.checkpoint(message.summary, message.recent) }]
    if (message.type === "shell")
      return [{ role: "tool", name: "shell", text: JSON.stringify({ command: message.command, output: message.output }) }]
    if (message.type !== "assistant") return []
    return message.content.flatMap((part): Approval.TranscriptEntry[] => {
      if (part.type === "text") return part.text.trim() ? [{ role: "assistant", text: part.text }] : []
      if (part.type !== "tool") return []
      const pending = part.state.status === "pending"
      const input = pending ? part.state.input : JSON.stringify(part.state.input)
      const result =
        part.state.status === "completed"
          ? JSON.stringify({ content: part.state.content, structured: part.state.structured, result: part.state.result })
          : part.state.status === "error"
            ? JSON.stringify({ error: part.state.error, content: part.state.content, structured: part.state.structured })
            : undefined
      return [
        { role: "tool", name: `${part.name} call`, text: input },
        ...(result ? [{ role: "tool" as const, name: `${part.name} result`, text: result }] : []),
      ]
    })
  })
}

function justification(metadata: Readonly<Record<string, unknown>> | undefined) {
  const value = metadata?.justification ?? metadata?.reason
  return typeof value === "string" ? value : undefined
}
