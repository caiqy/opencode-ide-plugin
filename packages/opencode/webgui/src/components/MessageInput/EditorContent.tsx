import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin"
import { ContentEditable } from "@lexical/react/LexicalContentEditable"
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin"
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin"
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary"
import { MentionPlugin } from "../mention/MentionPlugin"
import { AttachmentPlugin } from "../attachment/AttachmentPlugin"
import { AttachmentRail } from "../attachment/AttachmentRail"
import { CommandPlugin } from "../command/CommandPlugin"
import type { EditorState } from "lexical"
import { useCallback, useRef, useState } from "react"

interface EditorContentProps {
  contentEditableRef: React.RefObject<HTMLDivElement | null>
  containerRef: React.RefObject<HTMLDivElement | null>
  onEditorChange: (editorState: EditorState) => void
}

export function EditorContent({ contentEditableRef, containerRef, onEditorChange }: EditorContentProps) {
  const [height, setHeight] = useState<number>()
  const drag = useRef<{ pointerID: number; startY: number; startHeight: number } | null>(null)

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      const startHeight = contentEditableRef.current?.getBoundingClientRect().height
      if (!startHeight) return
      drag.current = { pointerID: event.pointerId, startY: event.clientY, startHeight }
      event.currentTarget.setPointerCapture?.(event.pointerId)
    },
    [contentEditableRef],
  )

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (!current || current.pointerID !== event.pointerId) return
    setHeight(Math.min(400, Math.max(32, current.startHeight + current.startY - event.clientY)))
  }, [])

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerID !== event.pointerId) return
    drag.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }, [])

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return
      const current = height ?? contentEditableRef.current?.getBoundingClientRect().height
      if (!current) return
      event.preventDefault()
      setHeight(Math.min(400, Math.max(32, current + (event.key === "ArrowDown" ? 24 : -24))))
    },
    [contentEditableRef, height],
  )

  return (
    <>
      <div
        role="separator"
        aria-label="调整输入框高度"
        aria-orientation="horizontal"
        tabIndex={0}
        title="拖动调整输入框高度，双击重置"
        data-testid="message-input-resize-handle"
        className="group flex h-1 cursor-row-resize touch-none select-none items-center"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => setHeight(undefined)}
        onKeyDown={onKeyDown}
      />
      <AttachmentRail />
      <div className="px-3 py-1.5">
        <div ref={containerRef} className="relative">
          <RichTextPlugin
            contentEditable={
              // @ts-expect-error React 19 type compatibility
              <ContentEditable
                ref={contentEditableRef}
                id="opencode-message-input"
                className="px-2 py-1.5 text-[13px] text-gray-900 dark:text-gray-100 focus:outline-none min-h-[32px] max-h-[400px] overflow-y-auto"
                style={{ caretColor: "auto", height }}
                aria-label="输入消息（回车发送）"
                aria-placeholder="输入消息（回车发送）"
                placeholder={
                  <div className="absolute top-1.5 left-2 text-[13px] text-gray-400 dark:text-gray-500 pointer-events-none">
                    输入消息（回车发送）
                  </div>
                }
              />
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
          <OnChangePlugin onChange={onEditorChange} />
          <HistoryPlugin />
          <MentionPlugin />
          <CommandPlugin />
          <AttachmentPlugin />
        </div>
      </div>
    </>
  )
}
