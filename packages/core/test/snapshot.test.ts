import { $ } from "bun"
import { afterAll, beforeAll, describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Config } from "@opencode-ai/core/config"
import { Global } from "@opencode-ai/core/global"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath, RelativePath } from "@opencode-ai/core/schema"
import { Snapshot } from "@opencode-ai/core/snapshot"
import { Hash } from "@opencode-ai/core/util/hash"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

let indexedSnapshotTmp: Awaited<ReturnType<typeof tmpdir>>
let indexedSnapshotProject = ""
let indexedSnapshotLinked = ""

beforeAll(async () => {
  indexedSnapshotTmp = await tmpdir()
  indexedSnapshotProject = path.join(indexedSnapshotTmp.path, "project")
  indexedSnapshotLinked = path.join(indexedSnapshotTmp.path, "linked")
  await fs.mkdir(indexedSnapshotProject)
  await fs.writeFile(path.join(indexedSnapshotProject, "tracked.txt"), "main\n")
  await $`git init`.cwd(indexedSnapshotProject).quiet()
  await $`git config core.fsmonitor false`.cwd(indexedSnapshotProject).quiet()
  await $`git config commit.gpgsign false`.cwd(indexedSnapshotProject).quiet()
  await $`git config user.email test@opencode.test`.cwd(indexedSnapshotProject).quiet()
  await $`git config user.name Test`.cwd(indexedSnapshotProject).quiet()
  await $`git add .`.cwd(indexedSnapshotProject).quiet()
  await $`git commit -m initial`.cwd(indexedSnapshotProject).quiet()
  await $`git worktree add --detach ${indexedSnapshotLinked} HEAD`.cwd(indexedSnapshotProject).quiet()
})

afterAll(async () => {
  await indexedSnapshotTmp[Symbol.asyncDispose]()
})

