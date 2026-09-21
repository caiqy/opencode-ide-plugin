import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { QuestionRequest } from "@opencode-ai/sdk/v2/client"

const mocks = vi.hoisted(() => ({ replyQuestion: vi.fn(), rejectQuestion: vi.fn() }))

vi.mock("../../../../state/MessagesContext", () => ({ useMessages: () => mocks }))

import { QuestionPart } from "./index"

const request = (input: Partial<QuestionRequest> & Pick<QuestionRequest, "id" | "questions">): QuestionRequest => ({
  sessionID: "session-1",
  ...input,
})

describe("QuestionPart", () => {
  beforeEach(() => {
    mocks.replyQuestion.mockReset()
    mocks.rejectQuestion.mockReset()
  })

  it("单个单选问题：选中选项不自动提交，需在确认页提交", async () => {
    const user = userEvent.setup()
    render(
      <QuestionPart
        request={request({
          id: "q-single",
          questions: [
            {
              header: "来源",
              question: "从哪里查更新？",
              options: [{ label: "A" }, { label: "B" }],
            },
          ],
        })}
      />,
    )

    await user.click(screen.getByText("A"))

    expect(mocks.replyQuestion).not.toHaveBeenCalled()
    expect(await screen.findByText("复核你的答案")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "提交" }))

    expect(mocks.replyQuestion).toHaveBeenCalledWith("q-single", [["A"]])
  })

  it("展开自定义输入框即选中该选项", async () => {
    const user = userEvent.setup()
    render(
      <QuestionPart
        request={request({
          id: "q-expand",
          questions: [
            {
              header: "来源",
              question: "从哪里查更新？",
              custom: true,
              options: [{ label: "A" }],
            },
          ],
        })}
      />,
    )

    await user.click(screen.getByText("输入自定义答案"))

    expect(screen.getByRole("radio", { name: "勾选自定义答案" })).toHaveAttribute("aria-checked", "true")
    expect(screen.getByPlaceholderText("请输入自定义答案…")).toBeInTheDocument()
    expect(mocks.replyQuestion).not.toHaveBeenCalled()
  })

  it("单个单选问题：自定义答案展开即作答，确认页可提交", async () => {
    const user = userEvent.setup()
    render(
      <QuestionPart
        request={request({
          id: "q-custom",
          questions: [
            {
              header: "来源",
              question: "从哪里查更新？",
              custom: true,
              options: [{ label: "A" }],
            },
          ],
        })}
      />,
    )

    await user.click(screen.getByText("输入自定义答案"))
    await user.type(screen.getByPlaceholderText("请输入自定义答案…"), "官网")
    await user.click(screen.getByRole("radio", { name: "勾选自定义答案" }))

    expect(mocks.replyQuestion).not.toHaveBeenCalled()

    await user.click(await screen.findByRole("button", { name: "提交" }))

    expect(mocks.replyQuestion).toHaveBeenCalledWith("q-custom", [["官网"]])
  })
})
