import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { PartID } from "./schema"
import type { MessageID, SessionID } from "./schema"

export type GeneratedImageOutput = {
  title: string
  metadata: Record<string, any>
  output: string
  attachments?: SessionV1.FilePart[]
}

type ImageGenerationToolOutput = {
  title: string
  metadata: Record<string, any>
  output: unknown
  attachments?: SessionV1.FilePart[]
}

type NormalizeImageGenerationOutputInput = {
  tool: string
  sessionID: SessionID
  messageID: MessageID
  output: ImageGenerationToolOutput | unknown
}

type ImageData = {
  mime: string
  base64: string
}

const dataUrlPattern = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i
const base64Pattern = /^[a-z0-9+/]+={0,2}$/i
const orderedKeys = ["result", "b64_json", "b64Json", "base64", "data", "images", "results"]
const persistableImageMimes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])

export function normalizeImageGenerationOutput(input: NormalizeImageGenerationOutputInput): GeneratedImageOutput {
  if (input.tool !== "image_generation") return input.output as GeneratedImageOutput

  const output = toToolOutput(input.output)
  const images = extractImages(output.output)
  const persistableImages = images.filter((image) => persistableImageMimes.has(image.mime))
  if (persistableImages.length === 0) return outputForStorage(output)
  const existingImageCount = countImageAttachments(output.attachments)

  const generatedAttachments = persistableImages.map((image, index) => {
    const filename = generatedImageFilename(input.messageID, existingImageCount + index + 1, image.mime)
    return {
      id: PartID.ascending(),
      sessionID: input.sessionID,
      messageID: input.messageID,
      type: "file" as const,
      mime: image.mime,
      filename,
      url: `data:${image.mime};base64,${image.base64}`,
    }
  })

  return {
    output: formatOutput(persistableImages),
    title: output.title,
    metadata: output.metadata,
    attachments: [...(output.attachments ?? []), ...generatedAttachments],
  }
}

export function generatedImageFilename(messageID: MessageID, index: number, mime: string) {
  return `generated-image-${messageID}-${index}.${extension(mime)}`
}

export function generatedImageRelativePath(filename: string) {
  return `.opencode/generated-images/${filename}`
}

export function generatedImageBytes(url: string) {
  const image = parseDataUrl(url)
  if (!image) return
  return Buffer.from(image.base64, "base64")
}

function outputForStorage(output: ImageGenerationToolOutput): GeneratedImageOutput {
  return {
    title: output.title,
    metadata: output.metadata,
    output: typeof output.output === "string" ? output.output : JSON.stringify(output.output),
    attachments: output.attachments,
  }
}

function toToolOutput(output: GeneratedImageOutput | unknown): ImageGenerationToolOutput {
  if (isToolOutput(output)) return output

  return {
    title: "image_generation",
    metadata: {},
    output,
  }
}

function isToolOutput(output: GeneratedImageOutput | unknown): output is GeneratedImageOutput {
  if (!output || typeof output !== "object") return false
  const record = output as Record<string, unknown>
  return (
    typeof record.title === "string" &&
    typeof record.metadata === "object" &&
    record.metadata !== null &&
    "output" in record
  )
}

function countImageAttachments(attachments: SessionV1.FilePart[] | undefined) {
  return (attachments ?? []).filter((attachment) => {
    return (
      typeof attachment.mime === "string" &&
      attachment.mime.startsWith("image/") &&
      typeof attachment.url === "string" &&
      attachment.url.length > 0
    )
  }).length
}

function extractImages(output: unknown) {
  if (typeof output !== "string") return collectImages(output)

  const direct = toImageData(output)
  if (direct) return [direct]

  const parsed = parseJson(output)
  if (parsed === undefined) return []

  return collectImages(parsed)
}

function parseJson(output: string) {
  try {
    return JSON.parse(output) as unknown
  } catch {
    return undefined
  }
}

function collectImages(value: unknown): ImageData[] {
  if (typeof value === "string") {
    const image = toImageData(value)
    return image ? [image] : []
  }

  if (Array.isArray(value)) {
    return value.flatMap(collectImages)
  }

  if (!value || typeof value !== "object") {
    return []
  }

  const record = value as Record<string, unknown>
  const prioritized = orderedKeys.flatMap((key) => collectImages(record[key]))
  if (prioritized.length > 0) return prioritized
  return Object.values(record).flatMap(collectImages)
}

function toImageData(value: string) {
  const trimmed = value.trim()
  const dataUrl = parseDataUrl(trimmed)
  if (dataUrl) return dataUrl

  const base64 = sanitizeBase64(trimmed)
  if (!isBase64(base64)) return undefined

  const mime = detectImageMime(base64)
  if (!mime) return undefined

  return { mime, base64 }
}

function parseDataUrl(value: string) {
  const match = dataUrlPattern.exec(value)
  if (!match) return undefined

  const mime = match[1].toLowerCase()
  const base64 = sanitizeBase64(match[2])
  if (!isBase64(base64)) return undefined

  return { mime, base64 }
}

function sanitizeBase64(value: string) {
  return value.replace(/\s+/g, "")
}

function isBase64(value: string) {
  return value.length >= 16 && value.length % 4 === 0 && base64Pattern.test(value)
}

function detectImageMime(base64: string) {
  const bytes = Buffer.from(base64, "base64")

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png"
  }

  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg"
  }

  if (bytes.length >= 6) {
    const header = bytes.subarray(0, 6).toString("ascii")
    if (header === "GIF87a" || header === "GIF89a") {
      return "image/gif"
    }
  }

  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp"
  }

  return undefined
}

function extension(mime: string) {
  if (mime === "image/jpeg") return "jpg"
  return mime.slice("image/".length).split("+")[0] || "png"
}

function formatOutput(images: ImageData[]) {
  return `已生成 ${images.length} 张图片：`
}

export * as SessionGeneratedImage from "./generated-image"
