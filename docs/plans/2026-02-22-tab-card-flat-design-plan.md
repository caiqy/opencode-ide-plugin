# Tab Card Flat Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restore pure flat design, remove rounded corners/borders, enhance active tab brightness, and restore the blue bottom border.

**Architecture:** Use TDD. Update `Tab.test.tsx` to assert new background and border utility classes. Implement minimal changes to `Tab.tsx` to satisfy the tests while preserving the exact layout constraints.

**Tech Stack:** React, TypeScript, Tailwind utility classes, Vitest, Testing Library, Bun, Git.

---

### Task 1: Update Tests for Flat Design (RED)

**Files:**

- Modify: `packages/opencode/webgui/src/components/CompactHeader/Tab.test.tsx`

**Step 1: Write the failing test**

Modify `Tab.test.tsx` to ensure we cover the flat design requirements:

1. Update the existing test or add a new one to assert active tab styles:

```typescript
it("applies flat bright background and blue bottom border when active", () => {
  render(<Tab {...props({ isActive: true })} />)

  const tab = screen.getByTitle("新建会话 1")
  expect(tab.className).toContain("bg-white")
  expect(tab.className).toContain("border-b-blue-500")
  expect(tab.className).not.toContain("rounded")
  expect(tab.className).not.toContain("border-x")
  expect(tab.className).not.toContain("border-t")
})
```

2. Assert inactive tab background:

```typescript
it("applies light background and transparent bottom border when inactive", () => {
  render(<Tab {...props({ isActive: false })} />)

  const tab = screen.getByTitle("新建会话 1")
  expect(tab.className).toContain("bg-gray-100/50")
  expect(tab.className).toContain("border-b-transparent")
  expect(tab.className).not.toContain("rounded")
  expect(tab.className).not.toContain("border-x")
  expect(tab.className).not.toContain("border-t")
})
```

3. Update the fade background test:

```typescript
  it("renders long title without ellipsis truncation class", () => {
    const p = props({ title: "这是一个非常非常非常长的标题用于测试渐隐行为" })
    const { container } = render(<Tab {...p} />)

    const fade = container.querySelector("span[aria-hidden='true']")
    expect(fade?.className).toContain("pointer-events-none")
    // Should match the new inactive fade class
    expect(fade?.className).toContain("from-gray-100/50")
  })
```

**Step 2: Run test to verify it fails**

Run:

```bash
bun run test:run src/components/CompactHeader/Tab.test.tsx
```

Expected: FAIL (because current implementation has `rounded-t-md`, `border-x`, `border-t`, and different `bg` and `fade` utilities).

**Step 3: Write minimal implementation**

(Do nothing in this task, keep it red).

**Step 4: Run test to verify it passes**

(Skip for this task).

**Step 5: Commit**

```bash
git add packages/opencode/webgui/src/components/CompactHeader/Tab.test.tsx
git commit -m "test(webgui): assert flat tab design with blue bottom border"
```

---

### Task 2: Implement Flat Design (GREEN)

**Files:**

- Modify: `packages/opencode/webgui/src/components/CompactHeader/Tab.tsx`

**Step 1: Write the failing test**

(Re-use tests from Task 1).

**Step 2: Run test to verify it fails**

Run:

```bash
bun run test:run src/components/CompactHeader/Tab.test.tsx
```

Expected: FAIL.

**Step 3: Write minimal implementation**

Modify `Tab.tsx`:

1. Update `classes` array:
   - Remove `rounded-t-md`
   - Active state: `"border-b-2 border-b-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"`
   - Inactive state: `"border-b-2 border-b-transparent bg-gray-100/50 dark:bg-gray-900/50 text-gray-600 dark:text-gray-400 hover:bg-gray-200/50 dark:hover:bg-gray-800/50"`

2. Update `fade` span classes:
   - Active state: `"from-white dark:from-gray-800"`
   - Inactive state: `"from-gray-100/50 dark:from-gray-900/50 group-hover:from-gray-200/50 dark:group-hover:from-gray-800/50"`

**Step 4: Run test to verify it passes**

Run:

```bash
bun run test:run src/components/CompactHeader/Tab.test.tsx src/components/CompactHeader/TabBar.test.tsx src/components/CompactHeader/index.integration.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/opencode/webgui/src/components/CompactHeader/Tab.tsx
git commit -m "fix(webgui): implement flat tab design and restore blue bottom border"
```

---

### Task 3: Regression & Build

**Files:**

- None needed (unless tests fail).

**Step 1-3:** (Skip)

**Step 4: Run test to verify it passes**

Run:

```bash
bun run build:webgui
```

Expected: Vite build succeeds without errors.

**Step 5: Commit**
(No commit needed for just building, unless minor fixes are required).
