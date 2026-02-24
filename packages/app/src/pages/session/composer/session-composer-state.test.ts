import { describe, expect, test } from "bun:test"
import { composerLocked, sessionLoading } from "./session-composer-loading"

describe("sessionLoading", () => {
  test("returns false without session id", () => {
    expect(sessionLoading(undefined, {}, false, false)).toBe(false)
  })

  test("returns true before first load starts", () => {
    expect(sessionLoading("ses_1", {}, false, false)).toBe(true)
  })

  test("returns true while load is in flight", () => {
    expect(sessionLoading("ses_1", {}, true, true)).toBe(true)
  })

  test("returns false when session messages exist", () => {
    expect(sessionLoading("ses_1", { ses_1: [] }, false, true)).toBe(false)
  })

  test("returns false after load fails and settles", () => {
    expect(sessionLoading("ses_1", {}, false, true)).toBe(false)
  })
})

describe("composerLocked", () => {
  test("returns true when blocked", () => {
    expect(composerLocked(true, false)).toBe(true)
  })

  test("returns true when loading", () => {
    expect(composerLocked(false, true)).toBe(true)
  })

  test("returns false only when interactive", () => {
    expect(composerLocked(false, false)).toBe(false)
  })
})
