import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../lib/api/sdkClient", () => {
  return {
    sdk: {
      kv: {
        get: vi.fn(),
        update: vi.fn(),
      },
    },
  }
})

import { sdk } from "../lib/api/sdkClient"
import { UISettingsProvider, useUISettings } from "./UISettingsContext"

function wrapper(props: { children: ReactNode }) {
  return <UISettingsProvider>{props.children}</UISettingsProvider>
}

describe("UISettingsContext kv migration", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    ;(sdk.kv.get as any).mockResolvedValue({ data: {}, error: null })
    ;(sdk.kv.update as any).mockResolvedValue({ data: {}, error: null })
  })

  it("从 kv 读取 message parts 自动展开设置", async () => {
    ;(sdk.kv.get as any).mockResolvedValue({
      data: {
        webgui_message_parts_auto_expand: false,
      },
      error: null,
    })

    const { result } = renderHook(() => useUISettings(), { wrapper })

    await waitFor(() => {
      expect(result.current.autoExpandMessageParts).toBe(false)
    })
  })

  it("更新设置时写入 kv", async () => {
    const { result } = renderHook(() => useUISettings(), { wrapper })

    await act(async () => {
      await result.current.setAutoExpandMessageParts(false)
    })

    expect(sdk.kv.update).toHaveBeenCalledWith({
      body: {
        webgui_message_parts_auto_expand: false,
      },
    })
    expect(result.current.autoExpandMessageParts).toBe(false)
  })
})
