export type SlashItem = {
  id: string
  kind: "command" | "skill"
  name: string
  description?: string
  source?: "command" | "mcp" | "skill"
}

export function extractSlashQuery(beforeCursor: string): string | null {
  if (!beforeCursor.startsWith("/")) return null
  const query = beforeCursor.slice(1)
  if (/\s/.test(query)) return null
  return query
}

export function makeSlashInsert(item: Pick<SlashItem, "kind" | "name">): string {
  if (item.kind === "command") return `/${item.name} `
  return `Load the "${item.name}" skill and follow its instructions.`
}

export function filterSlashItems(items: SlashItem[], query: string): SlashItem[] {
  const q = query.trim().toLowerCase()
  const kindScore = (kind: SlashItem["kind"]) => (kind === "command" ? 0 : 1)
  const nameSort = (a: SlashItem, b: SlashItem) => a.name.localeCompare(b.name)
  if (!q) {
    return [...items].sort((a, b) => {
      const ks = kindScore(a.kind) - kindScore(b.kind)
      if (ks !== 0) return ks
      return nameSort(a, b)
    })
  }

  const hit = (item: SlashItem) => {
    const name = item.name.toLowerCase()
    const desc = (item.description ?? "").toLowerCase()
    if (name.startsWith(q)) return 0
    if (name.includes(q)) return 1
    if (desc.includes(q)) return 2
    return null
  }

  return items
    .map((item) => {
      const score = hit(item)
      return score === null ? null : { item, score }
    })
    .filter((x) => x !== null)
    .sort((a, b) => {
      if (!a || !b) return 0
      const s = a.score - b.score
      if (s !== 0) return s
      const ks = kindScore(a.item.kind) - kindScore(b.item.kind)
      if (ks !== 0) return ks
      return nameSort(a.item, b.item)
    })
    .map((x) => (x ? x.item : null))
    .filter((x) => x !== null)
}
