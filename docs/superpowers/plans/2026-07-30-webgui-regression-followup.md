# WebGUI 大合并回归补漏实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复大合并恢复后遗留的 pending 生命周期、visibility 首连、默认模型、长历史 selection 和 Diff 分类问题。

**Architecture:** 保持现有 `MessagesContext`、`SessionContext` 和 hooks 边界。使用已有 connection epoch、cursor 和服务端确认结果收敛状态，不增加依赖或通用状态框架。

**Tech Stack:** React 19、TypeScript、Vitest 4、Testing Library、Bun 1.3.14。

## Global Constraints

- 仅修改 `packages/opencode/webgui` 下的实现和测试。
- 不处理 project `PATCH /config` 和多 global 配置文件语义。
- 不修改 Protocol、HttpApi 或 generated SDK。
- 每项先确认新增测试在旧实现上失败，再写最小实现。
- 使用 vfox 管理的 Bun `1.3.14` 和 Node.js `22.23.1`。
- 不提交、推送、合并或修改用户已有的其他未提交文件。

## File Map

- `src/state/MessagesContext.tsx`: 删除会话时清理 pending，并过滤删除期间的 hydration 快照。
- `src/components/MessageInput/hooks/useMessageInput.ts`: 服务端确认 abort 后再清理 question。
- `src/hooks/useSessionVisibilitySync.ts`: 所有 `server.connected` 使用统一 epoch 规则。
- `src/state/SessionContext.tsx`: 将 provider default 纳入初始模型优先级。
- `src/state/useSessionActivation.ts`: 扫描长历史直到明确终止条件。
- `src/components/FileChangesPanel.tsx`: 分离 added、modified、deleted 展示。

---

### Task 1: 删除会话时收敛 pending 状态

**Files:**
- Modify: `packages/opencode/webgui/src/state/MessagesContext.tsx:173-206,1048-1061,1231-1267`
- Test: `packages/opencode/webgui/src/state/MessagesContext.questions.test.tsx`

**Interfaces:**
- Consumes: `session.deleted` 的 `event.properties.info.id`。
- Produces: 当前 hydration window 中按 session ID 过滤 permission/question 快照。

- [ ] **Step 1: 添加删除与 hydration 竞态测试**

在 `MessagesContext.questions.test.tsx` 添加：

```tsx
it("水合期间删除会话不会恢复该会话的 pending 状态", async () => {
  const questions = deferred<{ data: QuestionRequest[]; error: null }>()
  const permissions = deferred<{ data: PermissionRequest[]; error: null }>()
  vi.mocked(sdk.question.list).mockImplementationOnce(() => questions.promise)
  vi.mocked(sdk.permissions.list).mockImplementationOnce(() => permissions.promise)
  const emitter = new EventEmitter()
  mount(emitter)

  await act(async () => emitter.emit({ type: "server.connected", properties: {} }))
  await act(async () => {
    emitter.emit(ask("local", "s1"))
    emitter.emit({ type: "session.deleted", properties: { info: { id: "s1" } } } as unknown as ServerEvent)
    questions.resolve({ data: [ask("stale", "s1").properties as QuestionRequest], error: null })
    permissions.resolve({ data: [permission("stale-permission", "s1")], error: null })
  })

  await waitFor(() => {
    expect(api?.getQuestionsBySession("s1")).toEqual([])
    expect(api?.permissions.filter((item) => item.sessionID === "s1")).toEqual([])
  })
})
```

- [ ] **Step 2: 运行测试并确认 RED**

Run from `packages/opencode/webgui`:

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run test:run -- src/state/MessagesContext.questions.test.tsx -t "水合期间删除会话"
```

Expected: FAIL，旧 question 或 permission 被快照恢复。

- [ ] **Step 3: 在 pending window 记录删除的 session**

将 window 类型扩展为：

```ts
const pendingWindow = useRef<
  { epoch: number; version: number; touched: Record<string, number>; deletedSessions: Set<string> } | undefined
