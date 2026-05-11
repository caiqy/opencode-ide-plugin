import path from "node:path"

const devicePattern = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i
const MAX_FILENAME_LENGTH = 240

type BuildFilenameInput = {
  messageID: string
  index: number
  mime: string
  random: string
  count?: number
  filename?: string
}

export function extension(mime: string) {
  if (mime === "image/jpeg") return "jpg"
  return mime.slice("image/".length).split("+")[0] || "png"
}

export function sanitizeFilename(input: string) {
  const sanitized = input
    .replace(/[\\/]/g, "")
    .replace(/[<>:\"|?*]/g, "")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim()
    .replace(/^\.+|\.+$/g, "")
    .trim()

  if (!sanitized || devicePattern.test(sanitized)) return undefined
  return sanitized
}

export function buildFilename(input: BuildFilenameInput) {
  const suffix = `-${input.messageID}${input.count && input.count > 1 ? `-${input.index}` : ""}-${input.random}.${extension(input.mime)}`
  const sanitized = input.filename ? sanitizeFilename(input.filename) : undefined
  if (!sanitized) {
    return `generated-image-${input.messageID}-${input.index}-${input.random}.${extension(input.mime)}`
  }

  const stem = path.parse(sanitized).name || sanitized
  const maxStemLength = Math.max(1, MAX_FILENAME_LENGTH - suffix.length)
  return `${stem.slice(0, maxStemLength)}${suffix}`
}
