import { describe, expect } from "bun:test"
import { BackgroundJob } from "@opencode-ai/core/background-job"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Deferred, Effect, Exit, Scope } from "effect"
import { it } from "./lib/effect"

const jobsLayer = LayerNode.compile(BackgroundJob.node)

describe("BackgroundJob", () => {
  it.live("tracks process-local work through explicit observation", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const latch = yield* Deferred.make<void>()
      const job = yield* jobs.start({
        type: "test",
        metadata: { durable: false },
        run: Deferred.await(latch).pipe(Effect.as("done")),
      })

      expect(job).toMatchObject({ type: "test", status: "running", metadata: { durable: false } })
      expect(yield* jobs.wait({ id: job.id, timeout: 0 })).toMatchObject({
        timedOut: true,
        info: { status: "running" },
      })

      yield* Deferred.succeed(latch, undefined)
      expect(yield* jobs.wait({ id: job.id })).toMatchObject({
        timedOut: false,
        info: { status: "completed", output: "done" },
      })
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("publishes jobs before starting immediately settling work", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service

      yield* Effect.forEach(Array.from({ length: 100 }), (_, index) => {
        const id = `job_immediate_start_${index}`
        return Effect.gen(function* () {
          const job = yield* jobs.start({
            id,
            type: "test",
            run: jobs
              .get(id)
              .pipe(
                Effect.flatMap((info) =>
                  info?.status === "running"
                    ? Effect.succeed(`done-${index}`)
                    : Effect.fail("job started before publish"),
                ),
              ),
          })

          expect(yield* jobs.wait({ id: job.id })).toMatchObject({
            timedOut: false,
            info: { status: "completed", output: `done-${index}` },
          })
        })
      })
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("reports which concurrent start created the job", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const id = "job_owned"
      const [first, second] = yield* Effect.all(
        [
          jobs.startOwned({ id, type: "test", run: Effect.never }),
          jobs.startOwned({ id, type: "test", run: Effect.never }),
        ],
        { concurrency: "unbounded" },
      )

      expect([first, second].filter((item) => item.started)).toHaveLength(1)
      expect(first.info.id).toBe(id)
      expect(second.info.id).toBe(id)
      yield* jobs.cancel(id)
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("does not cancel a newer job with a stale owner", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const id = "job_reused"
      const first = yield* jobs.startOwned({ id, type: "test", run: Effect.never })

      yield* jobs.cancel(id)
      const second = yield* jobs.startOwned({ id, type: "test", run: Effect.never })
      yield* jobs.cancelOwned({ id, owner: first.owner! })

      expect(first.started).toBe(true)
      expect(second.started).toBe(true)
      expect((yield* jobs.get(id))?.status).toBe("running")
      yield* jobs.cancel(id)
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("keeps promotion observation bound to its job generation", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const id = "job_promoted"
      const latch = yield* Deferred.make<void>()
      const promoted = yield* Deferred.make<Effect.Effect<BackgroundJob.Info>>()
      yield* jobs.start({
        id,
        type: "test",
        run: Deferred.await(latch).pipe(Effect.as("first")),
        onPromote: ({ wait }) => Deferred.succeed(promoted, wait).pipe(Effect.asVoid),
      })

      yield* jobs.promote(id)
      yield* Deferred.succeed(latch, undefined)
      expect((yield* jobs.wait({ id })).info?.output).toBe("first")

      yield* jobs.start({ id, type: "test", run: Effect.never })
      expect((yield* yield* Deferred.await(promoted)).output).toBe("first")
      yield* jobs.cancel(id)
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("increments pending work before starting immediately settling extensions", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service

      yield* Effect.forEach(Array.from({ length: 100 }), (_, index) =>
        Effect.gen(function* () {
          const first = yield* Deferred.make<void>()
          const job = yield* jobs.start({
            type: "test",
            run: Deferred.await(first).pipe(Effect.as(`first-${index}`)),
          })

          expect(yield* jobs.extend({ id: job.id, run: Effect.succeed(`second-${index}`) })).toBe(true)
          expect((yield* jobs.get(job.id))?.status).toBe("running")

          yield* Deferred.succeed(first, undefined)
          expect(yield* jobs.wait({ id: job.id })).toMatchObject({
            timedOut: false,
            info: { status: "completed", output: `second-${index}` },
          })
        }),
      )
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("does not extend jobs after their admission closes", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const job = yield* jobs.start({ id: "job_closed_admission", type: "test", run: Effect.never })

      yield* jobs.closeAdmissions(["session"])

      expect(
        yield* jobs.extendIfOpen({
          id: job.id,
          cancellationKeys: ["session"],
          run: Effect.succeed("late"),
        }),
      ).toBe(false)
      yield* jobs.cancel(job.id)
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("interrupts live work without promising settlement after the owning process-local scope closes", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const interrupted = yield* Deferred.make<void>()
      const jobs = yield* BackgroundJob.make.pipe(Scope.provide(scope))
      const job = yield* jobs.start({
        type: "test",
        run: Effect.never.pipe(Effect.ensuring(Deferred.succeed(interrupted, undefined))),
      })

      yield* Scope.close(scope, Exit.void)

      yield* Deferred.await(interrupted).pipe(Effect.timeout("1 second"))
      // The abandoned in-memory registry is not a durable observation channel.
      expect((yield* jobs.get(job.id))?.status).toBe("running")
    }),
  )
})
