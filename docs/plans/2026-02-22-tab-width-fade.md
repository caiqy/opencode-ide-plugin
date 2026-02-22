# CompactHeader Tab Width and Fade Title Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 CompactHeader 标签最大宽度提升到 180，并把超长标题从省略号改为右侧渐隐且不影响关闭按钮点击。

**Architecture:** 仅调整展示层样式与结构，不改动 tab 状态与会话切换逻辑。核心变更集中在 `Tab.tsx`（标题渲染 + fade 结构）与 `TabBar.tsx`（外层宽度约束对齐）。采用先测后改（TDD）保证视觉改动可回归。

**Tech Stack:** React 19, TypeScript, Tailwind className, Vitest + Testing Library, Bun.

---

### Task 1: 更新 Tab 组件测试（先红）

**Files:**

- Modify: `packages/opencode/webgui/src/components/CompactHeader/Tab.test.tsx:27-109`

**Step 1: Write the failing test**

在 `it("uses browser-like dynamic width constraints", ...)` 中把断言改为：

```ts
expect(tab.className).toContain("min-w-[100px]")
expect(tab.className).toContain("max-w-[180px]")
expect(tab.className).toContain("flex-[1_1_150px]")
```

新增一个标题溢出样式断言用例（可命名 `renders long title without ellipsis truncation class`）：

```ts
const p = props({ title: "这是一个非常非常非常长的标题用于测试渐隐行为" })
render(<Tab {...p} />)
const title = screen.getByText(p.title)
expect(title.className).toContain("overflow-hidden")
expect(title.className).toContain("whitespace-nowrap")
expect(title.className).not.toContain("truncate")
```

**Step 2: Run test to verify it fails**

Run: `bun run test:run src/components/CompactHeader/Tab.test.tsx`

Expected: FAIL（`max-w-[180px]` 或 `truncate` 相关断言失败）。

**Step 3: Commit**

```bash
git add packages/opencode/webgui/src/components/CompactHeader/Tab.test.tsx
git commit -m "test(webgui): define tab width 180 and fade title expectations"
```

---

### Task 2: 实现 Tab.tsx 的宽度与标题渐隐（转绿）

**Files:**

- Modify: `packages/opencode/webgui/src/components/CompactHeader/Tab.tsx:135-205`

**Step 1: Write minimal implementation**

1. 容器 class 调整：

```ts
"group h-full min-w-[100px] max-w-[180px] flex-[1_1_150px]"
```

2. 标题结构改为“文本 + 渐隐层”：

```tsx
<span className="relative min-w-0 flex-1">
  <span
    className={`block overflow-hidden whitespace-nowrap text-xs ${hasDefaultTitle ? "italic text-gray-400 dark:text-gray-500" : ""}`}
  >
    {displayTitle}
  </span>
  <span
    aria-hidden
    className="pointer-events-none absolute right-0 top-0 h-full w-6 bg-gradient-to-l from-white dark:from-gray-900 to-transparent"
  />
</span>
```

3. 保持关闭按钮：

```ts
className={`relative z-20 w-4 h-4 flex-shrink-0 transition-opacity ...`}
```

**Step 2: Run test to verify it passes**

Run: `bun run test:run src/components/CompactHeader/Tab.test.tsx`

Expected: PASS（全部通过）。

**Step 3: Run focused regression**

Run: `bun run test:run src/components/CompactHeader/index.integration.test.tsx`

Expected: PASS（会话切换与关闭按钮行为无回归）。

**Step 4: Commit**

```bash
git add packages/opencode/webgui/src/components/CompactHeader/Tab.tsx
git commit -m "fix(webgui): apply 180 max width and fade title overflow"
```

---

### Task 3: 同步 TabBar 外层宽度约束（防冲突）

**Files:**

- Modify: `packages/opencode/webgui/src/components/CompactHeader/TabBar.tsx:157-161`

**Step 1: Write minimal implementation**

将 wrapper class 从：

```ts
"h-full min-w-[100px] max-w-[150px] flex-[1_1_150px]"
```

改为：

```ts
"h-full min-w-[100px] max-w-[180px] flex-[1_1_150px]"
```

**Step 2: Run tests**

Run: `bun run test:run src/components/CompactHeader/TabBar.test.tsx src/components/CompactHeader/Tab.test.tsx`

Expected: PASS。

**Step 3: Commit**

```bash
git add packages/opencode/webgui/src/components/CompactHeader/TabBar.tsx
git commit -m "fix(webgui): align tab wrapper max width to 180"
```

---

### Task 4: 全量验证与打包前检查

**Files:**

- No code changes expected

**Step 1: Run full CompactHeader related tests**

Run: `bun run test:run src/components/CompactHeader/*.test.tsx src/components/CompactHeader/*.integration.test.tsx`

Expected: PASS。

**Step 2: Run webgui build**

Run: `bun run build`

Expected: build 成功，生成 `webgui-dist` 产物。

**Step 3: Manual checklist**

- 长标题无 `...`
- 右侧有渐隐视觉提示
- active tab 的关闭按钮可见可点
- 多标签下单个 tab 最大宽度可达 180

**Step 4: Commit verification note (if needed)**

```bash
git add -A
git commit -m "test(webgui): verify tab width 180 and fade title behavior"
```

(仅在存在新的验证脚本或快照变更时提交)
