# 子任务弹层左边缘拉伸 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让子任务弹层支持左边缘拖拽调宽（可宽可窄），默认 520px，范围限制为 360px 到 90vw，且不持久化宽度。

**Architecture:** 在 `SubtaskDrawer` 内部维护局部宽度状态和拖拽会话状态，新增左侧拖拽手柄，使用 pointer 事件在拖拽时实时计算并 clamp 宽度。测试通过 `SubtaskDrawer.test.tsx` 增量覆盖默认宽度、双向拖拽和边界限制，保证不回归现有关闭行为。

**Tech Stack:** React 19、TypeScript、Tailwind class、Vitest + Testing Library

---

### Task 1: 为拖拽宽度行为写失败测试（RED）

**Files:**

- Modify: `packages/opencode/webgui/src/components/SubtaskDrawer/SubtaskDrawer.test.tsx`
- Reference: `packages/opencode/webgui/src/components/SubtaskDrawer/SubtaskDrawer.tsx`

**Step 1: 写失败测试（默认宽度 + 拖拽增减）**

在 `SubtaskDrawer.test.tsx` 新增 3 个测试：

```tsx
it("默认宽度应为 520px", () => {
  render(<SubtaskDrawer />)
  const dialog = screen.getByRole("dialog", { name: "子任务" })
  expect(dialog).toHaveStyle({ width: "520px" })
})

it("左边缘向左拖拽后应变宽", () => {
  render(<SubtaskDrawer />)
  const handle = screen.getByTestId("subtask-drawer-resize-handle")
  const dialog = screen.getByRole("dialog", { name: "子任务" })

  fireEvent.pointerDown(handle, { button: 0, clientX: 900 })
  fireEvent.pointerMove(window, { clientX: 820 })
  fireEvent.pointerUp(window)

  expect(parseFloat((dialog as HTMLElement).style.width)).toBeGreaterThan(520)
})

it("左边缘向右拖拽后应变窄", () => {
  render(<SubtaskDrawer />)
  const handle = screen.getByTestId("subtask-drawer-resize-handle")
  const dialog = screen.getByRole("dialog", { name: "子任务" })

  fireEvent.pointerDown(handle, { button: 0, clientX: 900 })
  fireEvent.pointerMove(window, { clientX: 980 })
  fireEvent.pointerUp(window)

  expect(parseFloat((dialog as HTMLElement).style.width)).toBeLessThan(520)
})
```

**Step 2: 运行测试，确认失败**

Run (workdir=`packages/opencode/webgui`):

```bash
bun run test:run src/components/SubtaskDrawer/SubtaskDrawer.test.tsx
```

Expected: FAIL（缺少 resize handle 和受控 width）

**Step 3: 提交测试变更**

```bash
git add packages/opencode/webgui/src/components/SubtaskDrawer/SubtaskDrawer.test.tsx
git commit -m "test(webgui): add failing tests for subtask drawer resize behavior"
```

### Task 2: 最小实现拖拽宽度能力（GREEN）

**Files:**

- Modify: `packages/opencode/webgui/src/components/SubtaskDrawer/SubtaskDrawer.tsx`
- Test: `packages/opencode/webgui/src/components/SubtaskDrawer/SubtaskDrawer.test.tsx`

**Step 1: 写最小实现（状态 + 事件 + 手柄）**

在 `SubtaskDrawer.tsx` 中实现：

1. 新增局部状态

```tsx
const [width, setWidth] = useState(520)
const drag = useRef<{ x: number; width: number } | null>(null)
```

2. 新增 clamp 函数

```tsx
const clamp = (next: number) => {
  const max = window.innerWidth * 0.9
  return Math.min(max, Math.max(360, next))
}
```

3. 新增 `pointerdown`/`pointermove`/`pointerup` 流程

- `pointerdown` 仅处理 `button===0`
- 记录 `drag.current = { x: e.clientX, width }`
- `pointermove` 计算 `delta = drag.current.x - e.clientX`
- 更新 `setWidth(clamp(drag.current.width + delta))`
- `pointerup` / `pointercancel` 清空 `drag.current`

4. 抽屉容器改为受控宽度

```tsx
style={{ width: `${width}px`, maxWidth: "90vw" }}
```

5. 新增左侧手柄

