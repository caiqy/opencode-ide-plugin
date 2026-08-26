import { Cause, Context, Deferred, Effect, Exit, Fiber, Latch, Schema, Scope, SynchronizedRef } from "effect"

export interface Runner<A, E = never> {
  readonly state: State<A, E>
  readonly busy: boolean
  readonly ensureRunning: (work: Effect.Effect<A, E>) => Effect.Effect<A, E>
  readonly startShell: (work: Effect.Effect<A, E>, ready?: Latch.Latch) => Effect.Effect<A, E | Busy>
  readonly cancel: Effect.Effect<void>
}

export class Cancelled extends Schema.TaggedErrorClass<Cancelled>()("RunnerCancelled", {}) {}
export class Busy extends Schema.TaggedErrorClass<Busy>()("RunnerBusy", {}) {}

const CurrentRunner = Context.Reference<{ owner: object; id: number } | undefined>("~opencode/Runner/Current", {
  defaultValue: () => undefined,
})

interface RunHandle<A, E> {
  id: number
  done: Deferred.Deferred<A, E | Cancelled>
  fiber: Fiber.Fiber<A, E>
}

interface ShellHandle<A, E> {
  id: number
  cancelled: Deferred.Deferred<void>
  ready?: Latch.Latch
  fiber: Fiber.Fiber<A, E>
}

interface PendingHandle<A, E> {
  id: number
  done: Deferred.Deferred<A, E | Cancelled>
  work: Effect.Effect<A, E>
}

export type State<A, E> =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Running"; readonly run: RunHandle<A, E> }
  | { readonly _tag: "Shell"; readonly shell: ShellHandle<A, E> }
  | { readonly _tag: "ShellThenRun"; readonly shell: ShellHandle<A, E>; readonly run: PendingHandle<A, E> }

