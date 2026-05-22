import { describe, expect, it } from "vitest"
import { getMessageCopyText, getUserTextCopySelection } from "./messageCopy"

describe("messageCopy", () => {
  it("用户消息按钮复制应复用 canonical 文本规则", () => {
    const message = {
      info: { id: "u1", role: "user", time: { created: 1 } },
      parts: [
        { id: "p1", type: "text", text: "  第一段" },
        { id: "p2", type: "text", text: "忽略", synthetic: true },
        { id: "p3", type: "tool", tool: "bash" },
        { id: "p4", type: "text", text: "第二段  " },
      ],
    }

    expect(getMessageCopyText(message as never)).toBe("第一段\n第二段")
  })

  it("助手消息按钮复制应保留当前非 synthetic text 拼接规则", () => {
    const message = {
      info: { id: "a1", role: "assistant", time: { created: 1 } },
      parts: [
        { id: "p1", type: "text", text: "hello" },
        { id: "p2", type: "text", text: "忽略", synthetic: true },
        { id: "p3", type: "text", text: " world" },
      ],
    }

    expect(getMessageCopyText(message as never)).toBe("hello world")
  })

  it("没有可复制文本时返回 null", () => {
    const message = {
      info: { id: "u1", role: "user", time: { created: 1 } },
      parts: [{ id: "p1", type: "text", text: "   " }],
    }

    expect(getMessageCopyText(message as never)).toBeNull()
  })

  it("普通用户文本选区应返回原文片段", () => {
    const wrapper = document.createElement("div")
    wrapper.innerHTML =
      '<span data-rawpart="1" data-raw="hello world" data-raw-start="0" data-raw-end="11">hello world</span>'
    document.body.appendChild(wrapper)
    const text = wrapper.firstChild?.firstChild
    expect(text).toBeTruthy()

    const range = document.createRange()
    range.setStart(text!, 6)
    range.setEnd(text!, 11)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    expect(getUserTextCopySelection({ text: "hello world", wrapper, selection })).toBe("world")
    wrapper.remove()
    selection.removeAllRanges()
  })

  it("包含 mention 的选区应复制 raw mention 文本", () => {
    const wrapper = document.createElement("div")
    wrapper.innerHTML = [
      '<span data-rawpart="1" data-raw="open " data-raw-start="0" data-raw-end="5">open </span>',
      '<span data-rawpart="1" data-raw-mention="1" data-raw="@file.txt" data-raw-start="5" data-raw-end="14"><button>file.txt</button></span>',
    ].join("")
    document.body.appendChild(wrapper)

    const range = document.createRange()
    range.setStart(wrapper.firstChild!.firstChild!, 0)
    range.setEnd(wrapper.lastChild!, 1)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    expect(getUserTextCopySelection({ text: "open @file.txt", wrapper, selection })).toBe("open @file.txt")
    wrapper.remove()
    selection.removeAllRanges()
  })

  it("部分选中 mention 时应复制完整 raw mention 文本", () => {
    const wrapper = document.createElement("div")
    wrapper.innerHTML =
      '<span data-rawpart="1" data-raw-mention="1" data-raw="@file.txt" data-raw-start="0" data-raw-end="9"><button>file.txt</button></span>'
    document.body.appendChild(wrapper)

    const label = wrapper.querySelector("button")!.firstChild!
    const range = document.createRange()
    range.setStart(label, 1)
    range.setEnd(label, 4)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    expect(getUserTextCopySelection({ text: "@file.txt", wrapper, selection })).toBe("@file.txt")
    wrapper.remove()
    selection.removeAllRanges()
  })

  it("选区不在 wrapper 内时返回 null 以放行默认复制", () => {
    const wrapper = document.createElement("div")
    wrapper.textContent = "inside"
    const outside = document.createElement("div")
    outside.textContent = "outside"
    document.body.append(wrapper, outside)

    const range = document.createRange()
    range.selectNodeContents(outside)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    expect(getUserTextCopySelection({ text: "inside", wrapper, selection })).toBeNull()
    wrapper.remove()
    outside.remove()
    selection.removeAllRanges()
  })

  it("映射失败时应 fallback 到可见选区文本", () => {
    const wrapper = document.createElement("div")
    wrapper.innerHTML = '<span data-rawpart="1" data-raw="broken" data-raw-start="x" data-raw-end="y">visible</span>'
    document.body.appendChild(wrapper)

    const range = document.createRange()
    range.selectNodeContents(wrapper.firstChild!)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    expect(getUserTextCopySelection({ text: "broken", wrapper, selection })).toBe("visible")
    wrapper.remove()
    selection.removeAllRanges()
  })
})
