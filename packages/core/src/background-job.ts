export * as BackgroundJob from "./background-job"

import { Cause, Clock, Context, Deferred, Effect, Exit, Layer, Scope, SynchronizedRef } from "effect"
import { Identifier } from "./id/id"
import { makeGlobalNode } from "./effect/app-node"

export type Status = "running" | "completed" | "error" | "cancelled"

export type Info = {
  id: string
  type: string
  title?: string
  status: Status
  started_at: number
  completed_at?: number
  output?: string
  error?: string
  metadata?: Record<string, unknown>
}

type Active = {
  info: Info
  done: Deferred.Deferred<Info>
  scope: Scope.Closeable
  token: object
  pending: number
  next: number
  output?: { sequence: number; text: string }
  tail: Deferred.Deferred<void>
  promoted: Deferred.Deferred<Info>
  onPromote?: (promotion: Promotion) => Effect.Effect<void>
}

type State = {
  jobs: SynchronizedRef.SynchronizedRef<Map<string, Active>>
  admissions: SynchronizedRef.SynchronizedRef<Set<string>>
  scope: Scope.Scope
}

type FinishResult = {
  info?: Info
  done?: Deferred.Deferred<Info>
  scope?: Scope.Closeable
}

type PromoteResult = {
  info?: Info
  done?: Deferred.Deferred<Info>
  promoted?: Deferred.Deferred<Info>
  onPromote?: (promotion: Promotion) => Effect.Effect<void>
}

type StartState = { info: Info } | { info: Info; scope: Scope.Closeable; token: object }

type ExtendResult =
  | { extended: false }
  | {
      extended: true
      previous: Deferred.Deferred<void>
      scope: Scope.Closeable
      tail: Deferred.Deferred<void>
      token: object
      sequence: number
    }

export type StartInput = {
  id?: string
  type: string
  title?: string
  metadata?: Record<string, unknown>
  cancellationKeys?: string[]
  onPromote?: (promotion: Promotion) => Effect.Effect<void>
  run: Effect.Effect<string, unknown>
}

export type Promotion = {
  info: Info
  wait: Effect.Effect<Info>
}

export type StartResult = {
  info: Info
  started: boolean
  owner?: object
}

export type CancelOwnedInput = {
  id: string
  owner: object
}

export type ExtendInput = {
  id: string
  run: Effect.Effect<string, unknown>
}

export type ExtendIfOpenInput = ExtendInput & {
  cancellationKeys: string[]
}

export type WaitInput = {
  id: string
  timeout?: number
}

export type WaitResult = {
  info?: Info
  timedOut: boolean
}

