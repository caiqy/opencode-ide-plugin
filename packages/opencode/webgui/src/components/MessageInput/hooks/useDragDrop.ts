import { useEffect } from "react"

interface UseDragDropOptions {
  contentEditableRef: React.RefObject<HTMLDivElement | null>
  containerRef: React.RefObject<HTMLDivElement | null>
  disabled?: boolean
}

export function useDragDrop({ contentEditableRef, containerRef, disabled = false }: UseDragDropOptions) {
  useEffect(() => {
    containerRef.current?.classList.remove("ring-2", "ring-blue-500", "border-blue-500")
  }, [containerRef])

  // Attach drag-and-drop to the contentEditable
  useEffect(() => {
    const el = contentEditableRef.current
    if (!el) return

    const onDragEnter = (ev: DragEvent) => {
      ev.preventDefault()
      if (disabled) return
    }

    const onDragOver = (ev: DragEvent) => {
      ev.preventDefault()
      if (disabled) return
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = "copy"
    }

    const onDragLeave = (ev: DragEvent) => {
      ev.preventDefault()
      if (disabled) return
    }

    const onDrop = (ev: DragEvent) => {
      ev.preventDefault()
    }

    el.addEventListener("dragenter", onDragEnter as any)
    el.addEventListener("dragover", onDragOver as any)
    el.addEventListener("dragleave", onDragLeave as any)
    el.addEventListener("drop", onDrop as any)
    return () => {
      el.removeEventListener("dragenter", onDragEnter as any)
      el.removeEventListener("dragover", onDragOver as any)
      el.removeEventListener("dragleave", onDragLeave as any)
      el.removeEventListener("drop", onDrop as any)
    }
  }, [contentEditableRef.current, disabled])

  // Document-level drag handling
  useEffect(() => {
    const onEnter = (e: DragEvent) => {
      e.preventDefault()
    }
    const onOver = (e: DragEvent) => {
      e.preventDefault()
    }
    const onLeave = (e: DragEvent) => {
      e.preventDefault()
    }
    const onEnd = (e: DragEvent) => {
      e.preventDefault()
    }

    document.addEventListener("dragenter", onEnter as any)
    document.addEventListener("dragover", onOver as any)
    document.addEventListener("dragleave", onLeave as any)
    document.addEventListener("drop", onEnd as any)
    document.addEventListener("dragend", onEnd as any)

    return () => {
      document.removeEventListener("dragenter", onEnter as any)
      document.removeEventListener("dragover", onOver as any)
      document.removeEventListener("dragleave", onLeave as any)
      document.removeEventListener("drop", onEnd as any)
      document.removeEventListener("dragend", onEnd as any)
    }
  }, [])
}
