# WebGUI Scroll-to-Bottom Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构 `useMessageScroll` hook，借鉴 SolidJS `create-auto-scroll` 的可靠模式，消除新消息到来时偶发的未滚到底部问题。

**Architecture:** 废除 `scrollSignature` effect 驱动触发方式，改为**单一 ResizeObserver 驱动**；用 `markAuto`/`isAuto` 位置比对替代 programmatic timeout；将状态机从 6 个 ref 压缩到 2 个核心 ref（`userScrolled`/`auto`），消除竞态。

**Tech Stack:** React 18, TypeScript, Vitest, @testing-library/react, ResizeObserver API

---

## 背景：当前问题根因

| #   | 问题                                                                                           | 影响                              |
| --- | ---------------------------------------------------------------------------------------------- | --------------------------------- |
| 1   | `scrollSignature` effect 在 DOM 布局前执行，`scrollIntoView` 读到旧位置                        | 内容增长后无滚动                  |
| 2   | programmatic smooth scroll 用 1000ms timeout 清除标志，流式输出期间 timeout 到期触发误判       | timeout 竞态漏滚                  |
| 3   | `settling` 期间 ResizeObserver 直接 return，不做任何滚动                                       | 会话切换后初始贴底失败            |
| 4   | ResizeObserver 先调 `updateScrollState`，内容刚增长时 distance 偏大，导致 `isNearBottom=false` | ResizeObserver 触发后跳过自动滚动 |
| 5   | `wheel deltaY < -2` 即标记 `userScrolled`，触摸板惯性/嵌套滚动会误触                           | 误停止 auto-follow                |

---

## 文件结构

| 文件                                                                                  | 操作       | 说明                          |
| ------------------------------------------------------------------------------------- | ---------- | ----------------------------- |
| `packages/opencode/webgui/src/components/MessageList/hooks/useMessageScroll.ts`       | **Modify** | 核心重构目标                  |
| `packages/opencode/webgui/src/components/MessageList/hooks/useMessageScroll.test.tsx` | **Modify** | 更新/补充测试用例以覆盖新逻辑 |

其余文件（`MessageList/index.tsx`、`ScrollToBottomButton.tsx`、`SubtaskMessageList.tsx` 等）**不需要改动**，对外接口保持不变。

---

## Task 1：理解并运行现有测试基线

**Files:**

- Read: `packages/opencode/webgui/src/components/MessageList/hooks/useMessageScroll.ts`
- Read: `packages/opencode/webgui/src/components/MessageList/hooks/useMessageScroll.test.tsx`

- [ ] **Step 1：运行现有测试，确认基线通过**

```bash
# 从 webgui 包目录运行
cd packages/opencode/webgui
bun test src/components/MessageList/hooks/useMessageScroll.test.tsx
```

Expected: 所有测试 PASS（绿色）

- [ ] **Step 2：记录当前测试用例列表**

读取测试文件，列出所有 `it(...)` 描述，作为重构后行为对比基准。

---

## Task 2：设计新状态机（仅分析，不改代码）

**Files:**

- Read: `packages/ui/src/hooks/create-auto-scroll.tsx`（SolidJS 参考实现）

在开始改代码前，先在此文档明确新状态机的核心数据结构和函数签名：

**新的核心 ref：**

```typescript
// 用户是否主动离开底部
const userScrolled = useRef(false)
// 最近一次程序滚动的预期 scrollTop 和时间戳
const auto = useRef<{ top: number; time: number } | null>(null)
// 安全定时器（清除 auto 标记，防止永久残留）
const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
```

**核心辅助函数（纯函数，可单独测试）：**

```typescript
// 记录程序滚动的预期位置
function markAuto(container: HTMLElement, auto: ..., timer: ...): void

// 判断当前 scroll 是否由程序触发
function isAuto(container: HTMLElement, auto: ...): boolean

// 计算离底距离
function distanceFromBottom(container: HTMLElement): number
```

- [ ] **Step 1：阅读 SolidJS 参考实现**

