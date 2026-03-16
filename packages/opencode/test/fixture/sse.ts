type EventChunk = {
  event: string
  data: unknown
}

function isEventChunk(chunk: unknown): chunk is EventChunk {
  if (!chunk || typeof chunk !== "object") return false
  const rec = chunk as Record<string, unknown>
  return typeof rec.event === "string" && "data" in rec
}

export function createEventStream(chunks: unknown[], includeDone = false) {
  const lines = chunks.map((chunk) => {
    if (isEventChunk(chunk)) {
      const data = typeof chunk.data === "string" ? chunk.data : JSON.stringify(chunk.data)
      return `event: ${chunk.event}\ndata: ${data}`
    }
    return `data: ${typeof chunk === "string" ? chunk : JSON.stringify(chunk)}`
  })
  if (includeDone) lines.push("data: [DONE]")
  const payload = lines.join("\n\n") + "\n\n"
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < payload.length; i += 37) {
        controller.enqueue(encoder.encode(payload.slice(i, i + 37)))
      }
      controller.close()
    },
  })
}

export function createEventResponse(chunks: unknown[], includeDone = false) {
  return new Response(createEventStream(chunks, includeDone), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  })
}
