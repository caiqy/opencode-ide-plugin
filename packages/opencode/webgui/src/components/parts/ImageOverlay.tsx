import { useEffect } from "react"

interface Props {
  url: string
  alt: string
  onClose: () => void
}

export function ImageOverlay({ url, alt, onClose }: Props) {
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between w-full mb-2 px-1">
          <span className="text-white/80 text-sm font-mono truncate">{alt}</span>
          <button
            onClick={onClose}
            className="ml-4 p-1 text-white/70 hover:text-white rounded transition-colors"
            aria-label="关闭"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <img src={url} alt={alt} className="max-w-[85vw] max-h-[80vh] object-contain rounded shadow-2xl" />
      </div>
    </div>
  )
}