>(undefined)
```

创建 window 时初始化集合：

```ts
pendingWindow.current = { epoch, version: 0, touched: {}, deletedSessions: new Set() }
```

在 `handleSessionDeletedNotification` 中同步清理 question 并记录删除：

```ts
pendingWindow.current?.deletedSessions.add(sessionID)
setPermissions((prev) => prev.filter((permission) => permission.sessionID !== sessionID))
setQuestions((prev) => {
  const next = new Map(prev)
  next.delete(sessionID)
  return next
})
```

在两个快照进入 `mergePendingSnapshot` 前按 session ID 过滤：

```ts
const visiblePermissions = permissions.filter((item) => !window.deletedSessions.has(item.sessionID))
const visibleQuestions = questions.filter((item) => !window.deletedSessions.has(item.sessionID))
```

- [ ] **Step 4: 运行聚焦测试并确认 GREEN**

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run test:run -- src/state/MessagesContext.questions.test.tsx
```

Expected: 文件内全部测试通过。

---

### Task 2: abort 失败时保留 pending question

**Files:**
- Modify: `packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.ts:224-257`
- Test: `packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.test.tsx:680-820`

**Interfaces:**
- Consumes: `sdk.session.abort({ path: { id } })` 的 error tuple。
- Produces: 只有 abort 成功后才调用 `rejectQuestion(requestID)` 和 `setSessionIdle(id, true)`。

- [ ] **Step 1: 加强 abort error tuple 测试**

在现有 `abort error tuple keeps session busy` 的 abort mock 后加入 pending question：

```ts
mocks.getQuestionsBySession.mockReturnValue([{ id: "q1" }, { id: "q2" }])
```

在该测试现有的 `handleAbort()` 调用后加入：

```ts
expect(mocks.rejectQuestion).not.toHaveBeenCalled()
expect(mocks.setSessionIdle).not.toHaveBeenCalledWith("s-3", true)
```

并在成功测试中断言调用顺序：

```ts
expect(mocks.abort.mock.invocationCallOrder[0]).toBeLessThan(mocks.rejectQuestion.mock.invocationCallOrder[0])
```

- [ ] **Step 2: 运行测试并确认 RED**

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run test:run -- src/components/MessageInput/hooks/useMessageInput.test.tsx -t "abort"
```

Expected: FAIL，当前实现先调用 `rejectQuestion`。

- [ ] **Step 3: 将 pending 清理移动到 abort 成功之后**

保持现有错误处理，只调整顺序：

```ts
const response = await sdk.session.abort({ path: { id: sessionID } })
if (response.error) {
  const message =
    typeof response.error === "object" && "message" in response.error
      ? String(response.error.message)
      : "终止会话失败"
  throw new Error(message)
}

const result = await Promise.allSettled(getQuestionsBySession(sessionID).map((item) => rejectQuestion(item.id)))
if (result.some((item) => item.status === "rejected" || (item.status === "fulfilled" && item.value === false))) {
  console.warn("[MessageInput] Failed to reject question after abort")
}
setSessionIdle(sessionID, true)
```

- [ ] **Step 4: 运行聚焦测试并确认 GREEN**

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run test:run -- src/components/MessageInput/hooks/useMessageInput.test.tsx -t "abort"
```

Expected: abort 相关测试全部通过。

---

### Task 3: 首次连接重置 visibility 预算

**Files:**
- Modify: `packages/opencode/webgui/src/hooks/useSessionVisibilitySync.ts:23-30,98-114`
- Test: `packages/opencode/webgui/src/hooks/useSessionVisibilitySync.test.tsx:312-350`

**Interfaces:**
- Consumes: `server.connected`。
- Produces: 每个连接事件创建新 epoch 并立即同步最新 key。

- [ ] **Step 1: 将现有重连测试改为只发一次事件**

