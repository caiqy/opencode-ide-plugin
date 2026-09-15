import { Context, Effect, Layer, Schema } from "effect"
import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { isDeepStrictEqual } from "node:util"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { KeyedMutex } from "@opencode-ai/core/effect/keyed-mutex"
import { InputQueueTable, QueuedInputTable, SessionTable } from "@opencode-ai/core/session/sql"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { define } from "@opencode-ai/schema/event"
import { EventV2Bridge } from "@/event-v2-bridge"
import { SessionID, MessageID } from "./schema"

export const Delivery = Schema.Literals(["steer", "queue"])
export type Delivery = typeof Delivery.Type
export const Submission = Schema.Struct({
  id: MessageID,
  delivery: Delivery,
  prompt: Schema.Struct({
    parts: Schema.Array(
      Schema.Union([
        SessionV1.TextPartInput,
        SessionV1.FilePartInput,
        SessionV1.AgentPartInput,
        SessionV1.SubtaskPartInput,
      ]),
    ),
    agent: Schema.optional(Schema.String),
    model: Schema.optional(Schema.Struct({ providerID: Schema.String, modelID: Schema.String })),
    variant: Schema.optional(Schema.String),
  }),
  command: Schema.optional(
    Schema.Struct({
      command: Schema.String,
      arguments: Schema.String,
      agent: Schema.optional(Schema.String),
      model: Schema.optional(Schema.String),
      variant: Schema.optional(Schema.String),
    }),
  ),
})
export type Submission = typeof Submission.Type
export const Snapshot = Schema.Struct({
  sessionID: SessionID,
  revision: Schema.Number,
  paused: Schema.Boolean,
  items: Schema.Array(
    Schema.Struct({
      id: MessageID,
      sequence: Schema.Number,
      delivery: Delivery,
      text: Schema.String,
    }),
  ),
}).annotate({ identifier: "SessionInputQueue.Snapshot" })
export type Snapshot = typeof Snapshot.Type
export const Removed = Schema.Struct({ snapshot: Snapshot, input: Submission }).annotate({
  identifier: "SessionInputQueue.Removed",
})
export type Removed = typeof Removed.Type
export class InputError extends Schema.TaggedErrorClass<InputError>()("SessionInputQueueError", {
  message: Schema.String,
}) {}
export const Changed = define({ type: "session.input.changed", schema: Snapshot.fields })

const owner = crypto.randomUUID()
const locks = KeyedMutex.makeUnsafe<string>()
const decode = Schema.decodeUnknownSync(Submission)

