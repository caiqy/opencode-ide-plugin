import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Hash } from "@opencode-ai/core/util/hash"
import { Schema } from "effect"

import { zod } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"

const projectIdSchema = Schema.String.pipe(Schema.brand("ProjectID"))
const NON_GIT_PREFIX = "local_"

export type ProjectID = typeof projectIdSchema.Type

function normalizeNonGitDirectory(directory: string) {
  const resolved = AppFileSystem.resolve(directory)
  const normalized = process.platform === "win32" ? AppFileSystem.normalizePath(resolved).toLowerCase() : resolved
  const root = AppFileSystem.resolve(process.platform === "win32" ? normalized.slice(0, 3) : "/")
  if (normalized === root) return normalized
  return normalized.replace(/[\\/]+$/, "")
}

export const ProjectID = projectIdSchema.pipe(
  withStatics((schema: typeof projectIdSchema) => ({
    global: schema.make("global"),
    nonGit(directory: string) {
      return schema.make(`${NON_GIT_PREFIX}${Hash.fast(normalizeNonGitDirectory(directory))}`)
    },
    isNonGit(value: ProjectID) {
      return value.startsWith(NON_GIT_PREFIX)
    },
    zod: zod(schema),
  })),
)
