# WebGUI 输入卡顿修复 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 对话很长时输入框键入卡顿。目标是让输入的高频更新不再触发 App/MessageList 重渲染，并把跨 ideBridge 的 input 持久化改成可控的低频同步。

**Architecture:**
1) 将 `uiBridgeState` 从“全量广播”升级为“可选择订阅（selector）”，让 `App` 只订阅会影响会话/选择项的字段（不订阅 `input`）。
2) `input` 字段同步到 host（`ideBridge.setState`）改为 200-500ms debounce，并提供 flush，在卸载/关键动作前强制落盘。
3) 作为兜底，移除/限制 `MessageList` 的高开销 debug 日志，并把自动滚动的依赖从全量签名改为 O(1) 的“末尾消息签名”。

**Tech Stack:** React + Lexical + Vitest（`packages/opencode/webgui`）

---

## 约束与验证说明

- 不在仓库根目录运行测试（根 `test` 已知会失败）。
- 单测命令（webgui）：
  - 单文件：`bun run --cwd packages/opencode/webgui test:run -- <file>`
- 本修复的“正确性”主要靠：
  - 单测验证 debounce/selector 行为
  - 手工验证：长对话下输入不应导致 `MessageList` 频繁 render（可用 React Profiler 观察）

---

### Task 1: 为 uiBridgeState 增加 selector 订阅（RED）

**Files:**
- Create: `packages/opencode/webgui/src/state/uiBridgeState.test.ts`

**Step 1: 写失败测试（selector 忽略 input 更新）**

```ts
import { describe, expect, it, vi } from "vitest"

vi.mock("../lib/ideBridge", () => ({
  ideBridge: {
    isInstalled: () => true,
    setState: vi.fn(async () => true),
  },
}))

import { uiBridgeSubscribeSelector, uiBridgeUpdate, uiBridgeEnable } from "./uiBridgeState"

describe("uiBridgeSubscribeSelector", () => {
  it("不会因为 input 变化触发非 input selector", () => {
    uiBridgeEnable()
    const onChange = vi.fn()
    const unsub = uiBridgeSubscribeSelector(
      (s) => ({ sessionID: s.sessionID, providerId: s.providerId }),
      onChange,
      (a, b) => a.sessionID === b.sessionID && a.providerId === b.providerId,
    )

    onChange.mockClear()
    uiBridgeUpdate({ input: "hello" })
    expect(onChange).toHaveBeenCalledTimes(0)

    uiBridgeUpdate({ sessionID: "s1" })
    expect(onChange).toHaveBeenCalledTimes(1)

    unsub()
  })
})
```

**Step 2: 运行测试确认失败**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/state/uiBridgeState.test.ts`

Expected: FAIL（`uiBridgeSubscribeSelector` 不存在）

---

### Task 2: 实现 selector 订阅（GREEN）

**Files:**
- Modify: `packages/opencode/webgui/src/state/uiBridgeState.ts`

**Step 1: 最小实现 `uiBridgeSubscribeSelector`**

实现要点：
- 订阅时计算一次 selector 值并缓存
- `emit(next)` 时对每个 selector 订阅者：重新计算、用 `isEqual` 判断是否变化，变化才回调
- 允许自定义 `isEqual`，默认用 `Object.is`

**Step 2: 运行 Task 1 测试应变绿**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/state/uiBridgeState.test.ts`

Expected: PASS

---

### Task 3: 为 input 持久化增加 debounce（RED）

**Files:**
- Modify: `packages/opencode/webgui/src/state/uiBridgeState.test.ts`

**Step 1: 写失败测试（input 更新只触发一次 setState）**

```ts
import { ideBridge } from "../lib/ideBridge"

it("input 更新会 debounce 后再 setState", async () => {
  vi.useFakeTimers()
  uiBridgeEnable()

  const setState = vi.mocked(ideBridge.setState)
  setState.mockClear()

  uiBridgeUpdate({ input: "a" })
  uiBridgeUpdate({ input: "ab" })
  uiBridgeUpdate({ input: "abc" })

  expect(setState).toHaveBeenCalledTimes(0)

  vi.advanceTimersByTime(350)
  // flush microtasks
  await Promise.resolve()

  expect(setState).toHaveBeenCalledTimes(1)
})
```

**Step 2: 运行测试确认失败**

Expected: FAIL（当前实现是每次 update 都 send）

---

### Task 4: 实现 input debounce + flush（GREEN）

**Files:**
- Modify: `packages/opencode/webgui/src/state/uiBridgeState.ts`
- Modify: `packages/opencode/webgui/src/main.tsx`（可选：beforeunload flush）

实现要点：
- 仅当“本次变化只有 input”时走 debounce；其他字段变化立即 send，并清理 pending 定时器。
- 新增 `uiBridgeFlush()`：若有 pending，立即 send 最新 state。
- 在 `main.tsx` 注册 `beforeunload` 调用 `uiBridgeFlush()`（可选但推荐）。

验证：Task 3 测试变绿。

---

### Task 5: App 仅订阅需要的 uiBridge 字段（RED→GREEN）

**Files:**
- Modify: `packages/opencode/webgui/src/App.tsx`

步骤：
1) 替换 `uiBridgeSubscribe((s) => setBridge(s))` 为 `uiBridgeSubscribeSelector`，selector 只包含：`sessionID/providerId/modelId/agent/variant`。
2) `AppInner` 内部逻辑使用新的“选择项快照”而不是全量 `bridge`。

验证：手工验证（长对话输入时，`AppInner` 不会因 `input` 变化 re-render）。

---

### Task 6: MessageList 兜底优化（按顺序）

**Files:**
- Modify: `packages/opencode/webgui/src/components/MessageList/index.tsx`
- Modify: `packages/opencode/webgui/src/components/MessageList/hooks/useMessageScroll.ts`

步骤：
1) 移除或用 `import.meta.env.DEV` 包裹 debug `useEffect`（包含 `messages.map(...)` 的那段）。
2) 将 `useMessageScroll` 的 `scrollSignature` 从“遍历所有 messages/parts 拼接长字符串”改为 O(1)：只基于末尾 message/parts 生成签名（仍包含 idle/reasoning）。

验证：
- `bun run --cwd packages/opencode/webgui test:run`（至少跑相关单测文件 + 任意回归单测文件）
- 手工验证：长对话流式输出时滚动仍正常；输入时不卡顿。
