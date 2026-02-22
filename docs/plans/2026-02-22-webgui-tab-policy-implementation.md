# WebGUI Tab Policy Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 webgui 会话标签实现统一策略：宽度 100/150、virtual 新建唯一、最多 6 标签、打开/加载后自动滚动到激活标签。

**Architecture:** 新增纯函数 `tabPolicy` 承载规则，`tabStore` 仅做状态与持久化，`CompactHeader/TabBar/Tab` 只做编排与展示。通过 policy 单测 + store 单测 + 组件单测确保行为不回归。

**Tech Stack:** React, TypeScript, Vitest, Testing Library, existing webgui tab store (`sdk.kv` persistence)

---

### Task 1: 新建 tabPolicy 纯函数与测试骨架

**Files:**
- Create: `packages/opencode/webgui/src/state/tabPolicy.ts`
- Create: `packages/opencode/webgui/src/state/tabPolicy.test.ts`
- Reference: `packages/opencode/webgui/src/state/tabStore.ts`

**Step 1: Write failing tests for core policy behavior**

在 `tabPolicy.test.ts` 先写失败用例（不实现代码）：

```ts
import { describe, expect, it } from "vitest"
import { openWithPolicy, openVirtualUnique, type TabState } from "./tabPolicy"

describe("tabPolicy", () => {
  it("open existing tab activates without reordering", () => {
    const state: TabState = { openTabs: ["s1", "s2"], activeTab: "s2" }
    const next = openWithPolicy(state, "s1")
    expect(next.openTabs).toEqual(["s1", "s2"])
    expect(next.activeTab).toBe("s1")
  })

  it("open new tab over limit evicts oldest non-active", () => {
    const state: TabState = { openTabs: ["s1", "s2", "s3", "s4", "s5", "s6"], activeTab: "s6" }
    const next = openWithPolicy(state, "s7")
    expect(next.openTabs).toEqual(["s2", "s3", "s4", "s5", "s6", "s7"])
    expect(next.activeTab).toBe("s7")
  })

  it("openVirtualUnique reuses existing virtual tab", () => {
    const state: TabState = { openTabs: ["s1", "virtual-1"], activeTab: "s1" }
    const next = openVirtualUnique(state, "virtual-2")
    expect(next.openTabs).toEqual(["s1", "virtual-1"])
    expect(next.activeTab).toBe("virtual-1")
  })
})
```

**Step 2: Run tests to verify they fail**

Run:

```bash
bun run --cwd packages/opencode/webgui test:run -- src/state/tabPolicy.test.ts
```

Expected: FAIL（`tabPolicy.ts` 尚未存在或导出不完整）

**Step 3: Implement minimal policy**

在 `tabPolicy.ts` 实现：

- `export type TabState = { openTabs: string[]; activeTab: string }`
- `const MAX_OPEN_TABS = 6`
- `openWithPolicy(state, incomingId)`
- `openVirtualUnique(state, incomingVirtualId)`
- `isVirtualTab(id)`（`id.startsWith("virtual-")`）
- 仅纯函数，不依赖 SDK/React

**Step 4: Run policy tests**

Run:

```bash
bun run --cwd packages/opencode/webgui test:run -- src/state/tabPolicy.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/opencode/webgui/src/state/tabPolicy.ts packages/opencode/webgui/src/state/tabPolicy.test.ts
git commit -m "feat(webgui): add tab policy for cap and virtual uniqueness"
```

---

### Task 2: 将 tabStore.openTab 接入策略层

**Files:**
- Modify: `packages/opencode/webgui/src/state/tabStore.ts`
- Modify: `packages/opencode/webgui/src/state/tabStore.test.ts`
- Reference: `packages/opencode/webgui/src/state/tabPolicy.ts`

**Step 1: Add failing store tests for new behavior**

在 `tabStore.test.ts` 新增失败用例：

- `openTab` 超过 6 时保持 6 个并淘汰最旧非活动
- `openTab("virtual-x")` 在已有 virtual 时复用旧 virtual，不新增第二个

**Step 2: Run targeted store tests to see failures**

Run:

```bash
bun run --cwd packages/opencode/webgui test:run -- src/state/tabStore.test.ts -t "openTab"
```

Expected: 新增用例 FAIL

**Step 3: Implement minimal integration in store**

在 `tabStore.ts`：

