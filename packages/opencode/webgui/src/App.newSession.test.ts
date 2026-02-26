import { describe, expect, it, vi } from "vitest"
import { prepareSession } from "./App"

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
    expect(setDraft).toHaveBeenNthCalledWith(1, null)
    expect(create).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith("s-new")
    expect(setDraft).toHaveBeenNthCalledWith(2, "s-new")
    expect(fail).not.toHaveBeenCalled()
  })

  it("treats reusable check errors as invalid draft", async () => {
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

    expect(setDraft).toHaveBeenNthCalledWith(1, null)
    expect(create).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith("s-new")
    expect(setDraft).toHaveBeenNthCalledWith(2, "s-new")
    expect(switchTo).not.toHaveBeenCalled()
    expect(fail).not.toHaveBeenCalled()
  })
})
