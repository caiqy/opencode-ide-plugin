import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../scopedStorage", () => ({
  scopedStateGetJSON: vi.fn(),
  scopedStateSetJSON: vi.fn(),
}))

import { scopedStateGetJSON, scopedStateSetJSON } from "../scopedStorage"
import { cleanupDeletedSessionDraft, loadDrafts, resetDraftRepoForTest, saveDrafts } from "./draftRepo"

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
