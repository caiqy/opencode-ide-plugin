import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"

import { KeyInput } from "./KeyInput"

describe("KeyInput", () => {
  it("展示中文 placeholder 与显隐提示", () => {
    const { rerender } = render(
      <KeyInput
        providerName="OpenAI"
        value=""
        showKey={false}
        onValueChange={vi.fn()}
        onToggleVisibility={vi.fn()}
      />,
    )

    expect(screen.getByPlaceholderText("输入 OpenAI API Key")).toBeInTheDocument()
    expect(screen.getByTitle("显示")).toBeInTheDocument()

    rerender(
      <KeyInput providerName="OpenAI" value="" showKey={true} onValueChange={vi.fn()} onToggleVisibility={vi.fn()} />,
    )

    expect(screen.getByTitle("隐藏")).toBeInTheDocument()
  })
})
