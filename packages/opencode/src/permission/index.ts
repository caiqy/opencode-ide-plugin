import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { InstanceState } from "@/effect/instance-state"
import { Wildcard } from "@opencode-ai/core/util/wildcard"
import { Deferred, Effect, Layer, Context, Schema, Semaphore } from "effect"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { ApprovalV1 } from "@opencode-ai/core/v1/approval"
import { Approval } from "@opencode-ai/core/approval"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Config } from "@/config/config"
import { ApprovalAgent } from "@/agent/approval-config"
import { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { jsonSchema, streamText, tool, type ModelMessage, type Tool as AITool } from "ai"
import { mergeDeep } from "remeda"
import { Agent } from "@/agent/agent"
import { Session } from "@/session/session"
import { ToolRegistry } from "@/tool/registry"
import { ToolJsonSchema } from "@/tool/json-schema"
import { EffectBridge } from "@/effect/bridge"
import { MessageID } from "@/session/schema"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { evaluate } from "./rules"
export { disabled, evaluate, fromConfig, merge, visibleTools } from "./rules"

export const Event = PermissionV1.Event

const guardianToolNames = new Set(["read", "glob", "grep"])

export interface Interface {
  readonly ask: (input: PermissionV1.AskInput) => Effect.Effect<void, PermissionV1.Error>
  readonly setApproval: (input: {
    sessionID: PermissionV1.AskInput["sessionID"]
    approval: ApprovalV1.Mode
  }) => Effect.Effect<void>
  readonly reply: (input: PermissionV1.ReplyInput) => Effect.Effect<void, PermissionV1.NotFoundError>
  readonly list: () => Effect.Effect<ReadonlyArray<PermissionV1.Request>>
}

interface PendingEntry {
  info: PermissionV1.Request
  deferred: Deferred.Deferred<void, PermissionV1.RejectedError | PermissionV1.CorrectedError>
  published: Deferred.Deferred<void>
  unregister: () => void
  lock: Semaphore.Semaphore
}

interface State {
  pending: Map<PermissionV1.ID, PendingEntry>
  approved: PermissionV1.Rule[]
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Permission") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const config = yield* Config.Service
    const provider = yield* Provider.Service
    const agents = yield* Agent.Service
    const sessions = yield* Session.Service
    const registry = yield* ToolRegistry.Service
    const state = yield* InstanceState.make<State>(
      Effect.fn("Permission.state")(function* (ctx) {
        void ctx
        const state = {
          pending: new Map<PermissionV1.ID, PendingEntry>(),
          approved: [],
        }

        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            for (const item of state.pending.values()) {
              yield* Deferred.fail(item.deferred, new PermissionV1.RejectedError())
              item.unregister()
            }
            state.pending.clear()
          }),
        )

        return state
      }),
    )

    const approve = Effect.fn("Permission.approve")(function* (
      request: Omit<PermissionV1.Request, "id"> & { toolName?: string },
    ) {
      const cfg = yield* config.get()
      const info = ApprovalAgent.resolve(cfg.agent?.approval)
      const resolved = yield* provider.getModel(info.model.providerID, info.model.modelID)
      const language = yield* provider.getLanguage(resolved)
      const variant = info.variant ? resolved.variants?.[info.variant] ?? {} : {}
      const approvalAgent = yield* agents.get("approval")
      // Fetch the full message history through the existing pagination path so
      // the bounded transcript never silently drops the first user request;
      // Approval.transcript bounds the rendered prompt and marks omissions.
      const history = (yield* sessions.messages({ sessionID: request.sessionID })).toSorted(
        (left, right) => left.info.time.created - right.info.time.created,
      )
      const bridge = yield* EffectBridge.make()
      const messageID = MessageID.ascending()
      const tools = Object.fromEntries(
        (yield* registry.builtin())
          .filter((item) => guardianToolNames.has(item.id))
          .map((item) => [
            item.id,
            tool({
              description: item.description,
              inputSchema: jsonSchema(ProviderTransform.schema(resolved, ToolJsonSchema.fromTool(item))),
              execute: (args, options) =>
                bridge.promise(
                  item.execute(args, {
                    sessionID: request.sessionID,
                    messageID,
                    callID: options.toolCallId,
                    agent: approvalAgent.name,
                    abort: options.abortSignal ?? new AbortController().signal,
                    messages: history,
                    metadata: () => Effect.void,
                    ask: (input) =>
                      input.patterns.every(
                        (pattern) => evaluate(input.permission, pattern, approvalAgent.permission).action === "allow",
                      )
                        ? Effect.void
                        : Effect.die(new Error(`Guardian cannot use permission ${input.permission}`)),
                  }),
                ),
            }),
          ]),
      ) satisfies Record<string, AITool>
      const prompt = Approval.guardianPrompt({
        sessionID: request.sessionID,
        transcript: guardianTranscript(history),
        action: Approval.input({
          permission: request.permission,
          tool: request.toolName ?? request.permission,
          patterns: request.patterns,
          metadata: request.metadata,
          source: request.tool,
          cwd: yield* InstanceState.directory,
          justification: justification(request.metadata),
        }),
      })
      return yield* Effect.tryPromise(async (signal) => {
        let messages: ModelMessage[] = [{ role: "user", content: prompt }]
        for (let round = 0; round <= 3; round++) {
          let decision: Approval.Assessment | undefined
          let decisions = 0
          let investigations = 0
          let errored = false
          const decisionTool = tool({
            description: "Return the Guardian assessment.",
            inputSchema: Object.assign(
              Schema.toStandardSchemaV1(Approval.Assessment),
              Schema.toStandardJSONSchemaV1(Approval.Assessment),
            ),
            execute: (input) => {
              decisions += 1
              decision = input
              return input
            },
          })
          const roundTools = Object.fromEntries(
            Object.entries(tools).map(([id, def]) => [
              id,
              tool({
                description: def.description,
                inputSchema: def.inputSchema,
                execute: (args, options) => {
                  investigations += 1
                  return Promise.resolve(def.execute!(args, options)).catch((error) => {
                    errored = true
                    throw error
                  })
                },
              }),
            ]),
          ) satisfies Record<string, AITool>
          const result = streamText({
            model: language,
            temperature: 0,
            system: ApprovalAgent.prompt,
            messages,
            tools:
              round === 3 ? { guardian_decision: decisionTool } : { ...roundTools, guardian_decision: decisionTool },
            toolChoice: "required",
            abortSignal: signal,
            providerOptions: ProviderTransform.providerOptions(
              resolved,
              mergeDeep(variant, { instructions: ApprovalAgent.prompt, store: false }),
            ),
          })
          await result.consumeStream()
          // A decision is only trusted when its own round produced exactly one
          // guardian_decision call and no investigation call or tool error; any
          // other shape falls back to the manual permission flow (fail-closed).
          if (errored || (decision && (decisions !== 1 || investigations !== 0))) {
            throw new Error("Guardian produced an invalid decision")
          }
          if (decision) return Approval.assess(decision)
          if (round === 3 || (await result.toolCalls).length === 0)
            throw new Error("Guardian investigation limit reached")
          messages = [...messages, ...(await result.response).messages]
        }
        return "ask" as const
      })
    })

    const ask = Effect.fn("Permission.ask")(function* (input: PermissionV1.AskInput) {
      const lifecycle = Approval.runtime.lifecycle(input.sessionID)
      while (true) {
        const { approved, pending } = yield* InstanceState.get(state)
        const { ruleset, toolName, ...request } = input
        const revision = Approval.runtime.revision(request.sessionID)
        const mode = Approval.runtime.get(request.sessionID) ?? ApprovalV1.modeFromRuleset(ruleset)
        if (mode === "full") {
          if (Approval.runtime.lifecycle(request.sessionID) !== lifecycle)
            return yield* new PermissionV1.RejectedError()
          return
        }
        let needsAsk = false

        for (const pattern of request.patterns) {
          const rule = evaluate(request.permission, pattern, approved, ruleset)
          yield* Effect.logInfo("evaluated", { permission: request.permission, pattern, action: rule })
          if (Approval.runtime.lifecycle(request.sessionID) !== lifecycle)
            return yield* new PermissionV1.RejectedError()
          if (Approval.runtime.revision(request.sessionID) !== revision) break
          if (rule.action === "deny") {
            return yield* new PermissionV1.DeniedError({
              ruleset: ruleset.filter((rule) => Wildcard.match(request.permission, rule.permission)),
            })
          }
          if (rule.action === "allow") continue
          needsAsk = true
        }

        if (Approval.runtime.lifecycle(request.sessionID) !== lifecycle) return yield* new PermissionV1.RejectedError()
        if (Approval.runtime.revision(request.sessionID) !== revision) continue
        if (!needsAsk) return

        if (mode === "automatic") {
          const result = yield* Approval.decide(approve({ ...request, toolName }).pipe(Effect.timeout("30 seconds")))
          if (Approval.runtime.lifecycle(request.sessionID) !== lifecycle) return yield* new PermissionV1.RejectedError()
          if (Approval.runtime.revision(request.sessionID) !== revision) continue
          if (result === "allow") return
          if (result === "deny") return yield* new PermissionV1.RejectedError()
        }

        const id = request.id ?? PermissionV1.ID.ascending()
        const info: PermissionV1.Request = {
          id,
          sessionID: request.sessionID,
          permission: request.permission,
          patterns: request.patterns,
          metadata: request.metadata,
          always: request.always,
          tool: request.tool,
        }
        yield* Effect.logInfo("asking", { id, permission: info.permission, patterns: info.patterns })
        if (Approval.runtime.lifecycle(request.sessionID) !== lifecycle) return yield* new PermissionV1.RejectedError()
        if (Approval.runtime.revision(request.sessionID) !== revision) continue

        const waiting = yield* Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            const deferred = yield* Deferred.make<void, PermissionV1.RejectedError | PermissionV1.CorrectedError>()
            const published = yield* Deferred.make<void>()
            if (pending.has(id)) throw new Error(`Duplicate pending permission ID: ${id}`)
            // Replied must not overtake the corresponding Asked event.
            const unregister = Approval.runtime.register(
              request.sessionID,
              Deferred.await(published).pipe(
                Effect.andThen(reply({ requestID: id, reply: "once" })),
                Effect.catchTag("Permission.NotFoundError", () => Effect.void),
              ),
              Deferred.await(published).pipe(
                Effect.andThen(reply({ requestID: id, reply: "reject" })),
                Effect.catchTag("Permission.NotFoundError", () => Effect.void),
              ),
              revision,
              lifecycle,
            )
            if (!unregister) {
              if (Approval.runtime.lifecycle(request.sessionID) !== lifecycle)
                return yield* new PermissionV1.RejectedError()
              return "retry" as const
            }
            const item = { info, deferred, published, unregister, lock: Semaphore.makeUnsafe(1) }
            pending.set(id, item)
            yield* events.publish(Event.Asked, info).pipe(
              Effect.onError(() =>
                Effect.sync(() => {
                  unregister()
                  if (pending.get(id) === item) pending.delete(id)
                }),
              ),
              Effect.ensuring(Deferred.succeed(published, undefined)),
            )
            return yield* restore(Deferred.await(deferred)).pipe(
              Effect.as("done" as const),
              Effect.ensuring(
                Effect.sync(() => {
                  unregister()
                  if (pending.get(id) === item) pending.delete(id)
                }),
              ),
            )
          }),
        )
        if (waiting === "retry") continue
        return
      }
    })

    const reply = Effect.fn("Permission.reply")((input: PermissionV1.ReplyInput) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          const { approved, pending } = yield* InstanceState.get(state)
          const item = pending.get(input.requestID)
          if (!item) return yield* new PermissionV1.NotFoundError({ requestID: input.requestID })
          return yield* item.lock.withPermit(
            Effect.gen(function* () {
              if (pending.get(input.requestID) !== item)
                return yield* new PermissionV1.NotFoundError({ requestID: input.requestID })
              yield* events.publish(Event.Replied, {
                sessionID: item.info.sessionID,
                requestID: item.info.id,
                reply: input.reply,
              })
              item.unregister()
              if (pending.get(input.requestID) === item) pending.delete(input.requestID)

              if (input.reply === "reject") {
                yield* Deferred.fail(
                  item.deferred,
                  input.message
                    ? new PermissionV1.CorrectedError({ feedback: input.message })
                    : new PermissionV1.RejectedError(),
                )

                for (const [id, pendingItem] of pending.entries()) {
                  if (pendingItem.info.sessionID !== item.info.sessionID) continue
                  yield* pendingItem.lock.withPermit(
                    Effect.gen(function* () {
                      if (pending.get(id) !== pendingItem) return
                      yield* events.publish(Event.Replied, {
                        sessionID: pendingItem.info.sessionID,
                        requestID: pendingItem.info.id,
                        reply: "reject",
                      })
                      pendingItem.unregister()
                      if (pending.get(id) === pendingItem) pending.delete(id)
                      yield* Deferred.fail(pendingItem.deferred, new PermissionV1.RejectedError())
                    }),
                  )
                }
                return
              }

              yield* Deferred.succeed(item.deferred, undefined)
              if (input.reply === "once") return

              for (const pattern of item.info.always) {
                approved.push({
                  permission: item.info.permission,
                  pattern,
                  action: "allow",
                })
              }

              for (const [id, pendingItem] of pending.entries()) {
                if (pendingItem.info.sessionID !== item.info.sessionID) continue
                const ok = pendingItem.info.patterns.every(
                  (pattern) => evaluate(pendingItem.info.permission, pattern, approved).action === "allow",
                )
                if (!ok) continue
                yield* pendingItem.lock.withPermit(
                  Effect.gen(function* () {
                    if (pending.get(id) !== pendingItem) return
                    yield* events.publish(Event.Replied, {
                      sessionID: pendingItem.info.sessionID,
                      requestID: pendingItem.info.id,
                      reply: "always",
                    })
                    pendingItem.unregister()
                    if (pending.get(id) === pendingItem) pending.delete(id)
                    yield* Deferred.succeed(pendingItem.deferred, undefined)
                  }),
                )
              }
            }),
          )
        }),
      ),
    )

    const setApproval = Effect.fn("Permission.setApproval")(
      (input: { sessionID: PermissionV1.AskInput["sessionID"]; approval: ApprovalV1.Mode }) =>
        Effect.uninterruptible(
          Effect.gen(function* () {
            Approval.runtime.set(input.sessionID, input.approval)
            if (input.approval !== "full") return
            yield* Approval.runtime.drain(input.sessionID)
          }),
        ),
    )

    const list = Effect.fn("Permission.list")(function* () {
      const pending = (yield* InstanceState.get(state)).pending
      return Array.from(pending.values(), (item) => item.info)
    })

    return Service.of({ ask, setApproval, reply, list })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [EventV2Bridge.node, Config.node, Provider.node, Agent.node, Session.node, ToolRegistry.node],
})

function guardianTranscript(messages: ReadonlyArray<SessionV1.WithParts>): Approval.TranscriptEntry[] {
  return messages.flatMap((message): Approval.TranscriptEntry[] => {
    if (message.info.role === "user")
      return message.parts.flatMap((part) =>
        part.type === "text" && !part.synthetic && !part.ignored && part.text.trim()
          ? [{ role: "user" as const, text: part.text }]
          : [],
      )
    return message.parts.flatMap((part): Approval.TranscriptEntry[] => {
      if (part.type === "text") return part.text.trim() ? [{ role: "assistant", text: part.text }] : []
      if (part.type !== "tool") return []
      const result =
        part.state.status === "completed"
          ? part.state.output
          : part.state.status === "error"
            ? part.state.error
            : undefined
      return [
        { role: "tool", name: `${part.tool} call`, text: JSON.stringify(part.state.input) },
        ...(result ? [{ role: "tool" as const, name: `${part.tool} result`, text: result }] : []),
      ]
    })
  })
}

function justification(metadata: Readonly<Record<string, unknown>> | undefined) {
  const value = metadata?.justification ?? metadata?.reason
  return typeof value === "string" ? value : undefined
}

export * as Permission from "."
