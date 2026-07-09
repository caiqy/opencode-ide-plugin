import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Session } from "@opencode-ai/sdk/client"
import {
  checkDraftSessionReusable,
  findReusableDefaultSessionFallback,
  findReusableDefaultSession,
  handleSessionUiEvent,
  prepareSession,
  reuseCheckFromResponses,
} from "./App"
import { sdk } from "./lib/api/sdkClient"
import { switchSessionWithTabRollback } from "./state/switchSession"

vi.mock("./lib/api/sdkClient", () => ({
  sdk: {
    session: {
      get: vi.fn(),
      list: vi.fn(),
      messages: vi.fn(),
    },
  },
}))

beforeEach(() => {
  vi.mocked(sdk.session.get).mockReset()
  vi.mocked(sdk.session.list).mockReset()
  vi.mocked(sdk.session.messages).mockReset()
})

type DefaultSession = Pick<Session, "id" | "title" | "parentID"> & {
  time: Session["time"] & { archived?: number }
}

function sessionGetResult(data: unknown, error: unknown): Awaited<ReturnType<typeof sdk.session.get>> {
  return { data, error } as Awaited<ReturnType<typeof sdk.session.get>>
}

function sessionMessagesResult(data: unknown, error: unknown): Awaited<ReturnType<typeof sdk.session.messages>> {
  return { data, error } as Awaited<ReturnType<typeof sdk.session.messages>>
}

function defaultSession(id: string, created: number, updated = created): DefaultSession {
  return {
    id,
    title: `New session - ${new Date(created).toISOString()}`,
    parentID: undefined,
    time: {
      created,
      updated,
    },
  } as DefaultSession
}

describe("reuseCheckFromResponses", () => {
  it("区分 reusable/not_reusable/unknown", () => {
    expect(reuseCheckFromResponses({ exists: true, messages: [] })).toBe("reusable")
    expect(reuseCheckFromResponses({ exists: false, messages: [] })).toBe("not_reusable")
    expect(reuseCheckFromResponses({ exists: true, messages: [{ id: "m-1" }] })).toBe("not_reusable")
    expect(reuseCheckFromResponses({ exists: "unknown", messages: [] })).toBe("unknown")
    expect(reuseCheckFromResponses({ exists: true, messages: "unknown" })).toBe("unknown")
  })
})

describe("findReusableDefaultSession", () => {
  it("返回最近的空默认 New session", async () => {
    const messages = vi.fn(async (id: string) => (id === "s-new-used" ? [{ id: "m-1" }] : []))

    await expect(
      findReusableDefaultSession(
        [
          defaultSession("s-old-empty", 1000),
          defaultSession("s-middle-empty", 2000),
          defaultSession("s-new-used", 3000),
        ],
        messages,
      ),
    ).resolves.toEqual({ id: "s-middle-empty" })

    expect(messages).toHaveBeenCalledTimes(2)
    expect(messages).toHaveBeenNthCalledWith(1, "s-new-used")
    expect(messages).toHaveBeenNthCalledWith(2, "s-middle-empty")
  })

  it("跳过 messages 请求失败候选", async () => {
    const messages = vi.fn(async (id: string) => {
      if (id === "s-new-fails") throw new Error("boom")
      return []
    })

    await expect(
      findReusableDefaultSession([defaultSession("s-old-empty", 1000), defaultSession("s-new-fails", 3000)], messages),
    ).resolves.toEqual({ id: "s-old-empty" })
  })

  it("忽略 archived/parentID/non-default-title", async () => {
    const messages = vi.fn(async () => [])
    const archived = defaultSession("s-archived", 4000)
    const archivedAtEpoch = defaultSession("s-archived-at-epoch", 3500)

    await expect(
      findReusableDefaultSession(
        [
          { ...archived, time: { ...archived.time, archived: 123 } },
          { ...archivedAtEpoch, time: { ...archivedAtEpoch.time, archived: 0 } },
          { ...defaultSession("s-child", 3000), parentID: "parent" },
          { ...defaultSession("s-titled", 2000), title: "Feature work" },
          defaultSession("s-valid", 1000),
        ],
        messages,
      ),
    ).resolves.toEqual({ id: "s-valid" })

    expect(messages).toHaveBeenCalledTimes(1)
    expect(messages).toHaveBeenCalledWith("s-valid")
  })

  it("无候选时返回 null", async () => {
    const messages = vi.fn(async () => [])

    await expect(
      findReusableDefaultSession(
        [
          { ...defaultSession("s-child", 3000), parentID: "parent" },
          { ...defaultSession("s-titled", 2000), title: "Feature work" },
        ],
        messages,
      ),
    ).resolves.toBeNull()

    expect(messages).not.toHaveBeenCalled()
  })
})

