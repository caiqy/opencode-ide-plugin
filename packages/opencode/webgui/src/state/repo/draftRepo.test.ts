import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../scopedStorage", () => ({
  scopedStateGetJSON: vi.fn(),
  scopedStateSetJSON: vi.fn(),
}))

import { scopedStateGetJSON, scopedStateSetJSON } from "../scopedStorage"
import { cleanupDeletedSessionDraft, draftText, loadDrafts, resetDraftRepoForTest, saveDrafts } from "./draftRepo"

describe("draftRepo", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    resetDraftRepoForTest()
  })

  it("晚到的旧 drafts 不会覆盖本会话刚保存的新 drafts", async () => {
    vi.mocked(scopedStateSetJSON).mockResolvedValue({ ok: true })
    vi.mocked(scopedStateGetJSON).mockResolvedValue({ s2: "old" })

    await saveDrafts({ s2: "fresh" })
    const value = await loadDrafts()

    expect(value).toEqual({ s2: "fresh" })
  })

  it("读取 legacy string 并保留经过验证的结构化 draft", async () => {
    vi.mocked(scopedStateGetJSON).mockResolvedValue({
      old: "legacy draft",
      forked: {
        parts: [
          { type: "text", text: "prompt" },
          { type: "file", mime: "image/png", filename: "image.png", url: "data:image/png;base64,AA==" },
          { type: "agent", name: "explore" },
        ],
        agent: "review",
        model: { providerID: "openai", modelID: "gpt-5", variant: "high" },
      },
      invalid: { parts: [{ type: "file", mime: 1 }], agent: "review" },
    })

    await expect(loadDrafts()).resolves.toEqual({
      old: "legacy draft",
      forked: {
        parts: [
          { type: "text", text: "prompt" },
          { type: "file", mime: "image/png", filename: "image.png", url: "data:image/png;base64,AA==" },
          { type: "agent", name: "explore" },
        ],
        agent: "review",
        model: { providerID: "openai", modelID: "gpt-5", variant: "high" },
      },
    })
  })

  it("保留 structured draft 中多个 text part 的原始顺序", () => {
    expect(
      draftText({
        parts: [
          { type: "text", text: "first" },
          { type: "agent", name: "explore" },
          { type: "text", text: "second" },
        ],
        agent: "build",
        model: undefined,
      }),
    ).toBe("firstsecond")
  })

  it.each([
    { label: "negative offset", source: { type: "file", path: "a", text: { value: "x", start: -1, end: 0 } } },
    { label: "reversed offset", source: { type: "file", path: "a", text: { value: "x", start: 1, end: 0 } } },
    { label: "out of range offset", source: { type: "file", path: "a", text: { value: "x", start: 0, end: 9 } } },
    { label: "fractional offset", source: { type: "file", path: "a", text: { value: "x", start: 0.5, end: 1 } } },
    { label: "non-finite offset", source: { type: "file", path: "a", text: { value: "x", start: 0, end: Infinity } } },
    { label: "text mismatch", source: { type: "file", path: "a", text: { value: "y", start: 0, end: 1 } } },
  ])("rejects a whole structured draft with $label", async ({ source }) => {
    vi.mocked(scopedStateGetJSON).mockResolvedValue({
      forked: {
        parts: [
          { type: "text", text: "x" },
          { type: "file", mime: "text/plain", url: "file:///a", source },
        ],
        agent: "build",
      },
    })

    await expect(loadDrafts()).resolves.toEqual({})
  })

  it("rejects a whole structured draft when any member is malformed", async () => {
    vi.mocked(scopedStateGetJSON).mockResolvedValue({
      forked: {
        parts: [{ type: "text", text: "ok" }, { type: "agent", name: 1 }],
        agent: "build",
      },
    })

    await expect(loadDrafts()).resolves.toEqual({})
  })

  it("accepts source parts whose array order differs from editor offsets", async () => {
    vi.mocked(scopedStateGetJSON).mockResolvedValue({
      forked: {
        parts: [
          { type: "text", text: "[file] @agent" },
          { type: "agent", name: "agent", source: { value: "@agent", start: 7, end: 13 } },
          {
            type: "file",
            mime: "text/plain",
            url: "file:///a",
            source: { type: "file", path: "a", text: { value: "[file]", start: 0, end: 6 } },
          },
        ],
        agent: "build",
      },
    })

    await expect(loadDrafts()).resolves.toHaveProperty("forked")
  })

  it.each([
    {
      label: "cross-text duplicate ambiguity",
      parts: [
        { type: "text", text: "[one]" },
        { type: "text", text: "[one]" },
        { type: "file", mime: "text/plain", url: "file:///one", source: { type: "file", path: "one", text: { value: "[one]", start: 0, end: 5 } } },
      ],
    },
    {
      label: "duplicate text ambiguity",
      parts: [
        { type: "text", text: "@agent" },
        { type: "text", text: "@agent" },
        { type: "agent", name: "agent", source: { value: "@agent", start: 0, end: 6 } },
      ],
    },
    {
      label: "reverse symbol range",
      parts: [
        { type: "text", text: "@symbol" },
        {
          type: "file",
          mime: "text/plain",
          url: "file:///symbol",
          source: {
            type: "symbol",
            path: "symbol",
            name: "symbol",
            kind: 1,
            text: { value: "@symbol", start: 0, end: 7 },
            range: { start: { line: 2, character: 0 }, end: { line: 1, character: 9 } },
          },
        },
      ],
    },
  ])("rejects a whole structured draft with $label", async ({ parts }) => {
    vi.mocked(scopedStateGetJSON).mockResolvedValue({ forked: { parts, agent: "build" } })

    await expect(loadDrafts()).resolves.toEqual({})
  })

  it("accepts a resource source whose SDK value differs from its editor placeholder", async () => {
    vi.mocked(scopedStateGetJSON).mockResolvedValue({
      forked: {
        parts: [
          { type: "text", text: "[resource.txt] @file" },
          {
            type: "file",
            mime: "text/plain",
            filename: "resource.txt",
            url: "resource://server/item",
            source: {
              type: "resource",
              clientName: "server",
              uri: "resource://server/item",
              text: { value: "resource://server/item", start: 0, end: 14 },
            },
          },
          {
            type: "file",
            mime: "text/plain",
            filename: "file",
            url: "file:///file",
            source: { type: "file", path: "file", text: { value: "@file", start: 15, end: 20 } },
          },
        ],
        agent: "build",
      },
    })

    await expect(loadDrafts()).resolves.toHaveProperty("forked")
  })

  it("does not write or cache invalid structured drafts", async () => {
    const value = {
      forked: {
        parts: [{ type: "text", text: "prompt" }, { type: "file", mime: "text/plain", url: "file:///a", source: { type: "file", path: "a", text: { value: "bad", start: 0, end: 3 } } }],
        agent: "build",
        model: undefined,
      },
    }

    await expect(saveDrafts(value)).resolves.toMatchObject({ ok: false })
    expect(scopedStateSetJSON).not.toHaveBeenCalled()
  })

  it("删除命中 draft_session 时清理 drafts 并置空 draft_session", async () => {
    vi.mocked(scopedStateGetJSON).mockResolvedValueOnce({ s1: "a", s2: "b" }).mockResolvedValueOnce("s1")
    vi.mocked(scopedStateSetJSON).mockResolvedValue({ ok: true })

    await cleanupDeletedSessionDraft("s1")

    expect(scopedStateSetJSON).toHaveBeenNthCalledWith(1, "workspace", "opencode:webgui:workspace:drafts:v1", {
      s2: "b",
    })
    expect(scopedStateSetJSON).toHaveBeenNthCalledWith(
      2,
      "workspace",
      "opencode:webgui:workspace:draft_session:v1",
      null,
    )
  })

  it("删除非命中 draft_session 时保持 draft_session", async () => {
    vi.mocked(scopedStateGetJSON).mockResolvedValueOnce({ s1: "a", s2: "b" }).mockResolvedValueOnce("s2")
    vi.mocked(scopedStateSetJSON).mockResolvedValue({ ok: true })

    await cleanupDeletedSessionDraft("s1")

    expect(scopedStateSetJSON).toHaveBeenCalledTimes(1)
    expect(scopedStateSetJSON).toHaveBeenCalledWith("workspace", "opencode:webgui:workspace:drafts:v1", {
      s2: "b",
    })
    expect(scopedStateSetJSON).not.toHaveBeenCalledWith("workspace", "opencode:webgui:workspace:draft_session:v1", null)
  })
})
