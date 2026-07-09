import { randomBytes } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { generatedImageRelativePath } from "../../session/generated-image"
import { buildFilename } from "./filename"
import type { DecodedImage } from "./types"

const MAX_ATTEMPTS = 999
const GENERATED_IMAGES_PLACEHOLDER = "placeholder"
const TEMP_SUFFIX_LENGTH = 6
const LINK_UNSUPPORTED_ERRORS = new Set(["ENOTSUP", "EOPNOTSUPP", "EPERM", "ENOSYS", "UNKNOWN"])

type PersistImagesInput = {
  root: string
  messageID: string
  filename?: string
  random?: () => string
  images: Array<Pick<DecodedImage, "mime" | "bytes">>
}

export async function persistImages(
  input: PersistImagesInput,
): Promise<Array<Omit<SessionV1.FilePart, "id" | "sessionID" | "messageID">>> {
  const root = ensureAbsoluteRealPath(await fs.realpath(input.root))
  const dir = generatedImagesDirectory(root)
  await assertCreatableDirectoryInsideProject(root, dir)
  await fs.mkdir(dir, { recursive: true })
  await assertDirectoryInsideProject(root, dir)

  return Promise.all(
    input.images.map((image, offset) =>
      persistImage({
        root,
        messageID: input.messageID,
        filename: input.filename,
        random: input.random?.() ?? randomBytes(4).toString("hex"),
        count: input.images.length,
        index: offset + 1,
        image,
      }),
    ),
  )
}

async function persistImage(input: {
  root: string
  messageID: string
  filename?: string
  random: string
  count: number
  index: number
  image: Pick<DecodedImage, "mime" | "bytes">
}) {
  const baseFilename = buildFilename({
    messageID: input.messageID,
    index: input.index,
    count: input.count,
    mime: input.image.mime,
    random: input.random,
    filename: input.filename,
  })

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const filename = attemptFilename(baseFilename, attempt)
    const relativePath = generatedImageRelativePath(filename)
    const absolutePath = generatedImageAbsolutePath(input.root, filename)
    const tempPath = temporaryImageAbsolutePath(input.root, filename)
    let handle: fs.FileHandle | undefined

    try {
      await assertPathParentInsideProject(input.root, absolutePath)
      await assertPathParentInsideProject(input.root, tempPath)

      handle = await fs.open(tempPath, "wx")

      await handle.writeFile(input.image.bytes)

      await handle.close()
      handle = undefined

      // Prefer hard-link publish so the final path only appears after bytes are fully written.
      const published = await publishTempFile(tempPath, absolutePath)
      if (!published) {
        await cleanupCriticalFile(tempPath, "temp cleanup after publish collision")
        continue
      }

      await cleanupCriticalFile(tempPath, "temp cleanup after publish")

      return {
        type: "file" as const,
        mime: input.image.mime,
        filename,
        relativePath,
        url: `/generated-image?path=${encodeURIComponent(relativePath)}`,
      }
    } catch (error) {
      const openHandle = handle
      handle = undefined
      await rethrowWithTempCleanup({
        action: "temp cleanup after persist failure",
        error,
        handle: openHandle,
        tempPath,
      })
    }
  }

  throw new Error(`Unable to persist generated image after ${MAX_ATTEMPTS} attempts`)
}

function generatedImagesDirectory(root: string) {
  const segments = generatedImageRelativePath(GENERATED_IMAGES_PLACEHOLDER).split("/")
  return path.join(root, ...segments.slice(0, -1))
}

function generatedImageAbsolutePath(root: string, filename: string) {
  return path.join(root, ...generatedImageRelativePath(filename).split("/"))
}

function temporaryImageAbsolutePath(root: string, filename: string) {
  const parsed = path.parse(generatedImageAbsolutePath(root, filename))
  return path.join(parsed.dir, `.${parsed.name}.tmp-${randomBytes(TEMP_SUFFIX_LENGTH).toString("hex")}${parsed.ext}`)
}

function attemptFilename(filename: string, attempt: number) {
  if (attempt === 1) return filename
  const parsed = path.parse(filename)
  return `${parsed.name}-${attempt}${parsed.ext}`
}

async function cleanupCriticalFile(filePath: string, action: string) {
  try {
    await fs.rm(filePath, { force: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return
    }

    throw new Error(`${action} failed for ${filePath}: ${formatError(error)}`)
  }
}

async function publishTempFile(tempPath: string, finalPath: string) {
  try {
    await fs.link(tempPath, finalPath)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "EEXIST") {
      return false
    }

    if (!isUnsupportedHardLinkError(error)) {
      throw error
    }
  }

  return publishWithLock(tempPath, finalPath)
}

