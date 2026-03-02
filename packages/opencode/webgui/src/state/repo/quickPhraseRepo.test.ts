import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../scopedStorage", () => ({
  scopedStateGetJSON: vi.fn(),
  scopedStateSetJSON: vi.fn(),
}))

import { scopedStateGetJSON, scopedStateSetJSON } from "../scopedStorage"
import { quick_phrase_preset } from "./quickPhrasePreset"
import {
  addCustomQuickPhrase,
  loadQuickPhraseState,
  removeQuickPhrase,
  reorderQuickPhrase,
  saveQuickPhraseState,
  toggleQuickPhraseHidden,
  updateCustomQuickPhrase,
} from "./quickPhraseRepo"

describe("quickPhraseRepo", () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it("loadQuickPhraseState 在空存储时注入预置并返回默认模式", async () => {
    vi.mocked(scopedStateGetJSON).mockResolvedValue(null)

    const value = await loadQuickPhraseState()

    expect(value.mode).toBe("double_send")
    expect(value.preset_version).toBe(quick_phrase_preset.version)
    expect(value.order).toEqual(quick_phrase_preset.items.map((item) => item.id))
    expect(Object.values(value.items).map((item) => item.source)).toEqual(quick_phrase_preset.items.map(() => "preset"))
    expect(scopedStateGetJSON).toHaveBeenCalledWith("global", "opencode:webgui:global:quick_phrase:v1", null)
  })

  it("loadQuickPhraseState 合并旧数据并清理非法字段", async () => {
    const preset = quick_phrase_preset.items[0]!.id
    vi.mocked(scopedStateGetJSON).mockResolvedValue({
      mode: "confirm_send",
      preset_version: 0,
      order: ["custom:1", preset, "ghost"],
      items: {
        "custom:1": {
          id: "custom:1",
          title: "我的短语",
          body: "Hello",
          source: "custom",
          hidden: false,
          order: 0,
          updated_at: 7,
        },
        [preset]: {
          id: preset,
          title: "旧标题",
          body: "旧正文",
          source: "preset",
          hidden: true,
          order: 1,
          updated_at: 8,
        },
        bad: {
          id: 1,
        },
      },
    })

    const value = await loadQuickPhraseState()

    expect(value.mode).toBe("confirm_send")
    expect(value.items["custom:1"]?.title).toBe("我的短语")
    expect(value.items[preset]?.title).toBe(quick_phrase_preset.items[0]!.title)
    expect(value.items[preset]?.hidden).toBe(true)
    expect(value.items["ghost"]).toBeUndefined()
    expect(value.order.includes("custom:1")).toBe(true)
    expect(quick_phrase_preset.items.every((item) => item.id in value.items)).toBe(true)
  })

  it("saveQuickPhraseState 写入 global quick_phrase key", async () => {
    vi.mocked(scopedStateSetJSON).mockResolvedValue({ ok: true })

    await saveQuickPhraseState({
      mode: "fill_input",
      preset_version: quick_phrase_preset.version,
      order: ["preset:commit"],
      items: {
        "preset:commit": {
          id: "preset:commit",
          title: "提交总结",
          body: "请总结本次改动",
          source: "preset",
          hidden: false,
          order: 0,
          updated_at: 1,
        },
      },
    })

    expect(scopedStateSetJSON).toHaveBeenCalledWith(
      "global",
      "opencode:webgui:global:quick_phrase:v1",
      expect.objectContaining({
        mode: "fill_input",
        preset_version: quick_phrase_preset.version,
      }),
    )
  })

  it("自定义短语支持增删改", async () => {
    let store: unknown = null
    vi.mocked(scopedStateGetJSON).mockImplementation(async () => store)
    vi.mocked(scopedStateSetJSON).mockImplementation(async (_scope, _key, value) => {
      store = value
      return { ok: true }
    })

    const added = await addCustomQuickPhrase({ title: "A", body: "B" })
    const id = added.order.find((item) => item.startsWith("custom:"))
    expect(id).toBeTruthy()
    if (!id) return

    const updated = await updateCustomQuickPhrase(id, { title: "AA", body: "BB" })
    expect(updated.items[id]?.title).toBe("AA")

    const removed = await removeQuickPhrase(id)
    expect(removed.items[id]).toBeUndefined()
    expect(removed.order.includes(id)).toBe(false)
  })

  it("预置短语不可编辑不可删除，但允许隐藏与排序", async () => {
    let store: unknown = null
    vi.mocked(scopedStateGetJSON).mockImplementation(async () => store)
    vi.mocked(scopedStateSetJSON).mockImplementation(async (_scope, _key, value) => {
      store = value
      return { ok: true }
    })

    const first = quick_phrase_preset.items[0]!.id
    const second = quick_phrase_preset.items[1]!.id

    const unchanged = await updateCustomQuickPhrase(first, { title: "X", body: "Y" })
    expect(unchanged.items[first]?.title).toBe(quick_phrase_preset.items[0]!.title)

    const kept = await removeQuickPhrase(first)
    expect(kept.items[first]).toBeTruthy()

    const hidden = await toggleQuickPhraseHidden(first)
    expect(hidden.items[first]?.hidden).toBe(true)

    const reordered = await reorderQuickPhrase([second, first])
    expect(reordered.order[0]).toBe(second)
  })

  it("自定义短语更新为空标题或空正文时应拒绝", async () => {
    let store: unknown = null
    vi.mocked(scopedStateGetJSON).mockImplementation(async () => store)
    vi.mocked(scopedStateSetJSON).mockImplementation(async (_scope, _key, value) => {
      store = value
      return { ok: true }
    })

    const added = await addCustomQuickPhrase({ title: "A", body: "B" })
    const id = added.order.find((item) => item.startsWith("custom:"))
    expect(id).toBeTruthy()
    if (!id) return

    const next = await updateCustomQuickPhrase(id, { title: " ", body: "" })
    expect(next.items[id]?.title).toBe("A")
    expect(next.items[id]?.body).toBe("B")
  })
})
