import { $getNodeByKey, type NodeKey } from "lexical"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { type AttachmentMetadata } from "./AttachmentNode"
import { ImagePreview } from "../parts/ImagePreview"

interface AttachmentComponentProps {
  nodeKey: NodeKey
  metadata: AttachmentMetadata
}

export function AttachmentComponent({ nodeKey, metadata }: AttachmentComponentProps) {
  const [editor] = useLexicalComposerContext()

  const handleRemove = () => {
    editor.update(() => {
      $getNodeByKey(nodeKey)?.remove()
    })
  }

  const getIcon = () => {
    if (metadata.mime.startsWith("image/")) {
      return (
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
      )
    }
    if (metadata.mime === "application/pdf") {
      return (
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
          />
        </svg>
      )
    }
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
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
  }

  if (metadata.mime.startsWith("image/")) {
    return (
      <div className="relative h-[72px] w-[72px] shrink-0" contentEditable={false} data-lexical-attachment="true">
        <ImagePreview
          src={metadata.url}
          alt={metadata.filename ?? metadata.display}
          filename={metadata.filename}
          className="block h-[72px] w-[72px] overflow-hidden rounded-[7px] border border-gray-200 bg-gray-100 text-left focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:border-gray-800 dark:bg-gray-950 dark:focus:ring-offset-gray-950"
          imageClassName="block h-[72px] w-[72px] object-cover"
          fallbackClassName="flex h-[72px] w-[72px] items-center justify-center rounded-[7px] border border-dashed border-gray-300 bg-gray-100 px-1 text-center text-[10px] text-gray-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-400"
        />
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            handleRemove()
          }}
          className="absolute -right-1 -top-1 flex h-[18px] w-[18px] items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 shadow-sm hover:bg-gray-100 hover:text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
          aria-label="移除附件"
          title="移除附件"
          data-tip="移除附件"
        >
          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    )
  }

  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
      contentEditable={false}
      data-lexical-attachment="true"
    >
      {getIcon()}
      <span>{metadata.display}</span>
      <span className="text-[10px] opacity-70">{formatSize(metadata.size)}</span>
      <button
        type="button"
        onClick={handleRemove}
        className="ml-0.5 flex h-[18px] w-[18px] items-center justify-center rounded hover:bg-blue-200 dark:hover:bg-blue-800/50"
        aria-label="移除附件"
        title="移除附件"
        data-tip="移除附件"
      >
        <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </span>
  )
}
