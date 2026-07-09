import { useEffect } from "react"

interface UseDragDropOptions {
  contentEditableRef: React.RefObject<HTMLDivElement | null>
  containerRef: React.RefObject<HTMLDivElement | null>
  disabled?: boolean
}

export function useDragDrop({ contentEditableRef, containerRef, disabled = false }: UseDragDropOptions) {
  // Attach drag-and-drop to the contentEditable
  useEffect(() => {
    const el = contentEditableRef.current
    if (!el) return

    let overCount = 0

    const addHighlight = () => {
      const box = containerRef.current
      if (!box) return
      box.classList.add("ring-2", "ring-blue-500", "border-blue-500")
    }
    const removeHighlight = () => {
      const box = containerRef.current
      if (!box) return
      box.classList.remove("ring-2", "ring-blue-500", "border-blue-500")
    }

    const onDragEnter = (ev: DragEvent) => {
      ev.preventDefault()
      if (disabled) return
      overCount = overCount + 1
      addHighlight()
    }

    const onDragOver = (ev: DragEvent) => {
      ev.preventDefault()
      if (disabled) return
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = "copy"
      addHighlight()
    }

    const onDragLeave = (ev: DragEvent) => {
      ev.preventDefault()
      if (disabled) return
      overCount = Math.max(0, overCount - 1)
      if (overCount === 0) removeHighlight()
    }

    const onDrop = (ev: DragEvent) => {
      ev.preventDefault()
      overCount = 0
      removeHighlight()
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
  }, [contentEditableRef.current, disabled, containerRef])

  // Document-level drag highlight
  useEffect(() => {
    let over = 0
    const add = () => {
      const box = containerRef.current
      if (!box) return
      box.classList.add("ring-2", "ring-blue-500", "border-blue-500")
    }
    const rm = () => {
      const box = containerRef.current
      if (!box) return
      box.classList.remove("ring-2", "ring-blue-500", "border-blue-500")
    }
    const onEnter = (e: DragEvent) => {
      e.preventDefault()
      over = over + 1
      add()
    }
    const onOver = (e: DragEvent) => {
      e.preventDefault()
      add()
    }
    const onLeave = (e: DragEvent) => {
      e.preventDefault()
      over = Math.max(0, over - 1)
      if (over === 0) rm()
    }
    const onEnd = (e: DragEvent) => {
      e.preventDefault()
      over = 0
      rm()
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
  }, [containerRef])
}