重点理解：

1. `markAuto` 如何记录预期 `scrollTop`（第41-52行）
2. `isAuto` 如何比对当前位置（第54-64行）
3. `handleScroll` 中如何区分程序滚动和用户滚动（第125-146行）
4. `ResizeObserver` 回调为何是滚动的唯一触发源（第172-187行）

- [ ] **Step 2：确认新接口与现有调用方兼容**

检查 `useMessageScroll` 的返回值在以下文件中的用法：

- `MessageList/index.tsx`（第136-145行）
- `SubtaskMessageList.tsx`（第28-33行）

返回值 `{ messagesEndRef, messagesContainerRef, showScrollToBottom, scrollToBottom }` 保持不变。

---

## Task 3：重写 useMessageScroll.ts

**Files:**

- Modify: `packages/opencode/webgui/src/components/MessageList/hooks/useMessageScroll.ts`

### 新实现完整代码

- [ ] **Step 1：用以下内容完整替换 useMessageScroll.ts**

```typescript
import { useEffect, useMemo, useRef, useCallback, useState, type RefObject } from "react"
import type { Message } from "../../../state/MessagesContext"

// ─── JCEF helpers ────────────────────────────────────────────────────────────

function readJcefScrollMultiplier() {
  if (typeof window === "undefined") return
  const value = new URLSearchParams(window.location.search).get("jcefScrollMultiplier")
  if (!value) return
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return
  return parsed
}

function normalizeDelta(e: WheelEvent, container: HTMLElement) {
  if (e.deltaMode === 1) return e.deltaY * 16
  if (e.deltaMode === 2) return e.deltaY * container.clientHeight
  return e.deltaY
}

function nestedScrollable(container: HTMLElement, target: EventTarget | null) {
  let node = target instanceof HTMLElement ? target : undefined
  while (node && node !== container) {
    const style = window.getComputedStyle(node)
    const overflow = style.overflowY
    if (
      (overflow === "auto" || overflow === "scroll" || overflow === "overlay") &&
      node.scrollHeight > node.clientHeight + 1
    ) {
      return true
    }
    node = node.parentElement ?? undefined
  }
  return false
}

// ─── Auto-scroll helpers (ported from create-auto-scroll) ────────────────────

const AUTO_TTL = 1500

type AutoMark = { top: number; time: number }

function markAuto(
  container: HTMLElement,
  ref: { current: AutoMark | null },
  timer: { current: ReturnType<typeof setTimeout> | null },
) {
  ref.current = {
    top: Math.max(0, container.scrollHeight - container.clientHeight),
    time: Date.now(),
  }
  if (timer.current) clearTimeout(timer.current)
  timer.current = setTimeout(() => {
    ref.current = null
    timer.current = null
  }, AUTO_TTL)
}

function isAuto(container: HTMLElement, ref: { current: AutoMark | null }): boolean {
  const a = ref.current
  if (!a) return false
  if (Date.now() - a.time > AUTO_TTL) {
    ref.current = null
    return false
  }
  return Math.abs(container.scrollTop - a.top) < 2
}

function distanceFromBottom(container: HTMLElement): number {
  return container.scrollHeight - container.clientHeight - container.scrollTop
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useMessageScroll(
  sessionID: string | null | undefined,
  sortedMessages: Message[],
  isIdle: boolean,
  isReasoning: boolean,
  settling = false,
  box?: RefObject<HTMLDivElement | null>,
  tail?: RefObject<HTMLDivElement | null>,
  tailKey = "",
) {
  const multiplier = useMemo(() => readJcefScrollMultiplier(), [])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = box ?? innerRef

  // ── core state (2 refs replacing the previous 6) ──────────────────────────
  const userScrolled = useRef(false)
  const autoMark = useRef<AutoMark | null>(null)
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── "scroll to bottom" button ─────────────────────────────────────────────
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)

  // ── helpers ───────────────────────────────────────────────────────────────

  const container = useCallback(
    () => messagesContainerRef.current?.parentElement as HTMLElement | null,
    [messagesContainerRef],
  )

  // Immediately pin to bottom (no animation).
  // ResizeObserver fires after layout, before paint — instant assignment avoids
  // the visible "catch-up" animation you get with scrollIntoView smooth.
  const pinBottom = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      const el = container()
      if (!el) return
      markAuto(el, autoMark, autoTimer)
      if (behavior === "smooth") {
        el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
      } else {
        el.scrollTop = el.scrollHeight
      }
      setShowScrollToBottom(false)
    },
    [container],
  )

  // ── scroll event handler ──────────────────────────────────────────────────

  const handleScroll = useCallback(() => {
    const el = container()
    if (!el) return

    const dist = distanceFromBottom(el)
    const canScroll = el.scrollHeight - el.clientHeight > 1

    // Button visibility: show when more than 8 px from bottom
    setShowScrollToBottom(dist > 8)

    if (!canScroll) {
      userScrolled.current = false
      return
    }

    if (dist < 10) {
      // Arrived at bottom — resume auto-follow
      userScrolled.current = false
      return
    }

    // Ignore scroll events that WE triggered
    if (!userScrolled.current && isAuto(el, autoMark)) {
      // still programmatic — keep following
      pinBottom()
      return
    }

    userScrolled.current = true
  }, [container, pinBottom])

  // ── wheel / touch handlers ────────────────────────────────────────────────

  useEffect(() => {
    const el = container()
    if (!el) return

    const handleWheel = (e: WheelEvent) => {
      // Only treat intentional upward scrolls as user intent.
      // Keep the threshold at < -2 (same as before) to ignore tiny
      // touchpad inertia ticks. Additionally filter out nested scrollable
      // regions (code blocks, tool output) — this is the real fix for root
      // cause #5, not just lowering the threshold.
      if (e.deltaY < -2 && !nestedScrollable(el, e.target)) {
        userScrolled.current = true
      }

      // JCEF wheel multiplier
      if (!multiplier) return
      if (nestedScrollable(el, e.target)) return
      const delta = normalizeDelta(e, el)
      if (!delta) return
      e.preventDefault()
      el.scrollBy({ top: delta * multiplier, behavior: "auto" })
    }

    let lastTouchY: number | undefined
    const handleTouchStart = (e: TouchEvent) => {
      lastTouchY = e.touches[0]?.clientY
    }
    const handleTouchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY
      if (y !== undefined && lastTouchY !== undefined && y > lastTouchY) {
        userScrolled.current = true
      }
      lastTouchY = y
    }

    const opts: AddEventListenerOptions = { passive: !multiplier }
    el.addEventListener("wheel", handleWheel, opts)
    el.addEventListener("touchstart", handleTouchStart, { passive: true })
    el.addEventListener("touchmove", handleTouchMove, { passive: true })
    return () => {
      el.removeEventListener("wheel", handleWheel, opts)
      el.removeEventListener("touchstart", handleTouchStart)
      el.removeEventListener("touchmove", handleTouchMove)
    }
  }, [sessionID, multiplier, container])

  // ── scroll event binding ──────────────────────────────────────────────────

  useEffect(() => {
    const el = container()
    if (!el) return
    el.addEventListener("scroll", handleScroll)
    handleScroll()
    return () => el.removeEventListener("scroll", handleScroll)
  }, [sessionID, handleScroll, container])

  // ── overflow-anchor: disable browser anchoring to avoid conflicts ─────────

  useEffect(() => {
    const el = container()
    if (!el) return
    const prev = el.style.overflowAnchor
    el.style.overflowAnchor = "none"
    return () => {
      el.style.overflowAnchor = prev
    }
  }, [sessionID, container])

  // ── ResizeObserver: sole auto-scroll trigger ──────────────────────────────
  // Fires after layout, before paint — correct timing for scrollTop assignment.

  useEffect(() => {
    const el = container()
    const content = tail?.current ?? messagesContainerRef.current
    if (!el || !content) return
    if (typeof ResizeObserver === "undefined") return

    const obs = new ResizeObserver(() => {
      if (settling || userScrolled.current) return
      pinBottom()
    })

    obs.observe(content)
    obs.observe(el)
    return () => obs.disconnect()
  }, [sessionID, settling, tail, container, messagesContainerRef, pinBottom])

  // ── Session reset ─────────────────────────────────────────────────────────

  useEffect(() => {
    userScrolled.current = false
    autoMark.current = null
    if (autoTimer.current) {
      clearTimeout(autoTimer.current)
      autoTimer.current = null
    }
    setShowScrollToBottom(false)
  }, [sessionID])

  // ── User sends new message → force scroll back to bottom ─────────────────

  const messageCount = sortedMessages.length
  const prevMsg = useRef({ count: messageCount, id: sortedMessages.at(-1)?.info.id })

  useEffect(() => {
    const last = sortedMessages.at(-1)
    const changed = prevMsg.current.count < messageCount || prevMsg.current.id !== last?.info.id
    if (changed && last?.info.role === "user") {
      userScrolled.current = false
      pinBottom()
    }
    prevMsg.current = { count: messageCount, id: last?.info.id }
  }, [messageCount, sortedMessages, pinBottom])

  // ── Fallback effect: for environments without ResizeObserver, or when
  //    settling ends — uses scrollSignature as a secondary trigger ─────────

  const scrollSignature = useMemo(() => {
    const last = sortedMessages.at(-1)
    const id = last?.info.id ?? ""
    const parts =
      last?.parts
        .map((part) => {
          const text = (part as { text?: string }).text
          const len = typeof text === "string" ? text.length : 0
          const tool = (part as { state?: { status?: string; output?: string; metadata?: { output?: string } } }).state
          const status = typeof tool?.status === "string" ? tool.status : ""
          const out = typeof tool?.output === "string" ? tool.output.length : 0
          const meta = typeof tool?.metadata?.output === "string" ? tool.metadata.output.length : 0
          return `${part.id}:${part.type}:${len}:${status}:${out}:${meta}`
        })
        .join(",") ?? ""
    return `${id}:${last?.parts.length ?? 0}:${parts}:idle=${isIdle}:think=${isReasoning}:tail=${tailKey}`
  }, [sortedMessages, isIdle, isReasoning, tailKey])

  useEffect(() => {
    if (settling) return
    if (userScrolled.current) return
    pinBottom()
  }, [scrollSignature, settling, sessionID, pinBottom])

  // ── Manual scroll-to-bottom (button) ─────────────────────────────────────

  const scrollToBottom = useCallback(() => {
    userScrolled.current = false
    pinBottom("smooth")
  }, [pinBottom])

  return { messagesEndRef, messagesContainerRef, showScrollToBottom, scrollToBottom }
}
```

