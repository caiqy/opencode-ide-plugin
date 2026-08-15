import { useEffect, useState } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { $getRoot, $isElementNode, type LexicalNode, type NodeKey } from "lexical"
import { AttachmentComponent } from "./AttachmentComponent"
import { $isAttachmentNode, type AttachmentMetadata } from "./AttachmentNode"

interface Attachment {
  key: NodeKey
  metadata: AttachmentMetadata
}

function readAttachments() {
  const attachments: Attachment[] = []
  const visit = (node: LexicalNode) => {
    if ($isAttachmentNode(node)) {
      attachments.push({ key: node.getKey(), metadata: node.getMetadata() })
      return
    }
    if ($isElementNode(node)) node.getChildren().forEach(visit)
  }

  $getRoot().getChildren().forEach(visit)
  return attachments
}

export function AttachmentRail() {
  const [editor] = useLexicalComposerContext()
  const [attachments, setAttachments] = useState<Attachment[]>([])

  useEffect(() => {
    const update = (editorState: ReturnType<typeof editor.getEditorState>) => {
      editorState.read(() => setAttachments(readAttachments()))
    }

    update(editor.getEditorState())
    return editor.registerUpdateListener(({ editorState }) => update(editorState))
  }, [editor])

  if (attachments.length === 0) return null

  return (
    <div className="px-3 pt-2" data-testid="attachment-rail">
      <div className="flex max-w-full gap-2 overflow-x-auto pb-1" data-testid="attachment-rail-items">
        {attachments.map((attachment) => (
          <AttachmentComponent key={attachment.key} nodeKey={attachment.key} metadata={attachment.metadata} />
        ))}
      </div>
    </div>
  )
}
