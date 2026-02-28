# Quick phrase isolation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 quick phrase 的 double_send/confirm_send 与输入框草稿完全解耦，并统一由 useMessageInput 负责发送。

**Architecture:** 在 useMessageInput 新增“直接发送短语”入口，发送时不依赖编辑器当前草稿和 isEmpty 状态。MessageInput 仅负责 fill_input 和确认弹窗交互，double_send/confirm_send 只调用 hook 的发送能力，并加上 latest-only 竞态保护。失败只提示，不回填输入框，不暴露重试入口。

**Tech Stack:** React 19 + TypeScript + Lexical + Vitest + Testing Library

---

### Task 1: Fix stale closure send gate

**Files:**

- Modify: `packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.ts`
- Test: `packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.test.tsx`

**Step 1: Write the failing test**

```tsx
it("quick phrase send 不受 isEmpty 闭包影响", async () => {
  const { result } = renderHook(() =>
    useMessageInput({
      sessionID: "s-1",
      editor,
      isEmpty: true,
      selectedProviderId: "openai",
      selectedModelId: "gpt-4.1",
      selectedAgent: "build",
      selectedVariant: undefined,
      extractMessageParts: vi.fn(() => []),
    }),
  )

  await act(async () => {
    await result.current.submitQuickPhrase("请总结改动")
  })

  expect(mocks.prompt).toHaveBeenCalledTimes(1)
})
```

**Step 2: Run test to verify it fails**

Run (cwd: `packages/opencode/webgui`):  
`bun run test:run src/components/MessageInput/hooks/useMessageInput.test.tsx -t "quick phrase send 不受 isEmpty 闭包影响"`  
Expected: FAIL，提示 `submitQuickPhrase` 不存在或未触发 `prompt`

**Step 3: Write minimal implementation**

```ts
const submitQuickPhrase = useCallback(
  async (body: string) => {
    if (!sessionID) return
    const text = body.trim()
    if (!text) return
    return submitText(text, { source: "quick_phrase" })
  },
  [sessionID, submitText],
)
```

并把 `handleSubmit` 改为先读取编辑器文本，再判断空内容，不再用旧的 `isEmpty` 作为发送前置条件。

**Step 4: Run test to verify it passes**

Run (cwd: `packages/opencode/webgui`):  
`bun run test:run src/components/MessageInput/hooks/useMessageInput.test.tsx -t "quick phrase send 不受 isEmpty 闭包影响"`  
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/MessageInput/hooks/useMessageInput.ts src/components/MessageInput/hooks/useMessageInput.test.tsx
git commit -m "fix(webgui): remove stale isEmpty gate from send path"
```

---

### Task 2: Move send responsibility into hook

**Files:**

- Modify: `packages/opencode/webgui/src/components/MessageInput/index.tsx`
- Modify: `packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.ts`
- Test: `packages/opencode/webgui/src/components/MessageInput/index.test.tsx`

**Step 1: Write the failing test**

```tsx
it("double_send 模式通过 submitQuickPhrase 发送，不先回填输入框", async () => {
  mocks.submitQuickPhrase.mockResolvedValue(undefined)
  render(<MessageInput sessionID="s1" />)

  act(() => {
    lastQuickPhraseBarProps.onActivate({ id: "preset:commit", title: "提交总结", body: "请总结改动" })
  })

  expect(mocks.submitQuickPhrase).toHaveBeenCalledWith("请总结改动")
  expect(mocks.insertPlainWithMentionsImpl).not.toHaveBeenCalled()
})
```

**Step 2: Run test to verify it fails**

Run (cwd: `packages/opencode/webgui`):  
`bun run test:run src/components/MessageInput/index.test.tsx -t "double_send 模式通过 submitQuickPhrase 发送，不先回填输入框"`  
Expected: FAIL，当前实现仍调用 `fillPhrase + handleSubmit`

**Step 3: Write minimal implementation**

```tsx
if (quickPhrases.mode === "fill_input") {
  fillPhrase(item.body)
  return
}
if (quickPhrases.mode === "double_send") {
  void submitQuickPhrase(item.body)
  return
}
setPhraseConfirm({ title: item.title, body: item.body })
```

`onConfirmPhrase` 也改为 `void submitQuickPhrase(body)`，不再调用 `sendPhrase`。

**Step 4: Run test to verify it passes**

Run (cwd: `packages/opencode/webgui`):  
`bun run test:run src/components/MessageInput/index.test.tsx -t "double_send 模式通过 submitQuickPhrase 发送，不先回填输入框"`  
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/MessageInput/index.tsx src/components/MessageInput/index.test.tsx src/components/MessageInput/hooks/useMessageInput.ts
git commit -m "refactor(webgui): centralize quick phrase sending in useMessageInput"
```

