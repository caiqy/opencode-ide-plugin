# WebGUI 真实会话化与单草稿复用 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 移除 `virtual-*` 主流程；新建会话始终创建真实会话；引入 `draftSessionId` 做“单草稿复用”；创建失败不扰动当前上下文。

**Architecture:** 以 `SessionContext + App + tabStore/uiBridgeState` 为主干重构。`SessionContext` 不再暴露 virtual 语义；`App` 负责“新建/冷启动”的草稿复用与创建编排；`MessageInput` 在首条消息成功后清空草稿标记；`tabStore/tabPolicy` 与 `CompactHeader` 删除 virtual 分支。

**Tech Stack:** React 19, TypeScript, Vitest, @testing-library/react, webview `uiBridgeState`。

---

## 执行约束

- 先测后改，严格按 `@superpowers:test-driven-development`。
- 每个任务完成后跑对应测试，再小步提交。
- 最终完成前执行 `@superpowers:verification-before-completion`。
- 测试命令都在 `packages/opencode/webgui` 目录执行（禁止在仓库根目录跑测试）。

---

### Task 1: 为 uiBridgeState 增加 `draftSessionId` 持久化能力

**Files:**

- Modify: `packages/opencode/webgui/src/state/uiBridgeState.ts`
- Modify: `packages/opencode/webgui/src/state/uiBridgeState.test.ts`

**Step 1: 写失败测试（先定义新字段行为）**

在 `uiBridgeState.test.ts` 增加用例：

```ts
it("hydrates and updates draftSessionId", () => {
  uiBridgeStateModule.uiBridgeHydrate({ draftSessionId: "s-draft" })
  expect(uiBridgeStateModule.uiBridgeState().draftSessionId).toBe("s-draft")

  uiBridgeStateModule.uiBridgeUpdateDraftSessionId("s-next")
  expect(uiBridgeStateModule.uiBridgeState().draftSessionId).toBe("s-next")

  uiBridgeStateModule.uiBridgeUpdateDraftSessionId(null)
  expect(uiBridgeStateModule.uiBridgeState().draftSessionId).toBeNull()
})
```

**Step 2: 运行测试，确认失败**

Run: `bun run test:run -- src/state/uiBridgeState.test.ts`

Expected: FAIL（`draftSessionId` 字段或 `uiBridgeUpdateDraftSessionId` 方法不存在）

**Step 3: 写最小实现**

在 `uiBridgeState.ts`：

- `UiBridgeState` 增加 `draftSessionId: string | null`
- `empty` 初始化为 `null`
- `uiBridgeHydrate` / `uiBridgeUpdate` 支持该字段
- 导出：

```ts
export function uiBridgeDraftSessionId() {
  return store.state.draftSessionId
}

export function uiBridgeUpdateDraftSessionId(id: string | null) {
  return uiBridgeUpdate({ draftSessionId: id })
}
```

**Step 4: 运行测试，确认通过**

Run: `bun run test:run -- src/state/uiBridgeState.test.ts`

Expected: PASS

**Step 5: 提交**

```bash
git add packages/opencode/webgui/src/state/uiBridgeState.ts packages/opencode/webgui/src/state/uiBridgeState.test.ts
git commit -m "feat(webgui): persist draftSessionId in bridge state"
```

---

### Task 2: SessionContext 移除 virtual API，保留真实会话语义

**Files:**

- Modify: `packages/opencode/webgui/src/state/SessionContext.tsx`
- Modify: `packages/opencode/webgui/src/state/SessionContext.test.tsx`

**Step 1: 写失败测试（约束对外 API）**

在 `SessionContext.test.tsx` 增加断言：

```ts
it("does not expose virtual-session APIs", async () => {
  const { result } = renderHook(() => useSession(), { wrapper })
  await waitFor(() => expect(result.current).toBeTruthy())
  expect("newVirtual" in (result.current as any)).toBe(false)
  expect("materializeSession" in (result.current as any)).toBe(false)
  expect("isVirtualSession" in (result.current as any)).toBe(false)
})
```

**Step 2: 运行测试，确认失败**

Run: `bun run test:run -- src/state/SessionContext.test.tsx`

Expected: FAIL（当前 context 仍暴露 virtual 字段）

**Step 3: 写最小实现**

在 `SessionContext.tsx`：

- 删除 `createVirtualSession/newVirtual/materializeSession/isVirtualSession`
- `currentSession` 初始改为 `null`
- 删除所有 `setIsVirtualSession(...)`
- 删除依赖 virtual 的分支（如 diff load 的 virtual 判断）
- 保留 `createSession/switchSession` 真实语义

