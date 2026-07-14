# Retry Error Recovery Regression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore downstream provider-error normalization so transient stream failures remain retryable and retry banners never expose the `<none>` sentinel.

**Architecture:** Fix the source boundary in `ProviderError`: normalize `APICallError` messages and classify structured stream errors before `MessageV2` turns them into session errors. Make `SessionRetry` preserve explicit permanent classifications before its generic 5xx fallback; keep session status propagation and WebGUI rendering unchanged.

**Tech Stack:** TypeScript, Bun test, AI SDK `APICallError`, Effect-based session processing

## Global Constraints

- Preserve `APICallError.cause` response-body recovery and `ProviderV2.ID` from the current implementation.
- Do not change retry timing, WebGUI rendering, dependencies, or unrelated provider behavior.
- Run tests and type checking from `packages/opencode`, never from the repository root.
- Do not commit unless the user explicitly requests it.

## File Structure

- Modify `packages/opencode/src/provider/error.ts`: restore message normalization and structured stream-error classification.
- Modify `packages/opencode/test/provider/error.test.ts`: restore the downstream contract assertions and cover `<none>` with HTTP status fallback.
- Modify `packages/opencode/src/session/retry.ts`: keep structured permanent errors ahead of the generic 5xx retry fallback.
- Modify `packages/opencode/test/session/retry.test.ts`: cover a permanent structured error paired with HTTP 5xx.

---

### Task 1: Restore Provider Error Normalization

**Files:**
- Modify: `packages/opencode/test/provider/error.test.ts`
- Modify: `packages/opencode/src/provider/error.ts`
- Modify: `packages/opencode/test/session/retry.test.ts`
- Modify: `packages/opencode/src/session/retry.ts`

**Interfaces:**
- Consumes: `ProviderError.parseStreamError(input: unknown)` and `ProviderError.parseAPICallError(input: { providerID: ProviderV2.ID; error: APICallError })`.
- Produces: Existing `ParsedStreamError | undefined` and `ParsedAPICallError` shapes; no new public API.

- [x] **Step 1: Restore and add failing contract tests**

Replace the regressed stream-string and API-message assertions, then add focused transient, permanent, context, and sentinel cases:

```ts
test("recognizes transient string error values", () => {
  expect(ProviderError.parseStreamError({ error: "stream_read_error" })).toStrictEqual({
    type: "api_error",
    message: "stream_read_error",
    isRetryable: true,
    responseBody: JSON.stringify({ error: "stream_read_error" }),
  })
  expect(ProviderError.parseStreamError({ error: "connection_timeout", message: "Connection timed out" })).toStrictEqual({
    type: "api_error",
    message: "Connection timed out",
    isRetryable: true,
    responseBody: JSON.stringify({ error: "connection_timeout", message: "Connection timed out" }),
  })
  expect(ProviderError.parseStreamError({ error: "invalid_api_key" })).toBeUndefined()
})

test("retries transient upstream errors", () => {
  expect(
    ProviderError.parseStreamError({
      type: "error",
      error: { type: "upstream_error", code: "stream_timeout", message: "stream_timeout" },
    }),
  ).toMatchObject({ type: "api_error", message: "stream_timeout", isRetryable: true })
})

test("classifies context_too_large as context overflow", () => {
  expect(
    ProviderError.parseStreamError({
      type: "error",
      error: { code: "context_too_large", message: "Upstream rejected this request." },
    }),
  ).toMatchObject({ type: "context_overflow", message: "Upstream rejected this request." })
})

test("extracts nested error.message from response body", () => {
  const result = ProviderError.parseAPICallError({
    providerID: ProviderID.make("openai"),
    error: new APICallError({
      message: "Bad Request",
      url: "https://example.com",
      requestBodyValues: {},
      statusCode: 400,
      responseHeaders: { "content-type": "application/json" },
      responseBody: JSON.stringify({ error: { message: "no_kv_space" } }),
      isRetryable: false,
    }),
  })

  expect(result.type).toBe("api_error")
  expect(result.message).toBe("Bad Request: no_kv_space")
})

test("falls back from the API SDK none sentinel to HTTP status text", () => {
  const result = ProviderError.parseAPICallError({
    providerID: ProviderID.make("openai"),
    error: new APICallError({
      message: "<none>",
      url: "https://example.com",
      requestBodyValues: {},
      statusCode: 429,
      responseHeaders: { "retry-after": "78" },
      isRetryable: true,
    }),
  })

  expect(result).toMatchObject({
    type: "api_error",
    message: "Too Many Requests",
    statusCode: 429,
    isRetryable: true,
    responseHeaders: { "retry-after": "78" },
  })
})
```

Change the existing `context_too_large` API-call test to expect `type: "context_overflow"`, `message: "Upstream rejected this request."`, and the same `responseBody`.

- [x] **Step 2: Run the focused test and confirm the regression**

Run:

```bash
bun test test/provider/error.test.ts
```

Expected: FAIL on transient string/upstream classification, nested message extraction, `context_too_large`, and `<none>` fallback.

- [x] **Step 3: Restore the minimum production behavior**

Add the transient code set near `isOpenAiErrorRetryable`:

```ts
const TRANSIENT_STREAM_ERROR_CODES = new Set([
  "connection_timeout",
  "internal_error",
  "rate_limit_exceeded",
  "server_error",
  "server_is_overloaded",
  "stream_read_error",
  "stream_timeout",
])

function isTransientStreamErrorCode(code: unknown) {
  return typeof code === "string" && TRANSIENT_STREAM_ERROR_CODES.has(code)
}
```