- [ ] **Step 2：运行 typecheck 确认无类型错误**

```bash
cd packages/opencode/webgui
bun typecheck
```

Expected: 0 errors

- [ ] **Step 3：Commit**

```bash
git add packages/opencode/webgui/src/components/MessageList/hooks/useMessageScroll.ts
git commit -m "refactor(webgui): rewrite useMessageScroll with markAuto/ResizeObserver pattern"
```

---

## Task 4：更新测试套件

**Files:**

- Modify: `packages/opencode/webgui/src/components/MessageList/hooks/useMessageScroll.test.tsx`

新实现使用 `container.scrollTop = scrollHeight` 而非 `scrollIntoView`，测试断言需相应调整。

### 关键变化点

- **变化 1**：`pinBottom` 直接赋 `scrollTop`（非 smooth 时），测试 harness 需追踪 `scrollTop` 写入而非 `scrollIntoView` 调用
- **变化 2**：wheel 阈值**保持 `< -2`**（与旧版相同），同时新增 `nestedScrollable` 过滤——这才是根因 #5 的真正修复，"微小 wheel delta" 用例**不需要**修改期望
- **变化 3**：贴底判定只用 `scrollHeight - clientHeight - scrollTop`，不再用 `getBoundingClientRect`

### mock 方式升级

