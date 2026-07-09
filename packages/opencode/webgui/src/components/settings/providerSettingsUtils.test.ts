import { describe, expect, it } from "vitest"
import {
  applyRemoteConfigUpdate,
  buildUpdatedProvider,
  maskApiKey,
  normalizeWhitelist,
  providerRows,
} from "./providerSettingsUtils"

describe("maskApiKey", () => {
  it("空值显示未配置", () => {
    expect(maskApiKey(undefined)).toBe("未配置")
    expect(maskApiKey("")).toBe("未配置")
  })

  it("短 key 使用固定掩码", () => {
    expect(maskApiKey("abc123")).toBe("••••••")
  })

  it("长 key 保留首尾并中段脱敏", () => {
    expect(maskApiKey("sk-1234567890abcdef")).toBe("sk-1…cdef")
  })
})

describe("normalizeWhitelist", () => {
  it("去空、trim、去重并保留首次出现顺序", () => {
    expect(normalizeWhitelist([" gpt-4.1 ", "", "gpt-4.1", "claude-opus"])).toEqual(["gpt-4.1", "claude-opus"])
  })
})

describe("providerRows", () => {
  it("从 config.provider 生成列表行", () => {
    expect(
      providerRows({
        provider: {
          openai: { options: { baseURL: "https://api.example.com/v1", apiKey: "sk-1234567890abcdef" } },
          anthropic: {},
        },
      }),
    ).toEqual([
      {
        id: "anthropic",
        baseURL: undefined,
        apiKey: undefined,
        maskedApiKey: "未配置",
      },
      {
        id: "openai",
        baseURL: "https://api.example.com/v1",
        apiKey: "sk-1234567890abcdef",
        maskedApiKey: "sk-1…cdef",
      },
    ])
  })
})

describe("buildUpdatedProvider", () => {
  it("写入 baseURL、apiKey、whitelist", () => {
    expect(
      buildUpdatedProvider(
        { name: "OpenAI", options: { timeout: 1000, baseURL: "old", apiKey: "old-key" }, whitelist: ["old"] },
        { baseURL: "https://new.example.com/v1", apiKey: "new-key", whitelist: ["gpt-4.1", "gpt-4.1"] },
      ),
    ).toEqual({
      name: "OpenAI",
      options: { timeout: 1000, baseURL: "https://new.example.com/v1", apiKey: "new-key" },
      whitelist: ["gpt-4.1"],
    })
  })

  it("空 baseURL/apiKey 会从 options 中移除", () => {
    expect(
      buildUpdatedProvider(
        { options: { timeout: 1000, baseURL: "old", apiKey: "old-key" } },
        { baseURL: "", apiKey: "", whitelist: [] },
      ),
    ).toEqual({ options: { timeout: 1000 }, whitelist: [] })
  })
})

describe("applyRemoteConfigUpdate", () => {
  const local = {
    username: "local-user",
    provider: {
      openai: {
        name: "Local OpenAI",
        options: { baseURL: "https://local.example.com/v1", apiKey: "local-key", timeout: 1000 },
        whitelist: ["local-model"],
      },
    },
  }

  const remote = {
    username: "remote-user",
    provider: {
      openai: {
        name: "Remote OpenAI",
        options: { baseURL: "https://remote.example.com/v1", apiKey: "remote-key", chunkTimeout: 2000 },
        whitelist: ["remote-model"],
      },
      anthropic: { options: { apiKey: "anthropic-key" } },
    },
  }

  it("覆盖模式以远程为主体，但保留同名 provider 的 baseURL/apiKey", () => {
    expect(applyRemoteConfigUpdate(local, remote, "replace")).toEqual({
      username: "remote-user",
      provider: {
        openai: {
          name: "Remote OpenAI",
          options: {
            baseURL: "https://local.example.com/v1",
            apiKey: "local-key",
            chunkTimeout: 2000,
          },
          whitelist: ["remote-model"],
        },
        anthropic: { options: { apiKey: "anthropic-key" } },
      },
    })
  })

  it("合并模式以本地为主体，并保留本地 baseURL/apiKey", () => {
    expect(applyRemoteConfigUpdate(local, remote, "merge")).toEqual({
      username: "remote-user",
      provider: {
        openai: {
          name: "Remote OpenAI",
          options: {
            baseURL: "https://local.example.com/v1",
            apiKey: "local-key",
            timeout: 1000,
            chunkTimeout: 2000,
          },
          whitelist: ["remote-model"],
        },
        anthropic: { options: { apiKey: "anthropic-key" } },
      },
    })
  })
})