describe("findReusableDefaultSessionFallback", () => {
  it("当前 sessions 非空时不调用 list", async () => {
    const list = vi.fn(async () => [defaultSession("s-listed", 2000)])
    const messages = vi.fn(async () => [])

    await expect(
      findReusableDefaultSessionFallback({
        sessions: [defaultSession("s-current", 1000)],
        list,
        messages,
      }),
    ).resolves.toEqual({ id: "s-current" })

    expect(list).not.toHaveBeenCalled()
  })

  it("当前 sessions 为空时调用 list", async () => {
    const list = vi.fn(async () => [defaultSession("s-listed", 2000)])
    const messages = vi.fn(async () => [])

    await expect(
      findReusableDefaultSessionFallback({
        sessions: [],
        list,
        messages,
      }),
    ).resolves.toEqual({ id: "s-listed" })

    expect(list).toHaveBeenCalledTimes(1)
  })
})

describe("switchSessionWithTabRollback", () => {
  it("切换成功后 currentSession.id 与 active_tab 一致", async () => {
    const state = {
      currentSessionId: "s1",
      activeTab: "s1",
      openTabs: ["s1"],
    }

    const ok = await switchSessionWithTabRollback({
      sessionId: "s2",
      previousSessionId: state.currentSessionId,
      previousActiveTab: state.activeTab,
      existed: false,
      open: (id) => {
        if (!state.openTabs.includes(id)) state.openTabs.push(id)
        state.activeTab = id
      },
      activate: (id) => {
        state.activeTab = id
      },
      remove: (id) => {
        state.openTabs = state.openTabs.filter((tab) => tab !== id)
      },
      switchTo: async (id) => {
        state.currentSessionId = id
      },
    })

    expect(ok).toBe(true)
    expect(state.currentSessionId).toBe("s2")
    expect(state.activeTab).toBe("s2")
  })

  it("切换失败时回滚 active_tab，并与 currentSession 保持一致", async () => {
    const state = {
      currentSessionId: "s1",
      activeTab: "s2",
      openTabs: ["s1", "s2"],
    }

    const ok = await switchSessionWithTabRollback({
      sessionId: "s3",
      previousSessionId: state.currentSessionId,
      previousActiveTab: state.activeTab,
      existed: false,
      open: (id) => {
        if (!state.openTabs.includes(id)) state.openTabs.push(id)
        state.activeTab = id
      },
      activate: (id) => {
        state.activeTab = id
      },
      remove: (id) => {
        state.openTabs = state.openTabs.filter((tab) => tab !== id)
      },
      switchTo: async () => {
        throw new Error("boom")
      },
    })

    expect(ok).toBe(false)
    expect(state.currentSessionId).toBe("s1")
    expect(state.activeTab).toBe("s1")
    expect(state.openTabs).toEqual(["s1", "s2"])
  })
})

