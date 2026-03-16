import { describe, expect, it } from "vitest"
import { parseTaskResult } from "./task-result"

describe("parseTaskResult", () => {
  it("只提取 task_result 标签内文本", () => {
    const out = `task_id: s1\n\n<task_result>## 标题\n- a\n</task_result>`
    const res = parseTaskResult(out)
    expect(res.hasTag).toBe(true)
    expect(res.hasContent).toBe(true)
    expect(res.text).toBe("## 标题\n- a")
  })

  it("标签缺失时返回无内容", () => {
    const res = parseTaskResult("task_id: s1")
    expect(res.hasTag).toBe(false)
    expect(res.hasContent).toBe(false)
    expect(res.text).toBe("")
  })

  it("空标签或仅空白时返回无内容", () => {
    const res = parseTaskResult("<task_result> \n\t </task_result>")
    expect(res.hasTag).toBe(true)
    expect(res.hasContent).toBe(false)
    expect(res.text).toBe("")
  })

  it("多个标签时优先取第一段合法内容", () => {
    const out = "<task_result>first</task_result>\n<task_result>second</task_result>"
    const res = parseTaskResult(out)
    expect(res.text).toBe("first")
  })

  it("CRLF 文本可被正确提取并 trim", () => {
    const out = "<task_result>\r\n# t\r\n- a\r\n</task_result>"
    const res = parseTaskResult(out)
    expect(res.text).toBe("# t\r\n- a")
  })

  it("带属性的 task_result 标签也可提取内容", () => {
    const out = '<task_result format="md">ok</task_result>'
    const res = parseTaskResult(out)
    expect(res.hasTag).toBe(true)
    expect(res.hasContent).toBe(true)
    expect(res.text).toBe("ok")
  })

  it("不闭合标签按无内容处理", () => {
    const res = parseTaskResult("<task_result>abc")
    expect(res.hasTag).toBe(false)
    expect(res.hasContent).toBe(false)
    expect(res.text).toBe("")
  })
})
