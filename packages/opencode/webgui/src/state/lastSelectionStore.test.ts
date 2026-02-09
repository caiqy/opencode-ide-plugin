import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../lib/ideBridge", () => {
  return {
    ideBridge: {
      isInstalled: vi.fn(),
      request: vi.fn(),
    },
  }
})

import { ideBridge } from "../lib/ideBridge"
import {
  LAST_SELECTION_KEY,
  loadLastSelectionFromHost,
  saveLastSelectionToHost,
  type LastSelectionV1,
} from "./lastSelectionStore"

describe("lastSelectionStore", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    ;(ideBridge.isInstalled as any).mockReturnValue(false)
    ;(ideBridge.request as any).mockResolvedValue({ ok: true, result: {} })
  })

  it("bridge 未安装时 load 返回 null", async () => {
    ;(ideBridge.isInstalled as any).mockReturnValue(false)

    const result = await loadLastSelectionFromHost()

    expect(result).toBeNull()
    expect(ideBridge.request).not.toHaveBeenCalled()
  })

  it("storageGet 返回合法 JSON 时可解析", async () => {
    ;(ideBridge.isInstalled as any).mockReturnValue(true)
    const value: LastSelectionV1 = {
      v: 1,
      agent: "build",
      providerId: "openai",
      modelId: "gpt-4.1",
      variant: "medium",
      updatedAt: 123,
    }
    ;(ideBridge.request as any).mockResolvedValue({
      ok: true,
      result: {
        [LAST_SELECTION_KEY]: JSON.stringify(value),
      },
    })

    const result = await loadLastSelectionFromHost()

    expect(result).toEqual(value)
    expect(ideBridge.request).toHaveBeenCalledWith("storageGet", {
      keys: [LAST_SELECTION_KEY],
    })
  })

  it("非法 JSON / 非法结构时返回 null", async () => {
    ;(ideBridge.isInstalled as any).mockReturnValue(true)
    ;(ideBridge.request as any).mockResolvedValueOnce({
      ok: true,
      result: {
        [LAST_SELECTION_KEY]: "{bad-json",
      },
    })

    expect(await loadLastSelectionFromHost()).toBeNull()
    ;(ideBridge.request as any).mockResolvedValueOnce({
      ok: true,
      result: {
        [LAST_SELECTION_KEY]: JSON.stringify({ v: 2, agent: "build" }),
      },
    })

    expect(await loadLastSelectionFromHost()).toBeNull()
  })

  it("save 会调用 storageSet 并写入固定 key", async () => {
    ;(ideBridge.isInstalled as any).mockReturnValue(true)
    const value: LastSelectionV1 = {
      v: 1,
      agent: "plan",
      providerId: "anthropic",
      modelId: "claude-4-sonnet",
      variant: null,
      updatedAt: 456,
    }

    await saveLastSelectionToHost(value)

    expect(ideBridge.request).toHaveBeenCalledWith("storageSet", {
      key: LAST_SELECTION_KEY,
      value: JSON.stringify(value),
    })
  })
})
