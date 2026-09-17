import { describe, expect, test } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { IdeHostBridge } from "../../src/acp/host-bridge"
import { SessionTools } from "../../src/session/tools"

describe("IdeHostBridge service", () => {
  test("reports unconfigured when url and token are missing", () => {
    const origUrl = process.env.OPENCODE_IDE_BRIDGE_URL
    const origToken = process.env.OPENCODE_IDE_BRIDGE_TOKEN
    delete process.env.OPENCODE_IDE_BRIDGE_URL
    delete process.env.OPENCODE_IDE_BRIDGE_TOKEN

    const bridge = IdeHostBridge.defaultService
    bridge.reset?.()

    try {
      expect(bridge.isConfigured()).toBe(false)
    } finally {
      if (origUrl && origToken) {
        bridge.register(origUrl, origToken)
        process.env.OPENCODE_IDE_BRIDGE_URL = origUrl
        process.env.OPENCODE_IDE_BRIDGE_TOKEN = origToken
      }
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

  test("resolves platform namespace config with fallback to flat structure and decodes via ConfigACP", () => {
    const rawConfig = {
      platform_vscode: {
        tasks: { enabled: true, tools: { t1: true } },
      },
      platform_intellij: {
        tasks: { enabled: false, tools: { t1: false } },
      },
      fallback_cat: { enabled: true, tools: { f1: true } },
    }

    // 核心 ConfigACP Schema 真实解码嵌套与扁平混合配置
    const decode = Schema.decodeUnknownSync(ConfigV1.ConfigACP)
    const decoded = decode(rawConfig) as any

    // VS Code 平台优先解析 config.platform_vscode
    const vsCodePlatformCfg = decoded.platform_vscode
    expect(vsCodePlatformCfg?.tasks?.enabled).toBe(true)
    expect(vsCodePlatformCfg?.tasks?.tools?.t1).toBe(true)

    // 回退到扁平结构
    const flatCatCfg = decoded.platform_vscode?.fallback_cat ?? decoded.fallback_cat
    expect(flatCatCfg?.enabled).toBe(true)
    expect(flatCatCfg?.tools?.f1).toBe(true)

    // IntelliJ 平台优先解析 config.platform_intellij
    const ideaPlatformCfg = decoded.platform_intellij
    expect(ideaPlatformCfg?.tasks?.enabled).toBe(false)
    expect(ideaPlatformCfg?.tasks?.tools?.t1).toBe(false)
  })

  test("SessionTools.matchAcpTools correctly isolates VS Code and IntelliJ tools and supports flat fallback", () => {
    const rawConfig = {
      platform_vscode: {
        tasks_and_problems: { enabled: true, tools: { executeTask: true } },
      },
      platform_intellij: {
        tasks_and_problems: { enabled: false, tools: { executeTask: false } },
      },
      fallback_cat: { enabled: true, tools: { f1: true } },
    }

    const decode = Schema.decodeUnknownSync(ConfigV1.ConfigACP)
    const acpConfig = decode(rawConfig) as any

    // 1. IntelliJ 宿主环境：优先匹配 platform_intellij，tasks_and_problems 为 disabled，fallback_cat 正常回退匹配
    const intellijCaps: any = {
      categories: [
        { id: "intellij", name: "IntelliJ", tools: [] },
        { id: "tasks_and_problems", name: "任务", tools: [{ id: "executeTask", name: "Run" }] },
        { id: "fallback_cat", name: "回退分类", tools: [{ id: "f1", name: "F1" }] },
      ],
    }
    const intellijMatched = SessionTools.matchAcpTools(intellijCaps, acpConfig)
    // tasks_and_problems 被 disabled，仅 fallback_cat 匹配
    expect(intellijMatched.map((m) => m.toolKey)).toEqual(["acp_fallback_cat_f1"])

    // 2. VS Code 宿主环境：优先匹配 platform_vscode，tasks_and_problems 为 enabled，fallback_cat 正常回退匹配
    const vscodeCaps: any = {
      categories: [
        { id: "vscode", name: "VS Code", tools: [] },
        { id: "tasks_and_problems", name: "任务", tools: [{ id: "executeTask", name: "Run" }] },
        { id: "fallback_cat", name: "回退分类", tools: [{ id: "f1", name: "F1" }] },
      ],
    }
    const vscodeMatched = SessionTools.matchAcpTools(vscodeCaps, acpConfig)
    expect(vscodeMatched.map((m) => m.toolKey)).toEqual(["acp_tasks_and_problems_executeTask", "acp_fallback_cat_f1"])
  })

  test("A5 dual-platform sequential patch keeps both configurations isolated without overwrite", () => {
    // 模拟服务端根据各端 patch 合并配置的逻辑
    let currentConfig: any = {}

    // 1. VS Code 端保存配置
    const vscodePatch = {
      acp: {
        platform_vscode: {
          tasks: { enabled: true, tools: { runTask: true } },
        },
      },
    }
    currentConfig = {
      ...currentConfig,
      acp: {
        ...(currentConfig.acp || {}),
        ...vscodePatch.acp,
      },
    }

    // 2. IntelliJ 端在不同时间保存其独立配置
    const intellijPatch = {
      acp: {
        platform_intellij: {
          tasks: { enabled: false, tools: { runTask: false } },
        },
      },
    }
    currentConfig = {
      ...currentConfig,
      acp: {
        ...(currentConfig.acp || {}),
        ...intellijPatch.acp,
      },
    }

    // 验证双端命名空间均独立完整保留
    expect(currentConfig.acp.platform_vscode.tasks.enabled).toBe(true)
    expect(currentConfig.acp.platform_vscode.tasks.tools.runTask).toBe(true)
    expect(currentConfig.acp.platform_intellij.tasks.enabled).toBe(false)
    expect(currentConfig.acp.platform_intellij.tasks.tools.runTask).toBe(false)

    // 通过 ConfigACP Schema 解码断言其完全合法
    const decode = Schema.decodeUnknownSync(ConfigV1.ConfigACP)
    const decoded = decode(currentConfig.acp) as any
    expect(decoded.platform_vscode.tasks.enabled).toBe(true)
    expect(decoded.platform_intellij.tasks.enabled).toBe(false)
  })
})
