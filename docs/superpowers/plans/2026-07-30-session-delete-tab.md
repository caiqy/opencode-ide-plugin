# 会话删除标签同步修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除会话成功后立即同步关闭对应标签，避免切换已删除会话或残留“新建会话”标签。

**Architecture:** 保持 `SessionContext` 与 `tabStore` 的现有职责。在 `CompactHeader` 传入 `useSessionActions` 的删除边界组合两者：后端删除成功才调用 `tabStore.closeTab`；删除进行中暂停恢复 effect，结束后按最终标签状态恢复。`SessionContext` 删除成功时只使同 ID 的 pending switch 失效，防止旧响应复活会话。

**Tech Stack:** React 19、TypeScript、Vitest、Testing Library

## Global Constraints

- 不新增依赖、状态、事件或标签选择算法。
- 删除失败不得改变标签状态。
- 不修改用户已有的无关工作区改动。

---

### Task 1: 删除成功后同步关闭标签

**Files:**
- Modify: `packages/opencode/webgui/src/components/CompactHeader/index.tsx:237-493`
- Test: `packages/opencode/webgui/src/components/CompactHeader/index.test.tsx`

**Interfaces:**
- Consumes: `deleteSession(sessionId: string): Promise<boolean>`、`tabStore.closeTab(sessionId: string): void`
- Produces: 传给 `useSessionActions` 的同签名删除函数；成功时关闭 backing tab，失败时不关闭；删除期间恢复 effect 暂停。

- [ ] **Step 1: 写失败回归测试**

在 `CompactHeader` 测试中渲染组件，从 `mocks.useSessionActions.mock.calls` 取得传入的 `deleteSession`，调用后断言原删除函数和 `closeTab` 都收到同一会话 ID；再让原删除函数返回 `false`，断言 `closeTab` 不增加调用。

```ts
const input = mocks.useSessionActions.mock.calls[0]?.[0] as {
  deleteSession: (sessionId: string) => Promise<boolean>
}

await expect(input.deleteSession("s2")).resolves.toBe(true)
expect(deleteSession).toHaveBeenCalledWith("s2")
expect(closeTab).toHaveBeenCalledWith("s2")

deleteSession.mockResolvedValue(false)
await expect(input.deleteSession("s3")).resolves.toBe(false)
expect(closeTab).not.toHaveBeenCalledWith("s3")
```

- [ ] **Step 2: 运行测试并确认按预期失败**

Run: `vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run test:run -- src/components/CompactHeader/index.test.tsx`

Expected: 新测试失败，原因是当前传入的是原始 `deleteSession`，`closeTab` 未被调用。

- [ ] **Step 3: 写最小实现**

```ts
const actions = useSessionActions({
  sessions,
  updateSessionTitle,
  deleteSession: async (sessionId) => {
    const success = await deleteSession(sessionId)
    if (success) tabStore.closeTab(sessionId)
    return success
  },
})
```

恢复 effect 首行同时检查删除状态，并在依赖中加入 `actions.isDeleting`：

```ts
if (!tabStore.loaded || actions.isDeleting) return
```

新增测试将 `isDeleting` 从 `true` 切换为 `false`，断言期间不切换待删除标签，结束后只切换最终 `activeTab`。

- [ ] **Step 4: 运行聚焦测试并确认通过**

Run: `vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run test:run -- src/components/CompactHeader/index.test.tsx src/components/CompactHeader/index.integration.test.tsx src/state/tabStore.test.ts`

Expected: 所列测试全部通过，0 failed。

- [ ] **Step 5: 运行 WebGUI 构建检查**

Run: `vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run build`

Expected: TypeScript 与 Vite 构建退出码为 0。

- [ ] **Step 6: 检查最终差异**

Run: `git diff --check -- packages/opencode/webgui/src/components/CompactHeader/index.tsx packages/opencode/webgui/src/components/CompactHeader/index.test.tsx`

Expected: 无输出；不自动提交或推送。

### Task 2: 删除使同 ID 在途切换失效

**Files:**
- Modify: `packages/opencode/webgui/src/state/SessionContext.tsx:945-990`
- Test: `packages/opencode/webgui/src/state/SessionContext.test.tsx`

**Interfaces:**
- Consumes: `pendingSwitchForegroundRef`、`switchTokenRef`、`currentSessionIDRef`
- Produces: 删除成功后，同 ID 的旧 `sdk.session.get` 响应不能更新 `currentSession`。

- [ ] **Step 1: 写 deferred 失败测试**

启动未分页会话的 `switchSession("s-late")`，在 `sdk.session.get` 返回前成功删除 `s-late`，最后放行旧响应并断言 `currentSession` 仍为 `null`。

- [ ] **Step 2: 确认测试失败**

Run: `vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run test:run -- src/state/SessionContext.test.tsx -t "删除会话后会丢弃该会话尚未完成的切换响应"`

Expected: FAIL，旧响应把 `s-late` 设为当前会话。

- [ ] **Step 3: 写最小实现**

```ts
if (pendingSwitchForegroundRef.current === sessionId) {
  switchTokenRef.current++
  replacePendingSwitchForeground(null)
}
if (currentSessionIDRef.current === sessionId) {
  setCurrentSession(null)
}
```

- [ ] **Step 4: 确认聚焦测试和完整验证通过**

Run: `vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run test:run -- src/state/SessionContext.test.tsx`

Expected: `SessionContext` 测试全部通过，0 failed。