**Step 4: 运行测试，确认通过**

Run: `bun run test:run -- src/state/SessionContext.test.tsx`

Expected: PASS

**Step 5: 提交**

```bash
git add packages/opencode/webgui/src/state/SessionContext.tsx packages/opencode/webgui/src/state/SessionContext.test.tsx
git commit -m "refactor(webgui): remove virtual session APIs from SessionContext"
```

---

### Task 3: App 新建/冷启动流程接入“单草稿复用”

**Files:**

- Modify: `packages/opencode/webgui/src/App.tsx`
- Modify: `packages/opencode/webgui/src/components/CompactHeader/index.integration.test.tsx`

**Step 1: 写失败测试（新建优先复用草稿）**

在 `index.integration.test.tsx` 增加行为测试（通过 mocked callbacks 断言）：

```ts
it("calls onNewSession and reuses draft-first flow", async () => {
  // 触发 New Session 按钮点击
  // 断言：onNewSession 被调用；切换逻辑不依赖 virtual id
})
```

**Step 2: 运行测试，确认失败**

Run: `bun run test:run -- src/components/CompactHeader/index.integration.test.tsx`

Expected: FAIL（当前 App 仍是 `newVirtual()` 路径）

**Step 3: 写最小实现**

在 `App.tsx`：

- 删除 `newVirtual` 依赖
- 新增异步 `handleNewSession`：
  1. 读取 `uiBridgeDraftSessionId()`
  2. 校验草稿有效（`sdk.session.get` + `sdk.session.messages` 为空）
  3. 有效则 `switchSession + tabStore.openTab`
  4. 否则 `createSession`，成功后 `uiBridgeUpdateDraftSessionId(newId)`
  5. 失败时 `showToast("创建会话失败", { variant: "error" })`
- 增加 in-flight guard，避免连点重复创建

**Step 4: 运行测试，确认通过**

Run: `bun run test:run -- src/components/CompactHeader/index.integration.test.tsx`

Expected: PASS

**Step 5: 提交**

```bash
git add packages/opencode/webgui/src/App.tsx packages/opencode/webgui/src/components/CompactHeader/index.integration.test.tsx
git commit -m "feat(webgui): add draft-first real session creation flow"
```

---

### Task 4: CompactHeader 删除 virtual 分支，统一真实会话恢复

**Files:**

- Modify: `packages/opencode/webgui/src/components/CompactHeader/index.tsx`
- Modify: `packages/opencode/webgui/src/components/CompactHeader/index.test.tsx`

**Step 1: 写失败测试（不再依赖 virtual guard）**

新增/改写用例：

```ts
it("restores active tab by real session id only", async () => {
  // openTabs 非空时直接按 activeTab 切换
  // 不出现 virtual-* 相关分支断言
})
```

**Step 2: 运行测试，确认失败**

Run: `bun run test:run -- src/components/CompactHeader/index.test.tsx`

Expected: FAIL（现有实现仍含 virtual 分支）

**Step 3: 写最小实现**

在 `index.tsx`：

- 删除 `startsWith("virtual-")` 相关分支
- tab 恢复逻辑：`loaded + openTabs>0` 时基于 `activeTab` 恢复
- 无 tab 时调用 `onNewSession`
- close-other/close-right 路径只处理真实 id

**Step 4: 运行测试，确认通过**

Run: `bun run test:run -- src/components/CompactHeader/index.test.tsx`

Expected: PASS

**Step 5: 提交**

```bash
git add packages/opencode/webgui/src/components/CompactHeader/index.tsx packages/opencode/webgui/src/components/CompactHeader/index.test.tsx
git commit -m "refactor(webgui): simplify tab restore without virtual branches"
```

---

### Task 5: MessageInput 与 MessagesContext 去 virtual 化，并在首条消息后清草稿标记

**Files:**

- Modify: `packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.ts`
- Modify: `packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.test.tsx`
- Modify: `packages/opencode/webgui/src/components/MessageInput/index.tsx`
- Modify: `packages/opencode/webgui/src/state/MessagesContext.tsx`

**Step 1: 写失败测试（发送成功后清空草稿标记）**

在 `useMessageInput.test.tsx` 添加：

```ts
it("clears draftSessionId after first successful send", async () => {
  // sessionID = s-draft
  // prompt/command 成功后断言 uiBridgeUpdateDraftSessionId(null) 被调用
})
```