Update `message(...)` so `""` and `<none>` share the existing missing-message fallback, and restore type-safe body extraction:

```ts
function message(providerID: ProviderV2.ID, e: APICallError) {
  return iife(() => {
    const msg = e.message
    const errMsg = iife(() => {
      if (!e.responseBody) return
      try {
        const body = JSON.parse(e.responseBody)
        if (typeof body.message === "string") return body.message
        if (typeof body.error?.message === "string") return body.error.message
        if (typeof body.error === "string") return body.error
      } catch {}
    })

    if (msg === "" || msg === "<none>") {
      if (errMsg) return errMsg
      if (e.statusCode) {
        const err = STATUS_CODES[e.statusCode]
        if (err) return err
      }
      return "Unknown error"
    }

    if (!e.responseBody || (e.statusCode && msg !== STATUS_CODES[e.statusCode])) return msg
    if (errMsg) return `${msg}: ${errMsg}`

    if (/^\s*<!doctype|^\s*<html/i.test(e.responseBody)) {
      if (e.statusCode === 401) {
        return "Unauthorized: request was blocked by a gateway or proxy. Your authentication token may be missing or expired — try running `opencode auth login <your provider URL>` to re-authenticate."
      }
      if (e.statusCode === 403) {
        return "Forbidden: request was blocked by a gateway or proxy. You may not have permission to access this resource — check your account and provider settings."
      }
      return msg
    }

    return `${msg}: ${e.responseBody}`
  }).trim()
}
```

Restore `parseStreamError(...)` classification while keeping its current input normalization:

```ts
export function parseStreamError(input: unknown): ParsedStreamError | undefined {
  const raw = json(input)
  const body = typeof raw?.message === "string" ? (json(raw.message) ?? raw) : raw
  if (!body) return

  const responseBody = JSON.stringify(body)
  if (body.type !== "error") {
    if (typeof body.error !== "string" || !isTransientStreamErrorCode(body.error)) return
    return {
      type: "api_error",
      message: typeof body.message === "string" ? body.message : body.error,
      isRetryable: true,
      responseBody,
    }
  }

  const code = typeof body.error?.code === "string" ? body.error.code : typeof body.code === "string" ? body.code : undefined
  const detail = typeof body.error?.message === "string" ? body.error.message : typeof body.message === "string" ? body.message : undefined
  const upstream = body.error?.type === "upstream_error" || code === "upstream_error"
  if (isTransientStreamErrorCode(code) || (upstream && (!code || code === "upstream_error"))) {
    return {
      type: "api_error",
      message: detail ?? code ?? "upstream_error",
      isRetryable: true,
      responseBody,
    }
  }

  switch (code) {
    case "context_too_large":
    case "context_length_exceeded":
      return { type: "context_overflow", message: detail ?? "Input exceeds context window of this model", responseBody }
    case "insufficient_quota":
      return { type: "api_error", message: "Quota exceeded. Check your plan and billing details.", isRetryable: false, responseBody }
    case "usage_not_included":
      return { type: "api_error", message: "To use Codex with your ChatGPT plan, upgrade to Plus: https://chatgpt.com/explore/plus.", isRetryable: false, responseBody }
    case "invalid_prompt":
    case "invalid_api_key":
      return { type: "api_error", message: detail ?? "Invalid request.", isRetryable: false, responseBody }
    case "server_is_overloaded":
    case "server_error":
      return { type: "api_error", message: detail ?? "Server error.", isRetryable: true, responseBody }
  }

  if (upstream) {
    return {
      type: "api_error",
      message: detail ?? code ?? "upstream_error",
      isRetryable: false,
      responseBody,
    }
  }
}
```

Before `SessionRetry` applies its generic 5xx fallback, parse the response body and stop when it is an explicitly permanent API error or context overflow:

```ts
const structured = ProviderError.parseStreamError(error.data.responseBody)
if (structured?.type === "context_overflow" || (structured?.type === "api_error" && !structured.isRetryable)) {
  return undefined
}
```

- [x] **Step 4: Run the provider-error test**

Run:

```bash
bun test test/provider/error.test.ts
```

Expected: all tests in `test/provider/error.test.ts` pass.

### Task 2: Verify Retry Data Flow

**Files:**
- No production changes expected.

**Interfaces:**
- Verifies `ProviderError` -> `MessageV2` -> `SessionRetry` -> `SessionStatus` behavior through existing tests.
- Produces no new API.

- [x] **Step 1: Run focused provider and session regression tests**

Run from `packages/opencode`:

```bash
bun test test/provider/error.test.ts test/session/message-v2.stream-error.test.ts test/session/retry.test.ts test/session/processor-effect.test.ts --timeout 30000
```

Expected: all selected tests pass, including transient stream errors, retry status attempts, and structured context overflow handling.

- [x] **Step 2: Run package type checking**

Run:

```bash
bun typecheck
```

Expected: exit code 0 with no TypeScript errors.

- [x] **Step 3: Inspect the final diff**

Run from the repository root:

```bash
git diff --check
git diff -- packages/opencode/src/provider/error.ts packages/opencode/src/session/retry.ts packages/opencode/test/provider/error.test.ts packages/opencode/test/session/retry.test.ts
```

Expected: no whitespace errors; the production diff is limited to restored normalization/classification and the test diff only asserts that contract.
