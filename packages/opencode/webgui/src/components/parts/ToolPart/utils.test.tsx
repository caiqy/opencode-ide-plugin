import { describe, expect, it } from "vitest"
import { render } from "@testing-library/react"
import {
  getBlockedIcon,
  getBlockedClasses,
  getBorderColor,
  getStatusClasses,
  getStatusIcon,
  getToolDisplayName,
} from "./utils"

describe("getStatusIcon", () => {
  it("pending 使用无箭头的旋转图标", () => {
    const { container } = render(getStatusIcon("pending"))
    const svg = container.querySelector("svg")
    expect(svg).toBeTruthy()
    expect(svg?.classList.contains("animate-spin")).toBe(true)
    expect(svg?.querySelector("circle[stroke-dasharray='42 15']")).toBeTruthy()
    expect(svg?.querySelector("path")).toBeNull()
  })

  it("running 使用旋转加载图标", () => {
    const { container } = render(getStatusIcon("running"))
    const svg = container.querySelector("svg")
    expect(svg).toBeTruthy()
    expect(svg?.classList.contains("animate-spin")).toBe(true)
    expect(svg?.classList.contains("animate-pulse")).toBe(false)
    expect(svg?.querySelector('path[d^="M4 4v5"]')).toBeTruthy()
  })
})

describe("getStatusClasses", () => {
  it("等待和运行状态使用深色模式 gray-400 文字", () => {
    (["pending", "running"] as const).forEach((status) => {
      expect(getStatusClasses(status)).toContain("dark:text-gray-400")
    })
  })

  it("完成状态使用深色模式白色文字", () => {
    expect(getStatusClasses("completed")).toContain("dark:text-white")
  })
})

describe("getToolDisplayName", () => {
  it("bash 工具在有命令参数时优先显示命令", () => {
    expect(getToolDisplayName("bash", { command: "bun test" }, "执行命令", undefined)).toBe("执行命令：bun test")
    expect(getToolDisplayName("bash", { command: "bun test" }, undefined, undefined)).toBe("执行命令：bun test")
  })
})

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