export interface Interface {
  readonly list: () => Effect.Effect<Info[]>
  readonly get: (id: string) => Effect.Effect<Info | undefined>
  readonly start: (input: StartInput) => Effect.Effect<Info>
  readonly startOwned: (input: StartInput) => Effect.Effect<StartResult>
  readonly startOwnedIfOpen: (input: StartInput) => Effect.Effect<StartResult | undefined>
  readonly admissionsOpen: (keys: string[]) => Effect.Effect<boolean>
  readonly closeAdmissions: (keys: string[]) => Effect.Effect<void>
  readonly openAdmissions: (keys: string[]) => Effect.Effect<void>
  readonly cancelOwned: (input: CancelOwnedInput) => Effect.Effect<Info | undefined>
  readonly extend: (input: ExtendInput) => Effect.Effect<boolean>
  readonly extendIfOpen: (input: ExtendIfOpenInput) => Effect.Effect<boolean>
  readonly wait: (input: WaitInput) => Effect.Effect<WaitResult>
  readonly waitForPromotion: (id: string) => Effect.Effect<Info>
  readonly promote: (id: string) => Effect.Effect<Info | undefined>
  readonly cancel: (id: string) => Effect.Effect<Info | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/BackgroundJob") {}

function snapshot(job: Active): Info {
  return {
    ...job.info,
    ...(job.info.metadata ? { metadata: { ...job.info.metadata } } : {}),
  }
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Makes one scoped, process-local registry. Entries are intentionally not
 * durable: process restart or owner-scope closure loses status and interrupts
 * live work. Persisted observation, restart recovery, and remote workers need a
 * separate durable ownership slice rather than pretending this registry has
 * those semantics.
 */
export const make = Effect.gen(function* () {
  const state: State = {
    jobs: yield* SynchronizedRef.make(new Map()),
    admissions: yield* SynchronizedRef.make(new Set<string>()),
    scope: yield* Scope.Scope,
  }

  const settle = Effect.fn("BackgroundJob.settle")(function* (
    id: string,
    token: object,
    sequence: number,
    exit: Exit.Exit<string, unknown>,
  ) {
    const completed_at = yield* Clock.currentTimeMillis
    const result = yield* SynchronizedRef.modify(state.jobs, (jobs): readonly [FinishResult, Map<string, Active>] => {
      const job = jobs.get(id)
      if (!job) return [{}, jobs]
      if (job.token !== token) return [{}, jobs]
      if (job.info.status !== "running") return [{ info: snapshot(job) }, jobs]
      const pending = job.pending - 1
      const output =
        Exit.isSuccess(exit) && (!job.output || sequence > job.output.sequence)
          ? { sequence, text: exit.value }
          : job.output
      if (Exit.isSuccess(exit) && pending > 0) {
        return [{}, new Map(jobs).set(id, { ...job, pending, output })]
      }
      const status: Exclude<Status, "running"> = Exit.isSuccess(exit)
        ? "completed"
        : Cause.hasInterruptsOnly(exit.cause)
          ? "cancelled"
          : "error"
      const next = {
        ...job,
        onPromote: undefined,
        pending: 0,
        output,
        info: {
          ...job.info,
          status,
          completed_at,
          ...(output ? { output: output.text } : {}),
          ...(Exit.isFailure(exit) ? { error: errorText(Cause.squash(exit.cause)) } : {}),
        },
      }
      return [{ info: snapshot(next), done: job.done, scope: job.scope }, new Map(jobs).set(id, next)]
    })
    if (result.info && result.done) yield* Deferred.succeed(result.done, result.info).pipe(Effect.ignore)
    if (result.scope) {
      yield* Scope.close(result.scope, Exit.void).pipe(Effect.forkIn(state.scope, { startImmediately: true }))
    }
    return result.info
  })

  const fork = Effect.fn("BackgroundJob.fork")(function* (
    scope: Scope.Scope,
    id: string,
    token: object,
    sequence: number,
    run: Effect.Effect<string, unknown>,
  ) {
    return yield* run.pipe(
      Effect.matchCauseEffect({
        onSuccess: (output) => settle(id, token, sequence, Exit.succeed(output)),
        onFailure: (cause) => settle(id, token, sequence, Exit.failCause(cause)),
      }),
      Effect.asVoid,
      Effect.forkIn(scope, { startImmediately: true }),
    )
  })

  const list: Interface["list"] = Effect.fn("BackgroundJob.list")(function* () {
    return Array.from((yield* SynchronizedRef.get(state.jobs)).values())
      .map(snapshot)
      .toSorted((a, b) => a.started_at - b.started_at)
  })

  const get: Interface["get"] = Effect.fn("BackgroundJob.get")(function* (id) {
    const job = (yield* SynchronizedRef.get(state.jobs)).get(id)
    if (!job) return
    return snapshot(job)
  })

  const startOwned: Interface["startOwned"] = Effect.fn("BackgroundJob.startOwned")(function* (input) {
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const id = input.id ?? Identifier.ascending("job")
        const started_at = yield* Clock.currentTimeMillis
        const done = yield* Deferred.make<Info>()
        const promoted = yield* Deferred.make<Info>()
        const tail = yield* Deferred.make<void>()
        const result = yield* SynchronizedRef.modifyEffect(
          state.jobs,
          Effect.fnUntraced(function* (jobs) {
            const existing = jobs.get(id)
            if (existing?.info.status === "running") {
              return [{ info: snapshot(existing) }, jobs] as readonly [StartState, Map<string, Active>]
            }
            const scope = yield* Scope.fork(state.scope, "parallel")
            const token = {}
            const job = {
              info: {
                id,
                type: input.type,
                title: input.title,
                status: "running" as const,
                started_at,
                metadata: input.metadata,
              },
              done,
              scope,
              token,
              pending: 1,
              next: 1,
              tail,
              promoted,
              onPromote: input.onPromote,
            }
            return [{ info: snapshot(job), scope, token }, new Map(jobs).set(id, job)] as readonly [
              StartState,
              Map<string, Active>,
            ]
          }),
        )
        if ("scope" in result)
          yield* fork(
            result.scope,
            id,
            result.token,
            0,
            restore(input.run).pipe(Effect.ensuring(Deferred.succeed(tail, undefined))),
          )
        return { info: result.info, started: "scope" in result, ...("token" in result ? { owner: result.token } : {}) }
      }),
    )
  })

