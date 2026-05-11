export type ImageAction = "generate" | "edit"

export type ImageFormat = "png" | "jpeg" | "webp"

export type ImageQuality = "low" | "medium" | "high" | "auto"

export type DecodedImage = {
  mime: "image/png" | "image/jpeg" | "image/webp"
  bytes: Uint8Array
  filename: string
}

export const MAX_PROMPT_LENGTH = 4000

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
