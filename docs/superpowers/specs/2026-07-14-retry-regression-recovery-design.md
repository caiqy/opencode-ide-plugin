# Retry Error Recovery Regression Design

## Problem

Commit `53ecc6ef0b` replaced downstream provider-error behavior during the July 9 upstream sync. The replacement changed tests to accept the regressions and caused retry banners to expose `APICallError`'s `<none>` sentinel. It also removed transient stream-code handling, weakened nested error-message extraction, and stopped recognizing previously supported context and authentication errors.

## Scope

Restore the downstream error-normalization contract in `packages/opencode/src/provider/error.ts` while preserving upstream additions that parse `APICallError.cause` and use `ProviderV2.ID`. Make `packages/opencode/src/session/retry.ts` respect explicitly classified permanent errors before applying its generic 5xx override. Do not add WebGUI-specific filtering: `TypingIndicator` should continue rendering the normalized retry status it receives.

## Behavior

- Treat `""` and `<none>` as missing API error messages.
- Prefer a response body's string `message`, nested `error.message`, or string `error`; otherwise fall back to the HTTP status text, then `Unknown error`.
- Restore transient stream codes and only retry `upstream_error` when its nested code is transient or absent.
- Restore `context_too_large` context-overflow handling and `invalid_api_key` non-retryable handling.
- Keep explicitly classified permanent errors non-retryable even when their HTTP status is 5xx.
- Preserve response-body recovery from `APICallError.cause` and all existing retry metadata.

## Verification

- Restore tests changed by `53ecc6ef0b` so they assert the intended downstream contract.
- Add regression cases for a retryable 429 `APICallError` with message `<none>` and for structured permanent errors paired with 5xx responses.
- Run provider-error, session retry, stream-error, and processor retry tests, followed by `bun typecheck` from `packages/opencode`.

## Non-Goals

No retry timing changes, UI redesign, new dependency, or broad provider refactor.
