import { render } from "@testing-library/react"
import { createRef } from "react"
import { describe, expect, it, vi } from "vitest"
import { useDragDrop } from "./useDragDrop"

const mocks = vi.hoisted(() => ({
  insertNodes: vi.fn(),
}))

vi.mock("lexical", () => ({
  $getSelection: () => ({ insertNodes: mocks.insertNodes }),
  $isRangeSelection: () => true,
  $createTextNode: (text: string) => ({ type: "text", text }),
}))

vi.mock("../../mention/MentionNode", () => ({
  $createMentionNode: (data: unknown) => ({ type: "mention", data }),
}))

function Harness(props: { disabled?: boolean; update: ReturnType<typeof vi.fn> }) {
  const contentEditableRef = createRef<HTMLDivElement>()
  const containerRef = createRef<HTMLDivElement>()
  useDragDrop({
    contentEditableRef,
    containerRef,
    disabled: props.disabled ?? false,
  } as any)

  return (
    <div ref={containerRef} data-testid="box">
      <div ref={contentEditableRef} data-testid="editor" />
    </div>
  )
}

describe("useDragDrop", () => {
  it("拖拽进入输入框时不显示 VSCode Explorer 的 Shift 提示", () => {
    const update = vi.fn((fn: () => void) => fn())
    const view = render(<Harness update={update} />)
    const editor = view.getByTestId("editor")
    const hint = "从 VSCode Explorer 拖入文件请按住 Shift再释放鼠标"

    editor.dispatchEvent(new Event("dragenter", { bubbles: true, cancelable: true }))

    expect(view.queryByText(hint)).toBeNull()
  })

  it("disabled 时 drop 仍会阻止默认行为，且不会写入编辑器", () => {
    const update = vi.fn((fn: () => void) => fn())
    mocks.insertNodes.mockClear()

    const view = render(<Harness disabled update={update} />)
    const preventDefault = vi.fn()
    const ev = new Event("drop", { bubbles: true, cancelable: true })
    Object.assign(ev, {
      preventDefault,
    })

    view.getByTestId("editor").dispatchEvent(ev)

    expect(preventDefault).toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(mocks.insertNodes).not.toHaveBeenCalled()
  })

  it("document drop 清理高亮时也会阻止默认行为", () => {
    const update = vi.fn((fn: () => void) => fn())
    render(<Harness update={update} />)

    const preventDefault = vi.fn()
    const ev = new Event("drop", { bubbles: true, cancelable: true })
    Object.assign(ev, { preventDefault })

    document.dispatchEvent(ev)

    expect(preventDefault).toHaveBeenCalledOnce()
  })

  it("disabled 时 editor drop 也会清掉已有拖拽高亮", () => {
    const update = vi.fn((fn: () => void) => fn())
    const view = render(<Harness disabled update={update} />)
    const box = view.getByTestId("box")

    document.dispatchEvent(new Event("dragenter", { bubbles: true, cancelable: true }))
    expect(box.classList.contains("ring-2")).toBe(true)

    const ev = new Event("drop", { bubbles: true, cancelable: true })
    view.getByTestId("editor").dispatchEvent(ev)

    expect(box.classList.contains("ring-2")).toBe(false)
  })

  it("editor drop 不会阻止冒泡，让 App 的统一 drop coordinator 处理插入", () => {
    const update = vi.fn((fn: () => void) => fn())
    mocks.insertNodes.mockClear()

    const view = render(<Harness update={update} />)

    const documentDrop = vi.fn()
    document.addEventListener("drop", documentDrop)
    const ev = new Event("drop", { bubbles: true, cancelable: true })

    view.getByTestId("editor").dispatchEvent(ev)

    expect(documentDrop).toHaveBeenCalled()
    document.removeEventListener("drop", documentDrop)
  })

  it("editor drop 后，新一轮 document dragleave 不会残留高亮", () => {
    const update = vi.fn((fn: () => void) => fn())
    const view = render(<Harness update={update} />)
    const box = view.getByTestId("box")

    document.dispatchEvent(new Event("dragenter", { bubbles: true, cancelable: true }))
    view.getByTestId("editor").dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }))
    expect(box.classList.contains("ring-2")).toBe(false)

    document.dispatchEvent(new Event("dragenter", { bubbles: true, cancelable: true }))
    expect(box.classList.contains("ring-2")).toBe(true)

    document.dispatchEvent(new Event("dragleave", { bubbles: true, cancelable: true }))
    expect(box.classList.contains("ring-2")).toBe(false)
  })
})
