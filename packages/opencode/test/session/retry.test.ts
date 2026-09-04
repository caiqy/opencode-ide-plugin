import { describe, expect, test } from "bun:test"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import type { NamedError } from "@opencode-ai/core/util/error"
import { APICallError } from "ai"
import { setTimeout as sleep } from "node:timers/promises"
import { Clock, Effect, Fiber, Schedule, Schema } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { SessionRetry } from "../../src/session/retry"
import { MessageV2 } from "../../src/session/message-v2"
import { ProviderError } from "../../src/provider/error"
import { it } from "../lib/effect"
import { ProviderV2 } from "@opencode-ai/core/provider"

const providerID = ProviderV2.ID.make("test")
const retryProvider = "test"

function apiError(headers?: Record<string, string>): SessionV1.APIError {
  return Schema.decodeUnknownSync(SessionV1.APIError.Schema)(
    new SessionV1.APIError({
      message: "boom",
      isRetryable: true,
      responseHeaders: headers,
    }).toObject(),
  )
}

function wrap(message: unknown): ReturnType<NamedError["toObject"]> {
  return { name: "", data: { message } }
}

function advance<A, E, R>(effect: Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const fiber = yield* effect.pipe(Effect.ignore, Effect.forkChild)
    yield* Effect.yieldNow
    yield* TestClock.adjust(121_000)
    return yield* Fiber.join(fiber)
  })
}

describe("session.retry.delay", () => {
  test("caps local backoff at 120 seconds when headers are missing", () => {
    const delays = Array.from({ length: 10 }, (_, index) => SessionRetry.delay(index + 1, 0))
    expect(delays).toStrictEqual([2000, 4000, 8000, 16000, 32000, 64000, 120000, 120000, 120000, 120000])
  })

  test("adds jitter to exponential delays", () => {
    expect(SessionRetry.delay(1, 0)).toBe(2000)
    expect(SessionRetry.delay(1, 1)).toBe(2500)
    expect(SessionRetry.delay(4, 1)).toBe(20000)
    expect(SessionRetry.delay(6, 1)).toBe(80000)
    expect(SessionRetry.delay(7, 1)).toBe(120000)
  })

  it.effect("policy updates retry status and increments attempts", () =>
    Effect.gen(function* () {
      const updates: { attempt: number; message: string }[] = []
      const error = apiError()

      const step = yield* Schedule.toStepWithMetadata(
        SessionRetry.policy({
          provider: "test",
          parse: Schema.decodeUnknownSync(SessionV1.APIError.Schema),
          set: (info) => Effect.sync(() => updates.push(info)),
        }),
      )
      yield* advance(step(error))
      yield* advance(step(error))

      expect(updates.at(-1)).toMatchObject({ attempt: 2, message: "boom" })
    }),
  )

  it.effect("policy stops after ten retries by default", () =>
    Effect.gen(function* () {
      const attempts: number[] = []
      const error = apiError()
      const step = yield* Schedule.toStepWithMetadata(
        SessionRetry.policy({
          provider: "test",
          parse: Schema.decodeUnknownSync(SessionV1.APIError.Schema),
          set: (info) =>
            Effect.sync(() => {
              attempts.push(info.attempt)
            }),
        }),
      )

      yield* Effect.forEach(Array.from({ length: SessionRetry.RETRY_MAX_RETRIES + 1 }), () => advance(step(error)))

      expect(attempts).toStrictEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    }),
  )

  it.effect("policy honors configured retry limits including zero", () =>
    Effect.gen(function* () {
      for (const [maxRetries, expected] of [
        [0, []],
        [2, [1, 2]],
      ] as const) {
        const attempts: number[] = []
        const step = yield* Schedule.toStepWithMetadata(
          SessionRetry.policy({
            provider: "test",
            maxRetries,
            parse: Schema.decodeUnknownSync(SessionV1.APIError.Schema),
            set: (info) => Effect.sync(() => attempts.push(info.attempt)),
          }),
        )

        yield* Effect.forEach(Array.from({ length: 4 }), () => advance(step(apiError())))
        expect(attempts).toStrictEqual([...expected])
      }
    }),
  )

  it.effect("independent retry policies reset attempts and delays", () =>
    Effect.gen(function* () {
      const nodes: { attempt: number; next: number }[][] = [[], []]
      const makeStep = (node: number) =>
        Schedule.toStepWithMetadata(
          SessionRetry.policy({
            provider: "test",
            parse: Schema.decodeUnknownSync(SessionV1.APIError.Schema),
            set: (info) => Effect.sync(() => nodes[node].push({ attempt: info.attempt, next: info.next })),
          }),
        )
      const first = yield* makeStep(0)
      const second = yield* makeStep(1)
      const retryAfter = apiError({ "retry-after": "60" })
      const retryAfterMs = apiError({ "retry-after-ms": "60000" })

      const starts = [yield* Clock.currentTimeMillis]
      yield* advance(first(retryAfter))
      starts.push(yield* Clock.currentTimeMillis)
      yield* advance(first(retryAfter))
      starts.push(yield* Clock.currentTimeMillis)
      yield* advance(second(retryAfterMs))

      expect(nodes.map((node) => node.map((item) => item.attempt))).toStrictEqual([[1, 2], [1]])
      expect(nodes[0][0].next - starts[0]).toBeWithin(2000, 2501)
      expect(nodes[0][1].next - starts[1]).toBeWithin(4000, 5001)
      expect(nodes[1][0].next - starts[2]).toBeWithin(2000, 2501)
    }),
  )
})

