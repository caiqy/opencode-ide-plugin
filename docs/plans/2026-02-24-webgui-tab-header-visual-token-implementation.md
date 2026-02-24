# WebGUI CompactHeader Visual Tokenization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 `CompactHeader` 的未激活标签标题更亮、右侧连接状态区与标签区有稳定间距，并把这两条视觉规则沉淀为可复用 token。

**Architecture:** 在 `CompactHeader/utils.ts` 定义语义化视觉 token（文字色阶与右侧间距），由 `Tab.tsx` 与 `index.tsx` 消费，避免组件内硬编码。先用测试锁定目标样式（RED），再做最小实现（GREEN），最后回归相关交互测试。

**Tech Stack:** React, TypeScript, Vitest, Testing Library, Tailwind utility classes

---

### Task 1: 为视觉 token 行为写失败测试（RED）

**Files:**

- Modify: `packages/opencode/webgui/src/components/CompactHeader/Tab.test.tsx`
- Modify: `packages/opencode/webgui/src/components/CompactHeader/index.test.tsx`

**Step 1: 在 Tab 测试中新增“未激活标题提亮”失败用例**

在 `Tab.test.tsx` 新增：

```tsx
it("uses brighter inactive title colors in light and dark", () => {
  render(<Tab {...props({ isActive: false, title: "会话 A" })} />)

  const title = screen.getByText("会话 A")
  expect(title.className).toContain("text-gray-700")
  expect(title.className).toContain("dark:text-gray-300")
})

it("uses brighter default-title fallback colors", () => {
  render(<Tab {...props({ isActive: false, title: "新建会话 1" })} />)

  const title = screen.getByText("新建会话 1")
  expect(title.className).toContain("text-gray-500")
  expect(title.className).toContain("dark:text-gray-400")
})
```

**Step 2: 在 CompactHeader 测试中新增“右侧间距”失败用例**

先在 `index.tsx` 右侧容器约定 `data-testid="compact-header-right"`（此时测试先写，先让它失败）：

```tsx
it("adds left gap between tab area and right status/actions area", () => {
  render(
    <CompactHeader
      connectionState={"connected" as ConnectionState}
      onNewSession={vi.fn()}
      isCreatingSession={false}
      onOpenCommandPalette={vi.fn()}
    />,
  )

  const right = screen.getByTestId("compact-header-right")
  expect(right.className).toContain("ml-2")
})
```

**Step 3: 运行测试并确认失败**

Run:

```bash
bun run --cwd packages/opencode/webgui test:run -- src/components/CompactHeader/Tab.test.tsx src/components/CompactHeader/index.test.tsx
```

Expected: FAIL（缺少新色阶与右侧间距类）

**Step 4: 提交失败测试**

```bash
git add packages/opencode/webgui/src/components/CompactHeader/Tab.test.tsx packages/opencode/webgui/src/components/CompactHeader/index.test.tsx
git commit -m "test(webgui): lock compact header visual token expectations"
```

---

### Task 2: 实现 CompactHeader 视觉 token 并让测试转绿（GREEN）

**Files:**

- Modify: `packages/opencode/webgui/src/components/CompactHeader/utils.ts`
- Modify: `packages/opencode/webgui/src/components/CompactHeader/Tab.tsx`
- Modify: `packages/opencode/webgui/src/components/CompactHeader/index.tsx`

**Step 1: 在 utils 增加语义 token**

在 `utils.ts` 新增：

```ts
export const TAB_TEXT_INACTIVE = "text-gray-700 dark:text-gray-300"
export const TAB_TEXT_INACTIVE_DEFAULT = "text-gray-500 dark:text-gray-400"
export const HEADER_RIGHT_GAP = "ml-2"
```

**Step 2: Tab.tsx 使用 token 替换硬编码色阶**

更新 import：

```ts
import { TAB_TEXT_INACTIVE, TAB_TEXT_INACTIVE_DEFAULT, TAB_WIDTH_CLASS } from "./utils"
```

将未激活样式改为 token：

```tsx
isActive
  ? "border-b-2 border-b-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
  : `border-b-2 border-b-transparent bg-gray-100/50 dark:bg-gray-900/50 ${TAB_TEXT_INACTIVE} hover:bg-gray-200/50 dark:hover:bg-gray-800/50`
```

将默认标题色阶改为 token：

```tsx
className={`block overflow-hidden whitespace-nowrap text-xs ${hasDefaultTitle ? `italic ${TAB_TEXT_INACTIVE_DEFAULT}` : ""}`}
```

**Step 3: index.tsx 给右侧容器加 token + 测试锚点**

```tsx
<div className={`flex items-center gap-1 ${HEADER_RIGHT_GAP}`} data-testid="compact-header-right" ref={dropdown.dropdownRef}>
```

并在顶部 import `HEADER_RIGHT_GAP`。

**Step 4: 运行目标测试确认通过**

Run:

```bash
bun run --cwd packages/opencode/webgui test:run -- src/components/CompactHeader/Tab.test.tsx src/components/CompactHeader/index.test.tsx
```

Expected: PASS

**Step 5: 提交实现**

```bash
git add packages/opencode/webgui/src/components/CompactHeader/utils.ts packages/opencode/webgui/src/components/CompactHeader/Tab.tsx packages/opencode/webgui/src/components/CompactHeader/index.tsx packages/opencode/webgui/src/components/CompactHeader/Tab.test.tsx packages/opencode/webgui/src/components/CompactHeader/index.test.tsx
git commit -m "fix(webgui): brighten inactive tab text and add compact header spacing token"
```

---

### Task 3: 回归验证与收尾（REFACTOR/VERIFY）

**Files:**

- Verify: `packages/opencode/webgui/src/components/CompactHeader/TabBar.test.tsx`
- Verify: `packages/opencode/webgui/src/components/CompactHeader/index.integration.test.tsx`

**Step 1: 运行 CompactHeader 相关回归测试**

Run:

```bash
bun run --cwd packages/opencode/webgui test:run -- src/components/CompactHeader/TabBar.test.tsx src/components/CompactHeader/index.integration.test.tsx src/components/CompactHeader/Tab.test.tsx src/components/CompactHeader/index.test.tsx
```

Expected: PASS

**Step 2: 运行改动文件级 lint 校验**

Run:

```bash
bun x eslint src/components/CompactHeader/utils.ts src/components/CompactHeader/Tab.tsx src/components/CompactHeader/index.tsx src/components/CompactHeader/Tab.test.tsx src/components/CompactHeader/index.test.tsx
```

Expected: PASS（无新增 error）

**Step 3: 手动验收（light/dark）**

1. 未激活标签标题较之前提亮（中等强度）
2. 标签区与连接状态图标之间可见 8px 留白
3. 标签激活/关闭/重命名/拖拽重排行为无变化

**Step 4: 提交回归（若有）**

```bash
git add packages/opencode/webgui/src/components/CompactHeader
git commit -m "test(webgui): verify compact header visual token regression"
```

---

**Execution Notes**

- 开始执行前请加载：`@superpowers/test-driven-development`
- 执行阶段请使用：`@superpowers/executing-plans`
