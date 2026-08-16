import { describe, expect, it } from "vitest"
import { getSubtaskStatusLabel, getToolDisplayName } from "./utils"

describe("getToolDisplayName", () => {
  it("在有 title 时使用中文工具名", () => {
    expect(getToolDisplayName("bash", undefined, "Run something", undefined)).toBe("执行命令：Run something")
  })

  it("bash 在无 title 时使用 description 作为运行中标题", () => {
    expect(
      getToolDisplayName("bash", { command: "git status", description: "查看工作区变更" }, undefined, undefined),
    ).toBe("执行命令：查看工作区变更")
  })

  it("非 bash 工具在无 title 时不应把 description 当作标题", () => {
    expect(
      getToolDisplayName("read", { filePath: "/tmp/demo.ts", description: "查看工作区变更" }, undefined, undefined),
    ).toBe("查看：/tmp/demo.ts")
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
    expect(getToolDisplayName("todowrite", undefined, "Update", output)).toBe("待办事项 (1/3)")
    expect(getToolDisplayName("todoread", undefined, "Read", output)).toBe("待办事项 (1/3)")
  })

  it("todoread/todowrite 无计数时也使用待办事项名称", () => {
    expect(getToolDisplayName("todowrite", undefined, undefined, undefined)).toBe("待办事项")
    expect(getToolDisplayName("todoread", undefined, undefined, undefined)).toBe("待办事项")
  })

  it("todoread/todowrite 当无已完成项时展示总数", () => {
    const output = JSON.stringify([
      { content: "a", status: "pending" },
      { content: "b", status: "pending" },
    ])
    expect(getToolDisplayName("todowrite", undefined, "Update", output)).toBe("待办事项 (0/2)")
  })

  it("task/question 工具调用应展示中文名", () => {
    expect(getToolDisplayName("task", undefined, undefined, undefined)).toBe("委派子任务")
    expect(getToolDisplayName("question", undefined, undefined, undefined)).toBe("提问")
  })

  it("应覆盖 webgui 其余工具调用中文名", () => {
    expect(getToolDisplayName("websearch", undefined, undefined, undefined)).toBe("网页搜索")
    expect(getToolDisplayName("codesearch", undefined, undefined, undefined)).toBe("代码搜索")
    expect(getToolDisplayName("lsp", undefined, undefined, undefined)).toBe("语言服务器查询")
    expect(getToolDisplayName("batch", undefined, undefined, undefined)).toBe("批量工具调用")
    expect(getToolDisplayName("plan_enter", undefined, undefined, undefined)).toBe("进入计划模式")
    expect(getToolDisplayName("plan_exit", undefined, undefined, undefined)).toBe("退出计划模式")
    expect(getToolDisplayName("invalid", undefined, undefined, undefined)).toBe("无效工具调用")
  })

  it("未知工具保持原样", () => {
    expect(getToolDisplayName("some-tool", undefined, undefined, undefined)).toBe("some-tool")
  })

  it("skill 工具应去掉英文 Loaded skill 前缀，避免中英文重复", () => {
    expect(getToolDisplayName("skill", undefined, "Loaded skill: brainstorming", undefined)).toBe(
      "加载技能：brainstorming",
    )
  })
})

describe("getSubtaskStatusLabel", () => {
  it("有进行中工具时返回当前工具名", () => {
    expect(getSubtaskStatusLabel({ currentToolLabel: "执行命令", isParentCompleted: false })).toBe("执行命令")
  })

  it("无进行中工具且父 task 未完成时返回思考中", () => {
    expect(getSubtaskStatusLabel({ currentToolLabel: null, isParentCompleted: false })).toBe("思考中")
  })

  it("无进行中工具且父 task 已完成时返回已完成", () => {
    expect(getSubtaskStatusLabel({ currentToolLabel: null, isParentCompleted: true })).toBe("已完成")
  })
})
