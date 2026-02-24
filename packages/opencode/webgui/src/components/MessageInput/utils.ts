import {
  $getRoot,
  $createParagraphNode,
  $createTextNode,
  $getSelection,
  $isRangeSelection,
  type LexicalEditor,
} from "lexical"
import { $createMentionNode } from "../mention/MentionNode"

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
