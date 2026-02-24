# WebGUI Tab Pointer Reorder Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 VSCode webview 中将标签拖拽换序改为 Pointer-based，确保松手立即换序且顺序可持久化。

**Architecture:** 仅在 `CompactHeader` 标签栏内切换交互模型：从 HTML5 DnD 改为 pointer 手势状态机（down/move/up/cancel）。顺序提交仍走 `tabStore.reorderTabs`，继续复用现有 debounce 持久化。文件拖入能力保持原有 document 级 drop 行为，不与标签重排耦合。

**Tech Stack:** React, TypeScript, Vitest, Testing Library, existing `tabStore` KV persistence (`sdk.kv`)

---

### Task 1: 为 Pointer 重排补充失败测试（TabBar）

**Files:**

- Modify: `packages/opencode/webgui/src/components/CompactHeader/TabBar.test.tsx`

**Step 1: 写失败用例（pointer 成功换序）**

在 `TabBar.test.tsx` 新增：

```tsx
it("reorders tabs on pointer drag end", () => {
  const p = props()
  render(<TabBar {...p} />)

  const from = screen.getByTitle("会话 1")
  fireEvent.pointerDown(from, { pointerId: 1, clientX: 40, clientY: 10, button: 0 })
  fireEvent.pointerMove(from, { pointerId: 1, clientX: 220, clientY: 10 })
  fireEvent.pointerUp(from, { pointerId: 1, clientX: 220, clientY: 10 })

  expect(p.onReorder).toHaveBeenCalledWith(0, 1)
})
```

**Step 2: 写失败用例（未超过阈值不换序）**

```tsx
it("does not reorder when pointer move stays below threshold", () => {
  const p = props()
  render(<TabBar {...p} />)

  const from = screen.getByTitle("会话 1")
  fireEvent.pointerDown(from, { pointerId: 2, clientX: 40, clientY: 10, button: 0 })
  fireEvent.pointerMove(from, { pointerId: 2, clientX: 42, clientY: 10 })
  fireEvent.pointerUp(from, { pointerId: 2, clientX: 42, clientY: 10 })

  expect(p.onReorder).not.toHaveBeenCalled()
})
```

**Step 3: 写失败用例（取消路径）**

```tsx
it("cancels reorder on pointercancel", () => {
  const p = props()
  render(<TabBar {...p} />)

  const from = screen.getByTitle("会话 1")
  fireEvent.pointerDown(from, { pointerId: 3, clientX: 40, clientY: 10, button: 0 })
  fireEvent.pointerMove(from, { pointerId: 3, clientX: 220, clientY: 10 })
  fireEvent.pointerCancel(from, { pointerId: 3 })

  expect(p.onReorder).not.toHaveBeenCalled()
})
```

**Step 4: 运行单测并确认失败**

Run:

```bash
bun run --cwd packages/opencode/webgui test:run -- src/components/CompactHeader/TabBar.test.tsx
```

Expected: FAIL（Pointer 新用例失败，当前实现仍走 `drag/drop`）

**Step 5: 提交测试脚手架**

```bash
git add packages/opencode/webgui/src/components/CompactHeader/TabBar.test.tsx
git commit -m "test(webgui): add pointer reorder expectations for tab bar"
```

---

### Task 2: 在 TabBar 实现 Pointer-based 重排状态机

**Files:**

- Modify: `packages/opencode/webgui/src/components/CompactHeader/TabBar.tsx`

**Step 1: 新增最小拖拽状态与阈值常量**

在 `TabBar.tsx` 增加：

```ts
const DRAG_THRESHOLD = 6

type Drag = {
  pointer: number
  from: number
  to: number
  startX: number
  startY: number
  dragging: boolean
} | null
```

**Step 2: 增加 pointerDown 处理（仅左键）**

```ts
const onPointerDown = useCallback((e: React.PointerEvent, idx: number) => {
  if (e.button !== 0) return
  if (!(e.currentTarget instanceof HTMLDivElement)) return
  e.currentTarget.setPointerCapture(e.pointerId)
  setDrag({
    pointer: e.pointerId,
    from: idx,
    to: idx,
    startX: e.clientX,
    startY: e.clientY,
    dragging: false,
  })
}, [])
```

**Step 3: 增加 pointerMove 处理（阈值 + 目标索引计算）**

```ts
const onPointerMove = useCallback((e: React.PointerEvent) => {
  setDrag((d) => {
    if (!d || d.pointer !== e.pointerId) return d
    const moved = Math.hypot(e.clientX - d.startX, e.clientY - d.startY) >= DRAG_THRESHOLD
    const dragging = d.dragging || moved
    if (!dragging) return d
    const to = calcToIndex(e.clientX, tabRects.current, d.from)
    return to === d.to && dragging === d.dragging ? d : { ...d, to, dragging }
  })
}, [])
```

