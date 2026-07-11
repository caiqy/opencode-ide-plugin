# Hide Max When Ultra Is Available

## Goal

Remove the duplicate `max` UI variant when a GPT-5.6 model offers `ultra`.

## Decision

- `gpt-5.6`, GPT-5.6 Sol, and GPT-5.6 Terra expose `none`, `low`, `medium`, `high`, `xhigh`, and `ultra`.
- GPT-5.6 Luna continues to expose `none`, `low`, `medium`, `high`, `xhigh`, and `max`.
- `ultra` remains a stored variant key and continues to map to the OpenAI wire effort `max`.

This is a selector simplification. OpenAI supports `max` for the GPT-5.6 family, but showing both `max` and `ultra` would present two choices with the same request effort in this application.

## Implementation

Update only the GPT-5.6 effort constants in `packages/opencode/src/provider/transform.ts`. Keep the ID matching, provider body shapes, `openAIWireEffort`, WebGUI label mapping, and generic effort schema unchanged.

Update the existing provider matrix tests to assert the revised Sol, Terra, alias, dated-snapshot, and Luna variant key order. Keep the existing wire-body assertions: an `ultra` variant must still send `max`.

## Verification

Run `bun test test/provider/transform.test.ts test/provider/cf-ai-gateway-e2e.test.ts` and `bun typecheck` from `packages/opencode`.