async function publishWithLock(tempPath: string, finalPath: string) {
  const lockPath = `${finalPath}.lock`
  let lockHandle: fs.FileHandle | undefined
  let ownsLock = false
  let closeError: unknown

  try {
    try {
      lockHandle = await fs.open(lockPath, "wx")
      ownsLock = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        return false
      }

      throw error
    }

    if (await pathExists(finalPath)) {
      return false
    }

    // Filesystems without hard-link support still need an atomic publish after full temp write.
    await fs.rename(tempPath, finalPath)
    return true
  } finally {
    if (ownsLock) {
      if (lockHandle) {
        try {
          await lockHandle.close()
        } catch (error) {
          closeError = error
        }
      }

      let cleanupError: unknown
      try {
        await cleanupCriticalFile(lockPath, "lock cleanup after fallback publish")
      } catch (error) {
        cleanupError = error
      }

      if (closeError || cleanupError) {
        throw new Error(
          `fallback lock cleanup failed for ${lockPath}: ${[
            closeError ? `close=${formatError(closeError)}` : undefined,
            cleanupError ? `cleanup=${formatError(cleanupError)}` : undefined,
          ]
            .filter(Boolean)
            .join("; ")}`,
        )
      }
    }
  }
}

function isUnsupportedHardLinkError(error: unknown) {
  return LINK_UNSUPPORTED_ERRORS.has((error as NodeJS.ErrnoException).code ?? "")
}

async function pathExists(filePath: string) {
  try {
    await fs.lstat(filePath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false
    }

    throw error
  }
}

async function assertDirectoryInsideProject(root: string, directory: string) {
  const [realRoot, realDirectory] = await Promise.all([fs.realpath(root), fs.realpath(directory)])
  if (isOutside(realRoot, realDirectory)) {
    throw new Error("generated image directory is outside project")
  }
}

async function assertCreatableDirectoryInsideProject(root: string, directory: string) {
  const realRoot = await fs.realpath(root)
  let current = directory
  while (true) {
    try {
      await fs.lstat(current)
      const realCurrent = await fs.realpath(current)
      if (isOutside(realRoot, realCurrent)) {
        throw new Error("generated image directory is outside project")
      }
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error
      }
      if (await isLink(current)) {
        throw new Error("generated image directory is outside project")
      }
      const parent = path.dirname(current)
      if (parent === current) {
        throw error
      }
      current = parent
    }
  }
}

async function isLink(filePath: string) {
  try {
    await fs.readlink(filePath)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ENOENT" || code === "EINVAL") {
      return false
    }
    throw error
  }
}

async function assertPathParentInsideProject(root: string, filePath: string) {
  const [realRoot, realParent] = await Promise.all([fs.realpath(root), fs.realpath(path.dirname(filePath))])
  if (isOutside(realRoot, realParent)) {
    throw new Error("generated image directory is outside project")
  }
}

function isOutside(root: string, child: string) {
  const relative = path.relative(normalizeRealPath(root), normalizeRealPath(child))
  return relative.startsWith("..") || path.isAbsolute(relative)
}

function ensureAbsoluteRealPath(filePath: string) {
  const stripped = filePath.replace(/^\\\\\?\\/, "")
  return /^[A-Za-z]:(?:\.?)?$/.test(stripped) ? `${stripped[0]}:\\` : path.resolve(path.normalize(stripped))
}

function normalizeRealPath(filePath: string) {
  const normalized = ensureAbsoluteRealPath(filePath)
  return process.platform === "win32" ? normalized.toLowerCase() : normalized
}

function formatError(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

async function rethrowWithTempCleanup(input: {
  action: string
  error: unknown
  handle?: fs.FileHandle
  tempPath: string
}): Promise<never> {
  const closeError = input.handle ? await tryCloseFileHandle(input.handle) : undefined
  const cleanupError = await tryCleanupCriticalFile(input.tempPath, input.action)

  if (closeError || cleanupError) {
    throw new Error(
      `${input.action} failed for ${input.tempPath}: ${[
        `error=${formatError(input.error)}`,
        closeError ? `close=${formatError(closeError)}` : undefined,
        cleanupError ? `cleanup=${formatError(cleanupError)}` : undefined,
      ]
        .filter(Boolean)
        .join("; ")}`,
    )
  }

  throw toError(input.error)
}

async function tryCloseFileHandle(handle: fs.FileHandle) {
  try {
    await handle.close()
    return undefined
  } catch (error) {
    return error
  }
}

async function tryCleanupCriticalFile(filePath: string, action: string) {
  try {
    await cleanupCriticalFile(filePath, action)
    return undefined
  } catch (error) {
    return error
  }
}

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error))
}