---

### Task 3: Keep fill-only behavior and isolate failure

**Files:**

- Modify: `packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.ts`
- Modify: `packages/opencode/webgui/src/components/MessageInput/index.tsx`
- Test: `packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.test.tsx`
- Test: `packages/opencode/webgui/src/components/MessageInput/index.test.tsx`

**Step 1: Write the failing test**

```tsx
it("quick phrase 发送失败时不写入 failedMap 且不提供重试", async () => {
  mocks.prompt.mockRejectedValueOnce(new Error("network"))
  await act(async () => {
    await result.current.submitQuickPhrase("请总结改动")
  })

  expect(result.current.lastFailedMessage).toBe(null)
  expect(mocks.showToast).toHaveBeenCalledTimes(1)
})
```

并补一个 UI 测试：`fill_input` 仍只回填、不发送。

**Step 2: Run test to verify it fails**

Run (cwd: `packages/opencode/webgui`):  
`bun run test:run src/components/MessageInput/hooks/useMessageInput.test.tsx -t "quick phrase 发送失败时不写入 failedMap 且不提供重试"`  
Run (cwd: `packages/opencode/webgui`):  
`bun run test:run src/components/MessageInput/index.test.tsx -t "fill_input 模式双击仅回填不发送"`  
Expected: 第一条 FAIL，第二条保持 PASS

**Step 3: Write minimal implementation**

```ts
if (source === "quick_phrase") {
  showToast(error.message, { title: "Failed to send message", variant: "error", duration: 8000 })
  onError?.(error)
  setSessionIdle(sessionID, true)
  return
}
setFailed(sessionID, savedMessage)
```

`fill_input` 路径不改发送逻辑，只保留回填。

**Step 4: Run test to verify it passes**

Run (cwd: `packages/opencode/webgui`):  
`bun run test:run src/components/MessageInput/hooks/useMessageInput.test.tsx -t "quick phrase 发送失败时不写入 failedMap 且不提供重试"`  
Run (cwd: `packages/opencode/webgui`):  
`bun run test:run src/components/MessageInput/index.test.tsx -t "fill_input 模式双击仅回填不发送"`  
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/MessageInput/hooks/useMessageInput.ts src/components/MessageInput/hooks/useMessageInput.test.tsx src/components/MessageInput/index.test.tsx src/components/MessageInput/index.tsx
git commit -m "fix(webgui): keep phrase failure out of draft and retry flow"
```

---

### Task 4: Add latest-only race guard

**Files:**

- Modify: `packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.ts`
- Test: `packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.test.tsx`

**Step 1: Write the failing test**

```tsx
it("并发短语发送时仅最新一次可落状态", async () => {
  let resolveOld: ((v: any) => void) | null = null
  let resolveNew: ((v: any) => void) | null = null
  mocks.prompt
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveOld = r
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveNew = r
        }),
    )

  await act(async () => {
    void result.current.submitQuickPhrase("old")
    void result.current.submitQuickPhrase("new")
  })

  await act(async () => {
    resolveNew?.({ data: {}, error: null })
    resolveOld?.({ data: {}, error: null })
  })

  expect(mocks.setSessionIdle).toHaveBeenLastCalledWith("s-1", true)
  expect(mocks.showToast).toHaveBeenCalledTimes(0)
})
```

**Step 2: Run test to verify it fails**

Run (cwd: `packages/opencode/webgui`):  
`bun run test:run src/components/MessageInput/hooks/useMessageInput.test.tsx -t "并发短语发送时仅最新一次可落状态"`  
Expected: FAIL，旧请求完成后仍会覆盖最新状态

**Step 3: Write minimal implementation**

```ts
const sendSeq = useRef(0)

