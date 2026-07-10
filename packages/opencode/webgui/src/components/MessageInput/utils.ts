import {
  $getRoot,
  $createParagraphNode,
  $createTextNode,
  $getSelection,
  $isRangeSelection,
  type LexicalNode,
  type LexicalEditor,
} from "lexical"
import { $createMentionNode } from "../mention/MentionNode"
import { $createAttachmentNode } from "../attachment/AttachmentNode"
import { type Draft, type DraftPart } from "../../state/repo/draftRepo"

export function insertPlainWithMentionsImpl(
  editor: LexicalEditor,
  parseWithRange: (val: string) => { display: string; path: string; range?: { start: number; end: number } },
  plain: string,
  options?: { replace?: boolean },
) {
  editor.update(() => {
    if (options?.replace) {
      const root = $getRoot()
      root.clear()
      const paragraph = $createParagraphNode()
      root.append(paragraph)
      paragraph.select()
    }
    if (!plain) return
    const selection = $getSelection()
    if (!$isRangeSelection(selection)) return
    const nodes: any[] = []
    const re = /@(\S+)/g
    let last = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(plain)) !== null) {
      const start = m.index
      const end = re.lastIndex
      if (start > last) {
        const chunk = plain.slice(last, start)
        if (chunk) nodes.push($createTextNode(chunk))
      }
      const token = m[1]
      const parsed = parseWithRange(token)
      const isDir = token.endsWith("/")
      const md: any = isDir
        ? { type: "directory" as const, display: token, path: token.endsWith("/") ? token : token + "/" }
        : (() => {
            const relBase = parsed.path
            const display = parsed.range ? `${relBase}:${parsed.range.start}-${parsed.range.end}` : relBase
            const base: any = { type: "file" as const, display, path: relBase }
            if (parsed.range)
              base.range = {
                start: { line: parsed.range.start, character: 0 },
                end: { line: parsed.range.end, character: 0 },
              }
            return base
          })()
      nodes.push($createMentionNode(md))
      last = end
    }
    if (last < plain.length) {
      const chunk = plain.slice(last)
      if (chunk) nodes.push($createTextNode(chunk))
    }
    if (nodes.length > 0) selection.insertNodes(nodes)
  })
}

export function restoreDraftImpl(editor: LexicalEditor, draft: Exclude<Draft, string>) {
  editor.update(() => {
    const root = $getRoot()
    root.clear()
    const paragraph = $createParagraphNode()
    root.append(paragraph)
    const nodes: LexicalNode[] = []
    for (const part of draft.parts) {
      if (part.type === "text") {
        const inline = draft.parts
          .flatMap((item) => {
            const source = sourceText(item) ?? sourceLessAgentText(item, draft)
            if (!source || !matchesSourceText(item, part.text, source)) return []
            return [{ part: item, start: source.start, end: source.end }]
          })
          .sort((a, b) => a.start - b.start)
        let cursor = 0
        for (const item of inline) {
          if (item.start > cursor) nodes.push($createTextNode(part.text.slice(cursor, item.start)))
          const node = draftNode(item.part)
          if (node) nodes.push(node)
          cursor = item.end
        }
        if (cursor < part.text.length) nodes.push($createTextNode(part.text.slice(cursor)))
        continue
      }
      const source = sourceText(part) ?? sourceLessAgentText(part, draft)
      const embedded = source && draft.parts.some((text) => text.type === "text" && matchesSourceText(part, text.text, source))
      if (embedded) continue
      if (part.type === "agent" && !part.source) continue
      const node = draftNode(part)
      if (node) nodes.push(node)
    }
    paragraph.append(...nodes)
    paragraph.select()
  })
}

function draftNode(part: DraftPart): LexicalNode | undefined {
  if (part.type === "agent") {
    return $createMentionNode({ type: "agent", display: part.name, name: part.name })
  }
  if (part.type !== "file") return undefined
  if (!part.source || part.source.type === "resource") {
    return $createAttachmentNode({
      id: crypto.randomUUID(),
      display: part.filename || (part.source?.type === "resource" ? part.source.uri : "Attachment"),
      filename: part.filename,
      mime: part.mime,
      url: part.url,
      size: 0,
      source: part.source,
    })
  }
  if (part.source.type === "file" && /^\[.*\]$/.test(part.source.text.value)) {
    const display = part.source.text.value.slice(1, -1)
    return $createAttachmentNode({
      id: crypto.randomUUID(),
      display,
      filename: part.filename || part.source.path,
      mime: part.mime,
      url: part.url,
      size: 0,
      source: part.source,
    })
  }
  if (part.source.type === "file") {
    return $createMentionNode({ type: "file", display: part.source.text.value.replace(/^@/, ""), path: part.source.path })
  }
  if (part.source.type === "symbol") {
    return $createMentionNode({
      type: "symbol",
      display: part.source.text.value.replace(/^@/, ""),
      path: part.source.path,
      name: part.source.name,
      range: part.source.range,
      kind: part.source.kind,
    })
  }
  return undefined
}

function sourceText(part: DraftPart) {
  if (part.type === "agent") return part.source
  if (part.type === "file") return part.source?.text
}

function sourceLessAgentText(part: DraftPart, draft: Exclude<Draft, string>) {
  if (part.type !== "agent" || part.source) return
  const value = `@${part.name}`
  const matches = draft.parts.flatMap((item) => {
    if (item.type !== "text") return []
    const start = item.text.indexOf(value)
    if (start < 0 || start !== item.text.lastIndexOf(value)) return []
    return [{ start, end: start + value.length, value }]
  })
  if (matches.length !== 1) return
  return matches[0]
}

function matchesSourceText(part: DraftPart, text: string, source: { value: string; start: number; end: number }) {
  if (source.end > text.length) return false
  const value = part.type === "file" && part.source?.type === "resource" ? `[${part.filename || part.source.uri}]` : source.value
  return text.slice(source.start, source.end) === value
}
