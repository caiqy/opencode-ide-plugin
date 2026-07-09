import { createContext, useContext, useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { ImageOverlay } from "./ImageOverlay"

interface Props {
  src: string
  alt: string
  filename?: string
  className?: string
  imageClassName?: string
  fallbackClassName?: string
  fallbackText?: string
  interactive?: boolean
}

const defaultFrame =
  "inline-flex max-w-full cursor-zoom-in overflow-hidden rounded-lg border border-gray-200 bg-gray-100 align-top shadow-sm transition hover:border-gray-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:border-gray-800 dark:bg-gray-950 dark:hover:border-gray-700 dark:focus:ring-offset-gray-950"
const defaultImage = "block max-h-[60vh] max-w-full object-contain"
const defaultFallback =
  "inline-flex min-h-20 max-w-full items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-100 px-4 py-3 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-400"
const staticFrame =
  "inline-flex max-w-full overflow-hidden rounded-lg border border-gray-200 bg-gray-100 align-top shadow-sm dark:border-gray-800 dark:bg-gray-950"

export const ImagePreviewLinkContext = createContext(false)

function imageName(src: string) {
  const path = src.split(/[?#]/)[0] ?? ""
  const segment = path.split("/").filter(Boolean).at(-1)
  if (!segment) return "image"
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

export function ImagePreview({
  src,
  alt,
  filename,
  className,
  imageClassName,
  fallbackClassName,
  fallbackText,
  interactive = true,
}: Props) {
  const linked = useContext(ImagePreviewLinkContext)
  const [preview, setPreview] = useState(false)
  const [failed, setFailed] = useState(false)
  const name = filename || alt || imageName(src)

  useEffect(() => {
    setFailed(false)
    setPreview(false)
  }, [src])

  if (failed) {
    return <span className={fallbackClassName ?? defaultFallback}>{fallbackText ?? "图片预览不可用"}</span>
  }

  if (!interactive || linked) {
    return (
      <span className={className ?? staticFrame}>
        <img src={src} alt={alt || name} onError={() => setFailed(true)} className={imageClassName ?? defaultImage} />
      </span>
    )
  }

  const overlay = preview ? (
    <ImageOverlay url={src} alt={alt || name} filename={name} onClose={() => setPreview(false)} />
  ) : null

  return (
    <>
      <button
        type="button"
        className={className ?? defaultFrame}
        aria-label={`查看图片：${name}`}
        onClick={() => setPreview(true)}
      >
        <img src={src} alt={alt} onError={() => setFailed(true)} className={imageClassName ?? defaultImage} />
      </button>

      {overlay && typeof document === "undefined" ? overlay : overlay ? createPortal(overlay, document.body) : null}
    </>
  )
}
