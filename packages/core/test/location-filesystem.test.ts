import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Layer, Scope } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FileSystem } from "@opencode-ai/core/filesystem"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Location } from "@opencode-ai/core/location"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { AbsolutePath, RelativePath } from "@opencode-ai/core/schema"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { it } from "./lib/effect"

const provide = (directory: string) =>
  Effect.provide(
    LayerNode.compile(FileSystem.node, [
      [
        Location.node,
        Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
      ],
    ]),
  )

const withTmp = <A, E, R>(f: (directory: string) => Effect.Effect<A, E, R>) =>
  Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(Effect.flatMap((tmp) => f(tmp.path)))

describe("FileSystem", () => {
  it.live("reads text and binary files", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "text.txt"), "hello"))
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "data.bin"), Buffer.from([0, 1, 2])))
        const service = yield* FileSystem.Service
        const text = yield* service.read({ path: RelativePath.make("text.txt") })
        const binary = yield* service.read({ path: RelativePath.make("data.bin") })
        expect(new TextDecoder().decode(text.content)).toBe("hello")
        expect(text.mime).toBe("text/plain")
        expect(binary.content).toEqual(new Uint8Array([0, 1, 2]))
      }).pipe(provide(directory)),
    ),
  )

  it.live("lists direct children", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.mkdir(path.join(directory, "src")))
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "README.md"), "# Test"))
        const entries = yield* (yield* FileSystem.Service).list()
        expect(entries.map((entry) => ({ path: entry.path, type: entry.type }))).toEqual([
          { path: RelativePath.make("src" + path.sep), type: "directory" },
          { path: RelativePath.make("README.md"), type: "file" },
        ])
      }).pipe(provide(directory)),
    ),
  )

  it.live("rejects lexical escapes", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const result = yield* (yield* FileSystem.Service)
          .read({ path: RelativePath.make("../outside.txt") })
          .pipe(Effect.exit)
        expect(Exit.isFailure(result)).toBe(true)
      }).pipe(provide(directory)),
    ),
  )

  it.live("waits for the initial search scan before finding files", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const previous = Flag.OPENCODE_DISABLE_FFF
        Flag.OPENCODE_DISABLE_FFF = true
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            Flag.OPENCODE_DISABLE_FFF = previous
          }),
        )

        const started = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const completed = yield* Deferred.make<void>()
        const entry = FileSystem.Entry.make({ path: RelativePath.make("ready.txt"), type: "file" })
        const ripgrep = Layer.mock(Ripgrep.Service, {
          find: (input) =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.andThen(input.onEntry?.(entry) ?? Effect.void),
              Effect.as([entry]),
            ),
        })

        return yield* Effect.gen(function* () {
          const service = yield* FileSystem.Service
          const scope = yield* Scope.Scope
          yield* Deferred.await(started)
          const found = yield* service
            .find({ query: "ready", type: "file", limit: 10 })
            .pipe(Effect.tap(() => Deferred.succeed(completed, undefined)), Effect.forkIn(scope))

          yield* Effect.yieldNow
          expect(yield* Deferred.isDone(completed)).toBe(false)

          yield* Deferred.succeed(release, undefined)
          expect((yield* Fiber.join(found)).map((item) => item.path)).toEqual([entry.path])
        }).pipe(
          Effect.provide(
            LayerNode.compile(FileSystem.node, [
              [
                Location.node,
                Layer.succeed(
                  Location.Service,
                  Location.Service.of(location({ directory: AbsolutePath.make(directory) })),
                ),
              ],
              [Ripgrep.node, ripgrep],
            ]),
          ),
        )
      }),
    ),
  )
})
