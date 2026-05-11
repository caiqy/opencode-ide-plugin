import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { downloadUrl } from "../../lib/fileUtils"
import { ImageOverlay } from "./ImageOverlay"

vi.mock("../../lib/fileUtils", async () => {
  const actual = await vi.importActual<typeof import("../../lib/fileUtils")>("../../lib/fileUtils")

  return {
    ...actual,
    downloadUrl: vi.fn(),
  }
})

function setNaturalSize(img: HTMLImageElement, width: number, height: number) {
  Object.defineProperties(img, {
    naturalWidth: { configurable: true, value: width },
    naturalHeight: { configurable: true, value: height },
  })

  fireEvent.load(img)
}

function withViewport(width: number, height: number, run: () => void) {
  const innerWidth = window.innerWidth
  const innerHeight = window.innerHeight

  try {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width })
    Object.defineProperty(window, "innerHeight", { configurable: true, value: height })
    run()
  } finally {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: innerWidth })
    Object.defineProperty(window, "innerHeight", { configurable: true, value: innerHeight })
  }
}

describe("ImageOverlay", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("显示保存和缩放控制按钮", () => {
    render(<ImageOverlay url="https://example.com/image.png" alt="sample.png" onClose={() => {}} />)

    expect(screen.getByRole("dialog", { name: "sample.png" })).toBeInTheDocument()
    expect(screen.getByText("sample.png")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "保存图片" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "放大" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "缩小" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "重置缩放" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "适应窗口" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "关闭" })).toBeInTheDocument()
    expect(screen.getByText("100%")).toBeInTheDocument()
  })

  it("键盘 + / = / - / 0 调整显示百分比", () => {
    render(<ImageOverlay url="https://example.com/image.png" alt="sample.png" onClose={() => {}} />)

    fireEvent.keyDown(document, { key: "+" })
    expect(screen.getByText("125%")).toBeInTheDocument()

    fireEvent.keyDown(document, { key: "=" })
    expect(screen.getByText("150%")).toBeInTheDocument()

    fireEvent.keyDown(document, { key: "-" })
    expect(screen.getByText("125%")).toBeInTheDocument()

    fireEvent.keyDown(document, { key: "0" })
    expect(screen.getByText("100%")).toBeInTheDocument()
  })

  it("Esc 调用 onClose", () => {
    const onClose = vi.fn()
    render(<ImageOverlay url="https://example.com/image.png" alt="sample.png" onClose={onClose} />)

    fireEvent.keyDown(document, { key: "Escape" })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("点击保存调用 downloadUrl", () => {
    render(<ImageOverlay url="https://example.com/image.png" alt="sample.png" onClose={() => {}} />)

    fireEvent.click(screen.getByRole("button", { name: "保存图片" }))

    expect(downloadUrl).toHaveBeenCalledWith("https://example.com/image.png", "sample.png")
  })

  it("双击图片重置缩放", () => {
    render(<ImageOverlay url="https://example.com/image.png" alt="sample.png" onClose={() => {}} />)

    fireEvent.keyDown(document, { key: "+" })
    fireEvent.dblClick(screen.getByRole("img", { name: "sample.png" }))

    expect(screen.getByText("100%")).toBeInTheDocument()
  })

  it("鼠标滚轮缩放", () => {
    render(<ImageOverlay url="https://example.com/image.png" alt="sample.png" onClose={() => {}} />)

    const img = screen.getByRole("img", { name: "sample.png" })
    const stage = img.parentElement
    if (!stage) throw new Error("stage not found")

    fireEvent.wheel(stage, { deltaY: -100 })
    expect(screen.getByText("125%")).toBeInTheDocument()

    fireEvent.wheel(stage, { deltaY: 100 })
    expect(screen.getByText("100%")).toBeInTheDocument()
  })

  it("拖拽平移更新图片 transform", () => {
    render(<ImageOverlay url="https://example.com/image.png" alt="sample.png" onClose={() => {}} />)

    const img = screen.getByRole("img", { name: "sample.png" }) as HTMLImageElement
    const stage = img.parentElement
    if (!stage) throw new Error("stage not found")

    stage.setPointerCapture = vi.fn()
    stage.releasePointerCapture = vi.fn()

    fireEvent.pointerDown(stage, { button: 0, clientX: 10, clientY: 20, pointerId: 1 })
    fireEvent.pointerMove(stage, { clientX: 35, clientY: 50, pointerId: 1 })
    fireEvent.pointerUp(stage, { pointerId: 1 })

    expect(img).toHaveStyle({ transform: "translate(25px, 30px) scale(1)" })
    expect(stage.setPointerCapture).toHaveBeenCalledWith(1)
    expect(stage.releasePointerCapture).toHaveBeenCalledWith(1)
  })

  it("适应窗口后按 + 基于当前 fit 比例放大并退出 fit", () => {
    withViewport(1000, 1000, () => {
      render(<ImageOverlay url="https://example.com/image.png" alt="sample.png" onClose={() => {}} />)

      const img = screen.getByRole("img", { name: "sample.png" }) as HTMLImageElement
      setNaturalSize(img, 1800, 1000)

      fireEvent.click(screen.getByRole("button", { name: "适应窗口" }))
      expect(screen.getByText("50%")).toBeInTheDocument()

      fireEvent.keyDown(document, { key: "+" })
      expect(screen.getByText("75%")).toBeInTheDocument()
    })
  })

  it("大图打开后默认按适应窗口比例显示", () => {
    withViewport(1000, 1000, () => {
      render(<ImageOverlay url="https://example.com/image.png" alt="sample.png" onClose={() => {}} />)

      const img = screen.getByRole("img", { name: "sample.png" }) as HTMLImageElement
      setNaturalSize(img, 1800, 1000)

      expect(screen.getByText("50%")).toBeInTheDocument()
      expect(screen.queryByText("100%")).not.toBeInTheDocument()
    })
  })

  it("适应窗口后点击缩小基于当前 fit 比例缩小", () => {
    withViewport(1000, 1000, () => {
      render(<ImageOverlay url="https://example.com/image.png" alt="sample.png" onClose={() => {}} />)

      const img = screen.getByRole("img", { name: "sample.png" }) as HTMLImageElement
      setNaturalSize(img, 1800, 1000)

      fireEvent.click(screen.getByRole("button", { name: "适应窗口" }))
      expect(screen.getByText("50%")).toBeInTheDocument()

      fireEvent.click(screen.getByRole("button", { name: "缩小" }))
      expect(screen.getByText("25%")).toBeInTheDocument()
    })
  })

  it("适应窗口后滚轮向下基于当前 fit 比例缩小", () => {
    withViewport(1000, 1000, () => {
      render(<ImageOverlay url="https://example.com/image.png" alt="sample.png" onClose={() => {}} />)

      const img = screen.getByRole("img", { name: "sample.png" }) as HTMLImageElement
      const stage = img.parentElement
      if (!stage) throw new Error("stage not found")

      setNaturalSize(img, 1800, 1000)

      fireEvent.click(screen.getByRole("button", { name: "适应窗口" }))
      expect(screen.getByText("50%")).toBeInTheDocument()

      fireEvent.wheel(stage, { deltaY: 100 })
      expect(screen.getByText("25%")).toBeInTheDocument()
    })
  })

  it("超大图片适应窗口时可降到 11%", () => {
    withViewport(1000, 1000, () => {
      render(<ImageOverlay url="https://example.com/image.png" alt="sample.png" onClose={() => {}} />)

      const img = screen.getByRole("img", { name: "sample.png" }) as HTMLImageElement
      setNaturalSize(img, 8000, 6000)

      fireEvent.click(screen.getByRole("button", { name: "适应窗口" }))
      expect(screen.getByText("11%")).toBeInTheDocument()
    })
  })

  it("缩放不会超过上下限", () => {
    render(<ImageOverlay url="https://example.com/image.png" alt="sample.png" onClose={() => {}} />)

    for (let i = 0; i < 20; i++) fireEvent.keyDown(document, { key: "+" })
    expect(screen.getByText("500%")).toBeInTheDocument()

    for (let i = 0; i < 30; i++) fireEvent.keyDown(document, { key: "-" })
    expect(screen.getByText("5%")).toBeInTheDocument()
  })
})
