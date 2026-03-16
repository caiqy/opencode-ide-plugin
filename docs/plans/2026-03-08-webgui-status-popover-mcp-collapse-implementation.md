# WebGUI StatusPopover MCP 面板高度与工具折叠 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 StatusPopover 增加 60vh 最大高度与内容滚动，并让 MCP 工具列表支持默认收起的展开/收起交互。

**Architecture:** 在 `StatusPopover.tsx` 采用“头部固定 + 内容区滚动”的布局，新增 MCP server 级折叠状态映射以控制工具列表显示。测试先行：先写失败用例覆盖高度/滚动/折叠，再做最小实现直至通过。

**Tech Stack:** React, TypeScript, Tailwind utility classes, Vitest, Testing Library

---

### Task 1: 为面板增加 60vh 限高与内容区滚动

**Files:**

- Modify: `packages/opencode/webgui/src/components/CompactHeader/StatusPopover.tsx`
- Test: `packages/opencode/webgui/src/components/CompactHeader/StatusPopover.test.tsx`

**Step 1: Write the failing test**

在 `StatusPopover.test.tsx` 新增断言：

```tsx
it("面板限制最大高度并提供内容区滚动", () => {
  render(<StatusPopover open={true} connectionState="connected" onClose={vi.fn()} />)

  const dlg = screen.getByRole("dialog", { name: "状态面板" })
  expect(dlg).toHaveClass("max-h-[60vh]")
  const box = dlg.querySelector("[data-testid='status-scroll']")
  expect(box).toHaveClass("overflow-y-auto")
})
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/opencode/webgui/src/components/CompactHeader/StatusPopover.test.tsx`
Expected: FAIL（缺少 `max-h-[60vh]` 或 `status-scroll` 内容区）

**Step 3: Write minimal implementation**

在 `StatusPopover.tsx`：

```tsx
className = "modern-card absolute right-2 top-full z-50 mt-2 flex max-h-[60vh] w-[360px] flex-col"
```

并将 tab 区下方内容包裹为：

```tsx
<div data-testid="status-scroll" className="min-h-0 overflow-y-auto">
  {/* panels */}
</div>
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/opencode/webgui/src/components/CompactHeader/StatusPopover.test.tsx`
Expected: PASS（新增高度与滚动断言通过）

**Step 5: Commit**

```bash
git add packages/opencode/webgui/src/components/CompactHeader/StatusPopover.tsx packages/opencode/webgui/src/components/CompactHeader/StatusPopover.test.tsx
git commit -m "feat(webgui): constrain status popover height and add scroll area"
```

### Task 2: MCP 工具列表默认收起并支持展开/收起

**Files:**

- Modify: `packages/opencode/webgui/src/components/CompactHeader/StatusPopover.tsx`
- Test: `packages/opencode/webgui/src/components/CompactHeader/StatusPopover.test.tsx`

**Step 1: Write the failing test**

在 MCP 场景新增用例，验证默认收起 + 点击展开 + 再次收起：

```tsx
it("MCP 工具列表默认收起并可展开收起", async () => {
  const user = userEvent.setup()
  render(<StatusPopover open={true} connectionState="connected" onClose={vi.fn()} />)

  await user.click(screen.getByRole("tab", { name: "MCP" }))
  const btn = screen.getByRole("button", { name: "展开工具 alpha" })
  expect(btn).toHaveAttribute("aria-expanded", "false")
  expect(screen.queryByRole("switch", { name: "切换 alpha.read" })).not.toBeInTheDocument()

  await user.click(btn)
  expect(btn).toHaveAttribute("aria-expanded", "true")
  expect(screen.getByRole("switch", { name: "切换 alpha.read" })).toBeInTheDocument()

  await user.click(screen.getByRole("button", { name: "收起工具 alpha" }))
  expect(screen.queryByRole("switch", { name: "切换 alpha.read" })).not.toBeInTheDocument()
})
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/opencode/webgui/src/components/CompactHeader/StatusPopover.test.tsx`
Expected: FAIL（当前工具列表默认直接展示，无折叠按钮）

**Step 3: Write minimal implementation**

在 `StatusPopover.tsx` 增加 server 折叠状态：

```tsx
const [openMap, setOpenMap] = useState<Record<string, boolean>>({})
```

打开弹层时重置：

```tsx
useEffect(() => {
  if (!open) return
  setOpenMap({})
}, [open])
```

在 MCP server 行中加入折叠按钮（仅 `item.tools.length > 0` 显示），并按 `openMap[item.name]` 控制工具列表渲染。

**Step 4: Run test to verify it passes**

Run: `bun test packages/opencode/webgui/src/components/CompactHeader/StatusPopover.test.tsx`
Expected: PASS（默认收起、展开/收起切换与 aria 状态都通过）

**Step 5: Commit**

```bash
git add packages/opencode/webgui/src/components/CompactHeader/StatusPopover.tsx packages/opencode/webgui/src/components/CompactHeader/StatusPopover.test.tsx
git commit -m "feat(webgui): add collapsible mcp tool list in status popover"
```

### Task 3: 回归验证与边界确认

**Files:**

- Test: `packages/opencode/webgui/src/components/CompactHeader/StatusPopover.test.tsx`
- Test: `packages/opencode/webgui/src/components/CompactHeader/useStatusPopoverData.test.tsx`

**Step 1: Run focused popover tests**

Run: `bun test packages/opencode/webgui/src/components/CompactHeader/StatusPopover.test.tsx`
Expected: PASS

**Step 2: Run hook regression tests**

Run: `bun test packages/opencode/webgui/src/components/CompactHeader/useStatusPopoverData.test.tsx`
Expected: PASS（开关与 busy/refresh 逻辑无回归）

**Step 3: Run package-level webgui test suite (if needed)**

Run: `bun test packages/opencode/webgui`
Expected: PASS 或仅已知无关失败

**Step 4: Verify no unintended file changes**

Run: `git status --short`
Expected: 仅出现本次目标文件变更

**Step 5: Commit**

```bash
git add packages/opencode/webgui/src/components/CompactHeader/StatusPopover.tsx packages/opencode/webgui/src/components/CompactHeader/StatusPopover.test.tsx
git commit -m "test(webgui): cover status popover scroll and mcp collapse interactions"
```
