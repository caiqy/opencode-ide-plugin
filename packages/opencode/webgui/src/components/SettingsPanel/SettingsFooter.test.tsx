import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { SettingsFooter } from "./SettingsFooter"

describe("SettingsFooter", () => {
  it("按钮文案为中文", () => {
    render(
      <SettingsFooter
        isSaving={false}
        isLoading={false}
        hasUnsavedChanges={true}
        successMessage={null}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "保存更改" })).toBeInTheDocument()
  })
})
