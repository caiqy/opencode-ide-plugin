import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { eventEmitter } from "../../../lib/api/events"
import type { InputQueueSnapshot } from "../../../lib/api/inputQueue"
const mocks = vi.hoisted(() => ({ list: vi.fn(), add: vi.fn(), update: vi.fn(), remove: vi.fn(), next: vi.fn() }))
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
  let operation: Promise<boolean> | "" | null
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
