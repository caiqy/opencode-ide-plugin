import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { VariantSelector } from "./VariantSelector"

describe("VariantSelector", () => {
  it("展示中文默认选项与提示文案", async () => {
    const user = userEvent.setup()
    render(<VariantSelector variants={["low", "medium", "high"]} selectedVariant={undefined} onSelect={vi.fn()} />)

    const trigger = screen.getByTitle("选择推理强度")
    expect(trigger).toHaveTextContent("默认")

    await user.click(trigger)
    expect(screen.getByRole("button", { name: /默认\s*Default/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /低\s*low/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /中\s*medium/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /高\s*high/ })).toBeInTheDocument()
  })

  it("选择选项时回调仍使用原始 variant 值", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<VariantSelector variants={["low", "high"]} selectedVariant={undefined} onSelect={onSelect} />)

    await user.click(screen.getByTitle("选择推理强度"))
    await user.click(screen.getByText("高"))

    expect(onSelect).toHaveBeenCalledWith("high")
  })

  it("展示 minimal 变体为中文", async () => {
    const user = userEvent.setup()
    render(<VariantSelector variants={["minimal", "low", "medium"]} selectedVariant={undefined} onSelect={vi.fn()} />)

    await user.click(screen.getByTitle("选择推理强度"))
    expect(screen.getByRole("button", { name: /极低\s*minimal/ })).toBeInTheDocument()
  })
})
