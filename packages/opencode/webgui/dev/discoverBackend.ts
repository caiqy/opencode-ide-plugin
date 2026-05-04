const defaultPorts = [4300, 4096, 4097, 4098, 4099, 4100]

type FetchResponse = {
  ok: boolean
  status: number
  headers?: { get?: (name: string) => string | null } | Record<string, string>
  json?: () => Promise<unknown>
}

type FetchLike = (input: string) => Promise<FetchResponse>

type Attempt = {
  port: number
  url: string
  reason: "connect_failed" | "http_error" | "non_json" | "invalid_shape" | "invalid_json"
  detail: string
}

type BackendTarget = {
  url: string
  port: number
  probe: string
}

function headerValue(headers: FetchResponse["headers"], name: string) {
  if (!headers) return ""
  if (typeof headers.get === "function") return headers.get(name) ?? ""
  const map = headers as Record<string, string>
  const found = map[name] ?? map[name.toLowerCase()]
  return typeof found === "string" ? found : ""
}

function isConfigShape(value: unknown) {
  if (!value || typeof value !== "object") return false
  const obj = value as Record<string, unknown>
  return "$schema" in obj || "theme" in obj || "command" in obj || "model" in obj || "provider" in obj
}

export class BackendDiscoveryError extends Error {
  attempts: Attempt[]

  constructor(attempts: Attempt[]) {
    super("No running opencode backend found on localhost")
    this.name = "BackendDiscoveryError"
    this.attempts = attempts
  }
}

export async function discoverBackend(options?: { fetch?: FetchLike; ports?: number[] }): Promise<BackendTarget> {
  const fetcher = options?.fetch ?? ((input: string) => fetch(input))
  const ports = options?.ports ?? defaultPorts
  const attempts: Attempt[] = []

  for (const port of ports) {
    const url = `http://127.0.0.1:${port}`
    const probe = `${url}/global/config`

    try {
      const response = await fetcher(probe)
      if (!response.ok) {
        attempts.push({ port, url: probe, reason: "http_error", detail: String(response.status) })
        continue
      }

      const contentType = headerValue(response.headers, "content-type")
      if (!contentType.toLowerCase().includes("application/json")) {
        attempts.push({ port, url: probe, reason: "non_json", detail: contentType || "missing content-type" })
        continue
      }

      let data: unknown
      try {
        data = await response.json?.()
      } catch (error) {
        attempts.push({
          port,
          url: probe,
          reason: "invalid_json",
          detail: error instanceof Error ? error.message : String(error),
        })
        continue
      }

      if (!isConfigShape(data)) {
        attempts.push({ port, url: probe, reason: "invalid_shape", detail: "missing config keys" })
        continue
      }

      return { url, port, probe }
    } catch (error) {
      attempts.push({
        port,
        url: probe,
        reason: "connect_failed",
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  }

  throw new BackendDiscoveryError(attempts)
}