`setScrollMetrics` 每次会通过 `Object.defineProperty` 重写 `scrollTop`，与 tracker 的 setter 形成覆盖冲突。解决方式：**让 tracker 接管 `scrollHeight`/`clientHeight`，而 `scrollTop` 通过单独的可写属性维护**，避免两者冲突：

```typescript
// 新方式：追踪 scrollTop 赋值（自动写入）+ scrollTo 调用（smooth）
// 注意：内部维护 _top，setScrollMetrics 通过 top 参数直接设置，不计入计数
function makeScrollTracker(el: HTMLElement) {
  let count = 0
  let _top = 0
  let _scrollHeight = 1000
  let _clientHeight = 500

  // 重写 scrollHeight / clientHeight 为可配置属性
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => _scrollHeight })
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => _clientHeight })

  // scrollTop：写入（来自 pinBottom）计数；直接读/写（setFrom/来自 setScrollMetrics）不计数
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => _top,
    set: (v: number) => {
      const fromPin = !_setting // _setting 标志区分 setScrollMetrics 赋值
      _top = v
      if (fromPin) count++
    },
  })

  // scrollTo（smooth 分支）
  const scrollTo = vi.fn((opts?: ScrollToOptions) => {
    if (opts?.top !== undefined) _top = opts.top
    count++
  })
  Object.defineProperty(el, "scrollTo", { configurable: true, value: scrollTo })

  // 供测试内手动设定指标而不触发计数
  let _setting = false
  const setMetrics = (scrollHeight: number, clientHeight: number, scrollTop: number) => {
    _setting = true
    _scrollHeight = scrollHeight
    _clientHeight = clientHeight
    _top = scrollTop
    _setting = false
  }

  return {
    getCount: () => count,
    reset: () => {
      count = 0
    },
    setMetrics,
    scrollTo,
  }
}
```