- 引入 `openWithPolicy`、`openVirtualUnique`
- `openTab(sessionId)` 内部判断：
  - `sessionId.startsWith("virtual-")` -> `openVirtualUnique`
  - 否则 -> `openWithPolicy`
- 其余 API（`closeTab/reorder/replace...`）保持现状

**Step 4: Run full store tests**

Run:

```bash
bun run --cwd packages/opencode/webgui test:run -- src/state/tabStore.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/opencode/webgui/src/state/tabStore.ts packages/opencode/webgui/src/state/tabStore.test.ts
git commit -m "feat(webgui): enforce tab policy in tab store"
```

---

### Task 3: 调整 Tab 视觉宽度为 100/150

**Files:**
- Modify: `packages/opencode/webgui/src/components/CompactHeader/Tab.tsx`
- Modify: `packages/opencode/webgui/src/components/CompactHeader/Tab.test.tsx`

**Step 1: Add failing class expectation test**

在 `Tab.test.tsx` 断言类名包含：

- `min-w-[100px]`
- `max-w-[150px]`

**Step 2: Run single component test (expect fail first)**

Run:

```bash
bun run --cwd packages/opencode/webgui test:run -- src/components/CompactHeader/Tab.test.tsx
```

Expected: FAIL（当前仍是旧类名）

**Step 3: Update Tab class names minimally**

`Tab.tsx` 中将旧宽度类替换为新值，保留其他交互类。

**Step 4: Re-run test**

Run:

```bash
bun run --cwd packages/opencode/webgui test:run -- src/components/CompactHeader/Tab.test.tsx
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/opencode/webgui/src/components/CompactHeader/Tab.tsx packages/opencode/webgui/src/components/CompactHeader/Tab.test.tsx
git commit -m "style(webgui): update tab width constraints to 100/150"
```

---

### Task 4: TabBar 激活标签自动滚动

**Files:**
- Modify: `packages/opencode/webgui/src/components/CompactHeader/TabBar.tsx`
- Modify: `packages/opencode/webgui/src/components/CompactHeader/TabBar.test.tsx`

**Step 1: Add failing scroll behavior test**

在 `TabBar.test.tsx`：

- mock `Element.prototype.scrollIntoView`
- 渲染后切换 `activeTab`
- 断言 active tab 触发滚动

**Step 2: Run targeted TabBar tests (expect fail)**

Run:

```bash
bun run --cwd packages/opencode/webgui test:run -- src/components/CompactHeader/TabBar.test.tsx
```

Expected: 新增滚动用例 FAIL

**Step 3: Implement minimal scroll-to-active logic**

`TabBar.tsx`：

- 维护 `Map<string, HTMLElement>` refs
- `useEffect` 监听 `activeTab`
- 调用 `node.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" })`

**Step 4: Re-run TabBar tests**

Run:

```bash
bun run --cwd packages/opencode/webgui test:run -- src/components/CompactHeader/TabBar.test.tsx
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/opencode/webgui/src/components/CompactHeader/TabBar.tsx packages/opencode/webgui/src/components/CompactHeader/TabBar.test.tsx
git commit -m "feat(webgui): auto-scroll to active tab in tab bar"
```

---

### Task 5: 回归验证与文档同步

**Files:**
- Verify: `packages/opencode/webgui/src/components/CompactHeader/index.tsx`
- Verify: `docs/plans/2026-02-22-webgui-tab-policy-design.md`

**Step 1: Run focused webgui test suite**

Run:

```bash
bun run --cwd packages/opencode/webgui test:run -- src/state/tabStore.test.ts src/state/tabPolicy.test.ts src/components/CompactHeader/Tab.test.tsx src/components/CompactHeader/TabBar.test.tsx
```

Expected: PASS

**Step 2: Run webgui lint**

Run:

```bash
bun run --cwd packages/opencode/webgui lint
```

Expected: PASS

**Step 3: Spot-check integration tests related to header/tabs**

Run:

```bash
bun run --cwd packages/opencode/webgui test:run -- src/components/CompactHeader/index.test.tsx src/components/CompactHeader/index.integration.test.tsx
```

Expected: PASS

**Step 4: Final verification checklist**

- 第 7 个标签打开时维持 6 个
- virtual 仅一个
- 新打开/加载标签自动滚动到可见
- tab 宽度为 100/150

**Step 5: Commit**

```bash
git add packages/opencode/webgui/src
git commit -m "test(webgui): verify tab policy constraints and auto-scroll"
```
