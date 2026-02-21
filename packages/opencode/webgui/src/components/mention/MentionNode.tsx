import {
  DecoratorNode,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical"
import { useCallback, type MouseEvent, type KeyboardEvent } from "react"
import { useOpenFile } from "../../hooks/useOpenFile"

export type MentionType = "file" | "directory" | "agent" | "symbol"

export interface MentionMetadata {
  type: MentionType
  display: string
  path?: string
  name?: string
  range?: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  }
  kind?: number
}

export type SerializedMentionNode = Spread<
  {
    metadata: MentionMetadata
  },
  SerializedLexicalNode
>

export class MentionNode extends DecoratorNode<JSX.Element> {
  __metadata: MentionMetadata

  static override getType(): string {
    return "mention"
  }

  static override clone(node: MentionNode): MentionNode {
    return new MentionNode(node.__metadata, node.__key)
  }

  constructor(metadata: MentionMetadata, key?: NodeKey) {
    super(key)
    this.__metadata = metadata
  }

  override createDOM(config: EditorConfig): HTMLElement {
    const dom = document.createElement("span")
    dom.className = config.theme.mention || ""
    return dom
  }

  override updateDOM(): false {
    return false
  }

  static override importJSON(serializedNode: SerializedMentionNode): MentionNode {
    return $createMentionNode(serializedNode.metadata)
  }

  override exportJSON(): SerializedMentionNode {
    return {
      metadata: this.__metadata,
      type: "mention",
      version: 1,
    }
  }

  getMetadata(): MentionMetadata {
    return this.__metadata
  }

  override getTextContent(): string {
    return `@${this.__metadata.display}`
  }

  override decorate(): JSX.Element {
    return <MentionComponent metadata={this.__metadata} />
  }

  override isInline(): boolean {
    return true
  }

  override isKeyboardSelectable(): boolean {
    return false
  }
}

export function $createMentionNode(metadata: MentionMetadata): MentionNode {
  return new MentionNode(metadata)
}

export function $isMentionNode(node: LexicalNode | null | undefined): node is MentionNode {
  return node instanceof MentionNode
}

interface MentionComponentProps {
  metadata: MentionMetadata
}

function MentionComponent({ metadata }: MentionComponentProps) {
  const openFile = useOpenFile()
  const isFileLike = metadata.type === "file" || metadata.type === "directory" || metadata.type === "symbol"

  const handleActivate = useCallback(
    (event?: MouseEvent<HTMLSpanElement> | KeyboardEvent<HTMLSpanElement>) => {
      if (!isFileLike) return
      event?.preventDefault()
      event?.stopPropagation()
      openFile({
        path: metadata.path,
        display: metadata.display,
        range: metadata.range,
      })
    },
    [isFileLike, metadata.display, metadata.path, metadata.range, openFile],
  )

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLSpanElement>) => {
      if (!isFileLike) return
      if (event.key === "Enter" || event.key === " ") handleActivate(event)
    },
    [handleActivate, isFileLike],
  )

  const getIcon = () => {
    switch (metadata.type) {
      case "file":
        return (
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
        )
      case "directory":
        return (
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
            />
          </svg>
        )
      case "agent":
        return (
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
            />
          </svg>
        )
      case "symbol":
        return (
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
            />
          </svg>
        )
    }
  }

  const getColorClasses = () => {
    switch (metadata.type) {
      case "file":
        return "bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900 dark:text-blue-300 dark:border-blue-700"
      case "directory":
        return "bg-purple-100 text-purple-700 border-purple-300 dark:bg-purple-900 dark:text-purple-300 dark:border-purple-700"
      case "agent":
        return "bg-green-100 text-green-700 border-green-300 dark:bg-green-900 dark:text-green-300 dark:border-green-700"
      case "symbol":
        return "bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-900 dark:text-orange-300 dark:border-orange-700"
    }
  }

  const clickableClasses = isFileLike
    ? "cursor-pointer transition-colors hover:underline underline-offset-[3px] decoration-solid"
    : ""

  return (
    <span
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium border ${getColorClasses()} ${clickableClasses}`}
      contentEditable={false}
      data-lexical-mention="true"
      role={isFileLike ? "button" : undefined}
      tabIndex={isFileLike ? 0 : undefined}
      title={metadata.path}
      data-tip={metadata.path}
      onClick={handleActivate}
      onKeyDown={handleKeyDown}
    >
      {getIcon()}
      <span>@{metadata.display}</span>
    </span>
  )
}
