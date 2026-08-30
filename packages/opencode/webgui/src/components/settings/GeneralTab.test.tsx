import { describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { GeneralTab } from "./GeneralTab"

vi.mock("../../lib/api/sdkClient", () => ({
  sdk: {
    config: {
      allProviders: vi.fn().mockResolvedValue({
        data: {
          providers: [
            {
              id: "openai",
              models: { "gpt-5.6-luna": { id: "gpt-5.6-luna" } },
            },
          ],
        },
      }),
    },
    auth: { list: vi.fn().mockResolvedValue({ openai: true }) },
  },
}))

function renderTab(formData = {}) {
  const setFormData = vi.fn()
  const setStatus = vi.fn()
  render(
    <GeneralTab
      formData={formData}
      setFormData={setFormData}
      pluginAutoUpdate
      setPluginAutoUpdate={vi.fn()}
      pluginAutoUpdateAvailable
      setStatus={setStatus}
    />,
  )
  return { setFormData, setStatus }
}

describe("GeneralTab", () => {
  it("只展示常用设置并使用实际默认值", async () => {
    renderTab()

    expect(screen.getByRole("checkbox", { name: "IDE 插件自动更新" })).toBeChecked()
    expect(screen.getByRole("checkbox", { name: "文件快照" })).not.toBeChecked()
    expect(screen.getByRole("button", { name: "OpenAI 搜索" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("combobox", { name: "OpenAI 搜索模型" })).toHaveValue("openai/gpt-5.6-luna")
    expect(screen.getByRole("textbox", { name: "网页搜索并行数" })).toHaveValue("3")
    expect(screen.getByRole("textbox", { name: "子任务并行数" })).toHaveValue("3")
    expect(screen.getByRole("textbox", { name: "错误重试上限" })).toHaveValue("10")
    expect(screen.queryByText("用户名")).not.toBeInTheDocument()
    expect(screen.queryByText("分享模式")).not.toBeInTheDocument()
    expect(screen.queryByText("工作目录")).not.toBeInTheDocument()

    await waitFor(() => expect(screen.queryByText(/正在检查 OpenAI/)).not.toBeInTheDocument())
  })

  it("原生搜索写入 Exa/Parallel 路径配置", async () => {
    const user = userEvent.setup()
    const { setFormData } = renderTab()

    await user.click(screen.getByRole("button", { name: "原生搜索" }))

    expect(setFormData).toHaveBeenCalledWith({ websearch: { mode: "responses", models: [] } })
  })

  it("保留越界数值并报告字段错误", async () => {
    const user = userEvent.setup()
    const { setStatus } = renderTab()
    const input = screen.getByRole("textbox", { name: "网页搜索并行数" })

    await user.clear(input)
    await user.type(input, "11")

    expect(input).toHaveValue("11")
    expect(screen.getByText("请输入 1–10 的整数")).toBeInTheDocument()
    await waitFor(() => expect(setStatus).toHaveBeenLastCalledWith({ valid: false, draftDirty: true }))
  })
})
