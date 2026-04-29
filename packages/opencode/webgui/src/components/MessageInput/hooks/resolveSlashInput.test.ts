import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
}))

vi.mock("../../../lib/api/sdkClient", () => ({
  sdk: {
    command: {
      list: () => mocks.list(),
    },
  },
}))

async function loadModule() {
  vi.resetModules()
  return import("./resolveSlashInput")
}

describe("resolveSlashInput", () => {
  beforeEach(() => {
    mocks.list.mockReset()
  })

  it("普通文本不应触发命令列表查询", async () => {
    const { resolveSlashInput } = await loadModule()

    await expect(resolveSlashInput("hello world")).resolves.toEqual({ mode: "prompt" })
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it("已知 slash 应解析为 command 模式并保留参数", async () => {
    mocks.list.mockResolvedValueOnce({
      data: [{ name: "review" }],
      error: null,
    })

    const { resolveSlashInput } = await loadModule()

    await expect(resolveSlashInput("/review repo status")).resolves.toEqual({
      mode: "command",
      name: "review",
      arguments: "repo status",
    })
  })

  it("未知 slash 应降级为 prompt 模式", async () => {
    mocks.list.mockResolvedValueOnce({
      data: [{ name: "review" }],
      error: null,
    })

    const { resolveSlashInput } = await loadModule()

    await expect(resolveSlashInput("/123 abc")).resolves.toEqual({ mode: "prompt" })
  })

  it("slash 列表加载失败时应降级为 prompt 模式", async () => {
    mocks.list.mockRejectedValueOnce(new Error("offline"))

    const { resolveSlashInput } = await loadModule()

    await expect(resolveSlashInput("/review repo status")).resolves.toEqual({ mode: "prompt" })
  })

  it("slash 列表返回 error 形状时应降级为 prompt 模式", async () => {
    mocks.list.mockResolvedValueOnce({
      data: null,
      error: { message: "offline" },
    })

    const { resolveSlashInput } = await loadModule()

    await expect(resolveSlashInput("/review repo status")).resolves.toEqual({ mode: "prompt" })
  })

  it("缓存未命中时应强制刷新一次再决定是否降级", async () => {
    mocks.list
      .mockResolvedValueOnce({
        data: [{ name: "status" }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ name: "status" }, { name: "review" }],
        error: null,
      })

    const { resolveSlashInput } = await loadModule()

    await expect(resolveSlashInput("/status")).resolves.toEqual({
      mode: "command",
      name: "status",
      arguments: "",
    })

    await expect(resolveSlashInput("/review repo status")).resolves.toEqual({
      mode: "command",
      name: "review",
      arguments: "repo status",
    })

    expect(mocks.list).toHaveBeenCalledTimes(2)
  })

  it("同一模块实例内应复用已加载的 slash 列表", async () => {
    mocks.list.mockResolvedValue({
      data: [{ name: "review" }],
      error: null,
    })

    const { resolveSlashInput } = await loadModule()

    await resolveSlashInput("/review first")
    await resolveSlashInput("/review second")

    expect(mocks.list).toHaveBeenCalledTimes(1)
  })
})
