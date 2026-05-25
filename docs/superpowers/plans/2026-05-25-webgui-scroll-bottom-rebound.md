# WebGUI Scroll Bottom Rebound Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 WebGUI 对话区滚动到底部后偶发回弹 1-5px、且不再精确贴到底部的问题。

**Architecture:** 保留现有 `useMessageScroll` 状态机，但把“接近底部可视为 following”和“需要物理校准到最底部”分开。把滚动到底按钮从 `message-scroll-shell` 的文档流中移到 shell 外的零高度 sticky overlay，避免按钮显示/隐藏改变 shell 高度或破坏滚动宿主绑定。

**Tech Stack:** React 19、TypeScript、Vitest、Testing Library、Tailwind CSS。

---

## File Structure

- Modify: `packages/opencode/webgui/src/components/MessageList/hooks/useMessageScroll.ts`
  - 新增/调整接近底部时的精确贴底逻辑，避免 1-5px 残留距离被永久接受。
- Modify: `packages/opencode/webgui/src/components/MessageList/index.tsx`
  - 把 `scroll-to-bottom-layer` 放到 `message-scroll-shell` 外的零高度 sticky overlay，同时保持 `message-scroll-shell.parentElement` 是外部滚动宿主。
- Modify: `packages/opencode/webgui/src/components/MessageList/hooks/useMessageScroll.test.tsx`
  - 新增回归测试：接近底部的 scroll 事件会被校准到物理最底部。
- Modify: `packages/opencode/webgui/src/components/MessageList/index.test.tsx`
  - 调整/新增测试：滚动按钮层不再位于 `message-scroll-shell` 内部，避免参与滚动内容高度。

## Task 1: 精确贴底回归测试与 hook 修复

**Files:**
- Modify: `packages/opencode/webgui/src/components/MessageList/hooks/useMessageScroll.test.tsx`
- Modify: `packages/opencode/webgui/src/components/MessageList/hooks/useMessageScroll.ts`

- [ ] **Step 1: Write the failing test**

Add this test near the existing bottom-threshold tests in `useMessageScroll.test.tsx`:

```ts
it("接近底部时会校准到物理最底部，避免残留 1-5px 距离", () => {
  const { getByTestId } = render(
    <Harness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} controls />,
  )

  const parent = getByTestId("scroll-parent")
  const tracker = makeScrollTracker(parent)

  tracker.setMetrics(1000, 500, 496)
  fireEvent.scroll(parent)

  expect(tracker.getTop()).toBe(500)
  expect(getByTestId("scroll-mode").textContent).toBe("following")
  expect(getByTestId("scroll-at-bottom").textContent).toBe("1")
  expect(getByTestId("scroll-button-visible").textContent).toBe("0")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
bun run test:run src/components/MessageList/hooks/useMessageScroll.test.tsx
```

Expected: the new test fails because `tracker.getTop()` remains `496` instead of `500`.

- [ ] **Step 3: Implement minimal hook fix**

In `useMessageScroll.ts`, add a small helper near `pinBottom`:

```ts
const settleAtBottom = useCallback(
  (el: HTMLElement) => {
    const targetTop = Math.max(0, el.scrollHeight - el.clientHeight)
    const gap = targetTop - el.scrollTop
    if (gap > 0.5 && gap <= 6) {
      el.scrollTop = targetTop
    }
    syncLast(el)
    commitView("following", true)
  },
  [commitView, syncLast],
)
```

Then replace the `if (at)` branch in `handleScroll` with:

```ts
if (at) {
  allowNextTailFollow.current = false
  clearProgram()
  clearSeek()
  settleAtBottom(el)
  return
}
```

Include `settleAtBottom` in the `handleScroll` dependency array.

- [ ] **Step 4: Run hook tests**

Run:

```powershell
bun run test:run src/components/MessageList/hooks/useMessageScroll.test.tsx
```

Expected: all hook tests pass.

## Task 2: 把滚动到底按钮改成 overlay

**Files:**
- Modify: `packages/opencode/webgui/src/components/MessageList/index.tsx`
- Modify: `packages/opencode/webgui/src/components/MessageList/index.test.tsx`

- [ ] **Step 1: Write the failing component test**

Add or update the scroll button layout test in `index.test.tsx` to assert the layer is not inside `message-scroll-shell`:

```ts
it("scroll-to-bottom-layer 作为 overlay 渲染，不参与 message-scroll-shell 文档流", () => {
  mocks.useMessageScroll.mockReturnValue({
    messagesEndRef: { current: null },
    messagesContainerRef: { current: null },
    mode: "detached",
    showScrollToBottom: true,
    scrollToBottom: vi.fn(),
    runProgrammaticScroll: vi.fn(),
  })

  render(<MessageList sessionID="s1" />)

  const shell = screen.getByTestId("message-scroll-shell")
  const layer = screen.getByTestId("scroll-to-bottom-layer")

  expect(shell).not.toContainElement(layer)
  expect(layer).toHaveClass("sticky", "bottom-0", "z-30", "flex", "h-0", "justify-end", "pr-2", "pointer-events-none")
  expect(screen.getByTestId("scroll-to-bottom-offset")).toHaveClass("-translate-y-[calc(100%+2rem)]")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
bun run test:run src/components/MessageList/index.test.tsx
```

Expected: test fails because `scroll-to-bottom-layer` is currently inside `message-scroll-shell` and participates in the shell layout.

- [ ] **Step 3: Implement overlay layout**

In `index.tsx`, render the zero-height sticky overlay as a sibling after the scroll shell:

```tsx
<div data-testid="message-scroll-shell" ref={messagesContainerRef} className="min-h-full">
  ...existing message content...
</div>

{showScrollToBottom && (
  <div
    data-testid="scroll-to-bottom-layer"
    className="pointer-events-none sticky bottom-0 z-30 flex h-0 justify-end pr-2"
  >
    <div data-testid="scroll-to-bottom-offset" className="-translate-y-[calc(100%+2rem)]">
      <ScrollToBottomButton visible={showScrollToBottom} onClick={scrollToBottom} />
    </div>
  </div>
)}
```

Do not move `messagesContainerRef`; it must remain on `message-scroll-shell` so `useMessageScroll` still resolves the scroll parent as `<main>`.

Implementation note: the final implementation must not insert a wrapper between `message-scroll-shell` and the external scroll host. The zero-height sticky overlay stays outside `message-scroll-shell`, remains visible in the scrollport, and avoids adding button height to the shell.

- [ ] **Step 4: Run component tests**

Run:

```powershell
bun run test:run src/components/MessageList/index.test.tsx
```

Expected: all `MessageList` component tests pass.

## Task 3: Full verification

**Files:**
- Verify only.

- [ ] **Step 1: Run focused scroll tests**

Run:

```powershell
bun run test:run src/components/MessageList/hooks/useMessageScroll.test.tsx src/components/MessageList/index.test.tsx
```

Expected: both test files pass.

- [ ] **Step 2: Run WebGUI build for typecheck and bundling**

Run:

```powershell
bun run build
```

Expected: `tsc -b` and `vite build` pass. The existing Vite chunk-size warning is acceptable.

## Self-Review

- Spec coverage: Task 1 covers exact bottom calibration; Task 2 covers removing button layer from scroll content flow; Task 3 covers verification.
- Placeholder scan: no TBD/TODO placeholders.
- Type consistency: new helper uses existing scroll metrics and view state helpers; tests use existing harness and mocked hook shape.