```ts
it("第一次 server.connected 会给未变 key 新的重试预算", async () => {
  vi.useFakeTimers()
  mocks.syncVisible.mockResolvedValue(fail("temporary failure"))
  renderHook(() => useSessionVisibilitySync())
  await act(async () => vi.advanceTimersByTimeAsync(5000))
  expect(mocks.syncVisible).toHaveBeenCalledTimes(3)

  await act(async () => {
    events.emit()
    await Promise.resolve()
  })

  expect(mocks.syncVisible).toHaveBeenCalledTimes(4)
})
```

同样将“old epoch pending”测试中的两个 `events.emit()` 缩减为一个。

- [ ] **Step 2: 运行测试并确认 RED**

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run test:run -- src/hooks/useSessionVisibilitySync.test.tsx -t "第一次 server.connected|old epoch"
```

Expected: FAIL，首次事件只设置 `connected` 后返回。

- [ ] **Step 3: 删除首连特殊分支**

删除 `connected` ref，并让 handler 始终执行现有 reset：

```ts
return eventEmitter.on("server.connected", () => {
  epoch.current++
  synced.current = undefined
  blocked.current = undefined
  attempts.current = { key: "", count: 0 }
  if (retry.current) {
    clearTimeout(retry.current)
    retry.current = null
  }
  flush.current()
})
```

- [ ] **Step 4: 运行 visibility 文件并确认 GREEN**

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run test:run -- src/hooks/useSessionVisibilitySync.test.tsx
```

Expected: `14/14` 或更新后的全部测试通过。

---

### Task 4: 使用服务端 provider default

**Files:**
- Modify: `packages/opencode/webgui/src/state/SessionContext.tsx:376-443`
- Test: `packages/opencode/webgui/src/state/SessionContext.test.tsx:140-179,348-475`

**Interfaces:**
- Consumes: `sdk.config.providers().data.default: Record<string, string>`。
- Produces: 优先级 `workspace/agent -> recent -> config.model -> provider default -> first available`。

- [ ] **Step 1: 更新 fixture 并添加 default 非首项测试**

先将默认 mock 从旧形状改为：

```ts
default: { openai: "gpt-4.1", anthropic: "claude-4-sonnet" },
```

新增独立测试，给 OpenAI 两个模型并把第二个设为 default：

```tsx
it("无本地选择时使用服务端 provider default", async () => {
  ;(sdk.config.get as any).mockResolvedValue({ data: {}, error: null })
  ;(sdk.config.providers as any).mockResolvedValue({
    data: {
      providers: [{ id: "openai", name: "OpenAI", models: { first: {}, preferred: {} } }],
      default: { openai: "preferred" },
    },
    error: null,
  })

  const { result } = renderHook(() => useSession(), { wrapper })
  await waitFor(() => {
    expect(result.current.selectedProviderId).toBe("openai")
    expect(result.current.selectedModelId).toBe("preferred")
  })
})
```

再添加无效 default 回退测试：

```tsx
it("服务端 provider default 无效时回退到首个可用模型", async () => {
  ;(sdk.config.get as any).mockResolvedValue({ data: {}, error: null })
  ;(sdk.config.providers as any).mockResolvedValue({
    data: {
      providers: [{ id: "openai", name: "OpenAI", models: { first: {} } }],
      default: { openai: "missing" },
    },
    error: null,
  })

  const { result } = renderHook(() => useSession(), { wrapper })
  await waitFor(() => {
    expect(result.current.selectedProviderId).toBe("openai")
    expect(result.current.selectedModelId).toBe("first")
  })
})
```

- [ ] **Step 2: 运行测试并确认 RED**

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run test:run -- src/state/SessionContext.test.tsx -t "provider default"
```

Expected: 第一个测试得到 `first` 而失败。

- [ ] **Step 3: 将有效 default 插入最终 fallback 前**

在读取 providers 后计算：

```ts
const defaults = providersRes.data?.default ?? {}
const providerDefault = providers
  .map((provider) => ({ providerId: provider.id, modelId: defaults[provider.id] }))
  .find((item) => hasModel(providers, item.providerId, item.modelId))
