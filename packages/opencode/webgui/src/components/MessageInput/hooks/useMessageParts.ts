import { useCallback } from "react"
import { $getRoot, $isElementNode, type EditorState, type LexicalEditor } from "lexical"
import { $isMentionNode } from "../../mention/MentionNode"
import { $isAttachmentNode } from "../../attachment/AttachmentNode"
import { normalizeTextAttachment } from "../../../lib/fileUtils"
import type { FilePart } from "@opencode-ai/sdk/v2/client"

interface UseMessagePartsOptions {
  editor: LexicalEditor
  resolveToAbsolutePath: (path: string | undefined) => string
}

export function useMessageParts({ editor, resolveToAbsolutePath }: UseMessagePartsOptions) {
  const extractMessageParts = useCallback((editorState: EditorState = editor.getEditorState()) => {
    let fullText = ""
    const mentions: Array<{
      type: "file" | "directory" | "agent" | "symbol"
      start: number
      end: number
      display: string
      metadata: any
    }> = []
    const attachments: Array<{
      id: string
      display: string
      filename?: string
      mime: string
      url: string
      size: number
      start: number
      end: number
      source?: FilePart["source"]
    }> = []

    editorState.read(() => {
      const root = $getRoot()

      // Process each paragraph
      const paragraphs = root.getChildren()
      for (const paragraph of paragraphs) {
        // Process direct children of the paragraph only if it's an element node
        if (!$isElementNode(paragraph)) continue

        const children = paragraph.getChildren()

        for (const child of children) {
          if ($isMentionNode(child)) {
            // This is a mention node - add it to the text and track position
            const metadata = child.getMetadata()
            const mentionText = `@${metadata.display}`
            const start = fullText.length
            fullText += mentionText
            const end = fullText.length

            // Track this mention for later
            if (metadata.type === "file" || metadata.type === "directory" || metadata.type === "symbol") {
              mentions.push({
                type: metadata.type,
                start,
                end,
                display: mentionText,
                metadata,
              })
            } else if (metadata.type === "agent") {
              mentions.push({
                type: "agent",
                start,
                end,
                display: mentionText,
                metadata,
              })
            }
          } else if ($isAttachmentNode(child)) {
            // This is an attachment node - collect for later
            const metadata = child.getMetadata()
            // Add placeholder text for attachment and track position
            const attachmentText = `[${metadata.display}]`
            const start = fullText.length
            fullText += attachmentText
            const end = fullText.length

            attachments.push({
              id: metadata.id,
              display: metadata.display,
              filename: metadata.filename,
              mime: metadata.mime,
              url: metadata.url,
              size: metadata.size,
              start,
              end,
              source: metadata.source,
            })
          } else {
            // Regular text node - add to full text
            const text = child.getTextContent ? child.getTextContent() : ""
            fullText += text
          }
        }

        // Add newline between paragraphs (except for the last one)
        if (paragraph !== paragraphs[paragraphs.length - 1]) {
          fullText += "\n"
        }
      }
    })

    // Build parts array: first the text, then file/agent parts with positions
    const parts: any[] = []

    if (fullText.trim()) {
      parts.push({
        type: "text",
        text: fullText,
      })

      // Add file/agent parts with proper source.text positions
      for (const mention of mentions) {
        if (mention.type === "file" || mention.type === "directory" || mention.type === "symbol") {
          const absolutePath = resolveToAbsolutePath(mention.metadata.path)

          const withRangeUrl = (() => {
            const toFileUrl = (start?: number, end?: number) => {
              const p = absolutePath.replaceAll("\\", "/")
              if (!p) return ""
              let base = ""
              const isDrive = /^[A-Za-z]:\//.test(p)
              const isUnc = p.startsWith("//")
              if (isDrive) {
                base = `file:///${encodeURI(p)}`
              } else if (isUnc) {
                const without = p.slice(2)
                const idx = without.indexOf("/")
                const host = idx >= 0 ? without.slice(0, idx) : without
                const rest = idx >= 0 ? without.slice(idx) : ""
                const pathPart = rest || "/"
                base = `file://${host}${encodeURI(pathPart)}`
              } else {
                const pathPart = p.startsWith("/") ? p : `/${p}`
                base = `file://${encodeURI(pathPart)}`
              }
              if (typeof start === "number" && typeof end === "number") {
                return `${base}?start=${start}&end=${end}`
              }
              return base
            }
            // Prefer explicit metadata.range if present
            const r = mention.metadata?.range
            if (r && typeof r.start?.line === "number" && typeof r.end?.line === "number") {
              const start = r.start.line
              const end = r.end.line
              return toFileUrl(start, end)
            }
            // Fallback: parse from display suffix ":a-b"
            const disp: string = mention.metadata?.display || ""
            const idx = disp.lastIndexOf(":")
            if (idx > 0) {
              const tail = disp.slice(idx + 1)
              const m = tail.match(/^(\d+)-(\d+)$/)
              if (m) {
                const start = parseInt(m[1], 10)
                const end = parseInt(m[2], 10)
                if (!Number.isNaN(start) && !Number.isNaN(end)) {
                  return toFileUrl(start, end)
                }
              }
            }
            return toFileUrl()
          })()

          parts.push({
            type: "file",
            mime: "text/plain",
            filename: mention.metadata.display,
            url: withRangeUrl,
            source:
              mention.type === "symbol"
                ? {
                    type: "symbol",
                    text: {
                      value: mention.display,
                      start: mention.start,
                      end: mention.end,
                    },
                    path: absolutePath,
                    name: mention.metadata.name,
                    range: mention.metadata.range,
                    kind: mention.metadata.kind,
                  }
                : {
                    type: "file",
                    text: {
                      value: mention.display,
                      start: mention.start,
                      end: mention.end,
                    },
                    path: absolutePath,
                  },
          })
        } else if (mention.type === "agent") {
          parts.push({
            type: "agent",
            name: mention.metadata.name,
          })
        }
      }
    }

    // Add file parts for attachments with source.text positions
    for (const attachment of attachments) {
      const normalized = normalizeTextAttachment(attachment.mime, attachment.url)
      const source = attachment.source
        ? {
            ...attachment.source,
            text: {
              value: attachment.source.text.value,
              start: attachment.start,
              end: attachment.end,
            },
          }
        : {
            type: "file" as const,
            path: attachment.filename,
            text: {
              value: `[${attachment.display}]`,
              start: attachment.start,
              end: attachment.end,
            },
          }
      parts.push({
        type: "file",
        mime: normalized.mime,
        filename: attachment.filename,
        url: normalized.url,
        source,
      })
    }

    return parts
  }, [editor, resolveToAbsolutePath])

  return { extractMessageParts }
}
