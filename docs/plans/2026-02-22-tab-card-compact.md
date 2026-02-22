# CompactHeader Tab Card Compact Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让未激活标签关闭按钮默认可见，并在零间距前提下增强卡片边界感，同时将最小宽度下调到 72 保持更紧凑。

**Architecture:** 采用 TDD：先在 `Tab.test.tsx` 与 `TabBar.test.tsx` 写失败断言，锁定新的视觉契约，再做 `Tab.tsx`/`TabBar.tsx` 最小实现。宽度策略仍保持弹性分配（`flex-[1_1_150px]`），只下调 `min`，并保证 Tab 与 wrapper 双层约束同步，避免一层改了另一层没改导致实际不生效。

**Tech Stack:** React, TypeScript, Tailwind utility classes, Vitest, Testing Library, Bun, Git.

---

### Task 1: 先红 - 更新标签宽度与关闭按钮可见性测试

**Files:**

- Modify: `packages/opencode/webgui/src/components/CompactHeader/Tab.test.tsx`
- Modify: `packages/opencode/webgui/src/components/CompactHeader/TabBar.test.tsx`

**Step 1: Write the failing test**

在 `Tab.test.tsx`：

1. 更新宽度断言（72/180/150）：

```ts
expect(tab.className).toContain("min-w-[72px]")
expect(tab.className).toContain("max-w-[180px]")
expect(tab.className).toContain("flex-[1_1_150px]")
```

2. 新增“未激活关闭按钮默认可见”断言（基于 `isActive: false`）：

```ts
const close = screen.getByRole("button", { name: "关闭标签" })
expect(close.className).toContain("opacity-60")
```

在 `TabBar.test.tsx` 更新 wrapper 宽度断言：

```ts
expect(wrapper?.className).toContain("min-w-[72px]")
expect(wrapper?.className).toContain("max-w-[180px]")
expect(wrapper?.className).toContain("flex-[1_1_150px]")
```

**Step 2: Run test to verify it fails**

Run:

```bash
bun run test:run src/components/CompactHeader/Tab.test.tsx src/components/CompactHeader/TabBar.test.tsx
```

Expected: FAIL（当前实现仍是 `min-w-[100px]` 且未激活关闭按钮为 `opacity-0`）。

**Step 3: Write minimal implementation**

（本任务不改实现，保持红态，进入 Task 2）

**Step 4: Run test to verify it passes**

（本任务不执行，Task 2 完成后执行）

**Step 5: Commit**

```bash
git add packages/opencode/webgui/src/components/CompactHeader/Tab.test.tsx packages/opencode/webgui/src/components/CompactHeader/TabBar.test.tsx
git commit -m "test(webgui): define compact tab width and always-visible close button"
```

---

### Task 2: 转绿 - 实现宽度下调、关闭按钮常显、零间距卡片边界

**Files:**

- Modify: `packages/opencode/webgui/src/components/CompactHeader/Tab.tsx`
- Modify: `packages/opencode/webgui/src/components/CompactHeader/TabBar.tsx`

**Step 1: Write the failing test**

复用 Task 1 的失败测试（不新增）。

**Step 2: Run test to verify it fails**

Run:

```bash
bun run test:run src/components/CompactHeader/Tab.test.tsx src/components/CompactHeader/TabBar.test.tsx
```

Expected: FAIL（确认红态仍存在）。

**Step 3: Write minimal implementation**

1. 在 `Tab.tsx`：

- 容器宽度类改为：

```ts
"group h-full min-w-[72px] max-w-[180px] flex-[1_1_150px]"
```

- 关闭按钮未激活态从 `opacity-0 group-hover:opacity-100` 改为默认常显（如 `opacity-60 hover:opacity-100`），激活态保持 `opacity-100`。
- 保持 `relative z-20`。
- 在不加间距前提下，为未激活标签增加轻卡片边界感（轻边框/轻底色/顶部圆角），激活态保持更清晰层级。

2. 在 `TabBar.tsx`：

- wrapper 宽度类同步改为：

```ts
"h-full min-w-[72px] max-w-[180px] flex-[1_1_150px]"
```

- 保持标签区零间距（不新增 `gap-*`）。

3. 标题策略不回退：

- 保持无省略号（无 `truncate`）
- 保持 fade 层 `pointer-events-none`

**Step 4: Run test to verify it passes**

Run:

```bash
bun run test:run src/components/CompactHeader/Tab.test.tsx src/components/CompactHeader/TabBar.test.tsx src/components/CompactHeader/index.integration.test.tsx
```

Expected: PASS。

**Step 5: Commit**

```bash
git add packages/opencode/webgui/src/components/CompactHeader/Tab.tsx packages/opencode/webgui/src/components/CompactHeader/TabBar.tsx
git commit -m "fix(webgui): compact tabs with visible close buttons and card boundaries"
```

---

### Task 3: 回归验证与构建

**Files:**

- Modify (if needed): `packages/opencode/webgui/src/components/CompactHeader/Tab.tsx`
- Modify (if needed): `packages/opencode/webgui/src/components/CompactHeader/TabBar.tsx`
- Modify (if needed): `packages/opencode/webgui/src/components/CompactHeader/Tab.test.tsx`
- Modify (if needed): `packages/opencode/webgui/src/components/CompactHeader/TabBar.test.tsx`

**Step 1: Write the failing test**

新增或补强一个回归断言（若当前缺失）：

- 断言未激活标签按钮类包含 `z-20` 且不是 `opacity-0`
- 断言 fade 仍为 `pointer-events-none`

**Step 2: Run test to verify it fails**

Run:

```bash
bun run test:run src/components/CompactHeader/Tab.test.tsx
```

Expected: 若新增断言应先 FAIL；若无需新增则跳至 Step 3。

**Step 3: Write minimal implementation**

仅修复断言对应最小差异，不做额外样式重构。

**Step 4: Run test to verify it passes**

Run:

```bash
bun run test:run src/components/CompactHeader/Tab.test.tsx src/components/CompactHeader/TabBar.test.tsx src/components/CompactHeader/index.integration.test.tsx
bun run build
```

Expected: 全部 PASS，`packages/opencode/webgui` 构建成功。

**Step 5: Commit**

```bash
git add packages/opencode/webgui/src/components/CompactHeader/Tab.tsx packages/opencode/webgui/src/components/CompactHeader/TabBar.tsx packages/opencode/webgui/src/components/CompactHeader/Tab.test.tsx packages/opencode/webgui/src/components/CompactHeader/TabBar.test.tsx
git commit -m "test(webgui): cover compact tab visual regressions"
```