describe("prepareSession", () => {
  it("draft 可复用时打开并切换，不创建新会话", async () => {
    const create = vi.fn()
    const open = vi.fn()
    const switchTo = vi.fn().mockResolvedValue(undefined)
    const setDraft = vi.fn()

    await prepareSession({
      draft: "s-draft",
      reusable: vi.fn().mockResolvedValue("reusable"),
      create,
      open,
      switchTo,
      setDraft,
      fail: vi.fn(),
    })

    expect(open).toHaveBeenCalledWith("s-draft")
    expect(switchTo).toHaveBeenCalledWith("s-draft")
    expect(create).not.toHaveBeenCalled()
    expect(setDraft).not.toHaveBeenCalled()
  })

  it("draft 明确不可复用时清理指针并复用 fallback", async () => {
    const open = vi.fn()
    const switchTo = vi.fn().mockResolvedValue(undefined)
    const setDraft = vi.fn()

    await prepareSession({
      draft: "s-used",
      reusable: vi.fn().mockResolvedValue("not_reusable"),
      fallback: vi.fn().mockResolvedValue({ id: "s-empty" }),
      create: vi.fn(),
      open,
      switchTo,
      setDraft,
      fail: vi.fn(),
    })

    expect(setDraft).toHaveBeenNthCalledWith(1, null)
    expect(open).toHaveBeenCalledWith("s-empty")
    expect(switchTo).toHaveBeenCalledWith("s-empty")
    expect(setDraft).toHaveBeenLastCalledWith("s-empty")
  })

  it("draft 状态 unknown 时不清理指针并继续 fallback", async () => {
    const setDraft = vi.fn()

    await prepareSession({
      draft: "s-unknown",
      reusable: vi.fn().mockResolvedValue("unknown"),
      fallback: vi.fn().mockResolvedValue({ id: "s-empty" }),
      create: vi.fn(),
      open: vi.fn(),
      switchTo: vi.fn().mockResolvedValue(undefined),
      setDraft,
      fail: vi.fn(),
    })

    expect(setDraft).not.toHaveBeenCalledWith(null)
    expect(setDraft).toHaveBeenCalledWith("s-empty")
  })

  it("draft 可复用但切换失败时保留指针并继续创建新会话", async () => {
    const setDraft = vi.fn()

    await prepareSession({
      draft: "s-draft",
      reusable: vi.fn().mockResolvedValue("reusable"),
      create: vi.fn().mockResolvedValue({ id: "s-new" }),
      open: vi.fn(),
      switchTo: vi.fn().mockRejectedValue(new Error("switch failed")),
      setDraft,
      fail: vi.fn(),
    })

    expect(setDraft).not.toHaveBeenCalledWith(null)
    expect(setDraft).toHaveBeenCalledWith("s-new")
  })

  it("draft 可复用但切换失败且 create 返回 null 时保留指针并调用 fail", async () => {
    const setDraft = vi.fn()
    const fail = vi.fn()

    await prepareSession({
      draft: "s-draft",
      reusable: vi.fn().mockResolvedValue("reusable"),
      create: vi.fn().mockResolvedValue(null),
      open: vi.fn(),
      switchTo: vi.fn().mockRejectedValue(new Error("switch failed")),
      setDraft,
      fail,
    })

    expect(setDraft).not.toHaveBeenCalledWith(null)
    expect(fail).toHaveBeenCalledTimes(1)
  })

  it("没有 draft 和 fallback 时创建新会话", async () => {
    const open = vi.fn()
    const setDraft = vi.fn()

    await prepareSession({
      draft: null,
      reusable: vi.fn(),
      fallback: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "s-new" }),
      open,
      switchTo: vi.fn().mockResolvedValue(undefined),
      setDraft,
      fail: vi.fn(),
    })

    expect(open).toHaveBeenCalledWith("s-new")
    expect(setDraft).toHaveBeenCalledWith("s-new")
  })

  it("fallback reject 时继续创建新会话", async () => {
    const open = vi.fn()
    const setDraft = vi.fn()

    await prepareSession({
      draft: null,
      reusable: vi.fn(),
      fallback: vi.fn().mockRejectedValue(new Error("fallback failed")),
      create: vi.fn().mockResolvedValue({ id: "s-new" }),
      open,
      switchTo: vi.fn().mockResolvedValue(undefined),
      setDraft,
      fail: vi.fn(),
    })

    expect(open).toHaveBeenCalledWith("s-new")
    expect(setDraft).toHaveBeenCalledWith("s-new")
  })

  it("fallback 切换失败时继续创建新会话", async () => {
    const open = vi.fn()
    const setDraft = vi.fn()

    await prepareSession({
      draft: null,
      reusable: vi.fn(),
      fallback: vi.fn().mockResolvedValue({ id: "s-empty" }),
      create: vi.fn().mockResolvedValue({ id: "s-new" }),
      open,
      switchTo: vi.fn().mockRejectedValue(new Error("switch failed")),
      setDraft,
      fail: vi.fn(),
    })

    expect(open).toHaveBeenCalledWith("s-empty")
    expect(open).toHaveBeenCalledWith("s-new")
    expect(setDraft).toHaveBeenCalledWith("s-new")
    expect(setDraft).not.toHaveBeenCalledWith("s-empty")
  })

  it("create 返回 null 时调用 fail", async () => {
    const fail = vi.fn()

    await prepareSession({
      draft: null,
      reusable: vi.fn(),
      fallback: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(null),
      open: vi.fn(),
      switchTo: vi.fn().mockResolvedValue(undefined),
      setDraft: vi.fn(),
      fail,
    })

    expect(fail).toHaveBeenCalledTimes(1)
  })

  it("兼容 boolean reusable true", async () => {
    const create = vi.fn()
    const open = vi.fn()

    await prepareSession({
      draft: "s-draft",
      reusable: vi.fn().mockResolvedValue(true),
      create,
      open,
      switchTo: vi.fn().mockResolvedValue(undefined),
      setDraft: vi.fn(),
      fail: vi.fn(),
    })

    expect(open).toHaveBeenCalledWith("s-draft")
    expect(create).not.toHaveBeenCalled()
  })

  it("兼容 boolean reusable false", async () => {
    const setDraft = vi.fn()

    await prepareSession({
      draft: "s-used",
      reusable: vi.fn().mockResolvedValue(false),
      fallback: vi.fn().mockResolvedValue({ id: "s-empty" }),
      create: vi.fn(),
      open: vi.fn(),
      switchTo: vi.fn().mockResolvedValue(undefined),
      setDraft,
      fail: vi.fn(),
    })

    expect(setDraft).toHaveBeenNthCalledWith(1, null)
    expect(setDraft).toHaveBeenLastCalledWith("s-empty")
  })

  it("reusable 返回非法值时按 unknown 处理并继续 fallback", async () => {
    const setDraft = vi.fn()

    await prepareSession({
      draft: "s-weird",
      reusable: vi.fn().mockResolvedValue("invalid"),
      fallback: vi.fn().mockResolvedValue({ id: "s-empty" }),
      create: vi.fn(),
      open: vi.fn(),
      switchTo: vi.fn().mockResolvedValue(undefined),
      setDraft,
      fail: vi.fn(),
    })

    expect(setDraft).not.toHaveBeenCalledWith(null)
    expect(setDraft).toHaveBeenCalledWith("s-empty")
  })

  it("create reject 时调用 fail", async () => {
    const fail = vi.fn()

    await prepareSession({
      draft: null,
      reusable: vi.fn(),
      fallback: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockRejectedValue(new Error("create failed")),
      open: vi.fn(),
      switchTo: vi.fn().mockResolvedValue(undefined),
      setDraft: vi.fn(),
      fail,
    })

    expect(fail).toHaveBeenCalledTimes(1)
  })

  it("reusable throw 时按 unknown 处理且不清理 draft", async () => {
    const setDraft = vi.fn()

    await prepareSession({
      draft: "s-draft",
      reusable: vi.fn().mockRejectedValue(new Error("check failed")),
      fallback: vi.fn().mockResolvedValue({ id: "s-empty" }),
      create: vi.fn(),
      open: vi.fn(),
      switchTo: vi.fn().mockResolvedValue(undefined),
      setDraft,
      fail: vi.fn(),
    })

    expect(setDraft).not.toHaveBeenCalledWith(null)
    expect(setDraft).toHaveBeenCalledWith("s-empty")
  })

  it("checkDraftSessionReusable 返回 unknown 时不清理 draft", async () => {
    const setDraft = vi.fn()
    vi.mocked(sdk.session.get).mockResolvedValue(sessionGetResult(null, { message: "boom" }))

    await prepareSession({
      draft: "s-draft",
      reusable: checkDraftSessionReusable,
      fallback: vi.fn().mockResolvedValue({ id: "s-empty" }),
      create: vi.fn(),
      open: vi.fn(),
      switchTo: vi.fn().mockResolvedValue(undefined),
      setDraft,
      fail: vi.fn(),
    })

    expect(setDraft).not.toHaveBeenCalledWith(null)
    expect(setDraft).toHaveBeenCalledWith("s-empty")
  })
})

