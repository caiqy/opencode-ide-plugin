// DnD helpers for VSCode/JCEF webviews

function fileUrlToPath(uri: string): string | null {
  try {
    const u = new URL(uri)
    // Accept file://, vscode-remote://, wsl:// and similar IDE schemes
    const raw = decodeURIComponent(u.pathname)
    if (!raw || raw === "/") return null
    // Normalize Windows drive-letter paths like "/C:/foo" -> "C:/foo" while
    // leaving POSIX paths ("/home/user") untouched.
    if (/^\/[A-Za-z]:[\\/]/.test(raw)) return raw.slice(1)
    return raw
  } catch {
    return null
  }
}

function looksLikeDirectoryPath(p: string): boolean {
  return /[\\\/]$/.test(p)
}

export function extractPathsFromDrop(ev: DragEvent): string[] {
  const dt = ev.dataTransfer as DataTransfer | null
  if (!dt) return []

  const types: string[] = (dt as any).types ? Array.from((dt as any).types) : []
  const hasFileTypes =
    types.includes("application/vnd.code.uri-list") ||
    types.includes("text/uri-list") ||
    types.includes("application/vnd.code.tree.explorer")

  const collected: string[] = []

  // Prefer DataTransferItem-based extraction (skip directories when detectable)
  try {
    const items = dt.items as any as DataTransferItemList | undefined
    if (items && items.length > 0) {
      const fileItems: any[] = []
      for (let i = 0; i < items.length; i++) {
        const it: any = items[i]
        if (it && it.kind === "file") fileItems.push(it)
      }
      if (fileItems.length > 0) {
        for (let idx = 0; idx < fileItems.length; idx++) {
          const it: any = fileItems[idx]
          try {
            const getEntry = (it as any).webkitGetAsEntry || (it as any).getAsEntry
            const entry = typeof getEntry === "function" ? getEntry.call(it) : null
            if (entry && entry.isDirectory) continue
            const f = typeof it.getAsFile === "function" ? it.getAsFile() : null
            const p = f && typeof (f as any).path === "string" ? (f as any).path : null
            if (p) collected.push(p)
          } catch {}
        }
      }
      if (collected.length > 0) return collected
    }
  } catch {}

  const paths: string[] = []

  // VSCode uri-list
  try {
    let uriList = dt.getData("text/uri-list")
    if (!uriList) uriList = dt.getData("application/vnd.code.uri-list")
    if (uriList) {
      uriList.split(/\r?\n/).forEach((line) => {
        const s = line.trim()
        if (!s || s.startsWith("#")) return
        const p = fileUrlToPath(s)
        if (p && !looksLikeDirectoryPath(p)) paths.push(p)
      })
    }
  } catch {}

  // VSCode explorer tree
  try {
    const explorerType = "application/vnd.code.tree.explorer"
    if (types.includes(explorerType)) {
      const explorerData = dt.getData(explorerType)
      if (explorerData) {
        try {
          const parsed = JSON.parse(explorerData)
          if (Array.isArray(parsed) && parsed.length > 0) {
            for (const item of parsed) {
              const uri = (item && (item.uri || (item.resource && item.resource.uri))) || null
              if (typeof uri === "string") {
                const p = fileUrlToPath(uri)
                if (p && !looksLikeDirectoryPath(p)) paths.push(p)
              }
            }
          }
        } catch {}
      }
    }
  } catch {}

  // Fallback to text/plain or generic text
  if (paths.length === 0) {
    try {
      const txt = (!hasFileTypes && (dt.getData("text") || dt.getData("text/plain"))) || ""
      if (txt) {
        txt.split(/\r?\n/).forEach((line) => {
          const s = line.trim()
          if (!s) return
          if (/^file:\/\//i.test(s)) {
            const p = fileUrlToPath(s)
            if (p && !looksLikeDirectoryPath(p)) paths.push(p)
          } else if (/^[A-Za-z]:\\|^\\\\/.test(s) || s.startsWith("/")) {
            if (!looksLikeDirectoryPath(s)) paths.push(s)
          }
        })
      }
    } catch {}
  }

  // Final fallback: dt.files, skipping directories when possible
  if (paths.length === 0 && dt.files && dt.files.length > 0) {
    try {
      const items = dt.items as any as DataTransferItemList | undefined
      for (let i = 0; i < dt.files.length; i++) {
        if (items && items[i]) {
          try {
            const getEntry = (items[i] as any).webkitGetAsEntry || (items[i] as any).getAsEntry
            const entry = typeof getEntry === "function" ? getEntry.call(items[i]) : null
            if (entry && entry.isDirectory) continue
          } catch {}
        }
        const f: any = dt.files[i]
        if (typeof f.path === "string" && f.path && !looksLikeDirectoryPath(f.path)) paths.push(f.path)
      }
    } catch {
      for (let i = 0; i < dt.files.length; i++) {
        const f: any = dt.files[i]
        if (typeof f.path === "string" && f.path && !looksLikeDirectoryPath(f.path)) paths.push(f.path)
      }
    }
  }

  return paths
}

export function initGlobalDnD(): void {
  if ((document as any).__globalDnDBound) return
  document.addEventListener("dragover", (ev) => {
    try {
      ev.preventDefault()
    } catch {}
  })
  document.addEventListener("drop", (ev) => {
    try {
      ev.preventDefault()
      ev.stopPropagation()
    } catch {}
  })
  ;(document as any).__globalDnDBound = true
}
