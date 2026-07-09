import { Effect } from "effect"
import type { ImageFieldStyle } from "./config"
import { detectMime } from "./input"
import type { DecodedImage, ImageAction, ImageFormat, ImageQuality } from "./types"

type CallOpenAICompatibleInput = {
  baseURL: string
  apiKey: string
  action: ImageAction
  model: string
  prompt: string
  size: string
  quality: ImageQuality
  format: ImageFormat
  n: number
  images?: DecodedImage[]
  mask?: DecodedImage
  imageFieldStyle?: ImageFieldStyle
}

const base64Pattern = /^[A-Za-z0-9+/]+={0,2}$/
const dataUrlPattern = /^data:(image\/[A-Za-z0-9.+-]+);base64,(.*)$/is

export const callOpenAICompatible = Effect.fn("GenerateImage.openaiCompatible")(function* (
  input: CallOpenAICompatibleInput,
) {
  validateSize(input.size, input.model)

  if (input.action === "generate") {
    const payload = yield* Effect.tryPromise({
      try: async () => {
        const response = await fetch(`${input.baseURL}/images/generations`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${input.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: input.model,
            prompt: input.prompt,
            size: input.size,
            quality: input.quality,
            output_format: input.format,
            n: input.n,
          }),
        })

        if (!response.ok) {
          throw providerError(response.status, await response.text(), input.apiKey)
        }

        return response.json()
      },
      catch: (cause) => toRequestError(cause, "image generation request failed"),
    })

    return parseImages(payload)
  }

  const form = new FormData()
  form.set("model", input.model)
  form.set("prompt", input.prompt)
  form.set("size", input.size)
  form.set("quality", input.quality)
  form.set("output_format", input.format)
  form.set("n", String(input.n))

  const imageField = (input.imageFieldStyle ?? "brackets") === "brackets" ? "image[]" : "image"
  for (const image of input.images ?? []) {
    form.append(imageField, new Blob([Buffer.from(image.bytes)], { type: image.mime }), image.filename)
  }

  if (input.mask) {
    form.set("mask", new Blob([Buffer.from(input.mask.bytes)], { type: input.mask.mime }), input.mask.filename)
  }

  const payload = yield* Effect.tryPromise({
    try: async () => {
      const response = await fetch(`${input.baseURL}/images/edits`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.apiKey}`,
        },
        body: form,
      })

      if (!response.ok) {
        throw providerError(response.status, await response.text(), input.apiKey)
      }

      return response.json()
    },
    catch: (cause) => toRequestError(cause, "image edit request failed"),
  })

  return parseImages(payload)
})

function validateSize(size: string, model: string) {
  if (!model.startsWith("gpt-image-")) {
    return
  }

  if (size === "auto") {
    return
  }

  const match = /^(\d+)x(\d+)$/.exec(size)
  if (!match) {
    throw new Error("size must be auto or WIDTHxHEIGHT")
  }

  const width = Number(match[1])
  const height = Number(match[2])

  if (width < 1 || height < 1) {
    throw new Error("size width and height must be greater than 0")
  }

  if (width % 16 !== 0 || height % 16 !== 0) {
    throw new Error("size width and height must be multiples of 16")
  }

  if (Math.max(width, height) > 3840) {
    throw new Error("size longest edge must be <= 3840")
  }

  if (Math.max(width, height) / Math.min(width, height) > 3) {
    throw new Error("size aspect ratio must be <= 3:1")
  }

  const totalPixels = width * height

  if (totalPixels < 655360) {
    throw new Error("size total pixels must be >= 655360 for gpt-image models")
  }

  if (totalPixels > 8294400) {
    throw new Error("size total pixels must be <= 8294400 for gpt-image models")
  }
}

function parseImages(value: unknown): DecodedImage[] {
  const items = (value as { data?: unknown })?.data
  if (!Array.isArray(items)) {
    throw new Error("No image data returned from image provider")
  }

  return items.map((item) => parseImage(item))
}

function parseImage(value: unknown): DecodedImage {
  const item = value as Record<string, unknown>
  const raw = item.b64_json ?? item.b64Json ?? item.data ?? item.url
  if (typeof raw !== "string") {
    throw new Error("No image data returned from image provider")
  }

  if (/^https?:\/\//i.test(raw)) {
    throw new Error("remote image URLs are not supported")
  }

  const match = dataUrlPattern.exec(raw)
  const base64 = (match ? match[2] : raw).replace(/\s+/g, "")
  if (!isBase64(base64)) {
    throw new Error("provider image base64 decode failed")
  }

  const bytes = new Uint8Array(Buffer.from(base64, "base64"))
  const mime = detectMime(bytes)
  if (!mime) {
    throw new Error("unable to detect image mime")
  }

  return {
    mime,
    bytes,
    filename: defaultFilename(mime),
  }
}

function isBase64(value: string) {
  if (value.length < 4 || value.length % 4 !== 0 || !base64Pattern.test(value)) {
    return false
  }

  const padding = value.match(/=*$/)?.[0].length ?? 0
  if (padding > 2) {
    return false
  }

  return !value.slice(0, value.length - padding).includes("=")
}

function defaultFilename(mime: DecodedImage["mime"]) {
  if (mime === "image/jpeg") return "image.jpg"
  if (mime === "image/webp") return "image.webp"
  return "image.png"
}

function providerError(status: number, body: string, apiKey: string) {
  const summary = summarizeProviderBody(body, apiKey)
  return new Error(`image provider returned HTTP ${status}${summary ? `: ${summary}` : ""}`)
}

function summarizeProviderBody(body: string, apiKey: string) {
  const parsed = parseJsonObject(body)
  const errorMessage = stringValue(parsed?.error, "message")
  const message = stringValue(parsed, "message")
  const summary = redactSecrets((errorMessage ?? message ?? body.trim()).replace(/\s+/g, " "), apiKey)
  if (!summary) {
    return ""
  }

  return summary.length > 500 ? `${summary.slice(0, 500)}...` : summary
}

function redactSecrets(summary: string, apiKey: string) {
  const escaped = escapeRegex(apiKey)
  return summary
    .replace(new RegExp(`Authorization:\\s*Bearer\\s+${escaped}`, "gi"), "Authorization: Bearer [redacted]")
    .replace(new RegExp(`Bearer\\s+${escaped}`, "gi"), "Bearer [redacted]")
    .replace(new RegExp(escaped, "g"), "[redacted]")
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function parseJsonObject(body: string) {
  try {
    const parsed = JSON.parse(body) as unknown
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

function stringValue(record: Record<string, unknown> | unknown, key: string) {
  if (!record || typeof record !== "object") {
    return undefined
  }

  const value = (record as Record<string, unknown>)[key]
  return typeof value === "string" ? value : undefined
}

function toRequestError(cause: unknown, fallback: string) {
  if (cause instanceof Error) {
    return new Error(cause.message)
  }

  return new Error(fallback)
}
