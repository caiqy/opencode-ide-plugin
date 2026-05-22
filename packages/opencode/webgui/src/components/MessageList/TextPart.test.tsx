import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { TextPart } from "./TextPart"

const overlay = vi.hoisted(() => ({
  props: [] as Array<Record<string, unknown>>,
}))

vi.mock("../parts/ImageOverlay", () => ({
  ImageOverlay: (props: Record<string, unknown>) => {
    overlay.props.push(props)
    return <div data-testid="image-overlay" />
  },
}))

vi.mock("../../hooks/useOpenFile", () => ({
  useOpenFile: () => vi.fn(),
}))

describe("TextPart", () => {
  beforeEach(() => {
    overlay.props = []
  })

  it("用户消息气泡应使用稳定宽度约束并靠右", () => {
    render(<TextPart part={{ id: "p1", type: "text", text: "短句" } as any} isUser={true} />)

    const content = screen.getByText("短句")
    const bubble = content.parentElement

    expect(content).toBeTruthy()
    expect(content).toHaveClass("whitespace-pre-wrap")
    expect(content).toHaveClass("[overflow-wrap:anywhere]")

    expect(bubble).toBeTruthy()
    expect(bubble).toHaveClass("inline-block")
    expect(bubble).not.toHaveClass("w-fit")
    expect(bubble).not.toHaveClass("max-w-[70%]")

    const wrap = bubble?.parentElement
    expect(wrap).toBeTruthy()
    expect(wrap).toHaveClass("w-full")
    expect(wrap).toHaveClass("flex")
    expect(wrap).toHaveClass("justify-end")
  })

  it("用户消息应使用更克制的面板卡片样式，并与 ToolPart 保持同级圆角", () => {
    render(
      <TextPart
        part={{ id: "p2", type: "text", text: "根据历史提交惯例生成commit信息执行commit & push" } as any}
        isUser={true}
      />,
    )

    const content = screen.getByText("根据历史提交惯例生成commit信息执行commit & push")
    const bubble = content.parentElement

    expect(bubble).toBeTruthy()
    expect(bubble).toHaveClass("rounded-lg")
    expect(bubble).toHaveClass("border")
    expect(bubble).not.toHaveClass("rounded-xl")
    expect(bubble).not.toHaveClass("bg-blue-50")
    expect(bubble).not.toHaveClass("border-blue-400")
  })

  it("图片附件缺少 filename 时，预览保存名回退为带扩展名的图片文件名", () => {
    render(
      <TextPart
        part={{ id: "p3", type: "text", text: "图" } as any}
        isUser={true}
        attachedParts={[
          {
            id: "f1",
            type: "file",
            mime: "image/webp",
            url: "data:image/webp;base64,UklGRg==",
          } as any,
        ]}
      />,
    )

    fireEvent.click(screen.getByRole("img", { name: "image" }))

    expect(overlay.props).toHaveLength(1)
    expect(overlay.props[0]?.filename).toBe("image.webp")
    expect(overlay.props[0]?.alt).toBe("image")
  })

  it("用户消息普通选区复制应写入选区文本", () => {
    render(<TextPart part={{ id: "p4", type: "text", text: "hello world" } as any} isUser={true} />)

    const content = screen.getByText("hello world")
    const text = content.firstChild!
    const range = document.createRange()
    range.setStart(text, 6)
    range.setEnd(text, 11)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    const setData = vi.fn()
    fireEvent.copy(content, {
      clipboardData: { setData },
    })

    expect(setData).toHaveBeenCalledWith("text/plain", "world")
    selection.removeAllRanges()
  })

  it("用户消息折叠选区复制应写入整条消息", () => {
    render(<TextPart part={{ id: "p5", type: "text", text: "hello world" } as any} isUser={true} />)

    const content = screen.getByText("hello world")
    const text = content.firstChild!
    const range = document.createRange()
    range.setStart(text, 3)
    range.collapse(true)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    const setData = vi.fn()
    fireEvent.copy(content, {
      clipboardData: { setData },
    })

    expect(setData).toHaveBeenCalledWith("text/plain", "hello world")
    selection.removeAllRanges()
  })

  it("用户消息 mention 选区复制应写入 raw mention 文本", () => {
    render(
      <TextPart
        part={{ id: "p6", type: "text", text: "open @file.txt" } as any}
        isUser={true}
        attachedParts={[
          {
            id: "f1",
            type: "file",
            mime: "text/plain",
            url: "file:///tmp/file.txt",
            filename: "file.txt",
            source: { text: { start: 5, end: 14 } },
          } as any,
        ]}
      />,
    )

    const content = document.querySelector<HTMLElement>("[data-rawpart]")!.parentElement!
    const range = document.createRange()
    range.setStart(content.firstChild!.firstChild!, 0)
    range.setEnd(content.lastChild!, 1)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    const setData = vi.fn()
    fireEvent.copy(content, {
      clipboardData: { setData },
    })

    expect(setData).toHaveBeenCalledWith("text/plain", "open @file.txt")
    selection.removeAllRanges()
  })

  it("用户消息选区映射失败时应 fallback 写入可见选区文本", () => {
    render(
      <TextPart
        part={{ id: "p7", type: "text", text: "open @file.txt" } as any}
        isUser={true}
        attachedParts={[
          {
            id: "f1",
            type: "file",
            mime: "text/plain",
            url: "file:///tmp/file.txt",
            filename: "file.txt",
            source: { text: { start: 5, end: 14 } },
          } as any,
        ]}
      />,
    )

    const content = document.querySelector<HTMLElement>("[data-rawpart]")!.parentElement!
    Array.from(content.querySelectorAll<HTMLElement>("[data-rawpart]")).forEach((part) => {
      part.setAttribute("data-raw-start", "x")
      part.setAttribute("data-raw-end", "y")
    })
    const range = document.createRange()
    range.selectNodeContents(content)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    const setData = vi.fn()
    fireEvent.copy(content, {
      clipboardData: { setData },
    })

    expect(setData).toHaveBeenCalledWith("text/plain", expect.stringContaining("open"))
    selection.removeAllRanges()
  })

  it("用户消息选区不在当前 wrapper 内时不应阻止默认复制", () => {
    render(<TextPart part={{ id: "p8", type: "text", text: "inside" } as any} isUser={true} />)

    const content = screen.getByText("inside")
    const outside = document.createElement("div")
    outside.textContent = "outside"
    document.body.appendChild(outside)
    const range = document.createRange()
    range.selectNodeContents(outside)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    const setData = vi.fn()
    const event = new Event("copy", { bubbles: true, cancelable: true }) as ClipboardEvent
    Object.defineProperty(event, "clipboardData", {
      value: { setData },
    })
    content.dispatchEvent(event)

    expect(setData).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
    outside.remove()
    selection.removeAllRanges()
  })

  it("用户消息跨普通文本、mention 与后续文本复制应写入 raw 原文", () => {
    render(
      <TextPart
        part={{ id: "p9", type: "text", text: "open @file.txt now" } as any}
        isUser={true}
        attachedParts={[
          {
            id: "f1",
            type: "file",
            mime: "text/plain",
            url: "file:///tmp/file.txt",
            filename: "file.txt",
            source: { text: { start: 5, end: 14 } },
          } as any,
        ]}
      />,
    )

    const content = document.querySelector<HTMLElement>("[data-rawpart]")!.parentElement!
    const first = content.querySelector<HTMLElement>('[data-raw-start="0"]')!.firstChild!
    const last = content.querySelector<HTMLElement>('[data-raw-start="14"]')!.firstChild!
    const range = document.createRange()
    range.setStart(first, 0)
    range.setEnd(last, 4)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    const setData = vi.fn()
    fireEvent.copy(content, {
      clipboardData: { setData },
    })

    expect(setData).toHaveBeenCalledWith("text/plain", "open @file.txt now")
    selection.removeAllRanges()
  })
})
