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

interface EditorContentProps {
  contentEditableRef: React.RefObject<HTMLDivElement | null>
  containerRef: React.RefObject<HTMLDivElement | null>
  onEditorChange: (editorState: EditorState) => void
}

export function EditorContent({ contentEditableRef, containerRef, onEditorChange }: EditorContentProps) {
  return (
    <>
      <AttachmentRail />
      <div className="px-3 py-1.5">
        <div ref={containerRef} className="relative">
        <RichTextPlugin
          contentEditable={
            // @ts-expect-error React 19 type compatibility
            <ContentEditable
              ref={contentEditableRef}
              id="opencode-message-input"
              className="px-2 py-1.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none min-h-[32px] max-h-[400px] overflow-y-auto"
              style={{ caretColor: "auto" }}
              aria-label="输入消息（回车发送）"
              aria-placeholder="输入消息（回车发送）"
              placeholder={
                <div className="absolute top-1.5 left-2 text-sm text-gray-400 dark:text-gray-500 pointer-events-none">
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