describe("checkDraftSessionReusable", () => {
  it("get throw 时返回 unknown", async () => {
    vi.mocked(sdk.session.get).mockRejectedValue(new Error("boom"))

    await expect(checkDraftSessionReusable("s-draft")).resolves.toBe("unknown")
  })

  it("get response.error 时返回 unknown", async () => {
    vi.mocked(sdk.session.get).mockResolvedValue(sessionGetResult(null, { message: "boom" }))

    await expect(checkDraftSessionReusable("s-draft")).resolves.toBe("unknown")
  })

  it("get response.error 明确 404/not-found 时返回 not_reusable", async () => {
    vi.mocked(sdk.session.get).mockResolvedValue(
      sessionGetResult(null, { message: "session not found", statusCode: 404 }),
    )

    await expect(checkDraftSessionReusable("s-draft")).resolves.toBe("not_reusable")
  })

  it("get response.error 为 SDK NotFoundError shape 时返回 not_reusable", async () => {
    vi.mocked(sdk.session.get).mockResolvedValue(
      sessionGetResult(null, { name: "NotFoundError", data: { message: "Session not found" } }),
    )

    await expect(checkDraftSessionReusable("s-draft")).resolves.toBe("not_reusable")
  })

  it("get response.error message 包含 not-found 时返回 not_reusable", async () => {
    vi.mocked(sdk.session.get).mockResolvedValue(sessionGetResult(null, { message: "session not-found" }))

    await expect(checkDraftSessionReusable("s-draft")).resolves.toBe("not_reusable")
  })

  it("get response.error data.message 包含 not-found 时返回 not_reusable", async () => {
    vi.mocked(sdk.session.get).mockResolvedValue(sessionGetResult(null, { data: { message: "session not-found" } }))

    await expect(checkDraftSessionReusable("s-draft")).resolves.toBe("not_reusable")
  })

  it("get throw 明确 not-found 时返回 not_reusable", async () => {
    vi.mocked(sdk.session.get).mockRejectedValue(new Error("404 not found"))

    await expect(checkDraftSessionReusable("s-draft")).resolves.toBe("not_reusable")
  })

  it("get 返回空 data 且无 error 时返回 not_reusable", async () => {
    vi.mocked(sdk.session.get).mockResolvedValue(sessionGetResult(null, null))

    await expect(checkDraftSessionReusable("s-draft")).resolves.toBe("not_reusable")
  })

  it("messages throw 时返回 unknown", async () => {
    vi.mocked(sdk.session.get).mockResolvedValue(sessionGetResult({ id: "s-draft" }, null))
    vi.mocked(sdk.session.messages).mockRejectedValue(new Error("boom"))

    await expect(checkDraftSessionReusable("s-draft")).resolves.toBe("unknown")
  })

  it("messages response.error 时返回 unknown", async () => {
    vi.mocked(sdk.session.get).mockResolvedValue(sessionGetResult({ id: "s-draft" }, null))
    vi.mocked(sdk.session.messages).mockResolvedValue(sessionMessagesResult(null, { message: "boom" }))

    await expect(checkDraftSessionReusable("s-draft")).resolves.toBe("unknown")
  })

  it("messages data 缺失且无 error 时返回 unknown", async () => {
    vi.mocked(sdk.session.get).mockResolvedValue(sessionGetResult({ id: "s-draft" }, null))
    vi.mocked(sdk.session.messages).mockResolvedValue(sessionMessagesResult(null, null))

    await expect(checkDraftSessionReusable("s-draft")).resolves.toBe("unknown")
  })

  it("messages empty array 时返回 reusable", async () => {
    vi.mocked(sdk.session.get).mockResolvedValue(sessionGetResult({ id: "s-draft" }, null))
    vi.mocked(sdk.session.messages).mockResolvedValue(sessionMessagesResult([], null))

    await expect(checkDraftSessionReusable("s-draft")).resolves.toBe("reusable")
  })

  it("messages non-empty array 时返回 not_reusable", async () => {
    vi.mocked(sdk.session.get).mockResolvedValue(sessionGetResult({ id: "s-draft" }, null))
    vi.mocked(sdk.session.messages).mockResolvedValue(sessionMessagesResult([{ id: "m-1" }], null))

    await expect(checkDraftSessionReusable("s-draft")).resolves.toBe("not_reusable")
  })
})