describe("Snapshot", () => {
  testEffect(Layer.empty).live("does not capture snapshots unless explicitly enabled", () =>
    Effect.gen(function* () {
      const snapshot = yield* Snapshot.Service
      expect(yield* snapshot.capture()).toBeUndefined()
    }).pipe(
      Effect.provide(
        snapshotLayer(indexedSnapshotTmp.path, indexedSnapshotProject, new Config.Info({})),
      ),
    ),
  )

  testEffect(Layer.empty).live("captures and restores Location-scoped changes", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const project = path.join(tmp.path, "project")
          const location = path.join(project, "scope")
          yield* Effect.promise(async () => {
            await fs.mkdir(location, { recursive: true })
            await fs.writeFile(path.join(location, "tracked.txt"), "one\n")
            await fs.writeFile(path.join(project, "outside.txt"), "outside\n")
            await $`git init`.cwd(project).quiet()
            await $`git config core.fsmonitor false`.cwd(project).quiet()
            await $`git config commit.gpgsign false`.cwd(project).quiet()
            await $`git config user.email test@opencode.test`.cwd(project).quiet()
            await $`git config user.name Test`.cwd(project).quiet()
            await $`git add .`.cwd(project).quiet()
            await $`git commit -m initial`.cwd(project).quiet()
          })

          const layer = snapshotLayer(tmp.path, location)
          yield* Effect.gen(function* () {
            const snapshot = yield* Snapshot.Service
            const before = yield* snapshot.capture()
            expect(before).toBeDefined()
            if (!before) return

            yield* Effect.promise(async () => {
              await fs.writeFile(path.join(location, "tracked.txt"), "two\n")
              await fs.writeFile(path.join(location, "added.txt"), "added\n")
              await fs.writeFile(path.join(project, "outside.txt"), "changed outside\n")
            })
            const after = yield* snapshot.capture()
            expect(after).toBeDefined()
            if (!after) return

            expect(yield* snapshot.files({ from: before, to: after })).toEqual([
              RelativePath.make("scope/added.txt"),
              RelativePath.make("scope/tracked.txt"),
            ])
            const plan = new Map([[RelativePath.make("scope/tracked.txt"), before]])
            const preview = yield* snapshot.preview({ files: plan, context: 1 })
            expect(preview).toHaveLength(1)
            expect(preview[0]?.path).toBe(RelativePath.make("scope/tracked.txt"))
            yield* snapshot.restore({ files: plan })
            expect(yield* read(path.join(location, "tracked.txt"))).toBe("one\n")
            expect(yield* read(path.join(location, "added.txt"))).toBe("added\n")
            expect(yield* read(path.join(project, "outside.txt"))).toBe("changed outside\n")
          }).pipe(Effect.provide(layer))
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
    30_000,
  )

  testEffect(Layer.empty).live("treats capture outside Git as unavailable", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          expect(
            yield* Effect.gen(function* () {
              const snapshot = yield* Snapshot.Service
              return yield* snapshot.capture()
            }).pipe(Effect.provide(snapshotLayer(tmp.path, tmp.path))),
          ).toBeUndefined()
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  testEffect(Layer.empty).live("isolates snapshot indexes by canonical Git worktree", () =>
    Effect.gen(function* () {
      const capture = (directory: string) =>
        Effect.gen(function* () {
          const snapshot = yield* Snapshot.Service
          return yield* snapshot.capture()
        }).pipe(Effect.provide(snapshotLayer(indexedSnapshotTmp.path, directory)))
      expect(yield* capture(indexedSnapshotProject)).toBeDefined()
      expect(yield* capture(indexedSnapshotLinked)).toBeDefined()

      const projectID = yield* Effect.gen(function* () {
        return (yield* Location.Service).project.id
      }).pipe(
        Effect.provide(
          AppNodeBuilder.build(Location.boundNode(Location.Ref.make({ directory: AbsolutePath.make(indexedSnapshotProject) }))),
        ),
      )
      expect(
        yield* Effect.promise(() => fs.stat(path.join(indexedSnapshotTmp.path, "snapshot", projectID, Hash.fast(indexedSnapshotProject)))),
      ).toBeDefined()
      expect(
        yield* Effect.promise(() => fs.stat(path.join(indexedSnapshotTmp.path, "snapshot", projectID, Hash.fast(indexedSnapshotLinked)))),
      ).toBeDefined()
    }),
    30_000,
  )

  testEffect(Layer.empty).live("checks out a legacy revert snapshot without removing unrelated files", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const project = path.join(tmp.path, "project")
          yield* Effect.promise(async () => {
            await fs.mkdir(project)
            await fs.writeFile(path.join(project, "tracked.txt"), "one\n")
            await $`git init`.cwd(project).quiet()
            await $`git config core.fsmonitor false`.cwd(project).quiet()
            await $`git config commit.gpgsign false`.cwd(project).quiet()
            await $`git config user.email test@opencode.test`.cwd(project).quiet()
            await $`git config user.name Test`.cwd(project).quiet()
            await $`git add .`.cwd(project).quiet()
            await $`git commit -m initial`.cwd(project).quiet()
          })

          yield* Effect.gen(function* () {
            const snapshot = yield* Snapshot.Service
            const before = yield* snapshot.capture()
            expect(before).toBeDefined()
            if (!before) return
            yield* Effect.promise(async () => {
              await fs.writeFile(path.join(project, "tracked.txt"), "two\n")
              await fs.writeFile(path.join(project, "unrelated.txt"), "keep\n")
            })
            yield* snapshot.checkout(before)
            expect(yield* read(path.join(project, "tracked.txt"))).toBe("one\n")
            expect(yield* read(path.join(project, "unrelated.txt"))).toBe("keep\n")
          }).pipe(Effect.provide(snapshotLayer(tmp.path, project)))
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )
})

function snapshotLayer(data: string, directory: string, info = new Config.Info({ snapshots: true })) {
  return AppNodeBuilder.build(Snapshot.node, [
    [Location.node, Location.boundNode(Location.Ref.make({ directory: AbsolutePath.make(directory) }))],
    [Global.node, Global.layerWith({ data, config: path.join(data, "config") })],
    [
      Config.node,
      Layer.succeed(
        Config.Service,
        Config.Service.of({
          entries: () => Effect.succeed([new Config.Document({ type: "document", info })]),
        }),
      ),
    ],
  ])
}

function read(file: string) {
  return Effect.promise(() => fs.readFile(file, "utf8")).pipe(Effect.map((content) => content.replaceAll("\r\n", "\n")))
}