旧的 `setScrollMetrics` 辅助函数应替换为 `tracker.setMetrics(scrollHeight, clientHeight, scrollTop)`。

- [ ] **Step 1：更新 beforeEach / mock 结构**

用 `makeScrollTracker` 替换 `scrollIntoView` mock + `setScrollMetrics`，在每个测试中通过 `tracker.getCount()` 断言，`tracker.setMetrics(...)` 设置滚动指标。

- [ ] **Step 2："微小 wheel delta" 用例：阈值不变，期望不变，只更新 mock**

wheel 阈值保持 `< -2`，该用例原有期望（`deltaY = -1` 不触发锁定）仍然正确：

```typescript
it("微小 wheel delta 不应触发离底锁定", () => {
  tracker.setMetrics(1000, 500, 500)
  fireEvent.scroll(parent)
  tracker.reset()

  fireEvent.wheel(parent, { deltaY: -1 }) // < -2 阈值，不触发

  triggerResize(tail) // ResizeObserver 触发，userScrolled=false，应继续跟随
  expect(tracker.getCount()).toBeGreaterThan(0) // 仍会 pinBottom
})
```

- [ ] **Step 3：更新 "贴底判定" 测试**

移除 `getBoundingClientRect` mock，改为直接用 `scrollHeight - clientHeight - scrollTop`：

```typescript
it("贴底判定基于 scrollHeight-clientHeight-scrollTop，dist<=8 认为在底部", () => {
  tracker.setMetrics(1000, 500, 992) // dist = 8 → 在底
  fireEvent.scroll(parent)
  expect(getByTestId("scroll-button-visible").textContent).toBe("0")

  tracker.setMetrics(1000, 500, 990) // dist = 10 → 离底
  fireEvent.scroll(parent)
  expect(getByTestId("scroll-button-visible").textContent).toBe("1")
})
```

- [ ] **Step 4：按照下表分类处理旧测试用例**

