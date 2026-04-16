import path from "path"
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { NamedError } from "@opencode-ai/util/error"
import { fileURLToPath } from "url"
import { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import * as ProviderModule from "../../src/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Session } from "../../src/session"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

afterEach(async () => {
  mock.restore()
  await resetDatabase()
})

describe("session.prompt missing file", () => {
  test("does not fail the prompt when a file part is missing", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          build: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        const missing = path.join(tmp.path, "does-not-exist.ts")
        const msg = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          noReply: true,
          parts: [
            { type: "text", text: "please review @does-not-exist.ts" },
            {
              type: "file",
              mime: "text/plain",
              url: `file://${missing}`,
              filename: "does-not-exist.ts",
            },
          ],
        })

        if (msg.info.role !== "user") throw new Error("expected user message")

        const hasFailure = msg.parts.some(
          (part) => part.type === "text" && part.synthetic && part.text.includes("Read tool failed to read"),
        )
        expect(hasFailure).toBe(true)

        await Session.remove(session.id)
      },
    })
  })

  test("keeps stored part order stable when file resolution is async", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          build: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        const missing = path.join(tmp.path, "still-missing.ts")
        const msg = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          noReply: true,
          parts: [
            {
              type: "file",
              mime: "text/plain",
              url: `file://${missing}`,
              filename: "still-missing.ts",
            },
            { type: "text", text: "after-file" },
          ],
        })

        if (msg.info.role !== "user") throw new Error("expected user message")

        const stored = await MessageV2.get({
          sessionID: session.id,
          messageID: msg.info.id,
        })
        const text = stored.parts.filter((part) => part.type === "text").map((part) => part.text)

        expect(text[0]?.startsWith("Called the Read tool with the following input:")).toBe(true)
        expect(text[1]?.includes("Read tool failed to read")).toBe(true)
        expect(text[2]).toBe("after-file")

        await Session.remove(session.id)
      },
    })
  })
})

describe("session.prompt special characters", () => {
  test("handles filenames with # character", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, "file#name.txt"), "special content\n")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const template = "Read @file#name.txt"
        const parts = await SessionPrompt.resolvePromptParts(template)
        const fileParts = parts.filter((part) => part.type === "file")

        expect(fileParts.length).toBe(1)
        expect(fileParts[0].filename).toBe("file#name.txt")
        expect(fileParts[0].url).toContain("%23")

        const decodedPath = fileURLToPath(fileParts[0].url)
        expect(decodedPath).toBe(path.join(tmp.path, "file#name.txt"))

        const message = await SessionPrompt.prompt({
          sessionID: session.id,
          parts,
          noReply: true,
        })
        const stored = await MessageV2.get({ sessionID: session.id, messageID: message.info.id })
        const textParts = stored.parts.filter((part) => part.type === "text")
        const hasContent = textParts.some((part) => part.text.includes("special content"))
        expect(hasContent).toBe(true)

        await Session.remove(session.id)
      },
    })
  })
})

describe("session.prompt agent variant", () => {
  test("applies agent variant only when using agent model", async () => {
    const prev = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = "test-openai-key"

    try {
      await using tmp = await tmpdir({
        git: true,
        config: {
          agent: {
            build: {
              model: "openai/gpt-5.2",
              variant: "xhigh",
            },
          },
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})

          const other = await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            model: { providerID: ProviderID.make("opencode"), modelID: ModelID.make("kimi-k2.5-free") },
            noReply: true,
            parts: [{ type: "text", text: "hello" }],
          })
          if (other.info.role !== "user") throw new Error("expected user message")
          expect(other.info.variant).toBeUndefined()

          const match = await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            noReply: true,
            parts: [{ type: "text", text: "hello again" }],
          })
          if (match.info.role !== "user") throw new Error("expected user message")
          expect(match.info.model).toEqual({ providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-5.2") })
          expect(match.info.variant).toBe("xhigh")

          const override = await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            noReply: true,
            variant: "high",
            parts: [{ type: "text", text: "hello third" }],
          })
          if (override.info.role !== "user") throw new Error("expected user message")
          expect(override.info.variant).toBe("high")

          await Session.remove(session.id)
        },
      })
    } finally {
      if (prev === undefined) delete process.env.OPENAI_API_KEY
      else process.env.OPENAI_API_KEY = prev
    }
  })
})

describe("session.agent-resolution", () => {
  test("unknown agent throws typed error", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const err = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "nonexistent-agent-xyz",
          noReply: true,
          parts: [{ type: "text", text: "hello" }],
        }).then(
          () => undefined,
          (e) => e,
        )
        expect(err).toBeDefined()
        expect(err).not.toBeInstanceOf(TypeError)
        expect(NamedError.Unknown.isInstance(err)).toBe(true)
        if (NamedError.Unknown.isInstance(err)) {
          expect(err.data.message).toContain('Agent not found: "nonexistent-agent-xyz"')
        }
      },
    })
  }, 30000)

  test("unknown agent error includes available agent names", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const err = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "nonexistent-agent-xyz",
          noReply: true,
          parts: [{ type: "text", text: "hello" }],
        }).then(
          () => undefined,
          (e) => e,
        )
        expect(NamedError.Unknown.isInstance(err)).toBe(true)
        if (NamedError.Unknown.isInstance(err)) {
          expect(err.data.message).toContain("build")
        }
      },
    })
  }, 30000)

  test("unknown command throws typed error with available names", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const err = await SessionPrompt.command({
          sessionID: session.id,
          command: "nonexistent-command-xyz",
          arguments: "",
        }).then(
          () => undefined,
          (e) => e,
        )
        expect(err).toBeDefined()
        expect(err).not.toBeInstanceOf(TypeError)
        expect(NamedError.Unknown.isInstance(err)).toBe(true)
        if (NamedError.Unknown.isInstance(err)) {
          expect(err.data.message).toContain('Command not found: "nonexistent-command-xyz"')
          expect(err.data.message).toContain("init")
        }
      },
    })
  }, 30000)
})

