import { describe, expect, mock, test } from "bun:test"
import type { NamedError } from "@opencode-ai/util/error"
import { APICallError } from "ai"
import { setTimeout as sleep } from "node:timers/promises"
import type { Provider } from "../../src/provider/provider"
import { tmpdir } from "../fixture/fixture"

type APIError = import("../../src/session/message-v2").MessageV2.APIError
type User = import("../../src/session/message-v2").MessageV2.User
type Assistant = import("../../src/session/message-v2").MessageV2.Assistant

mock.module("@modelcontextprotocol/sdk/client/index.js", () => ({ Client: class {} }))
mock.module("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({ StreamableHTTPClientTransport: class {} }))
mock.module("@modelcontextprotocol/sdk/client/sse.js", () => ({ SSEClientTransport: class {} }))
mock.module("@modelcontextprotocol/sdk/client/stdio.js", () => ({ StdioClientTransport: class {} }))
mock.module("@modelcontextprotocol/sdk/client/auth.js", () => ({ UnauthorizedError: class extends Error {} }))
mock.module("@modelcontextprotocol/sdk/types.js", () => ({
  CallToolResultSchema: {},
  ToolListChangedNotificationSchema: {},
}))
mock.module("../../src/webgui/embed.generated", () => ({ embeddedWebGui: [] }))
mock.module("../../src/webgui/embed.generated.ts", () => ({ embeddedWebGui: [] }))

const { Agent } = await import("../../src/agent/agent")
const { Identifier } = await import("../../src/id/id")
const { Instance } = await import("../../src/project/instance")
const { Session } = await import("../../src/session")
const { SessionStatus } = await import("../../src/session/status")
const { LLM } = await import("../../src/session/llm")
const { SessionRetry } = await import("../../src/session/retry")
const { MessageV2 } = await import("../../src/session/message-v2")
const { SessionProcessor } = await import("../../src/session/processor")

function apiError(headers?: Record<string, string>): APIError {
  return new MessageV2.APIError({
    message: "boom",
    isRetryable: true,
    responseHeaders: headers,
  }).toObject() as APIError
}

function wrap(message: unknown): ReturnType<NamedError["toObject"]> {
  return { data: { message } } as ReturnType<NamedError["toObject"]>
}

function createModel(): Provider.Model {
  return {
    id: "test-model",
    providerID: "test",
    name: "Test",
    limit: {
      context: 100_000,
      output: 32_000,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    capabilities: {
      toolcall: true,
      attachment: false,
      reasoning: false,
      temperature: true,
      input: { text: true, image: false, audio: false, video: false },
      output: { text: true, image: false, audio: false, video: false },
    },
    api: { npm: "@ai-sdk/anthropic" },
    options: {},
  } as Provider.Model
}

describe("session.retry.delay", () => {
  test("caps delay at 30 seconds when headers missing", () => {
    const error = apiError()
    const delays = Array.from({ length: 10 }, (_, index) => SessionRetry.delay(index + 1, error))
    expect(delays).toStrictEqual([2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000, 30000, 30000])
  })

  test("prefers retry-after-ms when shorter than exponential", () => {
    const error = apiError({ "retry-after-ms": "1500" })
    expect(SessionRetry.delay(4, error)).toBe(1500)
  })

  test("uses retry-after seconds when reasonable", () => {
    const error = apiError({ "retry-after": "30" })
    expect(SessionRetry.delay(3, error)).toBe(30000)
  })

  test("accepts http-date retry-after values", () => {
    const date = new Date(Date.now() + 20000).toUTCString()
    const error = apiError({ "retry-after": date })
    const d = SessionRetry.delay(1, error)
    expect(d).toBeGreaterThanOrEqual(19000)
    expect(d).toBeLessThanOrEqual(20000)
  })

  test("ignores invalid retry hints", () => {
    const error = apiError({ "retry-after": "not-a-number" })
    expect(SessionRetry.delay(1, error)).toBe(2000)
  })

  test("ignores malformed date retry hints", () => {
    const error = apiError({ "retry-after": "Invalid Date String" })
    expect(SessionRetry.delay(1, error)).toBe(2000)
  })

  test("ignores past date retry hints", () => {
    const pastDate = new Date(Date.now() - 5000).toUTCString()
    const error = apiError({ "retry-after": pastDate })
    expect(SessionRetry.delay(1, error)).toBe(2000)
  })

  test("uses retry-after values even when exceeding 10 minutes with headers", () => {
    const error = apiError({ "retry-after": "50" })
    expect(SessionRetry.delay(1, error)).toBe(50000)

    const longError = apiError({ "retry-after-ms": "700000" })
    expect(SessionRetry.delay(1, longError)).toBe(700000)
  })

  test("sleep caps delay to max 32-bit signed integer to avoid TimeoutOverflowWarning", async () => {
    const controller = new AbortController()

    const warnings: string[] = []
    const originalWarn = process.emitWarning
    process.emitWarning = (warning: string | Error) => {
      warnings.push(typeof warning === "string" ? warning : warning.message)
    }

    const promise = SessionRetry.sleep(2_560_914_000, controller.signal)
    controller.abort()

    try {
      await promise
    } catch {}

    process.emitWarning = originalWarn
    expect(warnings.some((w) => w.includes("TimeoutOverflowWarning"))).toBe(false)
  })
})

describe("session.retry.retryable", () => {
  test("maps too_many_requests json messages", () => {
    const error = wrap(JSON.stringify({ type: "error", error: { type: "too_many_requests" } }))
    expect(SessionRetry.retryable(error)).toBe("Too Many Requests")
  })

  test("maps overloaded provider codes", () => {
    const error = wrap(JSON.stringify({ code: "resource_exhausted" }))
    expect(SessionRetry.retryable(error)).toBe("Provider is overloaded")
  })

  test("handles json messages without code", () => {
    const error = wrap(JSON.stringify({ error: { message: "no_kv_space" } }))
    expect(SessionRetry.retryable(error)).toBe(`{"error":{"message":"no_kv_space"}}`)
  })

  test("does not throw on numeric error codes", () => {
    const error = wrap(JSON.stringify({ type: "error", error: { code: 123 } }))
    const result = SessionRetry.retryable(error)
    expect(result).toBeUndefined()
  })

  test("returns undefined for non-json message", () => {
    const error = wrap("not-json")
    expect(SessionRetry.retryable(error)).toBeUndefined()
  })

  test("does not retry context overflow errors", () => {
    const error = new MessageV2.ContextOverflowError({
      message: "Input exceeds context window of this model",
      responseBody: '{"error":{"code":"context_length_exceeded"}}',
    }).toObject() as ReturnType<NamedError["toObject"]>

    expect(SessionRetry.retryable(error)).toBeUndefined()
  })

  test("does not retry gemini overflow api errors", () => {
    const cause = {
      type: "error",
      error: {
        code: "context_length_exceeded",
      },
    }
    const error = MessageV2.fromError(
      Object.assign(
        new APICallError({
          message: "Bad Request",
          url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent",
          requestBodyValues: {},
          statusCode: 400,
          responseHeaders: { "content-type": "application/json" },
          isRetryable: true,
        }),
        { cause },
      ),
      { providerID: "google" },
    ) as ReturnType<NamedError["toObject"]>

    expect(SessionRetry.retryable(error)).toBeUndefined()
  })
})

describe("session.processor context overflow boundary", () => {
  async function overflow(mode: Assistant["mode"]) {
    await using tmp = await tmpdir({ git: true })
    return Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel()
        const session = await Session.create({})
        const user = (await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: model.providerID, modelID: model.id },
        })) as User
        const assistant = (await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "assistant",
          parentID: user.id,
          modelID: model.id,
          providerID: model.providerID,
          mode,
          agent: "build",
          path: {
            cwd: tmp.path,
            root: tmp.path,
          },
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          time: { created: Date.now() },
        })) as Assistant
        const processor = SessionProcessor.create({
          assistantMessage: assistant,
          sessionID: session.id,
          model,
          abort: new AbortController().signal,
        })
        const original = LLM.stream
        LLM.stream = async () =>
          ({
            fullStream: (async function* () {
              yield {
                type: "start",
              }
              yield {
                type: "error",
                error: {
                  type: "error",
                  error: {
                    code: "context_length_exceeded",
                  },
                },
              }
            })(),
          }) as unknown as Awaited<ReturnType<typeof LLM.stream>>

        try {
          const result = await processor.process({
            user,
            agent: (await Agent.get("build"))!,
            abort: new AbortController().signal,
            sessionID: session.id,
            tools: {},
            system: [],
            messages: [],
            model,
          })

          return {
            result,
            error: processor.message.error,
            status: SessionStatus.get(session.id),
          }
        } finally {
          LLM.stream = original
        }
      },
    })
  }

  test("runtime context overflow compacts on first occurrence", async () => {
    const result = await overflow("chat")
    expect(result.result).toBe("compact")
    expect(result.error?.name).toBe("ContextOverflowError")
  })

  test("compaction mode overflow stops instead of compacting again", async () => {
    const result = await overflow("compaction")
    expect(result.result).toBe("stop")
    expect(result.error?.name).toBe("ContextOverflowError")
  })

  test("compaction mode overflow stops and restores idle status", async () => {
    const result = await overflow("compaction")
    expect(result.result).toBe("stop")
    expect(result.status).toEqual({ type: "idle" })
  })
})

