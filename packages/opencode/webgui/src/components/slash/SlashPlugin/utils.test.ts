import { describe, expect, test } from "vitest"
import {
  createEditor,
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $setSelection,
} from "lexical"
import { MentionNode, $createMentionNode } from "../../mention/MentionNode"
import { extractSlashQueryFromSelection } from "./utils"

function createTestEditor() {
  return createEditor({
    namespace: "slash-test",
    nodes: [MentionNode],
    onError: (e) => {
      throw e
    },
  })
}

describe("SlashPlugin utils", () => {
  test("extractSlashQueryFromSelection triggers when first paragraph starts with slash", () => {
    const editor = createTestEditor()

    const seen = { start: null as number | null, query: null as string | null }

    editor.update(() => {
      const root = $getRoot()
      root.clear()

      const p = $createParagraphNode()
      const text = $createTextNode("/in")
      p.append(text)
      root.append(p)

      const selection = $createRangeSelection()
      selection.anchor.set(text.getKey(), 3, "text")
      selection.focus.set(text.getKey(), 3, "text")
      $setSelection(selection)

      seen.query = extractSlashQueryFromSelection((o) => (seen.start = o))
    })

    expect(seen.query).toBe("in")
    expect(seen.start).toBe(0)
  })

  test("extractSlashQueryFromSelection does not trigger when slash is in second paragraph", () => {
    const editor = createTestEditor()

    const seen = { start: null as number | null, query: null as string | null }

    editor.update(() => {
      const root = $getRoot()
      root.clear()

      const p1 = $createParagraphNode()
      p1.append($createTextNode("hello"))
      const p2 = $createParagraphNode()
      const text = $createTextNode("/in")
      p2.append(text)

      root.append(p1)
      root.append(p2)

      const selection = $createRangeSelection()
      selection.anchor.set(text.getKey(), 3, "text")
      selection.focus.set(text.getKey(), 3, "text")
      $setSelection(selection)

      seen.query = extractSlashQueryFromSelection((o) => (seen.start = o))
    })

    expect(seen.query).toBe(null)
    expect(seen.start).toBe(null)
  })

  test("extractSlashQueryFromSelection does not trigger when slash is in a non-first text node", () => {
    const editor = createTestEditor()

    const seen = { start: null as number | null, query: null as string | null }

    editor.update(() => {
      const root = $getRoot()
      root.clear()

      const p = $createParagraphNode()
      const mention = $createMentionNode({ type: "file", display: "a", path: "a" })
      const text = $createTextNode("/in")
      p.append(mention)
      p.append(text)
      root.append(p)

      const selection = $createRangeSelection()
      selection.anchor.set(text.getKey(), 3, "text")
      selection.focus.set(text.getKey(), 3, "text")
      $setSelection(selection)

      seen.query = extractSlashQueryFromSelection((o) => (seen.start = o))
    })

    expect(seen.query).toBe(null)
    expect(seen.start).toBe(null)
  })
})