describe("session.retry.retryable", () => {
  test.each(["stream_timeout", JSON.stringify("stream_timeout")])("preserves exact stream timeout signal: %s", (message) => {
    expect(SessionRetry.retryable(wrap(message), retryProvider)).toBe("stream_timeout")
  })

  test("does not treat embedded stream_timeout text as the control signal", () => {
    expect(SessionRetry.retryable(wrap("request failed after stream_timeout"), retryProvider)).toBeUndefined()
  })

  test("retries serialized too_many_requests messages", () => {
    const error = wrap(JSON.stringify({ type: "error", error: { type: "too_many_requests" } }))
    expect(SessionRetry.retryable(error, retryProvider)).toEqual({ message: "Too Many Requests" })
  })

  test("retries serialized overloaded provider codes", () => {
    const error = wrap(JSON.stringify({ code: "resource_exhausted" }))
    expect(SessionRetry.retryable(error, retryProvider)).toEqual({ message: "Provider is overloaded" })
  })

  test("normalizes serialized rate_limit messages", () => {
    const message = JSON.stringify({ type: "error", error: { code: "rate_limit_exceeded" } })
    expect(SessionRetry.retryable(wrap(message), retryProvider)).toEqual({ message: "Rate Limited" })
  })

  test("does not retry unknown json messages", () => {
    const error = wrap(JSON.stringify({ error: { message: "no_kv_space" } }))
    expect(SessionRetry.retryable(error, retryProvider)).toBeUndefined()
  })

  test("does not throw on numeric error codes", () => {
    const error = wrap(JSON.stringify({ type: "error", error: { code: 123 } }))
    const result = SessionRetry.retryable(error, retryProvider)
    expect(result).toBeUndefined()
  })

  test("returns undefined for non-json message", () => {
    const error = wrap("not-json")
    expect(SessionRetry.retryable(error, retryProvider)).toBeUndefined()
  })

  test("does not retry unrelated numbers that happen to equal status codes", () => {
    expect(SessionRetry.retryable(wrap("Maximum output tokens 500"), retryProvider)).toBeUndefined()
  })

  test("does not retry structured permanent errors serialized in API messages", () => {
    const error = Schema.decodeUnknownSync(SessionV1.APIError.Schema)(
      new SessionV1.APIError({
        message: JSON.stringify({
          type: "error",
          error: { code: "invalid_api_key", message: "Internal server error" },
        }),
        isRetryable: false,
        statusCode: 400,
      }).toObject(),
    )

    expect(SessionRetry.retryable(error, retryProvider)).toBeUndefined()
  })

  test("retries plain text rate limit errors from Alibaba", () => {
    const msg =
      "Upstream error from Alibaba: Request rate increased too quickly. To ensure system stability, please adjust your client logic to scale requests more smoothly over time."
    const error = wrap(msg)
    expect(SessionRetry.retryable(error, retryProvider)).toEqual({ message: msg })
  })

  test("retries plain text rate limit errors", () => {
    const msg = "Rate limit exceeded, please try again later"
    const error = wrap(msg)
    expect(SessionRetry.retryable(error, retryProvider)).toEqual({ message: msg })
  })

  test("retries too many requests in plain text", () => {
    const msg = "Too many requests, please slow down"
    const error = wrap(msg)
    expect(SessionRetry.retryable(error, retryProvider)).toEqual({ message: msg })
  })

  test.each([
    "Concurrency limit exceeded for user, please retry later",
    "Concurrency limit exceeded for account, please retry later",
    "concurrency_limit_exceeded",
  ])("retries explicit concurrency limit errors: %s", (message) => {
    expect(SessionRetry.retryable(wrap(message), retryProvider)).toEqual({ message })
  })

  test("does not retry unrelated concurrency text", () => {
    expect(SessionRetry.retryable(wrap("Set the concurrency limit for user jobs"), retryProvider)).toBeUndefined()
  })

  test("retries HTTP 429 even when the SDK omitted its retryable marker", () => {
    const error = Schema.decodeUnknownSync(SessionV1.APIError.Schema)(
      new SessionV1.APIError({ message: "Too Many Requests", statusCode: 429, isRetryable: false }).toObject(),
    )
    expect(SessionRetry.retryable(error, retryProvider)).toEqual({ message: "Too Many Requests" })
  })

  test("does not retry HTTP 429 quota errors", () => {
    const error = Schema.decodeUnknownSync(SessionV1.APIError.Schema)(
      new SessionV1.APIError({
        message: "Too Many Requests",
        statusCode: 429,
        isRetryable: true,
        responseBody: JSON.stringify({ error: { type: "insufficient_quota" } }),
      }).toObject(),
    )
    expect(SessionRetry.retryable(error, retryProvider)).toBeUndefined()
  })

  test("does not retry plain insufficient quota responses", () => {
    const error = Schema.decodeUnknownSync(SessionV1.APIError.Schema)(
      new SessionV1.APIError({
        message: "Too Many Requests",
        statusCode: 429,
        isRetryable: true,
        responseBody: "insufficient_quota",
      }).toObject(),
    )
    expect(SessionRetry.retryable(error, retryProvider)).toBeUndefined()
  })

  test.each([
    [401, "Rate limit exceeded"],
    [403, "Concurrency limit exceeded for user, please retry later"],
  ])("does not retry permanent HTTP %s errors with retryable text", (statusCode, message) => {
    const error = Schema.decodeUnknownSync(SessionV1.APIError.Schema)(
      new SessionV1.APIError({ message, statusCode, isRetryable: true }).toObject(),
    )
    expect(SessionRetry.retryable(error, retryProvider)).toBeUndefined()
  })

  test.each(["authentication_error", "permission_denied"])(
    "does not retry HTTP 429 permanent provider code %s",
    (code) => {
      const error = Schema.decodeUnknownSync(SessionV1.APIError.Schema)(
        new SessionV1.APIError({
          message: "Rate limit exceeded",
          statusCode: 429,
          isRetryable: true,
          responseBody: JSON.stringify({ type: "error", error: { code, message: "Rate limit exceeded" } }),
        }).toObject(),
      )
      expect(SessionRetry.retryable(error, retryProvider)).toBeUndefined()
    },
  )

  test.each([
    "Internal server error",
    "internal error",
    "server-error",
    "Provider returned error",
    "provider-returned-error",
    "terminated",
    "fetch failed",
    "connection refused",
    "connect ECONNREFUSED",
    "request ETIMEDOUT",
    "failed to fetch",
    "EAI_AGAIN",
    "response timed out",
    "Please retry your request",
    "try your request again",
    "upstream returned status 524",
  ])("retries matching API error text: %s", (message) => {
    expect(SessionRetry.retryable(wrap(message), retryProvider)).toEqual({ message })
  })

  test("retries hyphenated service-unavailable errors", () => {
    expect(SessionRetry.retryable(wrap("service-unavailable"), retryProvider)).toEqual({
      message: "Provider is overloaded",
    })
  })

  test("matches retryable API response bodies", () => {
    const error = Schema.decodeUnknownSync(SessionV1.APIError.Schema)(
      new SessionV1.APIError({
        message: "Request failed",
        isRetryable: false,
        statusCode: 400,
        responseBody: JSON.stringify({ error: { message: "upstream connection refused" } }),
      }).toObject(),
    )
    expect(SessionRetry.retryable(error, retryProvider)).toEqual({ message: "Request failed" })
  })

  test("retries transport timeout errors", () => {
    const request = MessageV2.fromError(new ProviderError.HeaderTimeoutError(10000), { providerID })
    expect(SessionV1.APIError.isInstance(request)).toBe(true)
    expect(SessionRetry.retryable(request, retryProvider)).toEqual({
      message: "Provider response headers timed out after 10000ms",
    })
  })

  test("retries websocket stream transport errors", () => {
    const request = MessageV2.fromError(
      new ProviderError.ResponseStreamError("WebSocket closed before response.completed (code 1006: Connection ended)"),
      { providerID },
    )
    expect(SessionV1.APIError.isInstance(request)).toBe(true)
    expect(SessionRetry.retryable(request, retryProvider)).toEqual({
      message: "WebSocket closed before response.completed (code 1006: Connection ended)",
    })
  })

  test("does not retry context overflow errors", () => {
    const error = new SessionV1.ContextOverflowError({
      message: "Input exceeds context window of this model",
      responseBody: '{"error":{"code":"context_length_exceeded"}}',
    }).toObject()

    expect(SessionRetry.retryable(error, retryProvider)).toBeUndefined()
  })

  test("retries 500 errors even when isRetryable is false", () => {
    const error = Schema.decodeUnknownSync(SessionV1.APIError.Schema)(
      new SessionV1.APIError({
        message: "Internal server error",
        isRetryable: false,
        statusCode: 500,
        responseBody: '{"type":"api_error","message":"Internal server error"}',
      }).toObject(),
    )

    expect(SessionRetry.retryable(error, retryProvider)).toEqual({ message: "Internal server error" })
  })

  test("retries 502 bad gateway errors", () => {
    const error = Schema.decodeUnknownSync(SessionV1.APIError.Schema)(
      new SessionV1.APIError({
        message: "Bad gateway",
        isRetryable: false,
        statusCode: 502,
      }).toObject(),
    )

    expect(SessionRetry.retryable(error, retryProvider)).toEqual({ message: "Bad gateway" })
  })

  test("retries 503 service unavailable errors", () => {
    const error = Schema.decodeUnknownSync(SessionV1.APIError.Schema)(
      new SessionV1.APIError({
        message: "Service unavailable",
        isRetryable: false,
        statusCode: 503,
      }).toObject(),
    )

    expect(SessionRetry.retryable(error, retryProvider)).toEqual({ message: "Service unavailable" })
  })

  test("does not retry 4xx errors when isRetryable is false", () => {
    const error = Schema.decodeUnknownSync(SessionV1.APIError.Schema)(
      new SessionV1.APIError({
        message: "Bad request",
        isRetryable: false,
        statusCode: 400,
      }).toObject(),
    )

    expect(SessionRetry.retryable(error, retryProvider)).toBeUndefined()
  })

  test("does not let a 5xx status override a structured permanent error", () => {
    const error = Schema.decodeUnknownSync(SessionV1.APIError.Schema)(
      new SessionV1.APIError({
        message: "Invalid API key",
        isRetryable: false,
        statusCode: 500,
        responseBody: JSON.stringify({
          type: "error",
          error: { code: "invalid_api_key", message: "Invalid API key" },
        }),
      }).toObject(),
    )

    expect(SessionRetry.retryable(error, retryProvider)).toBeUndefined()
  })

  test("retries ZlibError decompression failures", () => {
    const error = Schema.decodeUnknownSync(SessionV1.APIError.Schema)(
      new SessionV1.APIError({
        message: "Response decompression failed",
        isRetryable: true,
        metadata: { code: "ZlibError" },
      }).toObject(),
    )

    const retryable = SessionRetry.retryable(error, retryProvider)
    expect(retryable).toBeDefined()
    expect(retryable).toEqual({ message: "Response decompression failed" })
  })

  test("maps free limits to Go upsell action", () => {
    const error = Schema.decodeUnknownSync(SessionV1.APIError.Schema)(
      new SessionV1.APIError({
        message: "Free usage exceeded",
        isRetryable: true,
        statusCode: 429,
        responseBody: JSON.stringify({
          type: "error",
          error: { type: "FreeUsageLimitError", message: "Free usage exceeded" },
        }),
      }).toObject(),
    )

    expect(SessionRetry.retryable(error, "opencode")).toEqual({
      message: SessionRetry.GO_UPSELL_MESSAGE,
      action: {
        reason: "free_tier_limit",
        provider: "opencode",
        title: "Free limit reached",
        message: "Subscribe to OpenCode Go for reliable access to the best open-source models, starting at $5/month.",
        label: "subscribe",
        link: SessionRetry.GO_UPSELL_URL,
      },
    })
  })

  test("maps Go subscription limits to workspace PAYG upsell", () => {
    const error = Schema.decodeUnknownSync(SessionV1.APIError.Schema)(
      new SessionV1.APIError({
        message: "Subscription quota exceeded. You can continue using free models.",
        isRetryable: true,
        statusCode: 429,
        responseHeaders: {
          "retry-after": "19380",
        },
        responseBody: JSON.stringify({
          type: "error",
          error: {
            type: "GoUsageLimitError",
            message: "Subscription quota exceeded. You can continue using free models.",
          },
          metadata: {
            workspace: "wrk_01K6XGM22R6FM8JVABE9XDQXGH",
            limitName: "5 hour",
          },
        }),
      }).toObject(),
    )

    expect(SessionRetry.retryable(error, "opencode-go")).toEqual({
      message:
        "5 hour usage limit reached. It will reset in 5 hours 23 minutes. To continue using this model now, enable usage from your available balance - https://opencode.ai/workspace/wrk_01K6XGM22R6FM8JVABE9XDQXGH/go",
      action: {
        reason: "account_rate_limit",
        provider: "opencode-go",
        title: "Go limit reached",
        message:
          "5 hour usage limit reached. It will reset in 5 hours 23 minutes. To continue using this model now, enable usage from your available balance",
        label: "open settings",
        link: "https://opencode.ai/workspace/wrk_01K6XGM22R6FM8JVABE9XDQXGH/go",
      },
    })
  })

  test("maps Go subscription limits without limit metadata", () => {
    const error = Schema.decodeUnknownSync(SessionV1.APIError.Schema)(
      new SessionV1.APIError({
        message: "Subscription quota exceeded. You can continue using free models.",
        isRetryable: true,
        statusCode: 429,
        responseHeaders: {
          "retry-after": "900",
        },
        responseBody: JSON.stringify({
          type: "error",
          error: {
            type: "GoUsageLimitError",
            message: "Subscription quota exceeded. You can continue using free models.",
          },
          metadata: {
            workspace: "wrk_01K6XGM22R6FM8JVABE9XDQXGH",
          },
        }),
      }).toObject(),
    )

    const retry = SessionRetry.retryable(error, "opencode-go")
    expect(retry === "stream_timeout" ? undefined : retry?.action?.message).toBe(
      "Usage limit reached. It will reset in 15 minutes. To continue using this model now, enable usage from your available balance",
    )
  })
})