```

初次 fallback 和无效选择 fallback 均按以下顺序使用：

```ts
providerDefault ?? firstAvailableModel(providers)
```

- [ ] **Step 4: 运行 SessionContext 测试并确认 GREEN**

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run test:run -- src/state/SessionContext.test.tsx
```

Expected: 文件内全部测试通过。

---

### Task 5: 长历史持续扫描 selection

**Files:**
- Modify: `packages/opencode/webgui/src/state/useSessionActivation.ts:121-149`
- Test: `packages/opencode/webgui/src/state/useSessionActivation.test.tsx:607-679`

**Interfaces:**
- Consumes: `scanOlder(sessionID, cursor, signal)` 返回的 `{ rows, cursor }`。
- Produces: 扫描直到命中 selection、历史结束、重复 cursor、失败或取消。

- [ ] **Step 1: 用第十一页 selection 替换“最大十页”测试**

将现有测试改为以下完整 mock，使 `c1` 到 `c10` 只返回 assistant，在 `c11` 返回 user selection：

```ts
;(sdk.session.messages as any).mockImplementation(
  ({ query }: { query: { before?: string; limit: number } }) => {
    if (!query.before) {
      return Promise.resolve({
        error: null,
        data: [{
          info: { id: "a0", sessionID: "s1", role: "assistant", time: { created: 100 } },
          parts: [],
        }],
        response: { headers: new Headers({ "X-Next-Cursor": "c1" }) },
      })
    }

    const n = Number(query.before.slice(1))
    if (n === 11) {
      return Promise.resolve({
        error: null,
        data: [{
          info: {
            id: "u-old",
            sessionID: "s1",
            role: "user",
            time: { created: 1 },
            agent: "plan",
            model: { providerID: "openai", modelID: "gpt-4.1" },
            variant: "low",
          },
          parts: [],
        }],
        response: { headers: new Headers() },
      })
    }

    return Promise.resolve({
      error: null,
      data: [{
        info: { id: `a${n}`, sessionID: "s1", role: "assistant", time: { created: 100 - n } },
        parts: [],
      }],
      response: { headers: new Headers({ "X-Next-Cursor": `c${n + 1}` }) },
    })
  },
)
```

完成激活后断言请求超过旧上限且 selection 已恢复：

```ts
expect(sdk.session.messages).toHaveBeenCalledTimes(12)
expect(sessionApi!.selectedAgent).toBe("plan")
expect(sessionApi!.selectedModelId).toBe("gpt-4.1")
```

保留现有重复 cursor 测试作为无限循环防护。

- [ ] **Step 2: 运行测试并确认 RED**

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run test:run -- src/state/useSessionActivation.test.tsx -t "第十一页"
```

Expected: FAIL，只请求 latest 加十页且未恢复 selection。

- [ ] **Step 3: 移除固定页数条件**

将循环改为：

```ts
while (!restoredSelection && cursor) {
  const older = await scanRef.current(sessionID, cursor, controller.signal)
  if (token !== activationTokenRef.current) return
  if (!older) {
    failed = true
    break
  }
  rows = merge(rows, older.rows)
  restoredSelection = selectionFromMessages(rows, revertRef.current)
  const next = older.cursor
  if (!next || seen.has(next)) break
  seen.add(next)
  cursor = next
}
```

- [ ] **Step 4: 运行 activation 文件并确认 GREEN**

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run test:run -- src/state/useSessionActivation.test.tsx
```

Expected: 文件内全部测试通过，重复 cursor 测试仍终止。

---

### Task 6: 分离 added、modified 和 deleted

**Files:**
- Modify: `packages/opencode/webgui/src/components/FileChangesPanel.tsx:33-61,72-130`
- Test: `packages/opencode/webgui/src/components/FileChangesPanel.test.tsx`

**Interfaces:**
- Consumes: `SnapshotFileDiff.status`。
- Produces: 三组独立计数和样式；总行数与净变更算法不变。

- [ ] **Step 1: 添加 added fixture 和展示断言**

在默认 mock 中加入：

