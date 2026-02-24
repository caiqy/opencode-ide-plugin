# WebGUI 会话级输入隔离与生成态锁定 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复 webgui 会话切换后的草稿串线与生成态误解锁问题，实现“草稿按会话隔离+持久化”和“生成锁定按会话隔离（仅 stop 可用）”。

**Architecture:** 将输入状态拆分为两条独立链路：`drafts[sessionID]`（草稿）和 `busyMap[sessionID]`（生成态）。`uiBridgeState` 升级为 `v2` 持久化结构承载会话草稿，并提供兼容 `v1.input` 的迁移。`MessageInput` 不再依赖全局单一输入值恢复，而是按当前会话读写草稿；禁用矩阵统一以 `SessionContext` 的会话 busy/idle 为真相源。

**Tech Stack:** TypeScript, React, Lexical, Vitest, Testing Library.

---

### Task 1: `uiBridgeState` 升级到会话草稿结构（v2）

**Files:**

- Modify: `packages/opencode/webgui/src/state/uiBridgeState.ts`
- Modify: `packages/opencode/webgui/src/state/uiBridgeState.test.ts`

**Step 1: 写失败测试（会话草稿与兼容迁移）**

在 `uiBridgeState.test.ts` 新增：

```ts
it("stores drafts by session id", () => {
  uiBridgeHydrate({ sessionID: "s1" })
  uiBridgeUpdateDraft("s1", "hello s1")
  uiBridgeUpdateDraft("s2", "hello s2")
  expect(uiBridgeDraft("s1")).toBe("hello s1")
  expect(uiBridgeDraft("s2")).toBe("hello s2")
})

it("migrates v1 input into active session draft", () => {
  uiBridgeHydrate({ sessionID: "s1", input: "legacy" })
  expect(uiBridgeDraft("s1")).toBe("legacy")
})
```

**Step 2: 运行测试确认失败**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/state/uiBridgeState.test.ts`

Expected: FAIL（`uiBridgeUpdateDraft/uiBridgeDraft` 未实现，或结构不匹配）。

**Step 3: 写最小实现（v2 + helper API）**

在 `uiBridgeState.ts`：

```ts
type UiBridgeState = {
  v: 2
  sessionID: string | null
  providerId: string | null
  modelId: string | null
  agent: string | null
  variant: string | null
  drafts: Record<string, string>
}

export function uiBridgeDraft(id: string | null) {
  if (!id) return ""
  return store.state.drafts[id] ?? ""
}

export function uiBridgeUpdateDraft(id: string | null, text: string) {
  if (!id) return store.state
  const drafts = text ? { ...store.state.drafts, [id]: text } : omitKey(store.state.drafts, id)
  return uiBridgeUpdate({ drafts })
}
```

并在 `uiBridgeHydrate` 中处理 `v1.input -> drafts[sessionID]` 迁移。

**Step 4: 运行测试确认通过**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/state/uiBridgeState.test.ts`

Expected: PASS。

**Step 5: Commit**

```bash
git add packages/opencode/webgui/src/state/uiBridgeState.ts packages/opencode/webgui/src/state/uiBridgeState.test.ts
git commit -m "refactor(webgui): store bridge drafts per session"
```

---

### Task 2: `MessageInput` 按会话读写草稿，移除全局 input 恢复路径

**Files:**

- Modify: `packages/opencode/webgui/src/components/MessageInput/index.tsx`
- Modify: `packages/opencode/webgui/src/components/MessageInput/index.test.tsx`

**Step 1: 写失败测试（A/B 草稿隔离）**

在 `index.test.tsx` 新增一个“切换会话恢复不同草稿”的测试，mock `uiBridgeDraft/uiBridgeUpdateDraft`：

```ts
it("restores draft by session id when switching", async () => {
  // given drafts: s1=foo, s2=bar
  // render with sessionID=s1 then rerender sessionID=s2
  // expect editor receives foo then bar
})
```

**Step 2: 运行测试确认失败**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/components/MessageInput/index.test.tsx`

Expected: FAIL（当前实现仍使用全局 `input` 单值恢复）。

**Step 3: 写最小实现（会话草稿恢复与保存）**

在 `MessageInput/index.tsx`：

```ts
useEffect(() => {
  if (!sessionID) return
  setIsRestoring(true)
  insertPlainWithMentionsImpl(editor, parseWithRange, uiBridgeDraft(sessionID), { replace: true })
  setTimeout(() => setIsRestoring(false), 0)
}, [sessionID, editor, parseWithRange])

const handleEditorChange = useCallback(
  (state: EditorState) => {
    state.read(() => {
      const text = $getRoot().getTextContent()
      setIsEmpty(text.trim().length === 0)
      if (!isRestoring) uiBridgeUpdateDraft(sessionID, text)
    })
  },
  [isRestoring, sessionID],
)
```

删除或收敛现有“只恢复一次 `restored.current` + `uiBridgeSubscribe(input)`”逻辑。

**Step 4: 运行测试确认通过**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/components/MessageInput/index.test.tsx`

Expected: PASS。

**Step 5: Commit**

