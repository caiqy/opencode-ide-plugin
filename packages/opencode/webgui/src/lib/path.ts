export function normalizePath(s: string): string {
  if (!s) return s
  // Normalize separators and trim a single trailing slash
  const sep = s.replaceAll("\\", "/")
  return sep.endsWith("/") ? sep.slice(0, -1) : sep
}

export function toProjectRelative(p: string, worktree: string | null | undefined): string {
  if (!p) return p
  if (!worktree) return p
  const wt = normalizePath(worktree)
  const pp = normalizePath(p)
  const prefix = wt + "/"
  if (pp.startsWith(prefix)) return pp.slice(prefix.length)
  // On Windows, drive letters may differ in case between worktree and paths
  // (e.g., "c:/" vs "C:/"). Treat drive-letter prefixes case-insensitively
  // for the purpose of project-relative detection only.
  const isDrive = /^[A-Za-z]:\//
  if (isDrive.test(wt) && isDrive.test(pp)) {
    const wtLower = wt.toLowerCase()
    const ppLower = pp.toLowerCase()
    const prefixLower = wtLower + "/"
    if (ppLower.startsWith(prefixLower)) return pp.slice(prefixLower.length)
  }
  return p
}

export function toDisplayPath(p: string | null | undefined, worktree: string | null | undefined): string {
  if (!p) return ""
  const rel = toProjectRelative(p, worktree)
  return normalizePath(rel)
}
