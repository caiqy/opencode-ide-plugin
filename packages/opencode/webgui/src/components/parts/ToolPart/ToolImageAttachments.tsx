import { useState } from "react"
import { ImageOverlay } from "../ImageOverlay"

type Attachment = {
  id?: string
  mime?: string
  filename?: string
  url?: string
}

interface Props {
  attachments?: Attachment[]
}

type ImageAttachment = {
  id?: string
  mime: string
  filename?: string
  url: string
}

function isImageAttachment(attachment: Attachment): attachment is ImageAttachment {
  return typeof attachment.mime === "string" && attachment.mime.startsWith("image/") && typeof attachment.url === "string" && attachment.url.length > 0
}

function extensionForMime(mime: string) {
  if (mime === "image/jpeg") return "jpg"
  if (mime === "image/png") return "png"
  if (mime === "image/webp") return "webp"
  if (mime === "image/gif") return "gif"

  const suffix = mime.slice("image/".length).trim().toLowerCase()
  return suffix.length > 0 ? suffix : "png"
}

function imageAttachments(attachments?: Attachment[]) {
  return (attachments ?? [])
    .filter(isImageAttachment)
    .map((attachment, index) => {
      const number = index + 1
      const extension = extensionForMime(attachment.mime)
      return {
        id: attachment.id ?? `image-${number}`,
        label: `Image #${number}`,
        filename: attachment.filename || `generated-image-${number}.${extension}`,
        url: attachment.url,
      }
    })
}

export function ToolImageAttachments({ attachments }: Props) {
  const images = imageAttachments(attachments)
  const [activeImage, setActiveImage] = useState<number | null>(null)

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
                <img
                  src={image.url}
                  alt={image.filename}
                  className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.02]"
                />
              </div>
              <div className="space-y-1 px-3 py-2">
                <div className="text-xs font-medium uppercase tracking-[0.12em] text-gray-500 dark:text-gray-400">
                  {image.label}
                </div>
                <div className="truncate text-sm text-gray-900 dark:text-gray-100">{image.filename}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {preview ? (
        <ImageOverlay
          url={preview.url}
          alt={preview.filename}
          onClose={() => setActiveImage(null)}
        />
      ) : null}
    </>
  )
}
