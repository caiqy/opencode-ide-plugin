/**
 * Path utilities for file path manipulation
 */

/**
 * Normalize a path by converting backslashes to forward slashes and removing trailing slash
 * @example normalizePath("C:\\Users\\test\\") // => "C:/Users/test"
 * @example normalizePath("./foo/bar/") // => "./foo/bar"
 */
export function normalizePath(s: string): string {
  if (!s) return s
  // Normalize separators and trim a single trailing slash
  const sep = s.replaceAll("\\", "/")
  return sep.endsWith("/") ? sep.slice(0, -1) : sep
}

/**
 * Convert an absolute path to a project-relative path
 * @example toProjectRelative("/home/user/project/src/file.ts", "/home/user/project") // => "src/file.ts"
 */
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

/**
 * Convert a path to a display-friendly format (project-relative and normalized)
 * @example toDisplayPath("/home/user/project/src/file.ts", "/home/user/project") // => "src/file.ts"
 */
export function toDisplayPath(p: string | null | undefined, worktree: string | null | undefined): string {
  if (!p) return ""
  const rel = toProjectRelative(p, worktree)
  return normalizePath(rel)
}

/**
 * Get the directory name from a path
 * @example dirname("/home/user/file.txt") // => "/home/user"
 * @example dirname("src/components/Button.tsx") // => "src/components"
 */
export function dirname(path: string): string {
  const normalized = normalizePath(path)
  const lastSlash = normalized.lastIndexOf("/")
  if (lastSlash === -1) return "."
  if (lastSlash === 0) return "/"
  return normalized.slice(0, lastSlash)
}

/**
 * Get the basename from a path
 * @example basename("/home/user/file.txt") // => "file.txt"
 * @example basename("src/components/Button.tsx") // => "Button.tsx"
 */
export function basename(path: string): string {
  const normalized = normalizePath(path)
  const lastSlash = normalized.lastIndexOf("/")
  return lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1)
}

/**
 * Get the extension from a filename or path
 * @example extname("file.txt") // => ".txt"
 * @example extname("/home/user/file.tar.gz") // => ".gz"
 */
export function extname(path: string): string {
  const base = basename(path)
  const lastDot = base.lastIndexOf(".")
  return lastDot === -1 ? "" : base.slice(lastDot)
}

/**
 * Join path segments together
 * @example join("src", "components", "Button.tsx") // => "src/components/Button.tsx"
 * @example join("/home/user", "project") // => "/home/user/project"
 */
export function join(...segments: string[]): string {
  const parts = segments.filter(Boolean).flatMap((segment) => normalizePath(segment).split("/"))
  const filtered = parts.filter(Boolean)
  return filtered.join("/")
}
