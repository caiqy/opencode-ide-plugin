import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { IdeHostBridge } from "../../src/acp/host-bridge"

describe("IdeHostBridge service", () => {
  test("reports unconfigured when url and token are missing", () => {
    const origUrl = process.env.OPENCODE_IDE_BRIDGE_URL
    const origToken = process.env.OPENCODE_IDE_BRIDGE_TOKEN
    delete process.env.OPENCODE_IDE_BRIDGE_URL
    delete process.env.OPENCODE_IDE_BRIDGE_TOKEN

    try {
      const bridge = IdeHostBridge.defaultService
      expect(bridge.isConfigured()).toBe(false)
    } finally {
      if (origUrl) process.env.OPENCODE_IDE_BRIDGE_URL = origUrl
      if (origToken) process.env.OPENCODE_IDE_BRIDGE_TOKEN = origToken
    }
  })

  test("can register credentials and update state", () => {
    const bridge = IdeHostBridge.defaultService
    bridge.register("http://127.0.0.1:4567/idebridge/test-session", "test-token")
    expect(bridge.isConfigured()).toBe(true)
  })

  test("layer provides mockable interface", async () => {
    const mockService: IdeHostBridge.Interface = {
      isConfigured: () => true,
      register: () => {},
      getCapabilities: () =>
        Effect.succeed({
          categories: [
            {
              id: "intellij",
              name: "IntelliJ IDEA",
              tools: [
                {
                  id: "executeAction",
                  name: "运行内置 Action",
                  parametersSchema: {
                    type: "object",
                    properties: { actionId: { type: "string" } },
                    required: ["actionId"],
                  },
                },
              ],
            },
          ],
        }),
      executeTool: (cat, tool, params) =>
        Effect.succeed({ output: `Executed ${cat}/${tool} with ${JSON.stringify(params)}` }),
    }

    const testLayer = Layer.succeed(IdeHostBridge.Service, mockService)
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* IdeHostBridge.Service
        const caps = yield* svc.getCapabilities()
        const exec = yield* svc.executeTool("intellij", "executeAction", { actionId: "SaveAll" })
        return { caps, exec }
      }).pipe(Effect.provide(testLayer)),
    )

    expect(result.caps?.categories[0].id).toBe("intellij")
    expect(result.exec.output).toBe(`Executed intellij/executeAction with {"actionId":"SaveAll"}`)
  })

  test("executeTool propagates abortSignal when provided", async () => {
    let capturedSignal: AbortSignal | undefined

    const mockService: IdeHostBridge.Interface = {
      isConfigured: () => true,
      register: () => {},
      getCapabilities: () => Effect.succeed(null),
      executeTool: (cat, tool, params, abort) => {
        capturedSignal = abort
        return Effect.succeed({ output: "aborted check ok" })
      },
    }

    const controller = new AbortController()
    const testLayer = Layer.succeed(IdeHostBridge.Service, mockService)

    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* IdeHostBridge.Service
        yield* svc.executeTool("vscode", "editor", { path: "/a.ts" }, controller.signal)
      }).pipe(Effect.provide(testLayer)),
    )

    expect(capturedSignal).toBe(controller.signal)
  })

  test("validates loopback bridge URL correctly", () => {
    expect(IdeHostBridge.isValidBridgeUrl("http://127.0.0.1:4000/idebridge/session-123")).toBe(true)
    expect(IdeHostBridge.isValidBridgeUrl("http://localhost:3000/idebridge/session_abc")).toBe(true)
    expect(IdeHostBridge.isValidBridgeUrl("http://[::1]:3000/idebridge/session_abc")).toBe(true)
    // Non-loopback rejected
    expect(IdeHostBridge.isValidBridgeUrl("http://192.168.1.100:4000/idebridge/session-1")).toBe(false)
    expect(IdeHostBridge.isValidBridgeUrl("http://evil.com/idebridge/session-1")).toBe(false)
    // Credentials, query, or fragment rejected
    expect(IdeHostBridge.isValidBridgeUrl("http://user:pass@127.0.0.1:4000/idebridge/session-1")).toBe(false)
    expect(IdeHostBridge.isValidBridgeUrl("http://127.0.0.1:4000/idebridge/session-1?foo=bar")).toBe(false)
    expect(IdeHostBridge.isValidBridgeUrl("http://127.0.0.1:4000/idebridge/session-1#frag")).toBe(false)
    // Non-bridge path rejected
    expect(IdeHostBridge.isValidBridgeUrl("http://127.0.0.1:4000/other/path")).toBe(false)
    // Malformed URL rejected
    expect(IdeHostBridge.isValidBridgeUrl("not-a-url")).toBe(false)
  })

  test("register rejects invalid or non-loopback bridge URL", () => {
    const bridge = IdeHostBridge.defaultService
    bridge.register("http://evil.com/idebridge/bad-session", "bad-token")
    // Previous valid state is not overwritten by an invalid URL
    expect(bridge.isConfigured()).toBe(true)
  })
})