describe("session title regeneration", () => {
  const titleModel = {
    id: "test-small-model",
    providerID: ProviderID.make("test"),
    name: "Test Small Model",
    api: {
      id: "test-small-model",
      npm: "@ai-sdk/openai",
    },
    limit: {
      context: 8192,
      output: 1024,
    },
    capabilities: {
      toolcall: true,
      attachment: false,
      reasoning: false,
      temperature: true,
      input: { text: true, image: false, audio: false, video: false },
      output: { text: true, image: false, audio: false, video: false },
    },
    options: {},
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
  } as any

  async function addUserMessage(sessionID: SessionID, text: string) {
    const message = await Session.updateMessage({
      id: MessageID.ascending(),
      sessionID,
      role: "user",
      time: { created: Date.now() },
      agent: "build",
      model: {
        providerID: ProviderID.make("test"),
        modelID: ModelID.make("test-model"),
      },
      tools: {},
      mode: "",
    } as unknown as MessageV2.Info)

    await Session.updatePart({
      id: PartID.ascending(),
      sessionID,
      messageID: message.id,
      type: "text",
      text,
    })
  }

  async function addSubtaskOnlyUserMessage(sessionID: SessionID, prompt: string) {
    const message = await Session.updateMessage({
      id: MessageID.ascending(),
      sessionID,
      role: "user",
      time: { created: Date.now() },
      agent: "build",
      model: {
        providerID: ProviderID.make("test"),
        modelID: ModelID.make("test-model"),
      },
      tools: {},
      mode: "",
    } as unknown as MessageV2.Info)

    await Session.updatePart({
      id: PartID.ascending(),
      sessionID,
      messageID: message.id,
      type: "subtask",
      prompt,
      description: "子任务描述",
      agent: "build",
      model: {
        providerID: ProviderID.make("test"),
        modelID: ModelID.make("test-model"),
      },
    })
  }

  test("regenerateTitle 会复用标题生成逻辑并覆盖现有手动标题", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "手动旧标题" })
        await addUserMessage(session.id, "请根据这段对话生成一个新的标签名")

        spyOn(Agent, "get").mockImplementation(async (name) => {
          if (name === "title") return { name: "title" } as any
          return null
        })
        spyOn(ProviderModule.Provider, "getSmallModel").mockResolvedValue(titleModel)

        const stream = spyOn(LLM, "stream").mockResolvedValue({
          text: Promise.resolve("<think>ignore</think>\n重新生成后的标题\n"),
        } as any)

        const updated = await SessionPrompt.regenerateTitle({ sessionID: session.id })

        expect(stream).toHaveBeenCalled()
        expect(updated.title).toBe("重新生成后的标题")
        expect((await Session.get(session.id)).title).toBe("重新生成后的标题")
      },
    })
  })

  test("regenerateTitle 会使用当前整段会话内容生成标题", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "手动旧标题" })
        await addUserMessage(session.id, "这是第一轮问题")
        await addUserMessage(session.id, "这是最后一轮问题，应该参与重新生成")

        spyOn(Agent, "get").mockImplementation(async (name) => {
          if (name === "title") return { name: "title" } as any
          return null
        })
        spyOn(ProviderModule.Provider, "getSmallModel").mockResolvedValue(titleModel)

        const stream = spyOn(LLM, "stream").mockResolvedValue({
          text: Promise.resolve("重新生成后的标题"),
        } as any)

        await SessionPrompt.regenerateTitle({ sessionID: session.id })

        const promptMessages = stream.mock.calls[0]?.[0]?.messages ?? []
        const serialized = JSON.stringify(promptMessages)
        expect(serialized).toContain("这是最后一轮问题，应该参与重新生成")
      },
    })
  })

  test("regenerateTitle 在最后一条用户消息仅包含 subtask 时仍保留整段会话上下文", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "手动旧标题" })
        await addUserMessage(session.id, "前文中的真实问题")
        await addSubtaskOnlyUserMessage(session.id, "最后一步子任务提示")

        spyOn(Agent, "get").mockImplementation(async (name) => {
          if (name === "title") return { name: "title" } as any
          return null
        })
        spyOn(ProviderModule.Provider, "getSmallModel").mockResolvedValue(titleModel)

        const stream = spyOn(LLM, "stream").mockResolvedValue({
          text: Promise.resolve("重新生成后的标题"),
        } as any)

        await SessionPrompt.regenerateTitle({ sessionID: session.id })

        const promptMessages = stream.mock.calls[0]?.[0]?.messages ?? []
        const serialized = JSON.stringify(promptMessages)
        expect(serialized).toContain("前文中的真实问题")
        expect(serialized).toContain("最后一步子任务提示")
      },
    })
  })
})
