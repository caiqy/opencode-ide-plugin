import fs from "node:fs/promises"
import path from "node:path"
import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { Effect } from "effect"
import { HttpServerResponse } from "effect/unstable/http"
import z from "zod"
import { Instance } from "@/project/instance"
import { classifyAttachment } from "@/util/media"
import { runRequest } from "./trace"

const generatedImagesPrefix = ".opencode/generated-images/"

export async function readGeneratedImage(pathname: string) {
  const relativePath = path.posix.normalize(pathname.replaceAll("\\", "/"))
  if (!relativePath.startsWith(generatedImagesPrefix)) {
    return HttpServerResponse.jsonUnsafe({ error: "Forbidden" }, { status: 403 })
  }

  const root = Instance.worktree === "/" ? Instance.directory : Instance.worktree
  const filePath = path.resolve(root, relativePath)
  const generatedImagesDir = path.resolve(root, ".opencode", "generated-images")
  const relativeToGeneratedImages = path.relative(generatedImagesDir, filePath)
  if (relativeToGeneratedImages.startsWith("..") || path.isAbsolute(relativeToGeneratedImages)) {
    return HttpServerResponse.jsonUnsafe({ error: "Forbidden" }, { status: 403 })
  }

  let realWorktree: string
  let realGeneratedImagesDir: string
  let realFilePath: string
  try {
    ;[realWorktree, realGeneratedImagesDir, realFilePath] = await Promise.all([
      fs.realpath(root),
      fs.realpath(generatedImagesDir),
      fs.realpath(filePath),
    ])
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return HttpServerResponse.jsonUnsafe({ error: "Not Found" }, { status: 404 })
    }
    throw error
  }
  const relativeToRealWorktree = path.relative(realWorktree, realGeneratedImagesDir)
  if (relativeToRealWorktree.startsWith("..") || path.isAbsolute(relativeToRealWorktree)) {
    return HttpServerResponse.jsonUnsafe({ error: "Forbidden" }, { status: 403 })
  }

  const relativeToRealGeneratedImages = path.relative(realGeneratedImagesDir, realFilePath)
  if (relativeToRealGeneratedImages.startsWith("..") || path.isAbsolute(relativeToRealGeneratedImages)) {
    return HttpServerResponse.jsonUnsafe({ error: "Forbidden" }, { status: 403 })
  }

  const file = Bun.file(realFilePath)
  const bytes = await file.bytes()
  const classified = classifyAttachment(filePath, bytes, "application/octet-stream")
  if (classified.kind !== "image") {
    return HttpServerResponse.jsonUnsafe({ error: "Forbidden" }, { status: 403 })
  }

  return HttpServerResponse.raw(bytes, {
    status: 200,
    headers: { "content-type": classified.mime },
  })
}

export const GeneratedImageRoutes = () =>
  new Hono().get(
    "/generated-image",
    describeRoute({
      summary: "Read generated image",
      description: "Read a generated image file from the current project.",
      operationId: "generatedImage.read",
      responses: {
        200: {
          description: "Generated image",
          content: {
            "image/*": {
              schema: resolver(z.any()),
            },
          },
        },
      },
    }),
    validator(
      "query",
      z.object({
        path: z.string(),
      }),
    ),
    async (c) =>
      HttpServerResponse.toWeb(
        await runRequest(
          "GeneratedImageRoutes.read",
          c,
          Effect.promise(() => readGeneratedImage(c.req.valid("query").path)),
        ),
      ),
  )
