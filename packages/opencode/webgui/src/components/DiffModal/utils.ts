import * as Diff from "diff"

export type DiffLine = { content: string; type: "added" | "removed" | "unchanged" | "empty" }

export function computeDiffLines(before: string, after: string) {
  const changes = Diff.diffLines(before, after)
  const leftLines: DiffLine[] = []
  const rightLines: DiffLine[] = []

  changes.forEach((change) => {
    const lines = change.value.split("\n").filter((line, i, arr) => i < arr.length - 1 || line !== "")

    if (change.added) {
      lines.forEach((line) => {
        leftLines.push({ content: "", type: "empty" })
        rightLines.push({ content: line, type: "added" })
      })
    } else if (change.removed) {
      lines.forEach((line) => {
        leftLines.push({ content: line, type: "removed" })
        rightLines.push({ content: "", type: "empty" })
      })
    } else {
      lines.forEach((line) => {
        leftLines.push({ content: line, type: "unchanged" })
        rightLines.push({ content: line, type: "unchanged" })
      })
    }
  })

  return { leftLines, rightLines, changes }
}
