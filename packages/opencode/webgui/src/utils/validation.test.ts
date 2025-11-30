import { describe, it, expect } from "vitest"
import { isValidEmail, isValidUrl, isValidHttpUrl, isEmpty, isNotEmpty, isNumber, isDigits } from "./validation"

describe("isValidEmail", () => {
  it("validates correct email addresses", () => {
    expect(isValidEmail("test@example.com")).toBe(true)
    expect(isValidEmail("user.name@example.co.uk")).toBe(true)
    expect(isValidEmail("user+tag@example.com")).toBe(true)
  })

  it("rejects invalid email addresses", () => {
    expect(isValidEmail("invalid")).toBe(false)
    expect(isValidEmail("invalid@")).toBe(false)
    expect(isValidEmail("@example.com")).toBe(false)
    expect(isValidEmail("user @example.com")).toBe(false)
    expect(isValidEmail("user@example")).toBe(false)
  })
})

describe("isValidUrl", () => {
  it("validates correct URLs", () => {
    expect(isValidUrl("https://example.com")).toBe(true)
    expect(isValidUrl("http://example.com")).toBe(true)
    expect(isValidUrl("ftp://example.com")).toBe(true)
    expect(isValidUrl("https://example.com/path?query=value")).toBe(true)
  })

  it("rejects invalid URLs", () => {
    expect(isValidUrl("not a url")).toBe(false)
    expect(isValidUrl("example.com")).toBe(false)
    expect(isValidUrl("")).toBe(false)
  })
})

describe("isValidHttpUrl", () => {
  it("validates HTTP/HTTPS URLs", () => {
    expect(isValidHttpUrl("https://example.com")).toBe(true)
    expect(isValidHttpUrl("http://example.com")).toBe(true)
  })

  it("rejects non-HTTP(S) URLs", () => {
    expect(isValidHttpUrl("ftp://example.com")).toBe(false)
    expect(isValidHttpUrl("file:///path/to/file")).toBe(false)
    expect(isValidHttpUrl("not a url")).toBe(false)
  })
})

describe("isEmpty", () => {
  it("returns true for empty strings", () => {
    expect(isEmpty("")).toBe(true)
    expect(isEmpty("   ")).toBe(true)
    expect(isEmpty("\t\n")).toBe(true)
  })

  it("returns true for null and undefined", () => {
    expect(isEmpty(null)).toBe(true)
    expect(isEmpty(undefined)).toBe(true)
  })

  it("returns false for non-empty strings", () => {
    expect(isEmpty("hello")).toBe(false)
    expect(isEmpty(" hello ")).toBe(false)
  })
})

describe("isNotEmpty", () => {
  it("returns false for empty strings", () => {
    expect(isNotEmpty("")).toBe(false)
    expect(isNotEmpty("   ")).toBe(false)
  })

  it("returns false for null and undefined", () => {
    expect(isNotEmpty(null)).toBe(false)
    expect(isNotEmpty(undefined)).toBe(false)
  })

  it("returns true for non-empty strings", () => {
    expect(isNotEmpty("hello")).toBe(true)
    expect(isNotEmpty(" hello ")).toBe(true)
  })
})

describe("isNumber", () => {
  it("returns true for valid numbers", () => {
    expect(isNumber(0)).toBe(true)
    expect(isNumber(123)).toBe(true)
    expect(isNumber(-123)).toBe(true)
    expect(isNumber(123.45)).toBe(true)
  })

  it("returns false for invalid numbers", () => {
    expect(isNumber(NaN)).toBe(false)
    expect(isNumber(Infinity)).toBe(false)
    expect(isNumber(-Infinity)).toBe(false)
  })

  it("returns false for non-numbers", () => {
    expect(isNumber("123")).toBe(false)
    expect(isNumber(null)).toBe(false)
    expect(isNumber(undefined)).toBe(false)
    expect(isNumber({})).toBe(false)
  })
})

describe("isDigits", () => {
  it("returns true for digit strings", () => {
    expect(isDigits("123")).toBe(true)
    expect(isDigits("0")).toBe(true)
    expect(isDigits("999999")).toBe(true)
  })

  it("returns false for non-digit strings", () => {
    expect(isDigits("12.3")).toBe(false)
    expect(isDigits("abc")).toBe(false)
    expect(isDigits("12a")).toBe(false)
    expect(isDigits("-123")).toBe(false)
    expect(isDigits("")).toBe(false)
  })
})
