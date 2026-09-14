import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Deferred, Effect, Layer, Schema, Context } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { SessionID } from "@/session/schema"
import { QuestionID } from "./schema"
import { EventV2Bridge } from "@/event-v2-bridge"
import { QuestionV1 } from "@opencode-ai/schema/question-v1"
import { SessionV1 } from "@opencode-ai/core/v1/session"

export const Option = QuestionV1.Option
export type Option = typeof Option.Type
export const Info = QuestionV1.Info
export type Info = typeof Info.Type
export const Prompt = QuestionV1.Prompt
export type Prompt = typeof Prompt.Type
export const Tool = QuestionV1.Tool
export type Tool = typeof Tool.Type
export const Request = QuestionV1.Request
export type Request = typeof Request.Type
export const Answer = QuestionV1.Answer
export type Answer = typeof Answer.Type
export const Reply = QuestionV1.Reply
export type Reply = typeof Reply.Type
export const Replied = QuestionV1.Replied
export const Rejected = QuestionV1.Rejected
export const Event = QuestionV1.Event

export class RejectedError extends Schema.TaggedErrorClass<RejectedError>()("QuestionRejectedError", {}) {
  override get message() {
    return "The user dismissed this question"
  }
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Question.NotFoundError", {
  requestID: QuestionID,
}) {}

interface PendingEntry {
  info: Request
  deferred: Deferred.Deferred<ReadonlyArray<Answer>, RejectedError>
}

interface State {
  pending: Map<QuestionID, PendingEntry>
  closedSessions: Set<SessionID>
}

// Service

export interface Interface {
  readonly ask: (input: {
    sessionID: SessionID
    questions: ReadonlyArray<Info>
    tool?: Tool
  }) => Effect.Effect<ReadonlyArray<Answer>, RejectedError>
  readonly reply: (input: {
    requestID: QuestionID
    answers: ReadonlyArray<Answer>
  }) => Effect.Effect<void, NotFoundError>
  readonly reject: (requestID: QuestionID) => Effect.Effect<void, NotFoundError>
  readonly rejectSession: (sessionID: SessionID) => Effect.Effect<void>
  readonly openSession: (sessionID: SessionID) => Effect.Effect<void>
  readonly list: () => Effect.Effect<ReadonlyArray<Request>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Question") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const state = yield* InstanceState.make<State>(
      Effect.fn("Question.state")(function* () {
        const state: State = {
          pending: new Map<QuestionID, PendingEntry>(),
          closedSessions: new Set<SessionID>(),
        }

        const unsubscribe = yield* events.listen((event) => {
          if (event.type === SessionV1.Event.Deleted.type) {
            state.closedSessions.delete((event.data as { sessionID: SessionID }).sessionID)
          }
          return Effect.void
        })

        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            yield* unsubscribe
            for (const item of state.pending.values()) {
              yield* Deferred.fail(item.deferred, new RejectedError())
            }
            state.pending.clear()
            state.closedSessions.clear()
          }),
        )

        return state
      }),
    )

    const ask = Effect.fn("Question.ask")(function* (input: {
      sessionID: SessionID
      questions: ReadonlyArray<Info>
      tool?: Tool
    }) {
      const data = yield* InstanceState.get(state)
      const id = QuestionID.ascending()

      // Atomic check and registration boundary: check closed state and register pending synchronously
      // without yielding, ensuring rejectSession cannot race between check and pending registration.
      const item = yield* Effect.uninterruptible(
        Effect.gen(function* () {
          if (data.closedSessions.has(input.sessionID)) {
            return yield* new RejectedError()
          }
          const deferred = yield* Deferred.make<ReadonlyArray<Answer>, RejectedError>()
          const info: Request = {
            id,
            sessionID: input.sessionID,
            questions: input.questions,
            tool: input.tool,
          }
          const entry = { info, deferred }
          data.pending.set(id, entry)
          return entry
        }),
      )

      yield* Effect.logInfo("asking", { id, questions: input.questions.length })
      yield* events.publish(Event.Asked, item.info).pipe(
        Effect.onError(() =>
          Effect.sync(() => {
            if (data.pending.get(id) === item) data.pending.delete(id)
          }),
        ),
      )

      return yield* Effect.ensuring(
        Deferred.await(item.deferred),
        Effect.sync(() => {
          if (data.pending.get(id) === item) data.pending.delete(id)
        }),
      )
    })

    const reply = Effect.fn("Question.reply")(function* (input: {
      requestID: QuestionID
      answers: ReadonlyArray<Answer>
    }) {
      const pending = (yield* InstanceState.get(state)).pending
      const existing = pending.get(input.requestID)
      if (!existing) {
        yield* Effect.logWarning("reply for unknown request", { requestID: input.requestID })
        return yield* new NotFoundError({ requestID: input.requestID })
      }
      pending.delete(input.requestID)
      yield* Effect.logInfo("replied", { requestID: input.requestID, answers: input.answers })
      yield* events.publish(Event.Replied, {
        sessionID: existing.info.sessionID,
        requestID: existing.info.id,
        answers: input.answers.map((a) => [...a]),
      })
      yield* Deferred.succeed(existing.deferred, input.answers)
    })

    const reject = Effect.fn("Question.reject")(function* (requestID: QuestionID) {
      const pending = (yield* InstanceState.get(state)).pending
      const existing = pending.get(requestID)
      if (!existing) {
        yield* Effect.logWarning("reject for unknown request", { requestID })
        return yield* new NotFoundError({ requestID })
      }
      pending.delete(requestID)
      yield* Effect.logInfo("rejected", { requestID })
      yield* events.publish(Event.Rejected, {
        sessionID: existing.info.sessionID,
        requestID: existing.info.id,
      })
      yield* Deferred.fail(existing.deferred, new RejectedError())
    })

    const rejectSession = Effect.fn("Question.rejectSession")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      data.closedSessions.add(sessionID)
      const toReject: Array<{ id: QuestionID; deferred: Deferred.Deferred<ReadonlyArray<Answer>, RejectedError> }> = []
      for (const [id, item] of data.pending.entries()) {
        if (item.info.sessionID === sessionID) {
          data.pending.delete(id)
          toReject.push({ id, deferred: item.deferred })
        }
      }
      for (const item of toReject) {
        yield* Effect.logInfo("session rejected question", { sessionID, requestID: item.id })
        yield* events.publish(Event.Rejected, {
          sessionID,
          requestID: item.id,
        })
        yield* Deferred.fail(item.deferred, new RejectedError())
      }
    })

    const openSession = Effect.fn("Question.openSession")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      data.closedSessions.delete(sessionID)
    })

    const list = Effect.fn("Question.list")(function* () {
      const pending = (yield* InstanceState.get(state)).pending
      return Array.from(pending.values(), (x) => x.info)
    })

    return Service.of({ ask, reply, reject, rejectSession, openSession, list })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [EventV2Bridge.node] })

export * as Question from "."