`calcToIndex` 基于每个 tab 中线计算插入位，返回合法索引。

**Step 4: 增加 pointerUp / pointerCancel 提交与清理**

```ts
const commit = useCallback(
  (d: Drag) => {
    if (!d || !d.dragging) return
    if (d.from === d.to) return
    onReorder(d.from, d.to)
  },
  [onReorder],
)

const onPointerUp = useCallback(
  (e: React.PointerEvent) => {
    setDrag((d) => {
      if (!d || d.pointer !== e.pointerId) return d
      commit(d)
      return null
    })
  },
  [commit],
)

const onPointerCancel = useCallback((e: React.PointerEvent) => {
  setDrag((d) => (d && d.pointer === e.pointerId ? null : d))
}, [])
```

**Step 5: 替换 JSX 事件绑定并保留视觉插入线**

- 去掉 `onDragOver/onDrop/onDragEnd` 传递
- 改为给 tab 容器绑定 `onPointerDown/onPointerMove/onPointerUp/onPointerCancel`
- `isDragOver` 改由 `drag.to` 与 `drag.from` 推导

**Step 6: 运行 TabBar 测试验证通过**

Run:

```bash
bun run --cwd packages/opencode/webgui test:run -- src/components/CompactHeader/TabBar.test.tsx
```

Expected: PASS

**Step 7: 提交 TabBar 实现**

```bash
git add packages/opencode/webgui/src/components/CompactHeader/TabBar.tsx packages/opencode/webgui/src/components/CompactHeader/TabBar.test.tsx
git commit -m "fix(webgui): switch tab reorder to pointer-based interactions"
```

---

### Task 3: 移除 Tab 的 HTML5 DnD 依赖并更新测试

**Files:**

- Modify: `packages/opencode/webgui/src/components/CompactHeader/Tab.tsx`
- Modify: `packages/opencode/webgui/src/components/CompactHeader/Tab.test.tsx`

**Step 1: 先改测试 props（使类型失败可见）**

在 `Tab.test.tsx` 的 `props()` 中移除：

- `onDragStart`
- `onDragOver`
- `onDrop`
- `onDragEnd`

Expected: Type check / test compile FAIL（因为 `TabProps` 仍要求 drag 回调）

**Step 2: 更新 TabProps 与 JSX，移除 drag API**

在 `Tab.tsx`：

- 删除 `onDragStart/onDragOver/onDrop/onDragEnd` props
- 删除 `dragging` 本地状态与 `handleDragStart/handleDragEnd`
- 删除 `draggable` 与 `onDrag*` 绑定
- 保持点击、双击重命名、中键关闭、右键菜单逻辑不变

**Step 3: 运行 Tab 单测**

Run:

```bash
bun run --cwd packages/opencode/webgui test:run -- src/components/CompactHeader/Tab.test.tsx
```

Expected: PASS

**Step 4: 提交 Tab 清理**

```bash
git add packages/opencode/webgui/src/components/CompactHeader/Tab.tsx packages/opencode/webgui/src/components/CompactHeader/Tab.test.tsx
git commit -m "refactor(webgui): remove html5 drag bindings from tab component"
```

---

### Task 4: 回归验证（立即换序 + 持久化 + 无副作用）

**Files:**

- Verify: `packages/opencode/webgui/src/state/tabStore.ts`
- Verify: `packages/opencode/webgui/src/state/tabStore.test.ts`
- Verify: `packages/opencode/webgui/src/components/CompactHeader/index.tsx`

**Step 1: 跑标签相关测试集**

Run:

```bash
bun run --cwd packages/opencode/webgui test:run -- src/components/CompactHeader/TabBar.test.tsx src/components/CompactHeader/Tab.test.tsx src/state/tabStore.test.ts
```

Expected: PASS

**Step 2: 跑 CompactHeader 集成测试**

Run:

```bash
bun run --cwd packages/opencode/webgui test:run -- src/components/CompactHeader/index.test.tsx src/components/CompactHeader/index.integration.test.tsx
```

Expected: PASS

**Step 3: 跑 lint**

Run:

```bash
bun run --cwd packages/opencode/webgui lint
```

Expected: PASS

**Step 4: 手测清单（VSCode webview）**

1. 标签拖拽松手后立即换序
2. 刷新 webview 后顺序保持
3. 点击切换/重命名/关闭仍正常
4. 拖入文件到消息输入区仍可插入路径

**Step 5: 提交最终验证更新（若有）**

```bash
git add packages/opencode/webgui/src/components/CompactHeader packages/opencode/webgui/src/state
git commit -m "test(webgui): verify pointer-based tab reorder and persistence"
```
