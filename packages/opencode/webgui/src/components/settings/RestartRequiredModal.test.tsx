import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { RestartRequiredModal } from "./RestartRequiredModal"

const mocks = vi.hoisted(() => ({ restart: vi.fn() }))

vi.mock("../../lib/ideBridge", () => ({
  ideBridge: {
    request: (...args: unknown[]) => mocks.restart(...args),
  },
}))

describe("RestartRequiredModal", () => {
  beforeEach(() => vi.clearAllMocks())

  it("暂不重启只关闭弹窗", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<RestartRequiredModal isOpen={true} onClose={onClose} />)

    await user.click(screen.getByRole("button", { name: "暂不重启" }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(mocks.restart).not.toHaveBeenCalled()
  })

  it("立即重启调用 ideBridge restartHost", async () => {
    const user = userEvent.setup()
    mocks.restart.mockResolvedValue({ ok: true })
    render(<RestartRequiredModal isOpen={true} onClose={vi.fn()} />)

    await user.click(screen.getByRole("button", { name: "立即重启" }))

    await waitFor(() => expect(mocks.restart).toHaveBeenCalledWith("restartHost"))
  })

  it("重启返回失败结果时显示手动重启提示", async () => {
    const user = userEvent.setup()
    mocks.restart.mockResolvedValue({ ok: false })
    render(<RestartRequiredModal isOpen={true} onClose={vi.fn()} />)

    await user.click(screen.getByRole("button", { name: "立即重启" }))

    expect(await screen.findByText("请手动重启插件或执行 Reload Window")).toBeInTheDocument()
  })

  it("重启失败时显示手动重启提示", async () => {
    const user = userEvent.setup()
    mocks.restart.mockRejectedValue(new Error("boom"))
    render(<RestartRequiredModal isOpen={true} onClose={vi.fn()} />)

    await user.click(screen.getByRole("button", { name: "立即重启" }))

    expect(await screen.findByText("请手动重启插件或执行 Reload Window")).toBeInTheDocument()
  })
})
