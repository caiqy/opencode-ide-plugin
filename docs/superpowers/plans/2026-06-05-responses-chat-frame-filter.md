# Responses Chat Frame Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the ad-hoc Responses Chat Completions-format frame filter into a focused provider Module that strips all Chat Completions-format SSE frames from OpenAI/Azure `/responses` streams.

**Architecture:** Extract the filtering seam from `provider.ts` into `src/provider/responses-filter.ts`. The new Module exposes two small functions: one guard for whether the filter applies to a request, and one Response transformer for stripping `object: "chat.completion.chunk"` frames while preserving valid Responses events.

**Tech Stack:** TypeScript, Web `Response`/`ReadableStream`, Bun test, existing opencode self-export Module pattern.

---

### Task 1: Extract Responses filter Module

**Files:**

- Create: `packages/opencode/src/provider/responses-filter.ts`
- Modify: `packages/opencode/src/provider/provider.ts`
- Modify: `packages/opencode/test/provider/provider.test.ts`
- Create: `packages/opencode/test/provider/responses-filter.test.ts`

- [ ] **Step 1: Move tests into a focused test file**

Create `packages/opencode/test/provider/responses-filter.test.ts` with the helper functions from `provider.test.ts` and these cases:

```ts
import { expect, test } from "bun:test"
import { ResponsesFilter } from "@/provider/responses-filter"

function providerSseResponse(frames: string[], separator = "\n\n") {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(frames.join(separator) + separator))
        controller.close()
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  )
}

async function readProviderSse(res: Response) {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let out = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    out += decoder.decode(value, { stream: true })
  }
  return out
}

test("non-SSE responses are not filtered", async () => {
  const response = ResponsesFilter.stripChatCompletionFrames(
    new Response(
      'data: {"id":"chatcmpl-example","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":""}}]}\n\n',
      { headers: { "content-type": "application/json" } },
    ),
  )

  expect(await response.text()).toContain('"object":"chat.completion.chunk"')
})

test("filter only targets OpenAI and Azure /responses requests", () => {
  expect(ResponsesFilter.shouldApply("@ai-sdk/openai", "https://api.example.com/v1/responses")).toBe(true)
  expect(ResponsesFilter.shouldApply("@ai-sdk/azure", "https://api.example.com/openai/v1/responses")).toBe(true)
  expect(ResponsesFilter.shouldApply("@ai-sdk/openai", new URL("https://api.example.com/v1/responses"))).toBe(true)
  expect(ResponsesFilter.shouldApply("@ai-sdk/openai", { url: "https://api.example.com/v1/responses" })).toBe(true)
  expect(
    ResponsesFilter.shouldApply(
      "@ai-sdk/azure",
      "https://myresource.openai.azure.com/openai/deployments/gpt-4o/responses?api-version=2025-01-01-preview",
    ),
  ).toBe(true)
  expect(ResponsesFilter.shouldApply("@ai-sdk/openai", "https://api.example.com/v1/chat/completions")).toBe(false)
  expect(ResponsesFilter.shouldApply("@ai-sdk/openai-compatible", "https://api.example.com/v1/responses")).toBe(false)
})

test("Responses filter preserves stream terminators", async () => {
  const out = await readProviderSse(ResponsesFilter.stripChatCompletionFrames(providerSseResponse(["data: [DONE]"])))
  expect(out).toContain("data: [DONE]")
})

test("Responses filter drops chat completion frames and preserves Responses events", async () => {
  const chat = `data: ${JSON.stringify({
    id: "chatcmpl-example",
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: { role: "assistant", content: "" } }],
  })}`
  const created = `data: ${JSON.stringify({ type: "response.created", response: { id: "resp_1" } })}`
  const textDelta = `data: ${JSON.stringify({ type: "response.output_text.delta", item_id: "msg_1", delta: "Hi" })}`

  const out = await readProviderSse(
    ResponsesFilter.stripChatCompletionFrames(providerSseResponse([chat, created, textDelta])),
  )
  expect(out).not.toContain("chatcmpl-example")
  expect(out).toContain("response.created")
  expect(out).toContain("response.output_text.delta")
})

test("Responses filter drops websocket ingress zero-width frames", async () => {
  const ingress = `data: ${JSON.stringify({
    id: "chatcmpl-ws-ingress",
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: { role: "assistant", content: "\u200b" } }],
  })}`
  const created = `data: ${JSON.stringify({ type: "response.created", response: { id: "resp_1" } })}`

  const out = await readProviderSse(ResponsesFilter.stripChatCompletionFrames(providerSseResponse([ingress, created])))
  expect(out).not.toContain("chatcmpl-ws-ingress")
  expect(out).toContain("response.created")
})

test("Responses filter drops all chat completion frames regardless of content", async () => {
  const emptyContent = `data: ${JSON.stringify({
    id: "chatcmpl-real-empty",
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: { role: "assistant", content: "" } }],
  })}`
  const realContent = `data: ${JSON.stringify({
    id: "chatcmpl-real-content",
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: { content: "real text" }, finish_reason: null }],
  })}`

  const out = await readProviderSse(
    ResponsesFilter.stripChatCompletionFrames(providerSseResponse([emptyContent, realContent])),
  )
  expect(out).not.toContain("chatcmpl-real-empty")
  expect(out).not.toContain("real text")
})
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `bun test test/provider/responses-filter.test.ts`

Expected: fail because `@/provider/responses-filter` does not exist.

- [ ] **Step 3: Create the Module implementation**

Create `packages/opencode/src/provider/responses-filter.ts`:

```ts
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
```

- [ ] **Step 4: Run focused test to verify it passes**

Run: `bun test test/provider/responses-filter.test.ts`

Expected: pass.

- [ ] **Step 5: Wire provider.ts to the new Module and delete old functions**

Modify `packages/opencode/src/provider/provider.ts`:

```ts
import { ResponsesFilter } from "./responses-filter"
```

Delete the old private/exported functions:

```ts
isChatCompletionFrame
filterResponsesDummyChunks
shouldFilterResponsesDummyChunks
```

Change the provider fetch path to:

```ts
// Strip Chat Completions-format frames that third-party proxies
// inject into Responses SSE streams.
if (ResponsesFilter.shouldApply(model.api.npm, input)) {
  res = ResponsesFilter.stripChatCompletionFrames(res)
}
```

- [ ] **Step 6: Move pure filter tests out of provider.test.ts and keep provider-scope integration coverage**

Delete the old inlined Responses filter tests from `packages/opencode/test/provider/provider.test.ts`. Those cases move to `responses-filter.test.ts`, except for the provider-scope integration case described below.

```ts
non-OpenAI Responses streams are not filtered
OpenAI/Azure Responses request guard cases
Responses filter drops chat completion frames and preserves Responses events
Responses filter drops websocket ingress zero-width frames
Responses filter drops all chat completion frames regardless of content
```

Keep a provider integration test named `custom provider Responses streams are not filtered` in `provider.test.ts`. It should use a file-backed custom provider to capture `options.fetch`, call that fetch with `/responses`, and assert that a Chat Completions-format SSE payload containing `custom text` is preserved. This proves non-OpenAI/non-Azure providers are not affected by the new Module.

- [ ] **Step 7: Run verification**

Run from `packages/opencode`:

```powershell
bun test test/provider/responses-filter.test.ts
bun test test/provider/provider.test.ts
bun run typecheck
```

Expected:

- `responses-filter.test.ts`: all pass
- `provider.test.ts`: all pass
- `typecheck`: exits successfully

- [ ] **Step 8: Review diff**

Run from repo root:

```powershell
git diff -- packages/opencode/src/provider/provider.ts packages/opencode/src/provider/responses-filter.ts packages/opencode/test/provider/provider.test.ts packages/opencode/test/provider/responses-filter.test.ts docs/superpowers/plans/2026-06-05-responses-chat-frame-filter.md
```

Expected: no `DummyChunks` naming remains in source or moved tests; `provider.ts` only calls `ResponsesFilter`; no unrelated provider changes.

Do not commit unless the user explicitly requests a commit.