export const make = <A, E = never>(
  scope: Scope.Scope,
  opts?: {
    onIdle?: Effect.Effect<void>
    onBusy?: Effect.Effect<void>
    onInterrupt?: Effect.Effect<A, E>
  },
): Runner<A, E> => {
  const ref = SynchronizedRef.makeUnsafe<State<A, E>>({ _tag: "Idle" })
  const idle = opts?.onIdle ?? Effect.void
  const onBusy = opts?.onBusy ?? Effect.void
  const onInterrupt = opts?.onInterrupt
  const owner = {}
  let ids = 0
  let cancelling: { done: Deferred.Deferred<void>; id: number } | undefined
  let waiting = 0

  const state = () => SynchronizedRef.getUnsafe(ref)
  const next = () => {
    ids += 1
    return ids
  }

  const completeCancellation = (id: number) =>
    Effect.suspend(() => {
      if (cancelling?.id !== id) return Effect.void
      const done = cancelling.done
      cancelling = undefined
      return Deferred.succeed(done, undefined).pipe(Effect.andThen(idle), Effect.asVoid)
    })

  const complete = (done: Deferred.Deferred<A, E | Cancelled>, exit: Exit.Exit<A, E>) =>
    Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)
      ? Deferred.fail(done, new Cancelled()).pipe(Effect.asVoid)
      : Deferred.done(done, exit).pipe(Effect.asVoid)

  const awaitDone = (done: Deferred.Deferred<A, E | Cancelled>) =>
    Deferred.await(done).pipe(Effect.catchTag("RunnerCancelled", (e) => onInterrupt ?? Effect.die(e)))

  const finishRun = (id: number, done: Deferred.Deferred<A, E | Cancelled>, exit: Exit.Exit<A, E>) =>
    SynchronizedRef.modify(
      ref,
      (st) =>
        [
          Effect.gen(function* () {
            if (st._tag === "Running" && st.run.id === id && !cancelling) yield* idle
            yield* complete(done, exit)
          }),
          st._tag === "Running" && st.run.id === id ? ({ _tag: "Idle" } as const) : st,
        ] as const,
    ).pipe(Effect.flatten)

  const startRun = (work: Effect.Effect<A, E>, done: Deferred.Deferred<A, E | Cancelled>) =>
    Effect.gen(function* () {
      const id = next()
      const fiber = yield* work.pipe(
        Effect.provideService(CurrentRunner, { owner, id }),
        Effect.onExit((exit) => finishRun(id, done, exit)),
        Effect.forkIn(scope),
      )
      return { id, done, fiber } satisfies RunHandle<A, E>
    })

  const finishShell = (id: number) =>
    SynchronizedRef.modifyEffect(
      ref,
      Effect.fnUntraced(function* (st) {
        if (st._tag === "Shell" && st.shell.id === id) {
          return [cancelling ? Effect.void : idle, { _tag: "Idle" }] as const
        }
        if (st._tag === "ShellThenRun" && st.shell.id === id) {
          const run = yield* startRun(st.run.work, st.run.done)
          return [Effect.void, { _tag: "Running", run }] as const
        }
        return [Effect.void, st] as const
      }),
    ).pipe(Effect.flatten)

  const stopShell = (shell: ShellHandle<A, E>) =>
    Effect.gen(function* () {
      if (shell.ready) yield* shell.ready.await.pipe(Effect.exit, Effect.asVoid)
      yield* Deferred.succeed(shell.cancelled, undefined).pipe(Effect.asVoid)
      yield* Fiber.interrupt(shell.fiber)
    })

  const ensureRunning: Runner<A, E>["ensureRunning"] = (work) =>
    SynchronizedRef.modifyEffect(
      ref,
      Effect.fnUntraced(function* (st) {
        if (cancelling) {
          const current = yield* CurrentRunner
          if (current?.owner === owner && current.id === cancelling.id)
            return [onInterrupt ?? Effect.die(new Cancelled()), st] as const
          return [
            Effect.sync(() => {
              waiting += 1
            }).pipe(
              Effect.andThen(Effect.interruptible(Deferred.await(cancelling.done))),
              Effect.andThen(ensureRunning(work)),
              Effect.ensuring(
                Effect.suspend(() =>
                  Effect.sync(() => {
                    waiting -= 1
                    return !cancelling && waiting === 0 && state()._tag === "Idle"
                  }).pipe(Effect.flatMap((idleNow) => (idleNow ? idle : Effect.void))),
                ),
              ),
            ),
            st,
          ] as const
        }
        switch (st._tag) {
          case "Running":
          case "ShellThenRun":
            return [awaitDone(st.run.done), st] as const
          case "Shell": {
            const run = {
              id: next(),
              done: yield* Deferred.make<A, E | Cancelled>(),
              work,
            } satisfies PendingHandle<A, E>
            return [awaitDone(run.done), { _tag: "ShellThenRun", shell: st.shell, run }] as const
          }
          case "Idle": {
            const done = yield* Deferred.make<A, E | Cancelled>()
            const run = yield* startRun(work, done)
            return [awaitDone(done), { _tag: "Running", run }] as const
          }
        }
      }),
    ).pipe(Effect.flatten)

  const startShell: Runner<A, E>["startShell"] = (work, ready) =>
    SynchronizedRef.modifyEffect(
      ref,
      Effect.fnUntraced(function* (st) {
        if (cancelling) {
          const current = yield* CurrentRunner
          if (current?.owner === owner && current.id === cancelling.id)
            return [onInterrupt ?? Effect.die(new Cancelled()), st] as const
          return [
            Effect.sync(() => {
              waiting += 1
            }).pipe(
              Effect.andThen(Effect.interruptible(Deferred.await(cancelling.done))),
              Effect.andThen(startShell(work, ready)),
              Effect.ensuring(
                Effect.suspend(() =>
                  Effect.sync(() => {
                    waiting -= 1
                    return !cancelling && waiting === 0 && state()._tag === "Idle"
                  }).pipe(Effect.flatMap((idleNow) => (idleNow ? idle : Effect.void))),
                ),
              ),
            ),
            st,
          ] as const
        }
        if (st._tag !== "Idle") {
          const reject: Effect.Effect<A, E | Busy> = Effect.fail(new Busy())
          return [reject, st] as const
        }
        yield* onBusy
        const id = next()
        const cancelled = yield* Deferred.make<void>()
        const fiber = yield* work.pipe(
          Effect.provideService(CurrentRunner, { owner, id }),
          Effect.ensuring(finishShell(id)),
          Effect.forkChild,
        )
        const shell = { id, cancelled, ready, fiber } satisfies ShellHandle<A, E>
        return [
          Effect.gen(function* () {
            const exit = yield* Fiber.await(fiber)
            if (Exit.isSuccess(exit)) return exit.value
            if (
              Cause.hasInterruptsOnly(exit.cause) ||
              ((yield* Deferred.isDone(cancelled)) && Cause.hasInterrupts(exit.cause) && !Cause.hasDies(exit.cause))
            ) {
              if (onInterrupt) return yield* onInterrupt
              return yield* Effect.die(new Cancelled())
            }
            return yield* Effect.failCause(exit.cause)
          }),
          { _tag: "Shell", shell },
        ] as const
      }),
    ).pipe(Effect.flatten)

  const cancel = SynchronizedRef.modifyEffect(
    ref,
    Effect.fnUntraced(function* (st) {
      if (cancelling) {
        return [Effect.void, st] as const
      }
      if (st._tag === "Idle") return [Effect.void, st] as const
      const current = yield* CurrentRunner
      const id = st._tag === "Running" ? st.run.id : st.shell.id
      if (current?.owner === owner && current.id === id) return [Effect.void, st] as const
      const done = yield* Deferred.make<void>()
      cancelling = { done, id }
      switch (st._tag) {
        case "Running":
          return [
            Effect.gen(function* () {
              yield* Fiber.interrupt(st.run.fiber)
              yield* Deferred.fail(st.run.done, new Cancelled()).pipe(Effect.asVoid)
            }).pipe(Effect.ensuring(completeCancellation(id))),
            { _tag: "Idle" } as const,
          ] as const
        case "Shell":
          return [
            Effect.gen(function* () {
              yield* stopShell(st.shell)
            }).pipe(Effect.ensuring(completeCancellation(id))),
            { _tag: "Idle" } as const,
          ] as const
        case "ShellThenRun":
          return [
            Effect.gen(function* () {
              yield* stopShell(st.shell)
              yield* Deferred.fail(st.run.done, new Cancelled()).pipe(Effect.asVoid)
            }).pipe(Effect.ensuring(completeCancellation(id))),
            { _tag: "Idle" } as const,
          ] as const
      }
    }),
  ).pipe(Effect.flatten, Effect.uninterruptible)

  return {
    get state() {
      return state()
    },
    get busy() {
      return cancelling !== undefined || waiting > 0 || state()._tag !== "Idle"
    },
    ensureRunning,
    startShell,
    cancel,
  }
}

export * as Runner from "./runner"
