function isChatCompletionFrame(data: string): boolean {
  // `[DONE]` is a stream terminator, not a Chat Completions frame.
  if (data === "[DONE]") return false
  let json: Record<string, unknown>
  try {
    const parsed = JSON.parse(data)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false
    json = parsed
  } catch {
    return false
  }
  return json.object === "chat.completion.chunk"
}

export function stripChatCompletionFrames(res: Response): Response {
  if (!res.body) return res
  if (!res.headers.get("content-type")?.includes("text/event-stream")) return res

  let buf = ""
  const body = res.body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(
      new TransformStream<string, string>({
        transform(chunk, ctrl) {
          buf += chunk
          const parts = buf.split(/\r?\n\r?\n/)
          buf = parts.pop() ?? ""
          for (const part of parts) {
            const trimmed = part.trim()
            if (!trimmed) continue
            const dataLine = trimmed
              .split(/\r?\n/)
              .find((line) => line.startsWith("data: ") || line.startsWith("data:"))
            if (dataLine) {
              const payload = dataLine.startsWith("data: ") ? dataLine.slice(6) : dataLine.slice(5)
              if (isChatCompletionFrame(payload)) continue
            }
            ctrl.enqueue(`${part}\n\n`)
          }
        },
        flush(ctrl) {
          if (buf.trim().length > 0) {
            const dataLine = buf
              .trim()
              .split(/\r?\n/)
              .find((line) => line.startsWith("data: ") || line.startsWith("data:"))
            if (dataLine) {
              const payload = dataLine.startsWith("data: ") ? dataLine.slice(6) : dataLine.slice(5)
              if (isChatCompletionFrame(payload)) return
            }
            ctrl.enqueue(buf)
          }
        },
      }),
    )
    .pipeThrough(new TextEncoderStream())

  return new Response(body, {
    headers: new Headers(res.headers),
    status: res.status,
    statusText: res.statusText,
  })
}

export function shouldApply(modelApiNpm: string, input: unknown): boolean {
  // Only OpenAI/Azure Responses requests need this compatibility filter;
  // other provider adapters may legitimately stream Chat Completions frames.
  if (modelApiNpm !== "@ai-sdk/openai" && modelApiNpm !== "@ai-sdk/azure") return false
  const inputUrl =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input && typeof input === "object" && "url" in input && typeof input.url === "string"
          ? input.url
          : ""
  if (!inputUrl) return false
  try {
    return new URL(inputUrl).pathname.endsWith("/responses")
  } catch {
    return inputUrl.endsWith("/responses")
  }
}

export * as ResponsesFilter from "./responses-filter"
