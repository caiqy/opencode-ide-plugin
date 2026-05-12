import { useEffect, useId, useRef, useState } from "react"
import { saveImage } from "../../lib/fileUtils"

interface Props {
  url: string
  alt: string
  filename: string
  onClose: () => void
}

const MIN_SCALE = 0.05
const MAX_SCALE = 5
const SCALE_STEP = 0.04
const WHEEL_SCALE_STEP = 0.04

function clampScale(value: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value))
}

export function ImageOverlay({ url, alt, filename, onClose }: Props) {
  const titleId = useId()
  const [scale, setScale] = useState(1)
  const [isFit, setIsFit] = useState(true)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const drag = useRef<{ pointerId: number; x: number; y: number; offsetX: number; offsetY: number } | null>(null)
  const naturalSize = useRef({ width: 0, height: 0 })

  const resetView = () => {
    setScale(1)
    setIsFit(false)
    setOffset({ x: 0, y: 0 })
  }

  const applyFit = () => {
    const { width, height } = naturalSize.current
    if (!width || !height) {
      setScale(1)
      setIsFit(true)
      setOffset({ x: 0, y: 0 })
      return
    }

    const widthScale = (window.innerWidth * 0.9) / width
    const heightScale = (window.innerHeight * 0.8) / height
    const nextScale = clampScale(Math.min(widthScale, heightScale))

    setScale(nextScale)
    setIsFit(true)
    setOffset({ x: 0, y: 0 })
  }

  const zoomBy = (delta: number) => {
    setScale((value) => clampScale(value + delta))
    setIsFit(false)
  }

  const handleSave = () => {
    void Promise.resolve(saveImage(url, filename)).catch((error) => {
      console.warn("[ImageOverlay] Failed to save image", { url, filename }, error)
    })
  }

  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose()
      if (e.key === "+" || e.key === "=") {
        e.preventDefault()
        zoomBy(SCALE_STEP)
      }
      if (e.key === "-") {
        e.preventDefault()
        zoomBy(-SCALE_STEP)
      }
      if (e.key === "0") {
        e.preventDefault()
        resetView()
      }
    }

    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [isFit, onClose])

  useEffect(() => {
    if (!isFit) return

    const handleResize = () => applyFit()
    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [isFit])

  const stopDragging = (target: HTMLDivElement, pointerId: number) => {
    try {
      target.releasePointerCapture(pointerId)
    } catch {
      // Ignore cases where capture is already gone.
    }

    drag.current = null
    setIsDragging(false)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex h-full flex-col"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 border-b border-white/10 bg-black/50 px-4 py-3">
          <span id={titleId} className="min-w-0 flex-1 truncate font-mono text-sm text-white/80">
            {alt}
          </span>

          <div className="flex items-center gap-2 text-sm text-white/80">
            <button
              type="button"
              aria-label="保存图片"
              className="rounded border border-white/15 px-3 py-1.5 transition-colors hover:border-white/30 hover:text-white"
              onClick={handleSave}
            >
              保存
            </button>
            <button
              type="button"
              aria-label="缩小"
              className="rounded border border-white/15 px-3 py-1.5 transition-colors hover:border-white/30 hover:text-white"
              onClick={() => zoomBy(-SCALE_STEP)}
            >
              -
            </button>
            <span className="w-14 text-center font-mono text-white">{Math.round(scale * 100)}%</span>
            <button
              type="button"
              aria-label="放大"
              className="rounded border border-white/15 px-3 py-1.5 transition-colors hover:border-white/30 hover:text-white"
              onClick={() => zoomBy(SCALE_STEP)}
            >
              +
            </button>
            <button
              type="button"
              aria-label="重置缩放"
              className="rounded border border-white/15 px-3 py-1.5 transition-colors hover:border-white/30 hover:text-white"
              onClick={resetView}
            >
              重置
            </button>
            <button
              type="button"
              aria-label="适应窗口"
              className="rounded border border-white/15 px-3 py-1.5 transition-colors hover:border-white/30 hover:text-white"
              onClick={applyFit}
            >
              适应
            </button>
            <button
              type="button"
              aria-label="关闭"
              className="rounded border border-white/15 px-3 py-1.5 transition-colors hover:border-white/30 hover:text-white"
              onClick={onClose}
            >
              关闭
            </button>
          </div>
        </div>

        <div
          className={`flex flex-1 items-center justify-center overflow-hidden px-4 py-6 ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}
          style={{ touchAction: "none" }}
          onPointerDown={(event) => {
            if (event.button !== 0) return

            event.currentTarget.setPointerCapture(event.pointerId)
            drag.current = {
              pointerId: event.pointerId,
              x: event.clientX,
              y: event.clientY,
              offsetX: offset.x,
              offsetY: offset.y,
            }
            setIsDragging(true)
          }}
          onPointerMove={(event) => {
            if (!drag.current || drag.current.pointerId !== event.pointerId) return

            setOffset({
              x: drag.current.offsetX + event.clientX - drag.current.x,
              y: drag.current.offsetY + event.clientY - drag.current.y,
            })
          }}
          onPointerUp={(event) => {
            if (!drag.current || drag.current.pointerId !== event.pointerId) return
            stopDragging(event.currentTarget, event.pointerId)
          }}
          onPointerCancel={(event) => {
            if (!drag.current || drag.current.pointerId !== event.pointerId) return
            stopDragging(event.currentTarget, event.pointerId)
          }}
          onWheel={(event) => {
            event.preventDefault()
            zoomBy(event.deltaY < 0 ? WHEEL_SCALE_STEP : -WHEEL_SCALE_STEP)
          }}
        >
          <img
            src={url}
            alt={alt}
            draggable={false}
            onLoad={(event) => {
              naturalSize.current = {
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              }

              if (isFit) applyFit()
            }}
            onDoubleClick={resetView}
            className="select-none rounded shadow-2xl"
            style={{
              maxWidth: "none",
              maxHeight: "none",
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
              transformOrigin: "center center",
            }}
          />
        </div>
      </div>
    </div>
  )
}
