import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { eventEmitter } from "../../../lib/api/events"
import type { InputQueueSnapshot } from "../../../lib/api/inputQueue"
const mocks = vi.hoisted(() => ({ list: vi.fn(), add: vi.fn(), update: vi.fn(), moveUp: vi.fn(), remove: vi.fn(), next: vi.fn() }))
vi.mock("../../../lib/api/inputQueue", () => ({ inputQueue: mocks }))
import { useInputQueue } from "./useInputQueue"

const snapshot = (revision: number): InputQueueSnapshot => ({ sessionID: "s", revision, paused: false, items: [] })
beforeEach(() => {
  vi.clearAllMocks()
  eventEmitter.clear()
})

it("迟到快照不能覆盖新事件，切换会话不显示旧列表", async () => {
  let resolve!: (value: InputQueueSnapshot) => void
  mocks.list.mockImplementationOnce(
    () =>
      new Promise<InputQueueSnapshot>((done) => {
        resolve = done
      }),
  )
  const view = renderHook(({ id }) => useInputQueue(id), { initialProps: { id: "s" } })
  act(() => eventEmitter.emit({ type: "session.input.changed", properties: { ...snapshot(3), paused: true } }))
  await act(async () =>
    resolve({ ...snapshot(1), items: [{ id: "old", sequence: 1, delivery: "queue", text: "已删除" }] }),
  )
  expect(view.result.current.snapshot?.revision).toBe(3)
  expect(view.result.current.snapshot?.items).toHaveLength(0)
  mocks.list.mockResolvedValue({ ...snapshot(1), sessionID: "other" })
  view.rerender({ id: "other" })
  await waitFor(() => expect(view.result.current.snapshot?.sessionID).toBe("other"))
  act(() => eventEmitter.emit({ type: "session.input.changed", properties: snapshot(4) }))
  expect(view.result.current.snapshot?.sessionID).toBe("other")
})

it("同项重复操作合并，删除冲突刷新快照并展示原因", async () => {
  mocks.list.mockResolvedValue(snapshot(1))
  let reject!: (error: Error) => void
  mocks.remove.mockImplementation(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail
      }),
  )
  const view = renderHook(() => useInputQueue("s"))
  await waitFor(() => expect(view.result.current.snapshot).not.toBeNull())
  let operation: ReturnType<typeof view.result.current.remove>
  act(() => {
    operation = view.result.current.remove("a")
    void view.result.current.remove("a")
  })
  expect(mocks.remove).toHaveBeenCalledTimes(1)
  await act(async () => {
    reject(new Error("消息已发送"))
    await operation
  })
  expect(view.result.current.error).toBe("消息已发送")
  expect(view.result.current.pending).toEqual([])
})

it("上移成功应用服务端返回的新顺序", async () => {
  mocks.list.mockResolvedValue(snapshot(1))
  mocks.moveUp.mockResolvedValue({
    ...snapshot(2),
    items: [
      { id: "b", sequence: 1, delivery: "queue", text: "第二条" },
      { id: "a", sequence: 2, delivery: "steer", text: "第一条" },
    ],
  })
  const view = renderHook(() => useInputQueue("s"))
  await waitFor(() => expect(view.result.current.snapshot).not.toBeNull())
  await act(async () => {
    expect(await view.result.current.moveUp("b")).toBe(true)
  })
  expect(view.result.current.snapshot?.items.map((item) => item.id)).toEqual(["b", "a"])
})

it("删除成功应用快照并返回原始输入", async () => {
  const input = { id: "a", delivery: "queue" as const, prompt: { parts: [{ type: "text" as const, text: "恢复" }] } }
  mocks.list.mockResolvedValue({
    ...snapshot(1),
    items: [{ id: "a", sequence: 1, delivery: "queue", text: "恢复" }],
  })
  mocks.remove.mockResolvedValue({ snapshot: snapshot(2), input })
  const view = renderHook(() => useInputQueue("s"))
  await waitFor(() => expect(view.result.current.snapshot?.items).toHaveLength(1))
  await act(async () => {
    expect(await view.result.current.remove("a")).toEqual(input)
  })
  expect(view.result.current.snapshot?.revision).toBe(2)
  expect(view.result.current.snapshot?.items).toHaveLength(0)
})
