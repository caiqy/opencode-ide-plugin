import { embeddedWebGui } from "../embed.generated"

const webguiFiles = new Map<string, string>(embeddedWebGui.map((item) => [item.path, item.data]))

function contentType(path: string) {
  if (path.endsWith(".html")) return "text/html; charset=utf-8"
  if (path.endsWith(".js")) return "text/javascript; charset=utf-8"
  if (path.endsWith(".css")) return "text/css; charset=utf-8"
  if (path.endsWith(".svg")) return "image/svg+xml"
  if (path.endsWith(".json")) return "application/json; charset=utf-8"
  if (path.endsWith(".png")) return "image/png"
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg"
  if (path.endsWith(".ico")) return "image/x-icon"
  return "application/octet-stream"
}

function resolvePath(input: string) {
  const requested = input.replace(/^\/+/, "")

  if (requested.length === 0) return "index.html"
  if (requested.startsWith("api/")) return undefined
  if (webguiFiles.has(requested)) return requested

  // SPA fallback
  if (!requested.includes(".")) return "index.html"
  return undefined
}

function serveFile(path: string) {
  const data = webguiFiles.get(path)
  if (!data) return undefined
  const body = Buffer.from(data, "base64")
  const headers = new Headers({
    "Content-Type": contentType(path),
  })

  if (path.startsWith("assets/")) {
    headers.set("Cache-Control", "public, max-age=31536000, immutable")
  } else {
    headers.set("Cache-Control", "no-store")
  }

  return new Response(body, { status: 200, headers })
}

export function serveWebGuiPath(path: string) {
  const resolved = resolvePath(path)
  if (!resolved) return undefined
  return serveFile(resolved)
}
