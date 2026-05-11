import { useState } from "react"
import { getGeneratedImageUrl } from "../../../lib/fileUtils"
import { useProject } from "../../../state/ProjectContext"
import { ImageOverlay } from "../ImageOverlay"

type Attachment = {
  id?: string
  mime?: string
  filename?: string
  url?: string
  relativePath?: string
}

interface Props {
  attachments?: Attachment[]
}

type ImageAttachment = {
  id?: string
  mime: string
  filename?: string
  url?: string
  relativePath?: string
}

function isImageAttachment(attachment: Attachment): attachment is ImageAttachment {
  const hasUrl = typeof attachment.url === "string" && attachment.url.length > 0
  const hasRelativePath = typeof attachment.relativePath === "string" && attachment.relativePath.length > 0
  return typeof attachment.mime === "string" && attachment.mime.startsWith("image/") && (hasUrl || hasRelativePath)
}

function extensionForMime(mime: string) {
  if (mime === "image/jpeg") return "jpg"
  if (mime === "image/png") return "png"
  if (mime === "image/webp") return "webp"
  if (mime === "image/gif") return "gif"

  const suffix = mime.slice("image/".length).trim().toLowerCase()
  return suffix.length > 0 ? suffix : "png"
}

function imageAttachments(attachments: Attachment[] | undefined, directory: string | null) {
  return (attachments ?? [])
    .filter(isImageAttachment)
    .map((attachment, index) => {
      const number = index + 1
      const extension = extensionForMime(attachment.mime)
      const src = attachment.relativePath ? getGeneratedImageUrl(attachment.relativePath, directory) : attachment.url!

      return {
        id: attachment.id ?? `image-${number}`,
        label: `Image #${number}`,
        filename: attachment.filename || `generated-image-${number}.${extension}`,
        relativePath: attachment.relativePath,
        src,
      }
    })
}

export function ToolImageAttachments({ attachments }: Props) {
  const { directory } = useProject()
  const images = imageAttachments(attachments, directory)
  const [activeImage, setActiveImage] = useState<number | null>(null)
  const [failedImageIds, setFailedImageIds] = useState<string[]>([])

  if (images.length === 0) return null

  const preview = activeImage === null ? null : images[activeImage] ?? null

  return (
    <>
      <div className="px-3 pb-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {images.map((image, index) => (
            <button
              key={image.id}
              type="button"
              onClick={() => setActiveImage(index)}
              className="group overflow-hidden rounded-lg border border-gray-200 bg-white text-left shadow-sm transition hover:border-gray-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700 dark:focus:ring-offset-gray-950"
            >
              <div className="aspect-[4/3] overflow-hidden bg-gray-100 dark:bg-gray-950">
                {failedImageIds.includes(image.id) ? (
                  <div className="flex h-full w-full items-center justify-center px-3 text-sm text-gray-500 dark:text-gray-400">
                    预览不可用
                  </div>
                ) : (
                  <img
                    src={image.src}
                    alt={image.filename}
                    onError={() => {
                      setFailedImageIds((value) => (value.includes(image.id) ? value : [...value, image.id]))
                    }}
                    className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.02]"
                  />
                )}
              </div>
              <div className="space-y-1 px-3 py-2">
                <div className="text-xs font-medium uppercase tracking-[0.12em] text-gray-500 dark:text-gray-400">
                  {image.label}
                </div>
                <div className="truncate text-sm text-gray-900 dark:text-gray-100">{image.filename}</div>
                {image.relativePath ? (
                  <div className="truncate font-mono text-xs text-gray-500 dark:text-gray-400">{image.relativePath}</div>
                ) : null}
              </div>
            </button>
          ))}
        </div>
      </div>

      {preview ? (
        <ImageOverlay
          url={preview.src}
          alt={preview.filename}
          onClose={() => setActiveImage(null)}
        />
      ) : null}
    </>
  )
}
