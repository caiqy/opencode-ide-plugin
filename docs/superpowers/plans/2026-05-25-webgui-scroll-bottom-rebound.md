# WebGUI Scroll Bottom Rebound Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 彻底修复 WebGUI 主消息列表“实际未到底但按钮隐藏/不自动跟随”的滚动状态机问题。

**Architecture:** 保留 `useMessageScroll` 对外 API 和 `messagesContainerRef.current.parentElement` 作为真实滚动宿主的约定。把自动跟随从“只观察 tail + 固定 seek timer”改为“同时观察真实滚动宿主、整体内容 shell 和 tail，并用物理底部检测驱动即时 pin”，确保深层 history/tail/tool 输出导致的 `scrollHeight` 变化都能被捕获；用户明确上滚、键盘上滚或拖滚动条时立即退出自动吸底。

**Tech Stack:** React 19、TypeScript、Vitest、Testing Library、Chrome DevTools 实机验证。

---

## Feasibility Evidence

- 当前真实页面中，消息内容最深子元素到 `main` 约 16 层，存在内部独立滚动区。
- 临时注入深层 history 高度增长 60px 后，`main.distance` 从 `0` 变成 `60`，当前 hook 不会补底。
- 同一实验中，`message-scroll-shell` / `message-scroll-root` 的 `ResizeObserver` 能捕获该深层增长。
- 临时原型在 `shell/root` 的 `ResizeObserver` 回调中按 `scrollHeight - clientHeight` 物理 pin，可把 history 深层增长 90px 后的 `distance=90` 立即修正为 `0`。

## File Structure

- Modify: `packages/opencode/webgui/src/components/MessageList/hooks/useMessageScroll.ts`
  - ResizeObserver 同时观察真实滚动宿主、`messagesContainerRef.current`（整体 shell）和 `tailRef.current`（尾部），不再只在 tail 存在时忽略 shell。
  - button-seek、send-message、auto-follow 统一依赖物理底部检测和即时 pin。
  - 移除 button-seek 的额外 700ms 固定延迟收尾 timer，避免视觉上的迟滞补跳。
- Modify: `packages/opencode/webgui/src/components/MessageList/hooks/useMessageScroll.test.tsx`
  - 新增 history 深层内容增长回归测试。
  - 新增 following 状态物理 distance 漏洞回归测试。
  - 更新 button-seek 测试，不再依赖 700ms 固定 timer 作为主要修复机制。
- Verify only: `packages/opencode/webgui/src/components/MessageList/index.tsx`
  - 保持已提交的 overlay 结构不变。
- Verify only: `packages/opencode/webgui/src/components/MessageList/index.test.tsx`
  - 确认 overlay 测试继续通过。

## Task 1: 先写 history 深层增长失败测试

**Files:**

- Modify: `packages/opencode/webgui/src/components/MessageList/hooks/useMessageScroll.test.tsx`

- [ ] **Step 1: Write the failing test**

Add this test after `工具展开后的布局抖动导致 scrollTop 瞬间变小时仍保持自动跟随`:

