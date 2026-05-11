import fs from "node:fs/promises"
import path from "node:path"
import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { Effect } from "effect"
import z from "zod"
import { Instance } from "@/project/instance"
import { classifyAttachment } from "@/util/media"
import { runRequest } from "./trace"

const generatedImagesPrefix = ".opencode/generated-images/"

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
      runRequest(
        "GeneratedImageRoutes.read",
        c,
        Effect.promise(async () => {
          const relativePath = path.posix.normalize(c.req.valid("query").path.replaceAll("\\", "/"))
          if (!relativePath.startsWith(generatedImagesPrefix)) {
            return c.json({ error: "Forbidden" }, 403)
          }

          const filePath = path.resolve(Instance.worktree, relativePath)
          const generatedImagesDir = path.resolve(Instance.worktree, ".opencode", "generated-images")
          const relativeToGeneratedImages = path.relative(generatedImagesDir, filePath)
          if (relativeToGeneratedImages.startsWith("..") || path.isAbsolute(relativeToGeneratedImages)) {
            return c.json({ error: "Forbidden" }, 403)
          }

          let realWorktree: string
          let realGeneratedImagesDir: string
          let realFilePath: string
          try {
            ;[realWorktree, realGeneratedImagesDir, realFilePath] = await Promise.all([
              fs.realpath(Instance.worktree),
              fs.realpath(generatedImagesDir),
              fs.realpath(filePath),
            ])
          } catch (error) {
            if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
              return c.json({ error: "Not Found" }, 404)
            }
            throw error
          }
          const relativeToRealWorktree = path.relative(realWorktree, realGeneratedImagesDir)
          if (relativeToRealWorktree.startsWith("..") || path.isAbsolute(relativeToRealWorktree)) {
            return c.json({ error: "Forbidden" }, 403)
          }

          const relativeToRealGeneratedImages = path.relative(realGeneratedImagesDir, realFilePath)
          if (relativeToRealGeneratedImages.startsWith("..") || path.isAbsolute(relativeToRealGeneratedImages)) {
            return c.json({ error: "Forbidden" }, 403)
          }

          const file = Bun.file(realFilePath)
          const bytes = await file.bytes()
          const classified = classifyAttachment(filePath, bytes, "application/octet-stream")
          if (classified.kind !== "image") {
            return c.json({ error: "Forbidden" }, 403)
          }

          c.header("Content-Type", classified.mime)
          return c.body(bytes)
        }),
      ),
  )
