import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../scopedStorage", () => ({
  scopedStateGetJSON: vi.fn(),
  scopedStateSetJSON: vi.fn(),
}))

import { scopedStateGetJSON, scopedStateSetJSON } from "../scopedStorage"
import { loadTheme, saveTheme } from "./themeRepo"

describe("themeRepo", () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it("loadTheme 从 global scope 读取", async () => {
    vi.mocked(scopedStateGetJSON).mockResolvedValue("light")
    const theme = await loadTheme()
    expect(theme).toBe("light")
    expect(scopedStateGetJSON).toHaveBeenCalledWith("global", "opencode:webgui:global:theme:v1", "dark")
  })

  it("saveTheme 写入 global scope", async () => {
    vi.mocked(scopedStateSetJSON).mockResolvedValue({ ok: true })
    const result = await saveTheme("dark")
    expect(result).toEqual({ ok: true })
    expect(scopedStateSetJSON).toHaveBeenCalledWith("global", "opencode:webgui:global:theme:v1", "dark")
  })
})