```ts
it("following 时 history 区深层内容增长也会继续贴到底部", () => {
  const { getByTestId } = render(
    <Harness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} controls />,
  )

  const parent = getByTestId("scroll-parent")
  const shell = getByTestId("message-scroll-container")
  const tracker = makeScrollTracker(parent)

  tracker.setMetrics(1000, 500, 500)
  fireEvent.scroll(parent)
  tracker.reset()

  tracker.growHeight(1060)
  triggerResize(shell)

  expect(tracker.getTop()).toBe(560)
  expect(getByTestId("scroll-mode").textContent).toBe("following")
  expect(getByTestId("scroll-button-visible").textContent).toBe("0")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run from `packages/opencode/webgui`:

```powershell
bun run test:run src/components/MessageList/hooks/useMessageScroll.test.tsx
```

Expected: the new test fails because current ResizeObserver observes `tail-box` and `scroll-parent`, not `message-scroll-container`; triggering shell resize does not pin to `560`.

## Task 2: 让 ResizeObserver 覆盖整体内容边界

**Files:**

- Modify: `packages/opencode/webgui/src/components/MessageList/hooks/useMessageScroll.ts`
- Modify: `packages/opencode/webgui/src/components/MessageList/hooks/useMessageScroll.test.tsx`

- [ ] **Step 1: Implement shell observation**

In `useMessageScroll.ts`, replace the ResizeObserver effect body with logic that observes both shell and tail when available:

```ts
useEffect(() => {
  const el = container()
  const shell = messagesContainerRef.current
  const tailNode = tail?.current
  if (!el || !shell) return
  if (typeof ResizeObserver === "undefined") return

  const obs = new ResizeObserver(() => {
    if (settling) return
    followTail(el)
  })

  obs.observe(shell)
  if (tailNode && tailNode !== shell) obs.observe(tailNode)
  return () => obs.disconnect()
}, [sessionID, settling, tail, container, messagesContainerRef, followTail])
```

- [ ] **Step 2: Run hook tests**

Run:

```powershell
bun run test:run src/components/MessageList/hooks/useMessageScroll.test.tsx
```

Expected: the new history-growth test passes and existing tests still pass.

## Task 3: 移除 fixed seek timer，改为 shell resize 即时追底

**Files:**

- Modify: `packages/opencode/webgui/src/components/MessageList/hooks/useMessageScroll.ts`
- Modify: `packages/opencode/webgui/src/components/MessageList/hooks/useMessageScroll.test.tsx`

- [ ] **Step 1: Add failing test that button-seek no longer creates a fixed seek timer**

Add this test near existing button-seek tests:

```ts
it("button-seek 不再创建额外的固定延迟收尾 timer", () => {
  vi.useFakeTimers()

  const { getByTestId } = render(
    <Harness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} controls />,
  )

  const parent = getByTestId("scroll-parent")
  const tracker = makeScrollTracker(parent)

  tracker.setMetrics(1000, 500, 400)
  fireEvent.scroll(parent)
  fireEvent.click(getByTestId("scroll-button"))

  expect(vi.getTimerCount()).toBe(1)
})
```

Expected before implementation: fails with timer count `2` because button-seek creates both the existing program TTL timer and the extra seek timer.

- [ ] **Step 2: Add coverage for repeated layout growth without waiting 700ms**

Add this test near existing button-seek tests:

```ts
it("button-seek 后多次整体布局增长会通过 shell resize 立即追到底部", () => {
  const { getByTestId } = render(
    <Harness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} controls />,
  )

  const parent = getByTestId("scroll-parent")
  const shell = getByTestId("message-scroll-container")
  const tracker = makeScrollTracker(parent)

  tracker.setMetrics(1000, 500, 200)
  fireEvent.scroll(parent)
  fireEvent.click(getByTestId("scroll-button"))
  expect(getByTestId("scroll-mode").textContent).toBe("seeking")

  tracker.growHeight(1060)
  triggerResize(shell)
  expect(tracker.scrollTo).toHaveBeenLastCalledWith({ top: 1060, behavior: "auto" })

  tracker.setMetrics(1060, 500, 560)
  fireEvent.scroll(parent)
  tracker.scrollTo.mockClear()

  tracker.growHeight(1120)
  triggerResize(shell)
  expect(tracker.scrollTo).toHaveBeenLastCalledWith({ top: 1120, behavior: "auto" })
  expect(getByTestId("scroll-button-visible").textContent).toBe("0")
})
```

- [ ] **Step 3: Remove fixed seek timer and keep button-seek protected during non-user jitter**

In `useMessageScroll.ts`:

1. Remove `seekTimer` and the `setTimeout(..., 700)` block from `pinBottom("button-seek")`.
2. After the button-seek `scrollTo`, call `syncLast(el)` so the next physical scroll comparison starts from the programmatic target.
3. Remove the now-unused `clearSeek` helper and its call sites.
4. In `handleScroll`, before the generic programmatic-scroll branch, keep button-seek attached during non-user scroll jitter:

```ts
if (item?.cause === "button-seek" && !dimensionsChanged && !hasUserIntent()) {
  pinBottom("button-seek", "auto")
  return
}
```

This preserves the old protection against layout/scroll jitter without relying on a delayed timer.

- [ ] **Step 4: Run hook tests**

Run:

```powershell
bun run test:run src/components/MessageList/hooks/useMessageScroll.test.tsx
```

Expected: all hook tests pass. Tests that previously advanced `700ms` now assert shell resize / immediate pin behavior instead of fixed timeout behavior.

## Task 4: Full verification and browser proof

**Files:**

- Verify only.

- [ ] **Step 1: Run focused tests**

Run from `packages/opencode/webgui`:

```powershell
bun run test:run src/components/MessageList/hooks/useMessageScroll.test.tsx src/components/MessageList/index.test.tsx
```

Expected: 2 files pass, 77+ tests pass.

- [ ] **Step 2: Run WebGUI build**

Run:

```powershell
bun run build
```

Expected: `tsc -b && vite build` passes. Existing Vite chunk-size warning is acceptable.

- [ ] **Step 3: Browser verify on `http://localhost:5173/app`**

Use Chrome DevTools to verify:

```js
const main = document.querySelector("main")
main.scrollHeight - main.clientHeight - main.scrollTop
```

Scenarios:

1. Scroll to top, click “滚动到底部”, wait for content/layout to settle: final distance must be `0` or `<= 0.5`.
2. While already at bottom, deep history/tool layout grows: final distance must return to `0` without showing stale hidden-button state.
3. User manually wheel-up during seeking/following: mode becomes detached and button appears; no automatic吸底.

## Self-Review

- Spec coverage: Task 1 covers the verified root cause: deep history growth is missed by tail-only observation. Task 2 observes the content boundary that Chrome proved catches deep nested growth. Task 3 removes fixed seek timer and preserves non-user button-seek jitter protection. Task 4 covers automated and real-browser verification.
- Placeholder scan: no TBD/TODO placeholders; every code-changing step names exact files and expected commands.
- Type consistency: helper names and refs match existing `useMessageScroll.ts` concepts (`container`, `syncLast`, `commitView`, `clearProgram`, `mode`, `ScrollCause`).