新实现自动跟随改用 `scrollTop` 立即贴底，仅手动 `scrollToBottom` 按钮保留 smooth。因此原来依赖 `scrollIntoView({ behavior: "smooth" })` 语义的测试需要相应处置：

| 原用例描述                                              | 处置方式                             | 说明                                                                                    |
| ------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------- |
| 在底部时持续自动滚动，用户离开底部后停止                | **保留，改 mock**                    | 逻辑不变，tracker 替换                                                                  |
| 工具状态变化时触发自动滚动                              | **保留，改 mock + 用 triggerResize** | 新实现由 ResizeObserver 驱动                                                            |
| `smooth 动画超过旧窗口后到达底部，不应清空用户上滑意图` | **删除**                             | 该测试验证旧 programmatic timeout 竞态防护，新实现用 markAuto 位置比对，该场景不再存在  |
| `smooth 自动滚动过程中不会让到底按钮闪回显示`           | **重写**                             | 自动跟随改为 auto，不再有 smooth 中间态；改为验证 pinBottom 时 showScrollToBottom=false |
| `smooth 期间仅 scroll 离底后停止自动滚动`               | **重写**                             | 同上，auto 贴底 + isAuto 保护，用 `!isAuto` 路径验证                                    |
| scrollbar 拖拽或键盘滚动离底后停止                      | **保留，改 mock**                    | handleScroll 中 movedUp 检测，逻辑不变                                                  |
| 微小 wheel delta 不触发离底锁定                         | **保留，期望不变，改 mock**          | 阈值 < -2 不变                                                                          |
| JCEF multiplier 放大位移                                | **保留，改 mock**                    | 逻辑不变                                                                                |
| 切换 session 后重置滚动状态                             | **保留，改 mock**                    | 逻辑不变                                                                                |
| 用户发送新消息时强制回到底部                            | **保留，改 mock**                    | 逻辑不变                                                                                |
| 离开底部一点点显示滚动到底部按钮                        | **保留，改 mock**                    | dist > 8 阈值                                                                           |
| 内容自动展开导致高度增长但 scrollTop 未上移时仍保持跟随 | **保留，改 mock + 用 triggerResize** | ResizeObserver 驱动                                                                     |
| history 区 resize 不触发 / tail 区触发                  | **保留，改 mock**                    | obs.observe(tail) 配置不变                                                              |
| 贴底判定基于 tail anchor（getBoundingClientRect）       | **重写**                             | 新实现不用 getBoundingClientRect，改 Step 3 的新版本                                    |
| 容器高度变化时保持到底部                                | **保留，改 mock**                    | ResizeObserver 同样处理                                                                 |
| settling 期间不滚，结束后校正                           | **保留，改 mock**                    | 新实现 settling 阻塞 ResizeObserver + scrollSignature fallback 校正                     |
| 无 ResizeObserver 降级                                  | **保留，改 mock**                    | scrollSignature fallback                                                                |
| 新增：嵌套可滚动区域 wheel 不触发 userScrolled          | **新增**                             | 见下 Step 4b                                                                            |

- [ ] **Step 4b：新增 nestedScrollable 测试**

```typescript
it("嵌套可滚动区域内的 wheel 上滑不标记主消息区 userScrolled", () => {
  // 在 parent 内部创建一个 overflow:auto 的嵌套容器
  const nested = document.createElement("div")
  Object.defineProperty(nested, "scrollHeight", { configurable: true, value: 400 })
  Object.defineProperty(nested, "clientHeight", { configurable: true, value: 100 })
  nested.style.overflowY = "auto"
  const container = getByTestId("message-scroll-container") // messagesContainerRef 的 parentElement
  container.appendChild(nested)

  tracker.setMetrics(1000, 500, 500)
  fireEvent.scroll(container)
  tracker.reset()

  // wheel 事件 target 在嵌套容器内
  fireEvent.wheel(container, { deltaY: -50, target: nested })

  triggerResize(tail) // ResizeObserver 触发
  expect(tracker.getCount()).toBeGreaterThan(0) // 仍应 pinBottom（userScrolled 未被锁）
})
```

