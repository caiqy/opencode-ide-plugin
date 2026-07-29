import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect, Exit, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { RipgrepBinary } from "@opencode-ai/core/ripgrep/binary"
import { RelativePath } from "@opencode-ai/core/schema"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(LayerNode.compile(Ripgrep.node))
const failedScan = testEffect(
  LayerNode.compile(Ripgrep.node, [
    [
      RipgrepBinary.node,
      Layer.succeed(
        RipgrepBinary.Service,
        RipgrepBinary.Service.of({
          filepath: Effect.sync(() => {
            const node = Bun.which("node")
            if (!node) throw new Error("node executable not found")
            return node
          }),
        }),
      ),
    ],
  ]),
)

describe("Ripgrep", () => {
  failedScan.live("falls back when a file scan process fails", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "fallback.ts"), "included\n"))
          yield* Effect.promise(() => fs.mkdir(path.join(tmp.path, ".opencode")))
          yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, ".opencode", "config"), "included\n"))
          yield* Effect.promise(() => fs.mkdir(path.join(tmp.path, "src", "vendor"), { recursive: true }))
          yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "src", "vendor", "skip.txt"), "excluded\n"))
          const ripgrep = yield* Ripgrep.Service
          const files = yield* ripgrep.glob({ cwd: tmp.path, pattern: "*.ts", limit: 10 })
          expect(files.map((item) => item.path)).toEqual([RelativePath.make("fallback.ts")])

          const observed: string[] = []
          const found = yield* ripgrep.find({
            cwd: tmp.path,
            pattern: "!**/vendor",
            limit: 10,
            onEntry: (entry) => Effect.sync(() => observed.push(entry.path)),
          })
          expect(found.map((item) => item.path)).toEqual([RelativePath.make("fallback.ts")])
          expect(observed).toEqual(found.map((item) => item.path))

          const hidden = yield* ripgrep.find({ cwd: tmp.path, pattern: "**/*", limit: 10 })
          expect(hidden.map((item) => item.path)).toContain(RelativePath.make(".opencode/config"))

          expect(Exit.isFailure(yield* ripgrep.grep({ cwd: tmp.path, pattern: "included", limit: 10 }).pipe(Effect.exit))).toBe(
            true,
          )
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  failedScan.live("preserves Git ignore and existing-file semantics in the fallback", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(() => Bun.$`git init -q ${tmp.path}`)
          yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, ".gitignore"), "ignored.txt\n"))
          yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "kept.txt"), "included\n"))
          yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "ignored.txt"), "excluded\n"))
          yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "deleted.txt"), "deleted\n"))
          yield* Effect.promise(() => Bun.$`git -C ${tmp.path} add .gitignore kept.txt deleted.txt`)
          yield* Effect.promise(() => Bun.$`git -C ${tmp.path} add -f ignored.txt`)
          yield* Effect.promise(() => fs.rm(path.join(tmp.path, "deleted.txt")))

          const files = yield* (yield* Ripgrep.Service).find({ cwd: tmp.path, pattern: "*", limit: 10 })
          expect(files.map((item) => item.path)).toEqual([RelativePath.make("kept.txt")])
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("keeps ignored files out of catch-all find results", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(() => fs.mkdir(path.join(tmp.path, "node_modules", "pkg"), { recursive: true }))
          yield* Effect.promise(() => fs.mkdir(path.join(tmp.path, "src")))
          yield* Effect.promise(() => Bun.$`git init -q ${tmp.path}`)
          yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, ".gitignore"), "node_modules/\n"))
          yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "node_modules", "pkg", "index.js"), "ignored\n"))
          yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "src", "index.js"), "included\n"))

          const files = yield* (yield* Ripgrep.Service).find({ cwd: tmp.path, pattern: "*", limit: 10 })
          expect(files.map((item) => item.path)).toContain(RelativePath.make("src/index.js"))
          expect(files.map((item) => item.path)).not.toContain(RelativePath.make("node_modules/pkg/index.js"))
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("never includes git metadata", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(() => fs.mkdir(path.join(tmp.path, ".opencode")))
          yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, ".opencode", "config"), "needle\n"))
          yield* Effect.promise(() => fs.mkdir(path.join(tmp.path, ".git")))
          yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, ".git", "config"), "needle\n"))
          const ripgrep = yield* Ripgrep.Service

          const files = yield* ripgrep.find({ cwd: tmp.path, pattern: "**/*", limit: 10 })
          expect(files.map((item) => item.path)).toContain(RelativePath.make(".opencode/config"))
          expect(files.map((item) => item.path)).not.toContain(RelativePath.make(".git/config"))

          const observed: string[] = []
          const limited = yield* ripgrep.find({
            cwd: tmp.path,
            pattern: "**/*",
            limit: 1,
            onEntry: (entry) => Effect.sync(() => observed.push(entry.path)),
          })
          expect(observed).toEqual(limited.map((item) => item.path))

          const matches = yield* ripgrep.grep({ cwd: tmp.path, pattern: "needle", include: "config", limit: 10 })
          expect(matches.map((item) => item.entry.path)).toContain(RelativePath.make(".opencode/config"))
          expect(matches.map((item) => item.entry.path)).not.toContain(RelativePath.make(".git/config"))
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )
})
