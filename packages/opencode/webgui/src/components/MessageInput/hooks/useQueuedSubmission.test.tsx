import { act, renderHook } from "@testing-library/react"
import { createEditor, $createParagraphNode, $createTextNode, $getRoot } from "lexical"
import { expect, it, vi } from "vitest"
vi.mock("./resolveSlashInput", () => ({ resolveSlashInput: async () => ({ mode: "text" }) }))
import { useQueuedSubmission } from "./useQueuedSubmission"

function setup() {
  const editor = createEditor({
    namespace: "queue-test",
    onError: (error) => {
      throw error
    },
  })
  const write = (text: string) =>
    editor.update(
      () => {
        $getRoot()
          .clear()
          .append($createParagraphNode().append($createTextNode(text)))
      },
      { discrete: true },
    )
  write("补充 A")
  const add = vi.fn(async () => true)
  const options = {
    sessionID: "s",
    editor,
    add,
    selectedAgent: "build",
    selectedProviderId: "test",
    selectedModelId: "model",
    selectedVariant: "high",
    extractMessageParts: () => [
      { type: "text" as const, text: editor.getEditorState().read(() => $getRoot().getTextContent()) },
    ],
  }
  return { editor, write, add, options }
}

it("失败保留快照与ID，成功清空后可以连续补充", async () => {
  const { editor, write, add, options } = setup()
  add.mockResolvedValueOnce(false)
  const view = renderHook(() => useQueuedSubmission(options))
  act(() => view.result.current.open())
  await act(async () => view.result.current.select("steer"))
  expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe("补充 A")
  await act(async () => view.result.current.select("steer"))
  expect(add.mock.calls[0]).toEqual(add.mock.calls[1])
  expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe("")
  write("补充 B")
  act(() => view.result.current.open())
  await act(async () => view.result.current.select("queue"))
  expect(add).toHaveBeenCalledTimes(3)
  expect(add.mock.calls[2]).not.toEqual(add.mock.calls[0])
})

it("迟到准入不清除新草稿，取消不提交", async () => {
  const { editor, write, add, options } = setup()
  let resolve!: (value: boolean) => void
  add.mockImplementation(
    () =>
      new Promise<boolean>((done) => {
        resolve = done
      }),
  )
  const view = renderHook(() => useQueuedSubmission(options))
  act(() => view.result.current.open())
  let sending!: Promise<void>
  await act(async () => {
    sending = view.result.current.select("steer")
    await Promise.resolve()
  })
  write("较新的草稿")
  await act(async () => {
    resolve(true)
    await sending
  })
  expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe("较新的草稿")
  act(() => view.result.current.open())
  act(() => view.result.current.close())
  expect(view.result.current.isOpen).toBe(false)
  expect(add).toHaveBeenCalledTimes(1)
})

it("会话切换后旧提交的确认不清除当前编辑器", async () => {
  const { editor, write, add, options } = setup()
  let resolve!: (value: boolean) => void
  add.mockImplementation(
    () =>
      new Promise<boolean>((done) => {
        resolve = done
      }),
  )
  const view = renderHook(({ id }) => useQueuedSubmission({ ...options, sessionID: id }), { initialProps: { id: "s" } })
  act(() => view.result.current.open())
  let sending!: Promise<void>
  await act(async () => {
    sending = view.result.current.select("steer")
    await Promise.resolve()
  })
  view.rerender({ id: "other" })
  write("另一会话的草稿")
  await act(async () => {
    resolve(true)
    await sending
  })
  expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe("另一会话的草稿")
  expect(view.result.current.isOpen).toBe(false)
})
