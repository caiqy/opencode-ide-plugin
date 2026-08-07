import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../lib/ideBridge", () => ({
  ideBridge: {
    isInstalled: vi.fn(),
    storageGet: vi.fn(),
    storageSet: vi.fn(),
  },
}))

import { ideBridge } from "../lib/ideBridge"
import {
  flushScopedStateWrites,
  resetScopedStateForTest,
  scopedStateGetJSON,
  scopedStateSetJSON,
  setScopedStateWriteErrorReporter,
} from "./scopedStorage"

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe("scopedStorage", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-02-26T00:00:00Z"))
    resetScopedStateForTest()
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it("三域 global/workspace/mem 读写与 cache 行为", async () => {
    vi.mocked(ideBridge.isInstalled).mockReturnValue(true)
    vi.mocked(ideBridge.storageGet).mockResolvedValue({
      "opencode:webgui:workspace:tabs:v1": JSON.stringify({ open_tabs: ["s1"], active_tab: "s1" }),
    })

    await scopedStateSetJSON("mem", "opencode:webgui:mem:runtime:v1", { panel: "chat" })
    const tabs = await scopedStateGetJSON("workspace", "opencode:webgui:workspace:tabs:v1", {
      open_tabs: [],
      active_tab: "",
    })
    const mem = await scopedStateGetJSON("mem", "opencode:webgui:mem:runtime:v1", {})

    expect(tabs.active_tab).toBe("s1")
    expect(mem).toEqual({ panel: "chat" })
    expect(ideBridge.storageGet).toHaveBeenCalledWith("workspace", ["opencode:webgui:workspace:tabs:v1"])
  })

  it("host 写失败按 key+error 节流告警", async () => {
    vi.mocked(ideBridge.isInstalled).mockReturnValue(true)
    vi.mocked(ideBridge.storageSet).mockResolvedValue(false)

    const report = vi.fn()
    setScopedStateWriteErrorReporter(report)

    await scopedStateSetJSON("global", "opencode:webgui:global:theme:v1", "dark")
    await scopedStateSetJSON("global", "opencode:webgui:global:theme:v1", "light")
    expect(report).toHaveBeenCalledTimes(1)

    vi.setSystemTime(new Date("2026-02-26T00:00:06Z"))
    await scopedStateSetJSON("global", "opencode:webgui:global:theme:v1", "dark")
    expect(report).toHaveBeenCalledTimes(2)
  })

  it("JSON 解析失败返回 fallback", async () => {
    vi.mocked(ideBridge.isInstalled).mockReturnValue(true)
    vi.mocked(ideBridge.storageGet).mockResolvedValue({
      "opencode:webgui:workspace:last_selection:v1": "{bad-json",
    })

    const value = await scopedStateGetJSON("workspace", "opencode:webgui:workspace:last_selection:v1", {
      agent: "build",
    })

    expect(value).toEqual({ agent: "build" })
  })

  it("无 ideBridge 时 global/workspace 会写入 localStorage 并可读回", async () => {
    vi.mocked(ideBridge.isInstalled).mockReturnValue(false)

    await scopedStateSetJSON("workspace", "opencode:webgui:workspace:tabs:v1", {
      open_tabs: ["s1"],
      active_tab: "s1",
    })
    await scopedStateSetJSON("global", "opencode:webgui:global:theme:v1", "dark")

    resetScopedStateForTest()
    vi.mocked(ideBridge.isInstalled).mockReturnValue(false)

    await expect(
      scopedStateGetJSON("workspace", "opencode:webgui:workspace:tabs:v1", {
        open_tabs: [],
        active_tab: "",
      }),
    ).resolves.toEqual({ open_tabs: ["s1"], active_tab: "s1" })
    await expect(scopedStateGetJSON("global", "opencode:webgui:global:theme:v1", "light")).resolves.toBe("dark")
  })

  it("无 ideBridge 时 mem 只保存在内存且不进入 localStorage", async () => {
    vi.mocked(ideBridge.isInstalled).mockReturnValue(false)

    await scopedStateSetJSON("mem", "opencode:webgui:mem:runtime:v1", { panel: "chat" })

    expect(localStorage.getItem("opencode:webgui:scoped:mem:opencode:webgui:mem:runtime:v1")).toBeNull()
    await expect(scopedStateGetJSON("mem", "opencode:webgui:mem:runtime:v1", {})).resolves.toEqual({ panel: "chat" })

    resetScopedStateForTest()
    vi.mocked(ideBridge.isInstalled).mockReturnValue(false)
    await expect(scopedStateGetJSON("mem", "opencode:webgui:mem:runtime:v1", {})).resolves.toEqual({})
  })

  it("localStorage 写失败时保留内存值并报告写入失败", async () => {
    vi.mocked(ideBridge.isInstalled).mockReturnValue(false)
    const report = vi.fn()
    setScopedStateWriteErrorReporter(report)
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota")
    })

    try {
      await scopedStateSetJSON("workspace", "opencode:webgui:workspace:draft_session:v1", "s1")

      await expect(scopedStateGetJSON("workspace", "opencode:webgui:workspace:draft_session:v1", null)).resolves.toBe(
        "s1",
      )
      expect(report).toHaveBeenCalledWith({
        key: "opencode:webgui:workspace:draft_session:v1",
        error: "host_write_failed",
        message: "设置未保存，本次会话可继续使用",
      })
    } finally {
      setItem.mockRestore()
    }
  })

  it("localStorage 写失败且已有旧值时优先读取内存新值", async () => {
    vi.mocked(ideBridge.isInstalled).mockReturnValue(false)
    localStorage.setItem(
      "opencode:webgui:scoped:workspace:opencode:webgui:workspace:draft_session:v1",
      JSON.stringify("old"),
    )
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota")
    })

    try {
      await scopedStateSetJSON("workspace", "opencode:webgui:workspace:draft_session:v1", "new")

      await expect(scopedStateGetJSON("workspace", "opencode:webgui:workspace:draft_session:v1", null)).resolves.toBe(
        "new",
      )
    } finally {
      setItem.mockRestore()
    }
  })

  it("host 写失败且返回旧值时优先读取内存新值", async () => {
    vi.mocked(ideBridge.isInstalled).mockReturnValue(true)
    vi.mocked(ideBridge.storageSet).mockResolvedValue(false)
    vi.mocked(ideBridge.storageGet).mockResolvedValue({
      "opencode:webgui:workspace:draft_session:v1": JSON.stringify("old"),
    })

    await scopedStateSetJSON("workspace", "opencode:webgui:workspace:draft_session:v1", "new")

    await expect(scopedStateGetJSON("workspace", "opencode:webgui:workspace:draft_session:v1", null)).resolves.toBe(
      "new",
    )
  })

  it("在途宿主读取期间成功写入后不返回或覆盖为旧值", async () => {
    vi.mocked(ideBridge.isInstalled).mockReturnValue(true)
    const host = deferred<Record<string, string | undefined>>()
    vi.mocked(ideBridge.storageGet).mockReturnValue(host.promise)
    vi.mocked(ideBridge.storageSet).mockResolvedValue(true)

    const reading = scopedStateGetJSON("workspace", "opencode:webgui:workspace:draft_session:v1", null)
    await vi.waitFor(() => expect(ideBridge.storageGet).toHaveBeenCalledTimes(1))
    await expect(scopedStateSetJSON("workspace", "opencode:webgui:workspace:draft_session:v1", "new")).resolves.toEqual({
      ok: true,
    })

    host.resolve({ "opencode:webgui:workspace:draft_session:v1": JSON.stringify("old") })

    await expect(reading).resolves.toBe("new")
  })

  it("读取开始时的待写入成功后不返回或缓存旧值", async () => {
    vi.mocked(ideBridge.isInstalled).mockReturnValue(true)
    const storageSet = deferred<boolean>()
    const storageGet = deferred<Record<string, string | undefined>>()
    vi.mocked(ideBridge.storageSet).mockReturnValue(storageSet.promise)
    vi.mocked(ideBridge.storageGet).mockImplementationOnce(() => storageGet.promise).mockResolvedValue({})

    const writing = scopedStateSetJSON("workspace", "opencode:webgui:workspace:draft_session:v1", "new")
    await vi.waitFor(() => expect(ideBridge.storageSet).toHaveBeenCalledTimes(1))

    const reading = scopedStateGetJSON("workspace", "opencode:webgui:workspace:draft_session:v1", null)
    await vi.waitFor(() => expect(ideBridge.storageGet).toHaveBeenCalledTimes(1))

    storageSet.resolve(true)
    await expect(writing).resolves.toEqual({ ok: true })

    storageGet.resolve({ "opencode:webgui:workspace:draft_session:v1": JSON.stringify("old") })
    await expect(reading).resolves.toBe("new")
    await expect(scopedStateGetJSON("workspace", "opencode:webgui:workspace:draft_session:v1", null)).resolves.toBe(
      "new",
    )
  })

  it("host 写失败留下 dirty key 时 flush 拒绝，后续成功写入后恢复", async () => {
    vi.mocked(ideBridge.isInstalled).mockReturnValue(true)
    vi.mocked(ideBridge.storageSet).mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    await expect(scopedStateSetJSON("workspace", "opencode:webgui:workspace:tabs:v1", { open_tabs: [] })).resolves.toEqual({
      ok: false,
      error: "host_write_failed",
    })
    await expect(flushScopedStateWrites()).rejects.toThrow("Scoped storage has unsaved state")

    await expect(scopedStateSetJSON("workspace", "opencode:webgui:workspace:tabs:v1", { open_tabs: ["s1"] })).resolves.toEqual({
      ok: true,
    })
    await expect(flushScopedStateWrites()).resolves.toBeUndefined()
  })

  it("ideBridge installed 时 storageSet 成功路径走 host storage 且不写 localStorage", async () => {
    vi.mocked(ideBridge.isInstalled).mockReturnValue(true)
    vi.mocked(ideBridge.storageSet).mockResolvedValue(true)
    const setItem = vi.spyOn(Storage.prototype, "setItem")

    try {
      await scopedStateSetJSON("workspace", "opencode:webgui:workspace:draft_session:v1", "s1")

      expect(ideBridge.storageSet).toHaveBeenCalledWith(
        "workspace",
        "opencode:webgui:workspace:draft_session:v1",
        '"s1"',
      )
      expect(setItem).not.toHaveBeenCalled()
      expect(
        localStorage.getItem("opencode:webgui:scoped:workspace:opencode:webgui:workspace:draft_session:v1"),
      ).toBeNull()
    } finally {
      setItem.mockRestore()
    }
  })

  it("不同 key 写入不会互相阻塞", async () => {
    vi.mocked(ideBridge.isInstalled).mockReturnValue(true)
    const first = deferred<boolean>()
    vi.mocked(ideBridge.storageSet).mockImplementationOnce(() => first.promise).mockResolvedValueOnce(true)

    const one = scopedStateSetJSON("workspace", "key-a", "one")
    const two = scopedStateSetJSON("workspace", "key-b", "two")

    await vi.waitFor(() => expect(ideBridge.storageSet).toHaveBeenCalledTimes(2))
    await expect(two).resolves.toEqual({ ok: true })
    first.resolve(true)
    await expect(one).resolves.toEqual({ ok: true })
  })

  it("同 key 写入串行执行且待写期间读取内存最新值", async () => {
    vi.mocked(ideBridge.isInstalled).mockReturnValue(true)
    const first = deferred<boolean>()
    vi.mocked(ideBridge.storageSet).mockImplementationOnce(() => first.promise).mockResolvedValueOnce(true)
    vi.mocked(ideBridge.storageGet).mockResolvedValue({
      "opencode:webgui:workspace:tabs:v1": JSON.stringify({ open_tabs: ["old"], active_tab: "old" }),
    })

    const one = scopedStateSetJSON("workspace", "opencode:webgui:workspace:tabs:v1", {
      open_tabs: ["s1"],
      active_tab: "s1",
    })
    const two = scopedStateSetJSON("workspace", "opencode:webgui:workspace:tabs:v1", {
      open_tabs: ["s1", "s2"],
      active_tab: "s2",
    })

    await vi.waitFor(() => expect(ideBridge.storageSet).toHaveBeenCalledTimes(1))
    await expect(
      scopedStateGetJSON("workspace", "opencode:webgui:workspace:tabs:v1", {
        open_tabs: [],
        active_tab: "",
      }),
    ).resolves.toEqual({ open_tabs: ["s1", "s2"], active_tab: "s2" })

    first.resolve(true)
    await Promise.all([one, two])
    expect(vi.mocked(ideBridge.storageSet).mock.calls.map((call) => call[2])).toEqual([
      JSON.stringify({ open_tabs: ["s1"], active_tab: "s1" }),
      JSON.stringify({ open_tabs: ["s1", "s2"], active_tab: "s2" }),
    ])
  })

  it("同 key 写失败后继续执行后续写入", async () => {
    vi.mocked(ideBridge.isInstalled).mockReturnValue(true)
    vi.mocked(ideBridge.storageSet).mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    const first = scopedStateSetJSON("workspace", "key", "old")
    const second = scopedStateSetJSON("workspace", "key", "new")

    await expect(first).resolves.toEqual({ ok: false, error: "host_write_failed" })
    await expect(second).resolves.toEqual({ ok: true })
    expect(ideBridge.storageSet).toHaveBeenNthCalledWith(1, "workspace", "key", JSON.stringify("old"))
    expect(ideBridge.storageSet).toHaveBeenNthCalledWith(2, "workspace", "key", JSON.stringify("new"))
  })

  it("flush 等待当前及期间追加的 scoped storage 写入", async () => {
    vi.mocked(ideBridge.isInstalled).mockReturnValue(true)
    const first = deferred<boolean>()
    const second = deferred<boolean>()
    vi.mocked(ideBridge.storageSet).mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise)

    const one = scopedStateSetJSON("workspace", "key", "one")
    let flushed = false
    const flush = flushScopedStateWrites().then(() => {
      flushed = true
    })
    const two = scopedStateSetJSON("workspace", "key", "two")

    await vi.waitFor(() => expect(ideBridge.storageSet).toHaveBeenCalledTimes(1))
    expect(flushed).toBe(false)
    first.resolve(true)
    await vi.waitFor(() => expect(ideBridge.storageSet).toHaveBeenCalledTimes(2))
    expect(flushed).toBe(false)
    second.resolve(true)
    await Promise.all([one, two, flush])
    expect(flushed).toBe(true)
  })
})