describe("handleSessionUiEvent", () => {
  it("session.idle 会恢复对应会话的 idle 状态且不弹 toast", () => {
    const showToast = vi.fn()
    const setSessionIdle = vi.fn()

    handleSessionUiEvent({
      event: { type: "session.idle", properties: { sessionID: "s-1" } },
      currentSessionId: "s-2",
      setSessionIdle,
      showToast,
    })

    expect(setSessionIdle).toHaveBeenCalledTimes(1)
    expect(setSessionIdle).toHaveBeenCalledWith("s-1", true)
    expect(showToast).not.toHaveBeenCalled()
  })

  it("session.compacted 仅对当前会话显示中文提示", () => {
    const showToast = vi.fn()
    const setSessionIdle = vi.fn()

    handleSessionUiEvent({
      event: { type: "session.compacted", properties: { sessionID: "s-1" } },
      currentSessionId: "s-1",
      setSessionIdle,
      showToast,
    })

    handleSessionUiEvent({
      event: { type: "session.compacted", properties: { sessionID: "s-2" } },
      currentSessionId: "s-1",
      setSessionIdle,
      showToast,
    })

    expect(showToast).toHaveBeenCalledTimes(1)
    expect(showToast).toHaveBeenCalledWith("会话历史已压缩以节省空间", {
      title: "会话已压缩",
      variant: "info",
      duration: 5000,
    })
  })
})
