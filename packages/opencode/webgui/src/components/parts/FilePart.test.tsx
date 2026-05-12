import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { FilePart } from "./FilePart"

const overlay = vi.hoisted(() => ({
  props: [] as Array<Record<string, unknown>>,
}))

vi.mock("../../hooks/useOpenFile", () => ({
  useOpenFile: () => vi.fn(),
}))

vi.mock("./ImageOverlay", () => ({
  ImageOverlay: (props: Record<string, unknown>) => {
    overlay.props.push(props)
    return <div data-testid="image-overlay" />
  },
}))

describe("FilePart", () => {
  beforeEach(() => {
    overlay.props = []
  })

  it("图片附件缺少 filename 时，预览保存名不退回展示文案且带扩展名", () => {
    render(
      <FilePart
        part={{
          id: "file-1",
          type: "file",
          mime: "image/png",
          url: "data:image/png;base64,AA==",
          source: {
            type: "symbol",
            text: { value: "", start: 0, end: 0 },
            name: "Hero Banner",
          },
        }}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: /Hero Banner/ }))

    expect(overlay.props).toHaveLength(1)
    expect(overlay.props[0]?.alt).toBe("Hero Banner")
    expect(overlay.props[0]?.filename).toBe("image.png")
  })
})
