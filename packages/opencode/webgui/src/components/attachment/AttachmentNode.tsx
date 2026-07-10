import {
  DecoratorNode,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical"
import { AttachmentComponent } from "./AttachmentComponent"
import type { FilePart } from "@opencode-ai/sdk/v2/client"

export interface AttachmentMetadata {
  id: string
  display: string
  filename?: string
  mime: string
  url: string // data URI
  size: number // bytes
  source?: FilePart["source"]
}

export type SerializedAttachmentNode = Spread<
  {
    metadata: AttachmentMetadata
  },
  SerializedLexicalNode
>

export class AttachmentNode extends DecoratorNode<JSX.Element> {
  __metadata: AttachmentMetadata

  static override getType(): string {
    return "attachment"
  }

  static override clone(node: AttachmentNode): AttachmentNode {
    return new AttachmentNode(node.__metadata, node.__key)
  }

  constructor(metadata: AttachmentMetadata, key?: NodeKey) {
    super(key)
    this.__metadata = metadata
  }

  override createDOM(config: EditorConfig): HTMLElement {
    const dom = document.createElement("span")
    dom.className = config.theme.attachment || ""
    return dom
  }

  override updateDOM(): false {
    return false
  }

  static override importJSON(serializedNode: SerializedAttachmentNode): AttachmentNode {
    return $createAttachmentNode(serializedNode.metadata)
  }

  override exportJSON(): SerializedAttachmentNode {
    return {
      metadata: this.__metadata,
      type: "attachment",
      version: 1,
    }
  }

  getMetadata(): AttachmentMetadata {
    return this.__metadata
  }

  override getTextContent(): string {
    return `[${this.__metadata.display}]`
  }

  override decorate(): JSX.Element {
    return <AttachmentComponent nodeKey={this.__key} metadata={this.__metadata} />
  }

  override isInline(): boolean {
    return true
  }

  override isKeyboardSelectable(): boolean {
    return false
  }
}

export function $createAttachmentNode(metadata: AttachmentMetadata): AttachmentNode {
  return new AttachmentNode(metadata)
}

export function $isAttachmentNode(node: LexicalNode | null | undefined): node is AttachmentNode {
  return node instanceof AttachmentNode
}
