import { describe, expect, it } from "vitest"
import { getToolDisplayName } from "./utils"

describe("getToolDisplayName", () => {
  it("在有 title 时使用中文工具名", () => {
    expect(getToolDisplayName("bash", undefined, "Run something", undefined)).toBe("执行命令：Run something")
  })

  it("在无 title/无 input 时回退为中文工具名", () => {
    expect(getToolDisplayName("read", undefined, undefined, undefined)).toBe("查看")
  })

  it("会把 list/glob/grep/webfetch 的展示标题中文化", () => {
    expect(getToolDisplayName("list", { path: "/tmp" }, undefined, undefined)).toBe("浏览目录：/tmp")
    expect(getToolDisplayName("glob", { pattern: "src/**/*.ts" }, undefined, undefined)).toBe("路径匹配：src/**/*.ts")
    expect(getToolDisplayName("webfetch", { url: "https://example.com" }, undefined, undefined)).toBe(
      "抓取网页：https://example.com",
    )
    expect(getToolDisplayName("grep", { pattern: "foo", include: "*.ts" }, undefined, undefined)).toBe(
      "文本查找：foo (*.ts)",
    )
  })

  it("todoread/todowrite 输出为 JSON todo 列表时展示计数", () => {
    const output = JSON.stringify([
      { content: "a", status: "completed" },
      { content: "b", status: "pending" },
      { content: "c", status: "pending" },
    ])
    expect(getToolDisplayName("todowrite", undefined, "Update", output)).toBe("更新任务列表：已完成 1/3")
    expect(getToolDisplayName("todoread", undefined, "Read", output)).toBe("查看任务列表：已完成 1/3")
  })

  it("todoread/todowrite 当无已完成项时展示总数", () => {
    const output = JSON.stringify([
      { content: "a", status: "pending" },
      { content: "b", status: "pending" },
    ])
    expect(getToolDisplayName("todowrite", undefined, "Update", output)).toBe("更新任务列表：共 2")
  })

  it("未知工具保持原样", () => {
    expect(getToolDisplayName("some-tool", undefined, undefined, undefined)).toBe("some-tool")
  })
})