describe("session.message-v2.fromError", () => {
  test.concurrent(
    "converts ECONNRESET socket errors to retryable APIError",
    async () => {
      using server = Bun.serve({
        port: 0,
        idleTimeout: 8,
        async fetch(_req) {
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

      const result = MessageV2.fromError(error, { providerID })

      expect(SessionV1.APIError.isInstance(result)).toBe(true)
      if (!SessionV1.APIError.isInstance(result)) throw new Error("expected APIError")
      expect(result.data.isRetryable).toBe(true)
      expect(result.data.message).toBe("Connection reset by server")
      expect(result.data.metadata?.code).toBe("ECONNRESET")
      expect(result.data.metadata?.message).toInclude("socket connection")
    },
    15_000,
  )

  test("ECONNRESET socket error is retryable", () => {
    const error = Schema.decodeUnknownSync(SessionV1.APIError.Schema)(
      new SessionV1.APIError({
        message: "Connection reset by server",
        isRetryable: true,
        metadata: { code: "ECONNRESET", message: "The socket connection was closed unexpectedly" },
      }).toObject(),
    )

    const retryable = SessionRetry.retryable(error, retryProvider)
    expect(retryable).toBeDefined()
    expect(retryable).toEqual({ message: "Connection reset by server" })
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
    const result = MessageV2.fromError(error, { providerID: ProviderV2.ID.make("openai") })
    if (!SessionV1.APIError.isInstance(result)) throw new Error("expected APIError")
    expect(result.data.isRetryable).toBe(true)
  })

  test("converts OpenAI server_error stream chunks to retryable APIError", () => {
    const result = MessageV2.fromError(
      {
        message: JSON.stringify({
          type: "error",
          sequence_number: 2,
          error: {
            type: "server_error",
            code: "server_error",
            message: "An error occurred while processing your request.",
            param: null,
          },
        }),
      },
      { providerID: ProviderV2.ID.make("openai") },
    )

    expect(SessionV1.APIError.isInstance(result)).toBe(true)
    if (!SessionV1.APIError.isInstance(result)) throw new Error("expected APIError")
    expect(result.data.isRetryable).toBe(true)
    expect(SessionRetry.retryable(result, retryProvider)).toEqual({
      message: "An error occurred while processing your request.",
    })
  })
})