export interface Interface {
  get: (sessionID: SessionID) => Effect.Effect<Snapshot, InputError>
  add: (sessionID: SessionID, input: Submission) => Effect.Effect<Snapshot, InputError>
  update: (sessionID: SessionID, id: MessageID, delivery: Delivery) => Effect.Effect<Snapshot, InputError>
  moveUp: (sessionID: SessionID, id: MessageID) => Effect.Effect<Snapshot, InputError>
  remove: (sessionID: SessionID, id: MessageID) => Effect.Effect<Removed, InputError>
  pause: (sessionID: SessionID) => Effect.Effect<void>
  resume: (sessionID: SessionID, idle: Effect.Effect<boolean>) => Effect.Effect<Snapshot, InputError>
  consume: (
    sessionID: SessionID,
    idle: boolean,
    prepare: (input: Submission) => Effect.Effect<SessionV1.WithParts>,
    stopping: () => boolean,
  ) => Effect.Effect<number>
}
export class Service extends Context.Service<Service, Interface>()("@opencode/SessionInputQueue") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const events = yield* EventV2Bridge.Service
    const db = database.db
    const pending = (sessionID: SessionID) =>
      db
        .select()
        .from(QueuedInputTable)
        .where(
          and(eq(QueuedInputTable.session_id, sessionID), inArray(QueuedInputTable.state, ["pending", "prepared"])),
        )
        .orderBy(asc(QueuedInputTable.sequence))
        .all()
        .pipe(Effect.orDie)

    const publishMessage = Effect.fn("InputQueue.publishMessage")(function* (id: string, message: SessionV1.WithParts) {
      yield* events.publish(SessionV1.Event.MessageUpdated, { sessionID: message.info.sessionID, info: message.info })
      for (const part of message.parts) {
        yield* events.publish(SessionV1.Event.PartUpdated, {
          sessionID: message.info.sessionID,
          part,
          time: message.info.time.created,
        })
      }
      yield* db
        .update(QueuedInputTable)
        .set({ state: "consumed", prepared: null })
        .where(eq(QueuedInputTable.id, id))
        .run()
        .pipe(Effect.orDie)
    })

    const state = Effect.fn("InputQueue.state")(function* (sessionID: SessionID) {
      const session = yield* db
        .select({ id: SessionTable.id })
        .from(SessionTable)
        .where(eq(SessionTable.id, sessionID))
        .get()
        .pipe(Effect.orDie)
      if (!session) return yield* new InputError({ message: "会话不存在" })
      yield* db
        .insert(InputQueueTable)
        .values({ session_id: sessionID, owner })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
      const current = yield* db
        .select()
        .from(InputQueueTable)
        .where(eq(InputQueueTable.session_id, sessionID))
        .get()
        .pipe(Effect.orDie)
      if (!current) return yield* Effect.die("Missing input queue")
      if (current.owner === owner) return current
      // A restart never retries provider work. Finish only idempotent history publication.
      const rows = yield* pending(sessionID)
      for (const row of rows) {
        if (row.prepared) yield* publishMessage(row.id, row.prepared)
      }
      const recovered = {
        ...current,
        owner,
        paused: rows.length > 0,
        next_id: null,
        revision: current.revision + 1,
      }
      yield* db
        .update(InputQueueTable)
        .set(recovered)
        .where(eq(InputQueueTable.session_id, sessionID))
        .run()
        .pipe(Effect.orDie)
      return recovered
    })
    const snapshot = Effect.fn("InputQueue.snapshot")(function* (sessionID: SessionID) {
      const current = yield* state(sessionID)
      const rows = yield* pending(sessionID)
      return {
        sessionID,
        revision: current.revision,
        paused: current.paused,
        items: rows.map((row) => {
          const input = decode(row.input)
          return {
            id: MessageID.make(row.id),
            sequence: row.sequence,
            delivery: row.delivery,
            text: input.command
              ? `/${input.command.command} ${input.command.arguments}`
              : input.prompt.parts
                  .map((part) =>
                    part.type === "text"
                      ? part.text
                      : part.type === "file"
                        ? (part.filename ?? "附件")
                        : part.type === "agent"
                          ? `@${part.name}`
                          : part.prompt,
                  )
                  .join(" "),
          }
        }),
      }
    })
    const changed = Effect.fn("InputQueue.changed")(function* (sessionID: SessionID) {
      const value = yield* snapshot(sessionID)
      yield* db
        .update(InputQueueTable)
        .set({ revision: value.revision + 1 })
        .where(eq(InputQueueTable.session_id, sessionID))
        .run()
        .pipe(Effect.orDie)
      const next = { ...value, revision: value.revision + 1 }
      yield* events.publish(Changed, next)
      return next
    })
    const get = (sessionID: SessionID) => locks.withLock(sessionID)(snapshot(sessionID))
    const add = (sessionID: SessionID, input: Submission) =>
      locks.withLock(sessionID)(
        Effect.gen(function* () {
          const current = yield* state(sessionID)
          const existing = yield* db
            .select()
            .from(QueuedInputTable)
            .where(eq(QueuedInputTable.id, input.id))
            .get()
            .pipe(Effect.orDie)
          if (existing) {
            if (
              existing.session_id !== sessionID ||
              !isDeepStrictEqual(existing.input, JSON.parse(JSON.stringify(input)))
            )
              return yield* new InputError({ message: "消息 ID 已用于其他输入" })
            return yield* snapshot(sessionID)
          }
          if (!input.command && !input.prompt.parts.some((part) => part.type !== "text" || part.text.trim()))
            return yield* new InputError({ message: "消息不能为空" })
          if (input.command && !input.command.command.trim()) return yield* new InputError({ message: "命令不能为空" })
          yield* db
            .insert(QueuedInputTable)
            .values({
              id: input.id,
              session_id: sessionID,
              sequence: current.revision + 1,
              delivery: input.delivery,
              state: "pending",
              input,
            })
            .run()
            .pipe(Effect.orDie)
          return yield* changed(sessionID)
        }),
      )
    const update = (sessionID: SessionID, id: MessageID, delivery: Delivery) =>
      locks.withLock(sessionID)(
        Effect.gen(function* () {
          yield* state(sessionID)
          const row = yield* db
            .select()
            .from(QueuedInputTable)
            .where(and(eq(QueuedInputTable.id, id), eq(QueuedInputTable.session_id, sessionID)))
            .get()
            .pipe(Effect.orDie)
          if (!row || row.state !== "pending")
            return yield* new InputError({ message: "消息已发送或已删除，请刷新列表" })
          yield* db
            .update(QueuedInputTable)
            .set({ delivery })
            .where(eq(QueuedInputTable.id, id))
            .run()
            .pipe(Effect.orDie)
          return yield* changed(sessionID)
        }),
      )
    const moveUp = (sessionID: SessionID, id: MessageID) =>
      locks.withLock(sessionID)(
        Effect.gen(function* () {
          yield* state(sessionID)
          const rows = (yield* pending(sessionID)).filter((row) => row.state === "pending")
          const index = rows.findIndex((row) => row.id === id)
          if (index < 0) return yield* new InputError({ message: "消息已发送或已删除，请刷新列表" })
          if (index === 0) return yield* snapshot(sessionID)
          const row = rows[index]
          const previous = rows[index - 1]
          yield* db
            .update(QueuedInputTable)
            .set({
              sequence: sql`case ${QueuedInputTable.id} when ${row.id} then ${previous.sequence} else ${row.sequence} end`,
            })
            .where(
              and(
                eq(QueuedInputTable.session_id, sessionID),
                eq(QueuedInputTable.state, "pending"),
                inArray(QueuedInputTable.id, [previous.id, row.id]),
              ),
            )
            .run()
            .pipe(Effect.orDie)
          return yield* changed(sessionID)
        }),
      )
    const remove = (sessionID: SessionID, id: MessageID) =>
      locks.withLock(sessionID)(
        Effect.gen(function* () {
          const current = yield* state(sessionID)
          const row = yield* db
            .select()
            .from(QueuedInputTable)
            .where(and(eq(QueuedInputTable.id, id), eq(QueuedInputTable.session_id, sessionID)))
            .get()
            .pipe(Effect.orDie)
          if (!row || row.state !== "pending")
            return yield* new InputError({ message: "消息已发送或已删除，请刷新列表" })
          yield* db
            .update(QueuedInputTable)
            .set({ state: "deleted" })
            .where(eq(QueuedInputTable.id, id))
            .run()
            .pipe(Effect.orDie)
          if (current.next_id === id) {
            yield* db
              .update(InputQueueTable)
              .set({ next_id: null })
              .where(eq(InputQueueTable.session_id, sessionID))
              .run()
              .pipe(Effect.orDie)
          }
          return { snapshot: yield* changed(sessionID), input: decode(row.input) }
        }),
      )
    const pause = (sessionID: SessionID) =>
      locks
        .withLock(sessionID)(
          Effect.gen(function* () {
            const current = yield* state(sessionID)
            if (current.paused && !current.next_id) return
            yield* db
              .update(InputQueueTable)
              .set({ paused: true, next_id: null })
              .where(eq(InputQueueTable.session_id, sessionID))
              .run()
              .pipe(Effect.orDie)
            yield* changed(sessionID)
          }),
        )
        .pipe(Effect.catchTag("SessionInputQueueError", () => Effect.void))
    const resume = (sessionID: SessionID, idle: Effect.Effect<boolean>) =>
      locks.withLock(sessionID)(
        Effect.gen(function* () {
          const current = yield* state(sessionID)
          if (!(yield* idle) || current.next_id) return yield* new InputError({ message: "请等待当前任务停止后再发送" })
          const first = (yield* pending(sessionID))[0]
          if (!first) return yield* new InputError({ message: "没有待发送消息" })
          yield* db
            .update(InputQueueTable)
            .set({ paused: false, next_id: first.id })
            .where(eq(InputQueueTable.session_id, sessionID))
            .run()
            .pipe(Effect.orDie)
          return yield* changed(sessionID)
        }),
      )
    const consume: Interface["consume"] = (sessionID, idle, prepare, stopping) =>
      locks
        .withLock(sessionID)(
          Effect.gen(function* () {
            const current = yield* state(sessionID)
            if (current.paused || stopping()) return 0
            const rows = yield* pending(sessionID)
            const queue = rows.findIndex((row) => row.delivery === "queue")
            const steers = rows.slice(0, queue < 0 ? rows.length : queue)
            const selected = current.next_id
              ? rows.filter((row) => row.id === current.next_id)
              : steers.length
                ? steers
                : idle
                  ? rows.slice(0, 1)
                  : []
            let count = 0
            for (const row of selected) {
              const message = row.prepared ?? (yield* prepare(decode(row.input)))
              if (stopping()) break
              // Persist resolved parts before publishing, so replay never reruns command expansion or attachment reads.
              yield* Effect.uninterruptible(
                Effect.gen(function* () {
                  yield* db
                    .update(QueuedInputTable)
                    .set({ state: "prepared", prepared: message })
                    .where(eq(QueuedInputTable.id, row.id))
                    .run()
                    .pipe(Effect.orDie)
                  yield* publishMessage(row.id, message)
                }),
              )
              count++
            }
            if (count) {
              yield* db
                .update(InputQueueTable)
                .set({ next_id: null })
                .where(eq(InputQueueTable.session_id, sessionID))
                .run()
                .pipe(Effect.orDie)
              yield* changed(sessionID)
            }
            return count
          }),
        )
        .pipe(Effect.orDie)
    return Service.of({ get, add, update, moveUp, remove, pause, resume, consume })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [Database.node, EventV2Bridge.node] })
export * as SessionInputQueue from "./input-queue"