describe("session.message-v2.fromError", () => {
  test.concurrent(
    "converts ECONNRESET socket errors to retryable APIError",
    async () => {
      using server = Bun.serve({
        port: 0,
        idleTimeout: 8,
        async fetch(req) {
          return new Response(
            new ReadableStream({
              async pull(controller) {
                controller.enqueue("Hello,")
                await sleep(10000)
                controller.enqueue(" World!")
                controller.close()
              },
            }),
            { headers: { "Content-Type": "text/plain" } },
          )
        },
      })

      const error = await fetch(new URL("/", server.url.origin))
        .then((res) => res.text())
        .catch((e) => e)

      const result = MessageV2.fromError(error, { providerID: "test" })

      expect(MessageV2.APIError.isInstance(result)).toBe(true)
      expect((result as APIError).data.isRetryable).toBe(true)
      expect((result as APIError).data.message).toBe("Connection reset by server")
      expect((result as APIError).data.metadata?.code).toBe("ECONNRESET")
      expect((result as APIError).data.metadata?.message).toInclude("socket connection")
    },
    15_000,
  )

  test("ECONNRESET socket error is retryable", () => {
    const error = new MessageV2.APIError({
      message: "Connection reset by server",
      isRetryable: true,
      metadata: { code: "ECONNRESET", message: "The socket connection was closed unexpectedly" },
    }).toObject() as APIError

    const retryable = SessionRetry.retryable(error)
    expect(retryable).toBeDefined()
    expect(retryable).toBe("Connection reset by server")
  })

  test("marks OpenAI 404 status codes as retryable", () => {
    const error = new APICallError({
      message: "boom",
      url: "https://api.openai.com/v1/chat/completions",
      requestBodyValues: {},
      statusCode: 404,
      responseHeaders: { "content-type": "application/json" },
      responseBody: '{"error":"boom"}',
      isRetryable: false,
    })
    const result = MessageV2.fromError(error, { providerID: "openai" }) as APIError
    expect(result.data.isRetryable).toBe(true)
  })
})
