import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../scopedStorage", () => ({
  scopedStateGetJSON: vi.fn(),
  scopedStateSetJSON: vi.fn(),
}))

import { scopedStateGetJSON, scopedStateSetJSON } from "../scopedStorage"
import { loadSelection, saveSelection } from "./selectionRepo"

describe("selectionRepo", () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it("loadSelection 从 workspace 读取并包含 variant", async () => {
    vi.mocked(scopedStateGetJSON).mockResolvedValue({
      agent: "build",
      provider_id: "openai",
      model_id: "gpt-5",
      variant: "reasoning",
      agent_model_map: {},
      updated_at: 1,
    })

    const value = await loadSelection()
    expect(value.variant).toBe("reasoning")
    expect(scopedStateGetJSON).toHaveBeenCalledWith("workspace", "opencode:webgui:workspace:last_selection:v1", {
      agent: null,
      provider_id: null,
      model_id: null,
      variant: null,
      agent_model_map: {},
      updated_at: 0,
    })
  })

  it("saveSelection 写入 workspace:last_selection", async () => {
    vi.mocked(scopedStateSetJSON).mockResolvedValue({ ok: true })
    const value = {
      agent: "build",
      provider_id: "openai",
      model_id: "gpt-5",
      variant: "reasoning",
      agent_model_map: {},
      updated_at: 2,
    }
    await saveSelection(value)
    expect(scopedStateSetJSON).toHaveBeenCalledWith("workspace", "opencode:webgui:workspace:last_selection:v1", value)
  })
})
