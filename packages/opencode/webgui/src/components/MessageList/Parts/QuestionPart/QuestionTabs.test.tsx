import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"

import { QuestionTabs } from "./QuestionTabs"

describe("QuestionTabs", () => {
  it("确认页签文案为中文", () => {
    render(
      <QuestionTabs
        tabs={[{ header: "问题一", answered: true }]}
        activeTab={1}
        onTabChange={vi.fn()}
        showConfirm={true}
      />,
    )

    expect(screen.getByRole("button", { name: "确认" })).toBeInTheDocument()
  })

  it("点击确认页签触发 onTabChange", () => {
    const onTabChange = vi.fn()
    render(
      <QuestionTabs
        tabs={[
          { header: "问题一", answered: false },
          { header: "问题二", answered: false },
        ]}
        activeTab={0}
        onTabChange={onTabChange}
        showConfirm={true}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "确认" }))
    expect(onTabChange).toHaveBeenCalledWith(2)
  })
})
