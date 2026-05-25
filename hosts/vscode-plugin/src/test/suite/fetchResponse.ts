export function testResponse(
  body: string | Uint8Array | Buffer,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  const status = init.status ?? 200
  const bytes = typeof body === "string" ? Buffer.from(body) : Buffer.from(body)

  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map(Object.entries(init.headers ?? {})) as unknown as Headers,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    json: async () => JSON.parse(bytes.toString("utf8")) as unknown,
    text: async () => bytes.toString("utf8"),
  } as Response
}
