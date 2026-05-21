import path from "path"
import { Effect } from "effect"
import * as EffectLogger from "@opencode-ai/core/effect/logger"
import { InstanceState } from "@/effect/instance-state"
import type * as Tool from "./tool"
import { containsPath } from "../project/instance-context"
import { AppFileSystem } from "@opencode-ai/core/filesystem"

type Kind = "file" | "directory"

type Options = {
  bypass?: boolean
  kind?: Kind
}

export const assertExternalDirectoryEffect = Effect.fn("Tool.assertExternalDirectory")(function* (
  ctx: Tool.Context,
  target?: string,
  options?: Options,
) {
  if (!target) return

  if (options?.bypass) return

  const ins = yield* InstanceState.context
  const full = process.platform === "win32" ? normalizeWindowsTarget(target, ins) : target
  if (containsPath(full, ins)) return

  const kind = options?.kind ?? "file"
  const dir = kind === "directory" ? full : path.dirname(full)
  const glob =
    process.platform === "win32"
      ? AppFileSystem.normalizePathPattern(path.join(dir, "*"))
      : path.join(dir, "*").replaceAll("\\", "/")

  yield* ctx.ask({
    permission: "external_directory",
    patterns: [glob],
    always: [glob],
    metadata: {
      filepath: full,
      parentDir: dir,
    },
  })
})

export async function assertExternalDirectory(ctx: Tool.Context, target?: string, options?: Options) {
  return Effect.runPromise(assertExternalDirectoryEffect(ctx, target, options).pipe(Effect.provide(EffectLogger.layer)))
}

function normalizeWindowsTarget(target: string, ins: { directory: string; worktree: string }) {
  const root = path.parse(ins.worktree || ins.directory).root
  const drive = root.match(/^[A-Za-z]:/)?.[0]
  const fixed = drive && /^[\/](?![\/])/.test(target) ? `${drive}${target}` : target
  return AppFileSystem.normalizePath(fixed)
}
