import assert from "node:assert/strict"
import { DebugStateStore } from "./DebugState"

test("DebugStateStore 跟踪会话生命周期与活动会话", () => {
  const store = new DebugStateStore()
  assert.strictEqual(store.snapshot().activeSessionId, null)

  store.upsertSession({ id: "s1", name: "Node", type: "node" })
  store.setActive({ id: "s1", name: "Node", type: "node" })

  assert.strictEqual(store.snapshot().activeSessionId, "s1")
  assert.deepStrictEqual(
    store.snapshot().sessions.map((session) => session.id),
    ["s1"],
  )

  store.removeSession("s1")
  assert.strictEqual(store.snapshot().activeSessionId, null)
  assert.deepStrictEqual(store.snapshot().sessions, [])
})

test("DebugStateStore 按线程维护暂停状态并在继续时按规范清理", () => {
  const store = new DebugStateStore()
  store.setActive({ id: "s1", name: "Node", type: "node" })

  store.onDapMessage("s1", {
    type: "event",
    event: "stopped",
    body: { reason: "breakpoint", threadId: 2, hitBreakpointIds: [7] },
  })
  store.onDapMessage("s1", { type: "event", event: "stopped", body: { reason: "exception", threadId: 5 } })
  assert.deepStrictEqual(store.pausedThreads("s1"), [
    { threadId: 2, reason: "breakpoint", hitBreakpointIds: [7] },
    { threadId: 5, reason: "exception", hitBreakpointIds: undefined },
  ])
  assert.strictEqual(store.isGloballyPaused("s1"), false)

  // allThreadsContinued 显式 false：只恢复给定线程
  store.onDapMessage("s1", { type: "event", event: "continued", body: { threadId: 2, allThreadsContinued: false } })
  assert.deepStrictEqual(store.pausedThreads("s1"), [
    { threadId: 5, reason: "exception", hitBreakpointIds: undefined },
  ])

  // allThreadsContinued 显式 true：全部线程恢复
  store.onDapMessage("s1", { type: "event", event: "stopped", body: { reason: "breakpoint", threadId: 6 } })
  store.onDapMessage("s1", { type: "event", event: "continued", body: { threadId: 5, allThreadsContinued: true } })
  assert.deepStrictEqual(store.pausedThreads("s1"), [])

  // 省略 allThreadsContinued：按 DAP 规范视为全部线程已恢复
  store.onDapMessage("s1", { type: "event", event: "stopped", body: { reason: "breakpoint", threadId: 8 } })
  store.onDapMessage("s1", { type: "event", event: "continued", body: { threadId: 8 } })
  assert.deepStrictEqual(store.pausedThreads("s1"), [])
})

test("DebugStateStore 将 allThreadsStopped 建模为会话级全局暂停并保留暂停原因", () => {
  const store = new DebugStateStore()
  store.setActive({ id: "s1", name: "Node", type: "node" })

  store.onDapMessage("s1", {
    type: "event",
    event: "stopped",
    body: { reason: "exception", threadId: 9, hitBreakpointIds: [3], allThreadsStopped: true },
  })
  assert.deepStrictEqual(store.pausedThreads("s1"), [
    { threadId: 9, reason: "exception", hitBreakpointIds: [3] },
  ])
  assert.strictEqual(store.isGloballyPaused("s1"), true)
  assert.deepStrictEqual(store.lastStopped("s1"), {
    threadId: 9,
    reason: "exception",
    description: undefined,
    text: undefined,
    hitBreakpointIds: [3],
  })

  store.clearPaused("s1", 9)
  assert.deepStrictEqual(store.pausedThreads("s1"), [])
  assert.strictEqual(store.isGloballyPaused("s1"), false)
})

test("DebugStateStore 无 threadId 的全局暂停不伪造线程记录", () => {
  const store = new DebugStateStore()
  store.setActive({ id: "s1", name: "Node", type: "node" })

  store.onDapMessage("s1", {
    type: "event",
    event: "stopped",
    body: { reason: "exception", allThreadsStopped: true },
  })
  assert.deepStrictEqual(store.pausedThreads("s1"), [])
  assert.strictEqual(store.isGloballyPaused("s1"), true)
  assert.deepStrictEqual(store.lastStopped("s1")?.reason, "exception")

  store.onDapMessage("s1", { type: "event", event: "stopped", body: { reason: "step", threadId: 3 } })
  assert.deepStrictEqual(store.pausedThreads("s1"), [
    { threadId: 3, reason: "step", hitBreakpointIds: undefined },
  ])
  assert.strictEqual(store.isGloballyPaused("s1"), false)

  store.onDapMessage("s1", { type: "event", event: "continued", body: { threadId: 3 } })
  assert.deepStrictEqual(store.pausedThreads("s1"), [])
  assert.strictEqual(store.isGloballyPaused("s1"), false)
})

test("DebugStateStore 全局暂停后的独立 continued(false) 保留其余已知线程", () => {
  const store = new DebugStateStore()
  store.setActive({ id: "s1", name: "Node", type: "node" })

  store.onDapMessage("s1", {
    type: "response",
    command: "threads",
    success: true,
    body: {
      threads: [
        { id: 7, name: "main" },
        { id: 8, name: "worker" },
        { id: 9, name: "io" },
      ],
    },
  })
  store.onDapMessage("s1", { type: "event", event: "stopped", body: { reason: "exception", allThreadsStopped: true } })
  assert.strictEqual(store.isGloballyPaused("s1"), true)

  store.onDapMessage("s1", { type: "event", event: "continued", body: { threadId: 9, allThreadsContinued: false } })
  assert.strictEqual(store.isGloballyPaused("s1"), false)
  assert.deepStrictEqual(
    store.pausedThreads("s1").map((thread) => thread.threadId),
    [7, 8],
  )
})