- [ ] **Step 5：运行测试，确认全部通过**

```bash
cd packages/opencode/webgui
bun test src/components/MessageList/hooks/useMessageScroll.test.tsx
```

Expected: 全部 PASS

- [ ] **Step 6：Commit**

```bash
git add packages/opencode/webgui/src/components/MessageList/hooks/useMessageScroll.test.tsx
git commit -m "test(webgui): update useMessageScroll tests for markAuto/ResizeObserver refactor"
```

---

## Task 5：回归全包测试

**Files:** 无新改动，验证现有 MessageList 集成测试不受影响

- [ ] **Step 1：运行 MessageList 全部测试**

```bash
cd packages/opencode/webgui
bun test src/components/MessageList/
```

Expected: 全部 PASS

- [ ] **Step 2：运行 webgui 全包测试**

```bash
cd packages/opencode/webgui
bun test
```

Expected: 全部 PASS（或与改动前相同数量的 passes）

- [ ] **Step 3：typecheck 全包**

```bash
cd packages/opencode/webgui
bun typecheck
```

Expected: 0 errors

- [ ] **Step 4：如有失败，按照 systematic-debugging skill 排查**

---

## Task 6：手动验证关键场景

**Files:** 无代码改动，仅验证

- [ ] **Step 1：启动 webgui dev server**

```bash
cd packages/opencode/webgui
bun dev
```

- [ ] **Step 2：验证以下场景**

| 场景                    | 预期结果                             |
| ----------------------- | ------------------------------------ |
| 新会话，AI 开始流式输出 | 自动贴底跟随，无"落后"感             |
| 流式输出中途向上滚动    | 停止自动跟随，显示"滚到底部"按钮     |
| 点击"滚到底部"按钮      | 平滑滚回底部，按钮消失，恢复自动跟随 |
| 用户手动滚回底部        | 自动贴底恢复                         |
| 发送新消息时在历史区    | 自动跳回底部                         |
| 切换 session            | 立即贴底新会话底部                   |
| reasoning 状态切换      | 不抖动，贴底正常                     |
| tool 调用输出展开       | 自动跟随展开高度                     |

- [ ] **Step 3：最终 commit（若有修复）**

```bash
git add packages/opencode/webgui/src/components/MessageList/hooks/useMessageScroll.ts
git commit -m "fix(webgui): correct scroll behavior for <scenario>"
```

---

## 关键设计决策

### 为何废除 `scrollIntoView` 改用 `scrollTop` 直接赋值

`scrollIntoView({ behavior: "smooth" })` 在流式输出中产生"平滑追赶"视觉噪声，且 smooth 动画完成时机不可预测，导致需要 timeout 清除 programmatic flag，进而产生竞态。

`el.scrollTop = el.scrollHeight` 在 ResizeObserver 回调（layout 后、paint 前）执行，零延迟，视觉上内容和滚动位置同步出现。仅手动按钮点击保留 smooth，因为这是用户主动操作，动画有明确意义。

### 为何保留 `scrollSignature` effect 作为 fallback

1. 某些测试环境无 ResizeObserver
2. `settling` 结束时需补一次校正滚动（settling 期间 ResizeObserver 被跳过）
3. `isIdle`/`isReasoning` 切换（无高度变化）需要保底

fallback effect 条件严格：`if (settling) return; if (userScrolled.current) return; pinBottom()`，与 ResizeObserver 调用同一幂等的 `pinBottom`，不产生冲突。

### `markAuto` / `isAuto` 替代 programmatic timeout 的原理

旧方案：1000ms timeout 内认为所有 scroll 事件是程序触发的 → timeout 期间用户真实滚动被忽略。

新方案：记录程序滚动的预期 `scrollTop`，每次 scroll 事件比对差值。差值 < 2px 认为是程序触发；差值大则认为用户介入。无 timeout 竞态。
