import path from "path"
import { FSUtil } from "@opencode-ai/core/fs-util"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { Effect } from "effect"
import { generatedImageBytes, generatedImageRelativePath } from "./generated-image"

function isSafeGeneratedImageFilename(filename: string) {
  return (
    filename.length > 0 &&
    filename === path.posix.basename(filename) &&
    filename === path.win32.basename(filename) &&
    filename !== "." &&
    filename !== ".."
  )
}

function isGeneratedImageAttachment(
  part: SessionV1.FilePart,
): part is SessionV1.FilePart & { filename: string; relativePath?: undefined } {
  return (
    part.mime.startsWith("image/") &&
    typeof part.filename === "string" &&
    part.filename.startsWith("generated-image-") &&
    typeof part.relativePath !== "string"
  )
}

export const persistGeneratedImageAttachments = Effect.fn(
  "SessionGeneratedImagePersistence.persistGeneratedImageAttachments",
)(function* (fs: FSUtil.Interface, root: string, attachments: SessionV1.FilePart[] | undefined) {
  if (!attachments || attachments.length === 0) return attachments

  return yield* Effect.forEach(attachments, (attachment) =>
    Effect.gen(function* () {
      if (!isGeneratedImageAttachment(attachment)) return attachment
      if (!isSafeGeneratedImageFilename(attachment.filename)) {
        throw new Error(`Unsafe generated image filename: ${attachment.filename}`)
      }
      const bytes = generatedImageBytes(attachment.url)
      if (!bytes) return attachment
      const relativePath = generatedImageRelativePath(attachment.filename)
      yield* fs.writeWithDirs(path.join(root, ".opencode", "generated-images", attachment.filename), bytes)
      return {
        ...attachment,
        relativePath,
        url: `/generated-image?path=${encodeURIComponent(relativePath)}`,
      }
    }),
  )
})

export * as SessionGeneratedImagePersistence from "./generated-image-persistence"