```tsx
<div
  data-testid="subtask-drawer-resize-handle"
  className="absolute left-0 top-0 h-full w-2 cursor-col-resize"
  onPointerDown={onResizeStart}
  onClick={(e) => e.stopPropagation()}
/>
```

**Step 2: 运行测试，确认通过**

Run (workdir=`packages/opencode/webgui`):

```bash
bun run test:run src/components/SubtaskDrawer/SubtaskDrawer.test.tsx
```

Expected: PASS

**Step 3: 提交最小实现**

```bash
git add packages/opencode/webgui/src/components/SubtaskDrawer/SubtaskDrawer.tsx packages/opencode/webgui/src/components/SubtaskDrawer/SubtaskDrawer.test.tsx
git commit -m "feat(webgui): support left-edge resize for subtask drawer"
```

### Task 3: 边界与回归测试补齐（REFACTOR + HARDEN）

**Files:**

- Modify: `packages/opencode/webgui/src/components/SubtaskDrawer/SubtaskDrawer.test.tsx`
- Modify: `packages/opencode/webgui/src/components/SubtaskDrawer/SubtaskDrawer.tsx`

**Step 1: 补充边界测试（360px / 90vw）**

新增 2 个测试（可通过 mock `window.innerWidth`）：

```tsx
it("宽度不应小于 360px", () => {
  render(<SubtaskDrawer />)
  const handle = screen.getByTestId("subtask-drawer-resize-handle")
  const dialog = screen.getByRole("dialog", { name: "子任务" })

  fireEvent.pointerDown(handle, { button: 0, clientX: 900 })
  fireEvent.pointerMove(window, { clientX: 5000 })
  fireEvent.pointerUp(window)

  expect(parseFloat((dialog as HTMLElement).style.width)).toBe(360)
})

it("宽度不应超过 90vw", () => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1000 })
  render(<SubtaskDrawer />)
  const handle = screen.getByTestId("subtask-drawer-resize-handle")
  const dialog = screen.getByRole("dialog", { name: "子任务" })

  fireEvent.pointerDown(handle, { button: 0, clientX: 900 })
  fireEvent.pointerMove(window, { clientX: -2000 })
  fireEvent.pointerUp(window)

  expect(parseFloat((dialog as HTMLElement).style.width)).toBe(900)
})
```

**Step 2: 补充停止更新测试**

```tsx
it("pointerup 后不应继续更新宽度", () => {
  render(<SubtaskDrawer />)
  const handle = screen.getByTestId("subtask-drawer-resize-handle")
  const dialog = screen.getByRole("dialog", { name: "子任务" })

  fireEvent.pointerDown(handle, { button: 0, clientX: 900 })
  fireEvent.pointerMove(window, { clientX: 850 })
  fireEvent.pointerUp(window)
  const locked = parseFloat((dialog as HTMLElement).style.width)

  fireEvent.pointerMove(window, { clientX: 750 })
  expect(parseFloat((dialog as HTMLElement).style.width)).toBe(locked)
})
```

**Step 3: 全量运行相关测试**

Run (workdir=`packages/opencode/webgui`):

```bash
bun run test:run src/components/SubtaskDrawer/SubtaskDrawer.test.tsx src/components/SubtaskDrawer/SubtaskMessageList.test.tsx src/components/parts/ToolPart/index.test.tsx
```

Expected: PASS

**Step 4: 提交边界与回归完善**

```bash
git add packages/opencode/webgui/src/components/SubtaskDrawer/SubtaskDrawer.tsx packages/opencode/webgui/src/components/SubtaskDrawer/SubtaskDrawer.test.tsx
git commit -m "test(webgui): cover subtask drawer resize bounds and pointer lifecycle"
```

### Task 4: 最终验证与发布前检查

**Files:**

- Verify only (no required file modifications)

**Step 1: 构建 webgui**

Run (workdir=`packages/opencode/webgui`):

```bash
bun run build
```

Expected: build success

**Step 2: 手工验收清单**

1. 打开子任务抽屉默认宽度约 520px
2. 左边缘拖拽左移可变宽，右移可变窄
3. 不能小于 360px
4. 不能大于 90vw
5. 关闭后再打开恢复默认 520px
6. 点击 backdrop / Esc 关闭行为正常

**Step 3: 最终提交（如有必要）**

```bash
git status
```

确保工作区干净，准备进入合并流程。
