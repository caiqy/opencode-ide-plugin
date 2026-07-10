import * as Diff from "diff"

export type DiffLine = { content: string; type: "added" | "removed" | "unchanged" | "empty" }

export function contentFromPatch(patch?: string): { before: string; after: string } | null {
  if (!patch) return null
  const lines = patch.split("\n")
  const hunkIndex = lines.findIndex((line) => line.startsWith("@@"))
  if (hunkIndex < 0 || lines.slice(hunkIndex + 1).some((line) => line.startsWith("@@"))) return null
  if (hunkIndex !== 0 && !(hunkIndex === 2 && /^--- .+/.test(lines[0]) && /^\+\+\+ .+/.test(lines[1]))) return null
  const hunk = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@(?: .*)?$/.exec(lines[hunkIndex])
  if (!hunk) return null
  const beforeExpected = hunk[1] === undefined ? 1 : Number(hunk[1])
  const afterExpected = hunk[2] === undefined ? 1 : Number(hunk[2])
  const before: string[] = []
  const after: string[] = []
  let changed = false
  for (const [index, line] of lines.slice(hunkIndex + 1).entries()) {
    if (index === lines.length - hunkIndex - 2 && line === "") continue
    if (line.startsWith("\\")) return null
    if (line.startsWith("-")) {
      changed = true
      before.push(line.slice(1))
      continue
    }
    if (line.startsWith("+")) {
      changed = true
      after.push(line.slice(1))
      continue
    }
    if (!line.startsWith(" ")) return null
    before.push(line.slice(1))
    after.push(line.slice(1))
  }
  if (!changed || before.length !== beforeExpected || after.length !== afterExpected) return null
  return { before: before.join("\n"), after: after.join("\n") }
}

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
