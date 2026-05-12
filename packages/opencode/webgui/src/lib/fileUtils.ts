import { ideBridge } from "./ideBridge"

export interface SaveImageResult {
  cancelled: boolean
}

export function getMimeTypeFromExtension(ext: string): string {
  const map: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".markdown": "text/markdown",
  }
  return map[ext.toLowerCase()] || "application/octet-stream"
}

export function getExtensionFromFilename(filename: string): string {
  const parts = filename.split(".")
  return parts.length > 1 ? `.${parts[parts.length - 1]}` : ""
}

export function getImageExtensionFromMime(mime: string): string {
  if (mime === "image/jpeg") return "jpg"
  if (mime === "image/png") return "png"
  if (mime === "image/webp") return "webp"
  if (mime === "image/gif") return "gif"

  const suffix = mime.slice("image/".length).trim().toLowerCase()
  return suffix.length > 0 ? suffix : "png"
}

export function getImageFilename(filename: string | undefined, mime: string, fallbackBase = "image"): string {
  if (filename) return filename
  return `${fallbackBase}.${getImageExtensionFromMime(mime)}`
}

export async function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error("Failed to read file"))
    reader.readAsDataURL(file)
  })
}

// Re-export from central utilities
export { formatFileSize } from "../utils/formatting"
export function isImageFile(mime: string): boolean {
  return mime.startsWith("image/")
}

export function isPdfFile(mime: string): boolean {
  return mime === "application/pdf"
}

export function isTextFile(mime: string): boolean {
  return mime.startsWith("text/")
}

export function isSupportedAttachmentType(mime: string): boolean {
  return isImageFile(mime) || isPdfFile(mime) || isTextFile(mime)
}

export function normalizeTextAttachment(mime: string, url: string): { mime: string; url: string } {
  if (!isTextFile(mime)) return { mime, url }

  return {
    mime: "text/plain",
    url: url.replace(/^data:[^;,]+/, "data:text/plain"),
  }
}

export function sanitizeFilename(filename: string): string {
  const value = filename.trim().replace(/[\\/:*?"<>|]/g, "-")
  return value || "image.png"
}

export function getGeneratedImageUrl(relativePath: string, directory?: string | null): string {
  const query = new URLSearchParams({ path: relativePath })
  if (directory) query.set("directory", directory)
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "")
  return `${base === "/" ? "" : base}/generated-image?${query.toString()}`
}

export function dataUrlToBlob(url: string): Blob {
  const comma = url.indexOf(",")
  if (comma < 0) throw new Error("Invalid data URL")

  const header = url.slice(0, comma)
  const data = url.slice(comma + 1)
  if (!header.startsWith("data:")) throw new Error("Invalid data URL")

  const meta = header.slice(5)
  const parts = meta.split(";")
  const mime = parts[0] || "application/octet-stream"
  const hasBase64 = parts.slice(1).some((part) => part.toLowerCase() === "base64")
  if (!hasBase64) throw new Error("Invalid data URL")

  try {
    if (!data) return new Blob([new Uint8Array(0)], { type: mime })

    const text = atob(data)
    const bytes = Uint8Array.from(text, (char) => char.charCodeAt(0))

    return new Blob([bytes], { type: mime })
  } catch {
    throw new Error("Invalid data URL")
  }
}

export function downloadUrl(url: string, filename: string): void {
  const link = document.createElement("a")
  const safeName = sanitizeFilename(filename)
  const objectUrl = url.startsWith("data:") ? URL.createObjectURL(dataUrlToBlob(url)) : null
  const href = objectUrl ?? url

  link.href = href
  link.download = safeName
  document.body.append(link)

  try {
    link.click()
  } finally {
    link.remove()
    if (objectUrl) {
      // Delay revoke so browsers/WebViews can start the download before the blob URL disappears.
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
    }
  }
}

export async function saveImage(url: string, filename: string): Promise<SaveImageResult> {
  if (!ideBridge.isInstalled()) {
    downloadUrl(url, filename)
    return { cancelled: false }
  }

  const message = await ideBridge.request<SaveImageResult>("saveImage", {
    url,
    filename: sanitizeFilename(filename),
  })

  return message.result ?? { cancelled: false }
}
