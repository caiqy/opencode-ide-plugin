import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react"

const mocks = vi.hoisted(() => ({
  loadQuickPhraseState: vi.fn(),
  setQuickPhraseMode: vi.fn(),
  addCustomQuickPhrase: vi.fn(),
  updateCustomQuickPhrase: vi.fn(),
  removeQuickPhrase: vi.fn(),
  toggleQuickPhraseHidden: vi.fn(),
  reorderQuickPhrase: vi.fn(),
}))

vi.mock("../../state/repo/quickPhraseRepo", () => ({
  loadQuickPhraseState: () => mocks.loadQuickPhraseState(),
  setQuickPhraseMode: (mode: "double_send" | "confirm_send" | "fill_input") => mocks.setQuickPhraseMode(mode),
  addCustomQuickPhrase: (input: { title: string; body: string }) => mocks.addCustomQuickPhrase(input),
  updateCustomQuickPhrase: (id: string, patch: { title: string; body: string }) =>
    mocks.updateCustomQuickPhrase(id, patch),
  removeQuickPhrase: (id: string) => mocks.removeQuickPhrase(id),
  toggleQuickPhraseHidden: (id: string) => mocks.toggleQuickPhraseHidden(id),
  reorderQuickPhrase: (order: string[]) => mocks.reorderQuickPhrase(order),
}))

import { QuickPhrasesTab } from "./QuickPhrasesTab"

const state = {
  mode: "fill_input" as const,
  preset_version: 1,
  order: ["preset:commit", "custom:1"],
  items: {
    "preset:commit": {
      id: "preset:commit",
      title: "提交总结",
      body: "请总结改动",
      source: "preset" as const,
      hidden: false,
      order: 0,
      updated_at: 1,
    },
    "custom:1": {
      id: "custom:1",
      title: "我的短语",
      body: "你好",
      source: "custom" as const,
      hidden: false,
      order: 1,
      updated_at: 2,
    },
  },
}

describe("QuickPhrasesTab", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.loadQuickPhraseState.mockResolvedValue(state)
    mocks.setQuickPhraseMode.mockResolvedValue(state)
    mocks.addCustomQuickPhrase.mockResolvedValue(state)
    mocks.updateCustomQuickPhrase.mockResolvedValue(state)
    mocks.removeQuickPhrase.mockResolvedValue(state)
    mocks.toggleQuickPhraseHidden.mockResolvedValue(state)
    mocks.reorderQuickPhrase.mockResolvedValue(state)
  })

  it("可以切换输入模式", async () => {
    render(<QuickPhrasesTab />)

    await waitFor(() => {
      expect(screen.getByLabelText("输入模式")).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText("输入模式"), { target: { value: "double_send" } })
    await waitFor(() => {
      expect(mocks.setQuickPhraseMode).toHaveBeenCalledWith("double_send")
    })
  })

  it("支持新增自定义短语", async () => {
    render(<QuickPhrasesTab />)

    await waitFor(() => {
      expect(screen.getByPlaceholderText("短语标题")).toBeInTheDocument()
    })

    fireEvent.change(screen.getByPlaceholderText("短语标题"), { target: { value: "新标题" } })
    fireEvent.change(screen.getByPlaceholderText("短语正文"), { target: { value: "新正文" } })
    fireEvent.click(screen.getByRole("button", { name: "添加短语" }))
    await waitFor(() => {
      expect(mocks.addCustomQuickPhrase).toHaveBeenCalledWith({ title: "新标题", body: "新正文" })
    })
  })

  it("支持编辑与删除自定义短语", async () => {
    render(<QuickPhrasesTab />)

    await waitFor(() => {
      expect(screen.getByText("我的短语")).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole("button", { name: "编辑-custom:1" }))
    fireEvent.change(screen.getByDisplayValue("我的短语"), { target: { value: "改后标题" } })
    fireEvent.change(screen.getByDisplayValue("你好"), { target: { value: "改后正文" } })
    fireEvent.click(screen.getByRole("button", { name: "保存-custom:1" }))
    await waitFor(() => {
      expect(mocks.updateCustomQuickPhrase).toHaveBeenCalledWith("custom:1", {
        title: "改后标题",
        body: "改后正文",
      })
    })

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "删除-custom:1" })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole("button", { name: "删除-custom:1" }))
    await waitFor(() => {
      expect(mocks.removeQuickPhrase).toHaveBeenCalledWith("custom:1")
    })
  })

  it("预置短语仅允许隐藏和排序", async () => {
    render(<QuickPhrasesTab />)

    await waitFor(() => {
      expect(screen.getByText("提交总结")).toBeInTheDocument()
    })

    expect(screen.queryByRole("button", { name: "编辑-preset:commit" })).toBeNull()
    expect(screen.queryByRole("button", { name: "删除-preset:commit" })).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "隐藏-preset:commit" }))
    await waitFor(() => {
      expect(mocks.toggleQuickPhraseHidden).toHaveBeenCalledWith("preset:commit")
    })

    fireEvent.click(screen.getByRole("button", { name: "下移-preset:commit" }))
    await waitFor(() => {
      expect(mocks.reorderQuickPhrase).toHaveBeenCalled()
    })
  })

  it("编辑自定义短语时空标题或空正文不应提交", async () => {
    render(<QuickPhrasesTab />)

    await waitFor(() => {
      expect(screen.getByText("我的短语")).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole("button", { name: "编辑-custom:1" }))
    fireEvent.change(screen.getByDisplayValue("我的短语"), { target: { value: " " } })
    fireEvent.change(screen.getByDisplayValue("你好"), { target: { value: "" } })
    fireEvent.click(screen.getByRole("button", { name: "保存-custom:1" }))

    expect(mocks.updateCustomQuickPhrase).not.toHaveBeenCalled()
  })

  it("StrictMode remount 后仍能加载短语列表", async () => {
    const { unmount } = render(<QuickPhrasesTab />)
    await waitFor(() => {
      expect(screen.getByText("我的短语")).toBeInTheDocument()
    })

    // Simulate StrictMode unmount/remount
    unmount()
    mocks.loadQuickPhraseState.mockClear()
    render(<QuickPhrasesTab />)

    await waitFor(() => {
      expect(screen.getByText("我的短语")).toBeInTheDocument()
    })
    expect(mocks.loadQuickPhraseState).toHaveBeenCalled()
  })
})