**Step 2: 运行测试，确认失败**

Run: `bun run test:run -- src/components/MessageInput/hooks/useMessageInput.test.tsx`

Expected: FAIL（当前是 materialize + moveDraft 逻辑）

**Step 3: 写最小实现**

在 `useMessageInput.ts`：

- 删除 `isVirtualSession/materializeSession/uiBridgeMoveDraft` 依赖
- 始终使用传入 `sessionID` 发送
- 发送成功后：若 `uiBridgeDraftSessionId() === sessionID`，执行 `uiBridgeUpdateDraftSessionId(null)`

在 `MessagesContext.tsx`：

- 删除 `loadSessionMessages` 的 virtual 早退分支

在 `MessageInput/index.tsx`：

- `isCompactDisabled` 删除 `sessionID.startsWith("virtual-")` 条件

**Step 4: 运行测试，确认通过**

Run: `bun run test:run -- src/components/MessageInput/hooks/useMessageInput.test.tsx src/state/MessagesContext.selection-restore.test.tsx`

Expected: PASS

**Step 5: 提交**

```bash
git add packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.ts packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.test.tsx packages/opencode/webgui/src/components/MessageInput/index.tsx packages/opencode/webgui/src/state/MessagesContext.tsx
git commit -m "refactor(webgui): remove message pipeline virtual session branches"
```

---

### Task 6: tabPolicy/tabStore 去 virtual 规则并更新测试

**Files:**

- Modify: `packages/opencode/webgui/src/state/tabPolicy.ts`
- Modify: `packages/opencode/webgui/src/state/tabPolicy.test.ts`
- Modify: `packages/opencode/webgui/src/state/tabStore.ts`
- Modify: `packages/opencode/webgui/src/state/tabStore.test.ts`

**Step 1: 写失败测试（prune 仅保留有效真实 tab）**

在 `tabStore.test.ts` 将 virtual 保留测试改为：

```ts
it("pruneTabs removes ids not in validIds", async () => {
  // openTabs: ["s1", "s2"]
  // prune with ["s1"] => ["s1"]
})
```

并在 `tabPolicy.test.ts` 删除 `openVirtualUnique` 场景，增加 `openWithPolicy` 常规覆盖。

**Step 2: 运行测试，确认失败**

Run: `bun run test:run -- src/state/tabPolicy.test.ts src/state/tabStore.test.ts`

Expected: FAIL（当前实现仍导出/使用 virtual 专用逻辑）

**Step 3: 写最小实现**

在 `tabPolicy.ts`：

- 删除 `isVirtualTab/openVirtualUnique`
- 保留 `openWithPolicy + MAX_OPEN_TABS`

在 `tabStore.ts`：

- `openTab` 仅调用 `openWithPolicy`
- `pruneTabs` 改为仅保留 `validIds.has(id)`

**Step 4: 运行测试，确认通过**

Run: `bun run test:run -- src/state/tabPolicy.test.ts src/state/tabStore.test.ts`

Expected: PASS

**Step 5: 提交**

```bash
git add packages/opencode/webgui/src/state/tabPolicy.ts packages/opencode/webgui/src/state/tabPolicy.test.ts packages/opencode/webgui/src/state/tabStore.ts packages/opencode/webgui/src/state/tabStore.test.ts
git commit -m "refactor(webgui): remove virtual-only tab policy branches"
```

---

### Task 7: 全量回归与收尾

**Files:**

- Verify only (no mandatory code changes)

**Step 1: 运行关键测试集合**

Run: `bun run test:run -- src/state/uiBridgeState.test.ts src/state/SessionContext.test.tsx src/components/CompactHeader/index.test.tsx src/components/MessageInput/hooks/useMessageInput.test.tsx src/state/tabStore.test.ts`

Expected: PASS

**Step 2: 运行 webgui 全量测试**

Run: `bun run test:run`

Expected: PASS（无失败用例）

**Step 3: 自检是否还存在 virtual 主路径**

Run: `rg "newVirtual|materializeSession|isVirtualSession|virtual-" src`

Expected: 仅剩非主流程文案或无匹配（按最终设计收敛）

**Step 4: 最终提交**

```bash
git add -A
git commit -m "refactor(webgui): switch to real-session-only flow with draft reuse"
```

---

Plan complete and saved to `docs/plans/2026-02-25-webgui-real-session-draft-reuse-implementation.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