```ts
{
  file: "src/new.ts",
  patch: "@@ -0,0 +1 @@\n+new",
  status: "added",
  additions: 1,
  deletions: 0,
}
```

将统计断言改为：

```ts
expect(screen.getByText("1 added • 1 modified • 1 deleted")).toBeInTheDocument()
expect(screen.getByTitle("src/new.ts")).toHaveClass("text-green-700")
```

- [ ] **Step 2: 运行测试并确认 RED**

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run test:run -- src/components/FileChangesPanel.test.tsx
```

Expected: FAIL，当前 UI 显示 `2 modified` 且没有 added 样式。

- [ ] **Step 3: 创建三组并渲染 added 区块**

在 memo 中按 status 分组：

```ts
const addedEntries = mergedDiffs.filter((diff) => diff.status === "added").sort(sortByBasename)
const modifiedEntries = mergedDiffs.filter((diff) => diff.status === "modified").sort(sortByBasename)
const deletedEntries = mergedDiffs.filter((diff) => diff.status === "deleted").sort(sortByBasename)
```

摘要改为：

```tsx
<span>{added.length} added • {modified.length} modified • {deleted.length} deleted</span>
```

在 modified 区块前增加以下 added 区块；不抽取单次 helper：

```tsx
{added.length > 0 && (
  <div className="px-3 py-1.5 flex flex-wrap items-center gap-1.5">
    {added.map((diff) => {
      const file = diff.file
      const displayPath = toDisplayPath(file, worktree) || normalizePath(file)
      const baseName = displayPath.split("/").pop() || displayPath
      return (
        <span
          key={file}
          role="button"
          tabIndex={0}
          onClick={() => openFile({ path: file, display: displayPath || file })}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return
            event.preventDefault()
            openFile({ path: file, display: displayPath || file })
          }}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs font-mono bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded cursor-pointer hover:bg-green-200 dark:hover:bg-green-900/60"
          title={displayPath || file}
          data-tip={displayPath || file}
        >
          {baseName}
          {diff.additions > 0 && (
            <span className="text-green-600 dark:text-green-400 text-[10px]">+{diff.additions}</span>
          )}
        </span>
      )
    })}
  </div>
)}
```

- [ ] **Step 4: 运行测试并确认 GREEN**

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run test:run -- src/components/FileChangesPanel.test.tsx
```

Expected: 文件内全部测试通过。

---

### Task 7: 集成验证与复审

**Files:**
- Verify only: `packages/opencode/webgui`

**Interfaces:**
- Consumes: Tasks 1-6 的实现和回归测试。
- Produces: 第一批可交付验证证据。

- [ ] **Step 1: 运行六个 owning test 文件**

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run test:run -- src/state/MessagesContext.questions.test.tsx src/components/MessageInput/hooks/useMessageInput.test.tsx src/hooks/useSessionVisibilitySync.test.tsx src/state/SessionContext.test.tsx src/state/useSessionActivation.test.tsx src/components/FileChangesPanel.test.tsx
```

Expected: 全部通过，0 failed。

- [ ] **Step 2: 运行 WebGUI 全量测试**

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run test:run
```

Expected: 至少保留当前 `158` 个测试文件、`1397` 个测试并包含新增测试；0 failed。

- [ ] **Step 3: 运行生产构建**

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run build
```

Expected: `tsc -b && vite build` 退出 0。

- [ ] **Step 4: 检查 diff 范围**

```powershell
git diff --check -- packages/opencode/webgui docs/superpowers/specs/2026-07-30-webgui-regression-followup-design.md docs/superpowers/plans/2026-07-30-webgui-regression-followup.md
git status --short
```

Expected: `git diff --check` 退出 0；仅报告预期 WebGUI、设计和计划文件，以及用户原有未提交文件。

- [ ] **Step 5: 请求只读代码复审**

复审必须检查：六项设计要求均有对应测试、abort 不提前破坏 pending、hydration 不复活删除状态、长历史循环有明确终止条件，以及没有混入第二批配置改动。