```bash
git add packages/opencode/webgui/src/components/MessageInput/index.tsx packages/opencode/webgui/src/components/MessageInput/index.test.tsx
git commit -m "fix(webgui): isolate message drafts by session"
```

---

### Task 3: 生成态禁用矩阵改为会话 busy/idle 驱动（仅 stop 可用）

**Files:**

- Modify: `packages/opencode/webgui/src/components/MessageInput/index.tsx`
- Modify: `packages/opencode/webgui/src/components/MessageInput/EditorToolbar.tsx`
- Modify: `packages/opencode/webgui/src/components/MessageInput/MessageActions.tsx`
- Modify: `packages/opencode/webgui/src/components/MessageInput/MessageActions.test.tsx`

**Step 1: 写失败测试（busy 时只允许 stop）**

在 `MessageActions.test.tsx` 增加断言：busy 时 compact 按钮 disabled，stop 可见。

```ts
it("busy session allows stop only", () => {
  render(<MessageActions isIdle={false} isButtonDisabled={true} isCompactDisabled={true} ... />)
  expect(screen.getByTitle("停止生成")).toBeInTheDocument()
  expect(screen.getByTitle("精简会话历史")).toBeDisabled()
})
```

**Step 2: 运行测试确认失败**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/components/MessageInput/MessageActions.test.tsx`

Expected: FAIL（当前禁用条件未完整覆盖 busy-only 规则）。

**Step 3: 写最小实现（以会话 busy 为真相）**

在 `MessageInput/index.tsx` 将禁用来源改为会话 busy：

```ts
const busy = !isIdle
const isDisabled = busy
const isButtonDisabled = busy || isEmpty
const isCompactDisabled =
  busy || isCompacting || !sessionID || sessionID.startsWith("virtual-") || !selectedProviderId || !selectedModelId
```

确保 `EditorToolbar` 中 `AgentSelector/ModelSelector/VariantSelector/IconButton` 都沿用 `isDisabled`。

**Step 4: 运行测试确认通过**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/components/MessageInput/MessageActions.test.tsx src/components/MessageInput/index.test.tsx`

Expected: PASS。

**Step 5: Commit**

```bash
git add packages/opencode/webgui/src/components/MessageInput/index.tsx packages/opencode/webgui/src/components/MessageInput/EditorToolbar.tsx packages/opencode/webgui/src/components/MessageInput/MessageActions.tsx packages/opencode/webgui/src/components/MessageInput/MessageActions.test.tsx
git commit -m "fix(webgui): lock composer controls by session busy state"
```

---

### Task 4: 处理 virtual 会话 materialize 后草稿迁移

**Files:**

- Modify: `packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.ts`
- Modify: `packages/opencode/webgui/src/state/uiBridgeState.ts`
- Create: `packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.test.tsx`

**Step 1: 写失败测试（virtual -> real 保留草稿）**

在新建 `useMessageInput.test.tsx` 中 mock `materializeSession` 返回真实 ID：

```ts
it("moves draft from virtual id to real id after materialize", async () => {
  // virtual-1 has draft "hello"
  // submit => materialize to s-real
  // expect draft moved to s-real
})
```

**Step 2: 运行测试确认失败**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/components/MessageInput/hooks/useMessageInput.test.tsx`

Expected: FAIL（当前无草稿迁移 API 或未调用）。

**Step 3: 写最小实现（move helper + 调用点）**

在 `uiBridgeState.ts` 增加：

```ts
export function uiBridgeMoveDraft(from: string, to: string) {
  if (!from || !to || from === to) return store.state
  const text = store.state.drafts[from]
  if (!text) return store.state
  return uiBridgeUpdate({ drafts: { ...omitKey(store.state.drafts, from), [to]: text } })
}
```

在 `useMessageInput.ts` materialize 成功后调用 `uiBridgeMoveDraft(sessionID, actualSessionID)`。

**Step 4: 运行测试确认通过**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/components/MessageInput/hooks/useMessageInput.test.tsx`

Expected: PASS。

**Step 5: Commit**

```bash
git add packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.ts packages/opencode/webgui/src/state/uiBridgeState.ts packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.test.tsx
git commit -m "fix(webgui): preserve draft when virtual session materializes"
```

---

### Task 5: 回归测试与手工验收

**Files:**

- Modify (if needed): `docs/plans/2026-02-24-webgui-session-input-isolation-design.md`

**Step 1: 跑关键自动化回归**

Run:

```bash
bun run --cwd packages/opencode/webgui test:run -- \
  src/state/uiBridgeState.test.ts \
  src/components/MessageInput/index.test.tsx \
  src/components/MessageInput/MessageActions.test.tsx \
  src/components/MessageInput/hooks/useMessageInput.test.tsx \
  src/state/useSessionActivation.test.tsx
```

Expected: 全部 PASS。

**Step 2: 手工验收清单**

1. A 生成中切 B：B 可输入并发送。
2. 切回 A：仅 stop 可操作。
3. A/B 草稿分别输入并切换：不串线。
4. 重载 Webview：A/B 草稿按会话恢复。

**Step 3: 最终提交**

```bash
git add -A
git commit -m "fix(webgui): isolate drafts and controls per session"
```