const runSend = useCallback(async (...) => {
  const seq = ++sendSeq.current
  ...
  if (seq !== sendSeq.current) return
  setSessionIdle(sessionID, true)
}, [...])
```

对成功与失败分支都加 `seq` 校验，确保只处理 latest 请求的收尾副作用。

**Step 4: Run test to verify it passes**

Run (cwd: `packages/opencode/webgui`):  
`bun run test:run src/components/MessageInput/hooks/useMessageInput.test.tsx -t "并发短语发送时仅最新一次可落状态"`  
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/MessageInput/hooks/useMessageInput.ts src/components/MessageInput/hooks/useMessageInput.test.tsx
git commit -m "fix(webgui): guard message submit side effects with latest-only sequence"
```

---

### Task 5: Extract quick phrase event constants

**Files:**

- Modify: `packages/opencode/webgui/src/state/repo/quickPhraseEvent.ts`
- Modify: `packages/opencode/webgui/src/components/settings/QuickPhrasesTab.tsx`
- Modify: `packages/opencode/webgui/src/components/MessageInput/index.tsx`
- Test: `packages/opencode/webgui/src/components/MessageInput/index.test.tsx`
- (Optional new test) `packages/opencode/webgui/src/state/repo/quickPhraseEvent.test.ts`

**Step 1: Write the failing test**

```ts
it("使用 quick phrase 事件常量对象而非散落字符串", () => {
  expect(quick_phrase_events.updated).toBe("opencode:quick-phrase-updated")
})
```

并把现有测试导入从 `quick_phrase_updated_event` 改为 `quick_phrase_events.updated`，先让编译失败。

**Step 2: Run test to verify it fails**

Run (cwd: `packages/opencode/webgui`):  
`bun run test:run src/components/MessageInput/index.test.tsx -t "快捷短语刷新时应仅应用最后一次加载结果"`  
Expected: FAIL，导入符号不存在

**Step 3: Write minimal implementation**

```ts
export const quick_phrase_events = {
  updated: "opencode:quick-phrase-updated",
} as const
```

替换所有 `addEventListener/dispatchEvent` 的引用为 `quick_phrase_events.updated`。

**Step 4: Run test to verify it passes**

Run (cwd: `packages/opencode/webgui`):  
`bun run test:run src/components/MessageInput/index.test.tsx -t "快捷短语刷新时应仅应用最后一次加载结果"`  
Expected: PASS

**Step 5: Commit**

```bash
git add src/state/repo/quickPhraseEvent.ts src/components/settings/QuickPhrasesTab.tsx src/components/MessageInput/index.tsx src/components/MessageInput/index.test.tsx src/state/repo/quickPhraseEvent.test.ts
git commit -m "refactor(webgui): consolidate quick phrase event constants"
```

---

### Verify end-to-end

在 `packages/opencode/webgui` 目录执行一次最小回归，确认核心路径都覆盖。  
Run: `bun run test:run src/components/MessageInput/index.test.tsx src/components/MessageInput/hooks/useMessageInput.test.tsx`，Expected: 全部 PASS。

---

### Split commits

1. `fix(webgui): remove stale isEmpty gate from send path`
2. `refactor(webgui): centralize quick phrase sending in useMessageInput`
3. `fix(webgui): keep phrase failure out of draft and retry flow`
4. `fix(webgui): guard message submit side effects with latest-only sequence`
5. `refactor(webgui): consolidate quick phrase event constants`
