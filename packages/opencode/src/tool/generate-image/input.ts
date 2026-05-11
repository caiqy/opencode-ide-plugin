import fs from "node:fs/promises"
import path from "node:path"
import { MAX_IMAGE_BYTES, MAX_PROMPT_LENGTH } from "./types"
import type { DecodedImage } from "./types"

const dataUrlPattern = /^data:([^;,]+);base64,(.*)$/is
const base64Pattern = /^[A-Za-z0-9+/=]+$/

export function validatePrompt(prompt: string) {
  if (prompt.length < 1 || prompt.length > MAX_PROMPT_LENGTH) {
    throw new Error(`prompt must be between 1 and ${MAX_PROMPT_LENGTH} characters`)
  }

  return prompt
}

export function validateMask(images: DecodedImage[], mask?: DecodedImage) {
  if (!mask) return
  if (images.some((image) => image.mime !== mask.mime)) {
    throw new Error("mask mime must match all edit images")
  }
}

export async function decodeImageInput(input: { root: string; input: string }): Promise<DecodedImage> {
  const value = input.input
  if (value.trim().length === 0) {
    throw new Error("image input cannot be empty")
  }

  if (/^https?:\/\//i.test(value)) {
    throw new Error("remote image URL inputs are not supported")
  }

  if (value.startsWith("data:")) {
    return decodeDataUrl(value)
  }

  const root = await fs.realpath(input.root)
  const filePath = path.resolve(root, value)

  if (await pathExists(filePath)) {
    return decodeImageFile(root, filePath)
  }

  if (isBase64(value)) {
    return decodeBase64(value)
  }

  const relative = path.relative(root, filePath)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("outside project")
  }

  throw new Error("image file does not exist")
}

async function decodeImageFile(root: string, filePath: string): Promise<DecodedImage> {
  const realFilePath = await fs.realpath(filePath)
  const relative = path.relative(root, realFilePath)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("outside project")
  }

  const stat = await fs.stat(realFilePath)
  if (stat.size > MAX_IMAGE_BYTES) {
    throw new Error("image exceeds 10MB limit")
  }

  const bytes = new Uint8Array(await fs.readFile(realFilePath))

  const mime = detectMime(bytes)
  if (!mime) {
    throw new Error("unable to detect image mime")
  }

  return {
    mime,
    bytes,
    filename: path.basename(realFilePath),
  }
}

function decodeDataUrl(input: string): DecodedImage {
  const match = dataUrlPattern.exec(input)
  if (!match) {
    throw new Error("data URL base64 decode failed")
  }

  const mime = match[1].toLowerCase()
  if (match[2] !== match[2].trim()) {
    throw new Error("data URL base64 decode failed")
  }

  const base64 = match[2].replace(/\s+/g, "")
  if (!isBase64(base64)) {
    throw new Error("data URL base64 decode failed")
  }

  if (estimateBase64Bytes(base64) > MAX_IMAGE_BYTES) {
    throw new Error("image exceeds 10MB limit")
  }

  const bytes = decodeBase64Bytes(base64)

  const detected = detectMime(bytes)
  if (!detected || detected !== mime) {
    throw new Error("unable to detect image mime")
  }

  return { mime: detected, bytes, filename: defaultFilename(detected) }
}

function decodeBase64(input: string): DecodedImage {
  if (estimateBase64Bytes(input) > MAX_IMAGE_BYTES) {
    throw new Error("image exceeds 10MB limit")
  }

  const bytes = decodeBase64Bytes(input)

  const mime = detectMime(bytes)
  if (!mime) {
    throw new Error("unable to detect image mime")
  }

  return { mime, bytes, filename: defaultFilename(mime) }
}

function decodeBase64Bytes(input: string) {
  return new Uint8Array(Buffer.from(input, "base64"))
}

function estimateBase64Bytes(input: string) {
  const padding = input.endsWith("==") ? 2 : input.endsWith("=") ? 1 : 0
  return (input.length / 4) * 3 - padding
}

export function detectMime(bytes: Uint8Array): DecodedImage["mime"] | undefined {
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

  if (
    bytes.length >= 12 &&
    Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" &&
    Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP"
  ) {
    return "image/webp"
  }
}

function defaultFilename(mime: DecodedImage["mime"]) {
  if (mime === "image/jpeg") return "image.jpg"
  if (mime === "image/webp") return "image.webp"
  return "image.png"
}

function isBase64(input: string) {
  if (input.length < 4 || input.length % 4 !== 0 || !base64Pattern.test(input)) {
    return false
  }

  const padding = input.match(/=*$/)?.[0].length ?? 0
  if (padding > 2) {
    return false
  }

  return !input.slice(0, input.length - padding).includes("=")
}

async function pathExists(filePath: string) {
  try {
    await fs.lstat(filePath)
    return true
  } catch (error) {
    if (["ENOENT", "ENAMETOOLONG"].includes((error as NodeJS.ErrnoException).code ?? "")) {
      return false
    }
    throw error
  }
}
