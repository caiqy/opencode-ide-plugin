import { describe, expect, it, vi } from "vitest"
import { chatState, prepareSession, redirectGutterWheel, retryLoad } from "./App"

describe("chatState", () => {
  it("最近页首屏已可用时不展示 loading 或 retry", () => {
    expect(
      chatState({
        loading: true,
        loaded: false,
        error: true,
        ready: true,
      }),
    ).toEqual({ loading: false, error: false, blocked: false })
  })

  it("最近页首屏不可用且请求失败时展示 retry", () => {
    expect(
      chatState({
        loading: false,
        loaded: false,
        error: true,
        ready: false,
      }),
    ).toEqual({ loading: false, error: true, blocked: true })
  })

  it("retry 会重新执行当前会话 activation", async () => {
    const load = vi.fn(async () => {})
    const activate = vi.fn(async () => {})

    await retryLoad({
      id: "s1",
      load,
      activate,
    })

    expect(activate).toHaveBeenCalledWith("s1")
    expect(activate).toHaveBeenCalledTimes(1)
    expect(load).not.toHaveBeenCalled()
  })
})

describe("redirectGutterWheel", () => {
  it("会把中心容器外侧的滚轮转发到消息滚动容器", () => {
    const center = document.createElement("div")
    const main = document.createElement("main")
    const gutter = document.createElement("div")
    const content = document.createElement("div")
    const scrollBy = vi.fn()
    const preventDefault = vi.fn()
    center.append(content)
    Object.defineProperty(main, "scrollBy", { value: scrollBy })

    redirectGutterWheel({ target: gutter, deltaY: 120, preventDefault }, center, main)

    expect(scrollBy).toHaveBeenCalledWith({ top: 120, behavior: "auto" })
    expect(preventDefault).toHaveBeenCalledTimes(1)

    redirectGutterWheel({ target: content, deltaY: 120, preventDefault }, center, main)

    expect(scrollBy).toHaveBeenCalledTimes(1)
  })
})

describe("prepareSession", () => {
  it("reuses valid draft session", async () => {
    const open = vi.fn()
    const setDraft = vi.fn()
    const fail = vi.fn()
    const create = vi.fn(async () => ({ id: "s-new" }))
    const switchTo = vi.fn(async () => {})

    await prepareSession({
      draft: "s-draft",
      reusable: async () => true,
      create,
      open,
      switchTo,
      setDraft,
      fail,
    })

    expect(open).toHaveBeenCalledWith("s-draft")
    expect(switchTo).toHaveBeenCalledWith("s-draft")
    expect(create).not.toHaveBeenCalled()
    expect(fail).not.toHaveBeenCalled()
    expect(setDraft).not.toHaveBeenCalled()
  })

  it("restores and reuses draft session when draft is null", async () => {
    const open = vi.fn()
    const setDraft = vi.fn()
    const fail = vi.fn()
    const create = vi.fn(async () => ({ id: "s-new" }))
    const switchTo = vi.fn(async () => {})
    const restore = vi.fn(async () => "s-draft")

    await prepareSession({
      draft: null,
      restore,
      reusable: async () => true,
      create,
      open,
      switchTo,
      setDraft,
      fail,
    })

    expect(restore).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith("s-draft")
    expect(switchTo).toHaveBeenCalledWith("s-draft")
    expect(create).not.toHaveBeenCalled()
    expect(fail).not.toHaveBeenCalled()
  })

  it("creates new session when draft is invalid", async () => {
    const open = vi.fn()
    const setDraft = vi.fn()
    const fail = vi.fn()
    const create = vi.fn(async () => ({ id: "s-new" }))
    const switchTo = vi.fn(async () => {})

    await prepareSession({
      draft: "s-draft",
      reusable: async () => false,
      create,
      open,
      switchTo,
      setDraft,
      fail,
    })

    expect(setDraft).toHaveBeenNthCalledWith(1, null)
    expect(create).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith("s-new")
    expect(setDraft).toHaveBeenNthCalledWith(2, "s-new")
    expect(fail).not.toHaveBeenCalled()
  })

  it("keeps current state when create fails", async () => {
    const open = vi.fn()
    const setDraft = vi.fn()
    const fail = vi.fn()
    const create = vi.fn(async () => null)
    const switchTo = vi.fn(async () => {})

    await prepareSession({
      draft: null,
      reusable: async () => false,
      create,
      open,
      switchTo,
      setDraft,
      fail,
    })

    expect(create).toHaveBeenCalledTimes(1)
    expect(open).not.toHaveBeenCalled()
    expect(switchTo).not.toHaveBeenCalled()
    expect(setDraft).not.toHaveBeenCalled()
    expect(fail).toHaveBeenCalledTimes(1)
  })

  it("falls back to create when switch session fails", async () => {
    const open = vi.fn()
    const setDraft = vi.fn()
    const fail = vi.fn()
    const create = vi.fn(async () => ({ id: "s-new" }))
    const switchTo = vi.fn(async () => {
      throw new Error("boom")
    })

    await prepareSession({
      draft: "s-draft",
      reusable: async () => true,
      create,
      open,
      switchTo,
      setDraft,
      fail,
    })

    expect(open).toHaveBeenCalledWith("s-draft")
    expect(create).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith("s-new")
    expect(setDraft).not.toHaveBeenCalledWith(null)
    expect(setDraft).toHaveBeenCalledWith("s-new")
    expect(fail).not.toHaveBeenCalled()
  })

  it("treats reusable check errors as unknown and preserves draft pointer", async () => {
    const open = vi.fn()
    const setDraft = vi.fn()
    const fail = vi.fn()
    const create = vi.fn(async () => ({ id: "s-new" }))
    const switchTo = vi.fn(async () => {})

    await prepareSession({
      draft: "s-draft",
      reusable: async () => {
        throw new Error("boom")
      },
      create,
      open,
      switchTo,
      setDraft,
      fail,
    })

    expect(create).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith("s-new")
    expect(setDraft).not.toHaveBeenCalledWith(null)
    expect(setDraft).toHaveBeenCalledWith("s-new")
    expect(switchTo).not.toHaveBeenCalled()
    expect(fail).not.toHaveBeenCalled()
  })
})
