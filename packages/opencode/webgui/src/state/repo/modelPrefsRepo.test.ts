import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../scopedStorage", () => ({
  scopedStateGetJSON: vi.fn(),
  scopedStateSetJSON: vi.fn(),
}))

import { scopedStateGetJSON, scopedStateSetJSON } from "../scopedStorage"
import { loadModelPrefs, saveModelPrefs, updateModelPrefs, addRecentModel, resetModelPrefsCache } from "./modelPrefsRepo"

describe("modelPrefsRepo", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    resetModelPrefsCache()
  })

  it("loadModelPrefs 仅返回 recent/favorite", async () => {
    vi.mocked(scopedStateGetJSON).mockResolvedValue({
      recent: [{ providerID: "p", modelID: "m" }],
      favorite: [{ providerID: "x", modelID: "y" }],
      variant: { "p/m": "fast" },
    })

    const model = await loadModelPrefs()
    expect(model).toEqual({
      recent: [{ providerID: "p", modelID: "m" }],
      favorite: [{ providerID: "x", modelID: "y" }],
    })
    expect(scopedStateGetJSON).toHaveBeenCalledWith("global", "opencode:webgui:global:model:v1", {
      recent: [],
      favorite: [],
    })
  })

  it("saveModelPrefs 写入 global:model", async () => {
    vi.mocked(scopedStateSetJSON).mockResolvedValue({ ok: true })
    await saveModelPrefs({ recent: [], favorite: [] })
    expect(scopedStateSetJSON).toHaveBeenCalledWith("global", "opencode:webgui:global:model:v1", {
      recent: [],
      favorite: [],
    })
  })

  it("updateModelPrefs 串行化并发写，避免 recent/favorite 覆盖", async () => {
    const entry = { providerID: "p", modelID: "m" }
    const fav = { providerID: "x", modelID: "y" }
    let store = {
      recent: [] as Array<{ providerID: string; modelID: string }>,
      favorite: [] as Array<{ providerID: string; modelID: string }>,
    }

    vi.mocked(scopedStateGetJSON).mockImplementation(async () => ({
      recent: [...store.recent],
      favorite: [...store.favorite],
    }))
    vi.mocked(scopedStateSetJSON).mockImplementation(async (_scope, _key, value) => {
      await Promise.resolve()
      store = {
        recent: Array.isArray((value as { recent?: unknown }).recent)
          ? ((value as { recent: Array<{ providerID: string; modelID: string }> }).recent ?? [])
          : [],
        favorite: Array.isArray((value as { favorite?: unknown }).favorite)
          ? ((value as { favorite: Array<{ providerID: string; modelID: string }> }).favorite ?? [])
          : [],
      }
      return { ok: true }
    })

    await Promise.all([
      updateModelPrefs((value) => ({
        recent: [entry, ...value.recent],
        favorite: value.favorite,
      })),
      updateModelPrefs((value) => ({
        recent: value.recent,
        favorite: [fav, ...value.favorite],
      })),
    ])

    expect(store.recent[0]).toEqual(entry)
    expect(store.favorite[0]).toEqual(fav)
  })

  it("consecutive loadModelPrefs calls share the cached promise", async () => {
    vi.mocked(scopedStateGetJSON).mockResolvedValue({ recent: [], favorite: [] })

    const [a, b] = await Promise.all([loadModelPrefs(), loadModelPrefs()])

    expect(a).toBe(b)
    expect(scopedStateGetJSON).toHaveBeenCalledTimes(1)
  })

  it("addRecentModel updates cache so subsequent loadModelPrefs sees new recent", async () => {
    const entry = { providerID: "openai", modelID: "gpt-5" }
    vi.mocked(scopedStateGetJSON).mockResolvedValue({ recent: [], favorite: [] })
    vi.mocked(scopedStateSetJSON).mockResolvedValue({ ok: true })

    await addRecentModel(entry)

    // loadModelPrefs should return the updated value without hitting storage again
    const prefs = await loadModelPrefs()
    expect(prefs.recent[0]).toEqual(entry)
    // scopedStateGetJSON was called once by addRecentModel's fresh load, not again by loadModelPrefs
    expect(scopedStateGetJSON).toHaveBeenCalledTimes(1)
  })

  it("updateModelPrefs updates cache so subsequent loadModelPrefs sees new favorite", async () => {
    const fav = { providerID: "anthropic", modelID: "claude-5" }
    vi.mocked(scopedStateGetJSON).mockResolvedValue({ recent: [], favorite: [] })
    vi.mocked(scopedStateSetJSON).mockResolvedValue({ ok: true })

    await updateModelPrefs((value) => ({
      recent: value.recent,
      favorite: [fav, ...value.favorite],
    }))

    const prefs = await loadModelPrefs()
    expect(prefs.favorite[0]).toEqual(fav)
    expect(scopedStateGetJSON).toHaveBeenCalledTimes(1)
  })

  it("saveModelPrefs updates cache so subsequent loadModelPrefs sees saved data", async () => {
    vi.mocked(scopedStateGetJSON).mockResolvedValue({ recent: [], favorite: [] })
    vi.mocked(scopedStateSetJSON).mockResolvedValue({ ok: true })

    const saved = {
      recent: [{ providerID: "a", modelID: "b" }],
      favorite: [{ providerID: "c", modelID: "d" }],
    }
    await saveModelPrefs(saved)

    const prefs = await loadModelPrefs()
    expect(prefs).toEqual(saved)
    // Storage read was never called because saveModelPrefs set the cache
    expect(scopedStateGetJSON).not.toHaveBeenCalled()
  })
})
