import { describe, expect, it } from "vitest"
import { render } from "@testing-library/react"
import { getBlockedIcon, getBlockedClasses, getBorderColor } from "./utils"

describe("getBlockedIcon", () => {
  it("permission 类型返回三角警告图标", () => {
    const icon = getBlockedIcon("permission")
    const { container } = render(icon)
    const svg = container.querySelector("svg")
    expect(svg).toBeTruthy()
    expect(svg?.classList.contains("text-amber-500")).toBe(true)
  })

  it("question 类型返回问号圆圈图标", () => {
    const icon = getBlockedIcon("question")
    const { container } = render(icon)
    const svg = container.querySelector("svg")
    expect(svg).toBeTruthy()
    expect(svg?.classList.contains("text-blue-500")).toBe(true)
  })
})

describe("getBlockedClasses", () => {
  it("permission 返回琥珀色背景类", () => {
    const cls = getBlockedClasses("permission")
    expect(cls).toContain("bg-amber-50/50")
    expect(cls).toContain("text-amber-700")
  })

  it("question 返回蓝色背景类", () => {
    const cls = getBlockedClasses("question")
    expect(cls).toContain("bg-blue-50/50")
    expect(cls).toContain("text-blue-700")
  })
})

describe("getBorderColor", () => {
  it("blocked 为 permission 时返回琥珀色边框", () => {
    const cls = getBorderColor("running", false, "permission")
    expect(cls).toContain("border-amber-400")
  })

  it("blocked 为 question 时返回蓝色边框", () => {
    const cls = getBorderColor("running", false, "question")
    expect(cls).toContain("border-blue-500")
  })

  it("blocked 为 null 时保持原有行为", () => {
    const cls = getBorderColor("running", false, null)
    expect(cls).toContain("border-gray-200")
  })

  it("error 状态始终优先", () => {
    const cls = getBorderColor("running", false, "permission")
    expect(cls).toContain("border-amber-400")
    const err = getBorderColor("error", false, "permission")
    expect(err).toContain("border-red-300")
  })
})