  const start: Interface["start"] = (input) => startOwned(input).pipe(Effect.map((result) => result.info))

  const startOwnedIfOpen: Interface["startOwnedIfOpen"] = Effect.fn("BackgroundJob.startOwnedIfOpen")(
    function* (input) {
      return yield* SynchronizedRef.modifyEffect(state.admissions, (closed) => {
        if (input.cancellationKeys?.some((key) => closed.has(key))) return Effect.succeed([undefined, closed] as const)
        return startOwned(input).pipe(Effect.map((started) => [started, closed] as const))
      })
    },
  )

  const admissionsOpen: Interface["admissionsOpen"] = (keys) =>
    SynchronizedRef.get(state.admissions).pipe(Effect.map((closed) => !keys.some((key) => closed.has(key))))

  const closeAdmissions: Interface["closeAdmissions"] = (keys) =>
    SynchronizedRef.update(state.admissions, (closed) => new Set([...closed, ...keys]))

  const openAdmissions: Interface["openAdmissions"] = (keys) =>
    SynchronizedRef.update(state.admissions, (closed) => {
      const next = new Set(closed)
      for (const key of keys) next.delete(key)
      return next
    })

  const extend: Interface["extend"] = Effect.fn("BackgroundJob.extend")(function* (input) {
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const tail = yield* Deferred.make<void>()
        const result = yield* SynchronizedRef.modify(
          state.jobs,
          (jobs): readonly [ExtendResult, Map<string, Active>] => {
            const job = jobs.get(input.id)
            if (!job || job.info.status !== "running") return [{ extended: false }, jobs]
            return [
              { extended: true, previous: job.tail, scope: job.scope, tail, token: job.token, sequence: job.next },
              new Map(jobs).set(input.id, {
                ...job,
                pending: job.pending + 1,
                next: job.next + 1,
                tail,
              }),
            ]
          },
        )
        if (!result.extended) return false
        yield* fork(
          result.scope,
          input.id,
          result.token,
          result.sequence,
          Deferred.await(result.previous).pipe(
            Effect.andThen(restore(input.run)),
            Effect.ensuring(Deferred.succeed(result.tail, undefined)),
          ),
        )
        return true
      }),
    )
  })

  const wait: Interface["wait"] = Effect.fn("BackgroundJob.wait")(function* (input) {
    const job = (yield* SynchronizedRef.get(state.jobs)).get(input.id)
    if (!job) return { timedOut: false }
    if (job.info.status !== "running") return { info: snapshot(job), timedOut: false }
    if (input.timeout === undefined) return { info: yield* Deferred.await(job.done), timedOut: false }
    if (input.timeout <= 0) return { info: snapshot(job), timedOut: true }
    const info = yield* Deferred.await(job.done).pipe(Effect.timeoutOption(input.timeout))
    if (info._tag === "Some") return { info: info.value, timedOut: false }
    return { info: snapshot(job), timedOut: true }
  })

  const waitForPromotion: Interface["waitForPromotion"] = Effect.fn("BackgroundJob.waitForPromotion")(function* (id) {
    const job = (yield* SynchronizedRef.get(state.jobs)).get(id)
    if (!job || job.info.status !== "running") return yield* Effect.never
    if (job.info.metadata?.background === true) return snapshot(job)
    return yield* Deferred.await(job.promoted)
  })

  const promote: Interface["promote"] = Effect.fn("BackgroundJob.promote")(function* (id) {
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const result = yield* SynchronizedRef.modifyEffect(
          state.jobs,
          Effect.fnUntraced(function* (jobs) {
            const job = jobs.get(id)
            if (!job || job.info.status !== "running")
              return [{}, jobs] as readonly [PromoteResult, Map<string, Active>]
            if (job.info.metadata?.background === true)
              return [{ info: snapshot(job) }, jobs] as readonly [PromoteResult, Map<string, Active>]
            const next = {
              ...job,
              onPromote: undefined,
              info: {
                ...job.info,
                metadata: { ...job.info.metadata, background: true },
              },
            }
            return [
              { info: snapshot(next), done: job.done, onPromote: job.onPromote, promoted: job.promoted },
              new Map(jobs).set(id, next),
            ] as readonly [PromoteResult, Map<string, Active>]
          }),
        )
        if (result.info && result.promoted) yield* Deferred.succeed(result.promoted, result.info).pipe(Effect.ignore)
        if (result.info && result.done && result.onPromote)
          yield* restore(result.onPromote({ info: result.info, wait: Deferred.await(result.done) })).pipe(Effect.ignore)
        return result.info
      }),
    )
  })

  const extendIfOpen: Interface["extendIfOpen"] = Effect.fn("BackgroundJob.extendIfOpen")(function* (input) {
    return yield* SynchronizedRef.modifyEffect(state.admissions, (closed) => {
      if (input.cancellationKeys.some((key) => closed.has(key))) return Effect.succeed([false, closed] as const)
      return extend(input).pipe(Effect.map((extended) => [extended, closed] as const))
    })
  })

  const cancelWith = Effect.fn("BackgroundJob.cancelWith")(function* (id: string, owner?: object) {
    return yield* Effect.uninterruptible(
      Effect.gen(function* () {
        const completed_at = yield* Clock.currentTimeMillis
        const result = yield* SynchronizedRef.modify(
          state.jobs,
          (jobs): readonly [FinishResult, Map<string, Active>] => {
            const job = jobs.get(id)
            if (!job || (owner && job.token !== owner)) return [{}, jobs]
            if (job.info.status !== "running") return [{ info: snapshot(job) }, jobs]
            const next = {
              ...job,
              onPromote: undefined,
              pending: 0,
              info: {
                ...job.info,
                status: "cancelled" as const,
                completed_at,
              },
            }
            return [{ info: snapshot(next), done: job.done, scope: job.scope }, new Map(jobs).set(id, next)]
          },
        )
        if (result.info && result.done) yield* Deferred.succeed(result.done, result.info).pipe(Effect.ignore)
        if (result.scope) yield* Scope.close(result.scope, Exit.void)
        return result.info
      }),
    )
  })

  const cancel: Interface["cancel"] = (id) => cancelWith(id)
  const cancelOwned: Interface["cancelOwned"] = (input) => cancelWith(input.id, input.owner)

  return Service.of({
    list,
    get,
    start,
    startOwned,
    startOwnedIfOpen,
    admissionsOpen,
    closeAdmissions,
    openAdmissions,
    cancelOwned,
    extend,
    extendIfOpen,
    wait,
    waitForPromotion,
    promote,
    cancel,
  })
})

const layer = Layer.effect(Service, make)

export const node = makeGlobalNode({ service: Service, layer, deps: [] })
