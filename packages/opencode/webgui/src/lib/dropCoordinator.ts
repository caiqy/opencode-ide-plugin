type DropCoordinatorInput = {
  files?: readonly string[]
  directories?: readonly string[]
}

type DropCoordinatorOptions = {
  focus?: () => void
  insertPaths: (paths: string[]) => void
  pastePath: (path: string) => void
  now?: () => number
  dedupeMs?: number
}

function clean(value: string) {
  return value.trim()
}

function dedupeKey(kind: "file" | "directory", path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/^([A-Z]):/, (_, drive: string) => `${drive.toLowerCase()}:`)
  return `${kind}:${normalized}`
}

function unique(values: readonly string[] | undefined) {
  return [...new Set((values ?? []).map(clean).filter((value) => value.length > 0))]
}

export function createDropCoordinator(options: DropCoordinatorOptions) {
  const recent = new Map<string, number>()
  const dedupeMs = options.dedupeMs ?? 1200
  const now = options.now ?? (() => Date.now())

  const consume = (input: DropCoordinatorInput) => {
    const at = now()
    recent.forEach((seenAt, key) => {
      if (at - seenAt > dedupeMs) recent.delete(key)
    })

    const files = unique(input.files).filter((path) => {
      const key = dedupeKey("file", path)
      const seenAt = recent.get(key)
      if (seenAt !== undefined && at - seenAt <= dedupeMs) return false
      recent.set(key, at)
      return true
    })
    const directories = unique(input.directories).filter((path) => {
      const key = dedupeKey("directory", path)
      const seenAt = recent.get(key)
      if (seenAt !== undefined && at - seenAt <= dedupeMs) return false
      recent.set(key, at)
      return true
    })

    if (files.length === 0 && directories.length === 0) return false

    options.focus?.()
    if (files.length > 0) options.insertPaths(files)
    directories.forEach((path) => options.pastePath(path))
    return true
  }

  return { consume }
}