test("DebugStateStore 通过 thread 事件与 threads 响应维护已知线程列表", () => {
  const store = new DebugStateStore()
  store.setActive({ id: "s1", name: "Node", type: "node" })

  store.onDapMessage("s1", { type: "event", event: "thread", body: { reason: "started", threadId: 11 } })
  assert.deepStrictEqual(store.knownThreads("s1"), [11])

  store.onDapMessage("s1", { type: "event", event: "stopped", body: { reason: "pause", allThreadsStopped: true } })
  store.onDapMessage("s1", { type: "event", event: "continued", body: { threadId: 12, allThreadsContinued: false } })
  assert.deepStrictEqual(
    store.pausedThreads("s1").map((thread) => thread.threadId),
    [11],
  )

  store.onDapMessage("s1", { type: "event", event: "thread", body: { reason: "exited", threadId: 11 } })
  assert.deepStrictEqual(store.knownThreads("s1"), [])

  store.onDapMessage("s1", {
    type: "response",
    command: "threads",
    success: true,
    body: {
      threads: [{ id: 21, name: "a" }, { id: 22, name: "b" }],
    },
  })
  assert.deepStrictEqual(store.knownThreads("s1"), [21, 22])
})

test("DebugStateStore 捕获适配器单线程执行能力", () => {
  const store = new DebugStateStore()
  store.setActive({ id: "s1", name: "Node", type: "node" })
  assert.strictEqual(store.supportsSingleThreadExecution("s1"), false)

  // 标准 DAP InitializeResponse：body 直接就是 Capabilities
  store.onDapMessage("s1", {
    type: "response",
    command: "initialize",
    success: true,
    body: { supportsSingleThreadExecutionRequests: true },
  })
  assert.strictEqual(store.supportsSingleThreadExecution("s1"), true)

  store.onDapMessage("s1", {
    type: "response",
    command: "initialize",
    success: true,
    body: {},
  })
  assert.strictEqual(store.supportsSingleThreadExecution("s1"), false)
})

test("DebugStateStore addPausedThreads 物化暂停线程并去重", () => {
  const store = new DebugStateStore()
  store.setActive({ id: "s1", name: "Node", type: "node" })

  store.onDapMessage("s1", { type: "event", event: "stopped", body: { reason: "step", threadId: 7 } })
  store.addPausedThreads("s1", [7, 8, 8])
  assert.deepStrictEqual(store.pausedThreads("s1"), [
    { threadId: 7, reason: "step", hitBreakpointIds: undefined },
    { threadId: 8, reason: undefined, hitBreakpointIds: undefined },
  ])
})

test("DebugStateStore 同一线程的 stopped 覆盖旧状态，terminated 与无线程 continued 清空", () => {
  const store = new DebugStateStore()
  store.setActive({ id: "s1", name: "Node", type: "node" })

  store.onDapMessage("s1", { type: "event", event: "stopped", body: { reason: "breakpoint", threadId: 2 } })
  store.onDapMessage("s1", { type: "event", event: "stopped", body: { reason: "step", threadId: 2 } })
  assert.deepStrictEqual(store.pausedThreads("s1"), [
    { threadId: 2, reason: "step", hitBreakpointIds: undefined },
  ])

  store.onDapMessage("s1", { type: "event", event: "stopped", body: { reason: "exception", threadId: 5 } })
  store.onDapMessage("s1", { type: "event", event: "continued", body: {} })
  assert.deepStrictEqual(store.pausedThreads("s1"), [])

  store.onDapMessage("s1", { type: "event", event: "stopped", body: { threadId: 3 } })
  store.onDapMessage("s1", { type: "event", event: "terminated", body: {} })
  assert.deepStrictEqual(store.pausedThreads("s1"), [])
  assert.strictEqual(store.isGloballyPaused("s1"), false)
  assert.strictEqual(store.lastStopped("s1"), null)
})

test("DebugStateStore 忽略非法消息与未知会话", () => {
  const store = new DebugStateStore()
  store.onDapMessage("missing", { type: "event", event: "stopped" })
  assert.deepStrictEqual(store.pausedThreads("missing"), [])

  store.upsertSession({ id: "s1", name: "n", type: "t" })
  store.onDapMessage("s1", { type: "response", command: "threads" })
  store.onDapMessage("s1", null)
  store.onDapMessage("s1", { type: "event" })
  assert.deepStrictEqual(store.pausedThreads("s1"), [])
})

test("DebugStateStore setActive 空值仅清空活动引用，reset 清空全部", () => {
  const store = new DebugStateStore()
  store.setActive({ id: "s2", name: "n", type: "t" })
  store.setActive(null)
  assert.strictEqual(store.snapshot().activeSessionId, null)
  assert.strictEqual(store.snapshot().sessions.length, 1)

  store.reset()
  assert.deepStrictEqual(store.snapshot(), { activeSessionId: null, sessions: [] })
})
