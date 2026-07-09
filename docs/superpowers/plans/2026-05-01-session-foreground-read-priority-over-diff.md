# 会话前台读取优先于后台 Diff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让会话切换时的前台消息读取、历史扫描与当前会话首次 Diff 读取始终优先于后台 summary/diff，避免“正在加载会话内容…”和“正在切换会话设置…”被后台 Diff 长时间拖住。

**Architecture:** 方案分两层：后端在 `session.messages` / `session.diff`（必要时 `session.get`）外层统一包 `summaryScheduler.foregroundStart/foregroundFinish`，保证前台读取期间不会再启动新的后台 Diff；前端为“正在激活的当前会话”增加一个临时的 foreground-protected 集合，在关键前台读取全部收口前，不把该会话纳入 `/session/visibility` 的 background visible set。整个实现只推迟后台 Diff 的启动时机，不新增新的 `markDirty(...)` 触发源，也不改变现有 scheduler 的合并语义。

**Tech Stack:** TypeScript、Effect、Hono/HttpApi、React 19、Vitest、Bun test

---

## 文件结构

### 后端将修改

- `packages/opencode/src/server/routes/instance/httpapi/session.ts` — 为 `messages` / `diff`（以及必要时 `get`）补 foreground 生命周期包装
- `packages/opencode/src/server/routes/instance/session.ts` — 若标准 Hono 路由与 HttpApi 路由分离，需要保持同类读取语义一致
- `packages/opencode/test/server/httpapi-session.test.ts` — 新增“前台读取阻止后台 diff 启动、结束后恢复调度”的接口回归

### 前端将修改

- `packages/opencode/webgui/src/hooks/useSessionVisibilitySync.ts` — 接受 activating/foreground-protected session IDs，并在同步 visible set 时排除它们
- `packages/opencode/webgui/src/hooks/useSessionVisibilitySync.test.tsx` — 覆盖“激活中的当前会话暂不纳入 visible set，收口后再加入”
- `packages/opencode/webgui/src/state/useSessionActivation.ts` — 在 selection restore 生命周期中显式开始/结束 session activation
- `packages/opencode/webgui/src/state/useSessionActivation.test.tsx` — 覆盖 activation 收口与 fallback/error 路径
- `packages/opencode/webgui/src/state/MessagesContext.tsx` — 让 `ensureSession(...)` / `scanOlder(...)` 的收口能驱动 activation 生命周期
- `packages/opencode/webgui/src/state/SessionContext.tsx` — 为当前 session 首次 `diff` 读取接入 activation 收口，并维护一个轻量 activation 协调状态
- `packages/opencode/webgui/src/App.tsx` — 将 activation 状态传给 `useSessionVisibilitySync()`
- `packages/opencode/webgui/src/state/SessionContext.test.tsx` — 覆盖当前 session diff 首次读取的 activation 收口

### 不应修改的正式核心

- `packages/opencode/src/session/summary-scheduler.ts` — 本轮只复用，不重构状态机
- `packages/opencode/src/session/prompt.ts` / `processor.ts` — 不新增新的 dirty 触发路径
- `packages/opencode/webgui/src/components/FileChangesPanel.tsx` — UI 状态文案不变

---

### Task 1: 给后端关键读取补 foreground 生命周期保护

**Files:**

- Modify: `packages/opencode/src/server/routes/instance/httpapi/session.ts`
- Modify: `packages/opencode/src/server/routes/instance/session.ts`
- Test: `packages/opencode/test/server/httpapi-session.test.ts`

- [ ] **Step 1: 先写失败测试，锁定“messages/diff 前台读取期间不应启动后台 diff”**

```ts
test("messages request keeps dirty diff pending until foreground read finishes", async () => {
  await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
  const session = await createSession(tmp.path, { title: "foreground messages" })
  const statuses: string[] = []
  const off = await runBus(
    tmp.path,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      return yield* bus.subscribeCallback(Session.Event.DiffStatus, (event) => {
        if (event.properties.sessionID === session.id) statuses.push(event.properties.status)
      })
    }),
  )

  try {
    await runSummaryScheduler(
      tmp.path,
      SessionSummaryScheduler.Service.use((svc) => svc.syncVisible([session.id])),
    )
    await runSummaryScheduler(
      tmp.path,
      SessionSummaryScheduler.Service.use((svc) =>
        Effect.gen(function* () {
          yield* svc.markDirty({ sessionID: session.id, messageID: MessageID.ascending(), version: 1 })
          yield* svc.foregroundStart(session.id)
          yield* svc.flush()
        }),
      ),
    )

    expect(statuses).toEqual([])

    await runSummaryScheduler(
      tmp.path,
      SessionSummaryScheduler.Service.use((svc) => svc.foregroundFinish(session.id)),
    )
    await runSummaryScheduler(
      tmp.path,
      SessionSummaryScheduler.Service.use((svc) => svc.flush()),
    )

    await waitFor(() => statuses.includes("idle"))
    expect(statuses).toEqual(["scheduled", "running", "idle"])
  } finally {
    off()
  }
})

test("diff request also blocks new background diff until foreground read finishes", async () => {
  await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
  const session = await createSession(tmp.path, { title: "foreground diff" })
  const statuses: string[] = []
  const off = await runBus(
    tmp.path,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      return yield* bus.subscribeCallback(Session.Event.DiffStatus, (event) => {
        if (event.properties.sessionID === session.id) statuses.push(event.properties.status)
      })
    }),
  )

  try {
    await runSummaryScheduler(
      tmp.path,
      SessionSummaryScheduler.Service.use((svc) => svc.syncVisible([session.id])),
    )
    await runSummaryScheduler(
      tmp.path,
      SessionSummaryScheduler.Service.use((svc) =>
        Effect.gen(function* () {
          yield* svc.markDirty({ sessionID: session.id, messageID: MessageID.ascending(), version: 1 })
          yield* svc.foregroundStart(session.id)
          yield* svc.flush()
        }),
      ),
    )

    expect(statuses).toEqual([])

    await runSummaryScheduler(
      tmp.path,
      SessionSummaryScheduler.Service.use((svc) => svc.foregroundFinish(session.id)),
    )
    await runSummaryScheduler(
      tmp.path,
      SessionSummaryScheduler.Service.use((svc) => svc.flush()),
    )
    await waitFor(() => statuses.includes("idle"))
    expect(statuses).toEqual(["scheduled", "running", "idle"])
  } finally {
    off()
  }
})
```

- [ ] **Step 2: 运行后端接口测试，确认当前失败**

Run:

`bun run --cwd packages/opencode test test/server/httpapi-session.test.ts`

Expected: FAIL，新增断言显示当前前台读取保护未覆盖 `messages` / `diff` 读取路径。

- [ ] **Step 3: 在 `httpapi/session.ts` 为关键读取提炼统一包装器**

```ts
const withForegroundRead = <A>(sessionID: SessionID, fx: Effect.Effect<A>) =>
  SessionSummaryScheduler.Service.use((svc) =>
    Effect.acquireUseRelease(
      svc.foregroundStart(sessionID),
      () => fx,
      () => svc.foregroundFinish(sessionID),
    ),
  ).pipe(Effect.provide(SessionSummaryScheduler.defaultLayer))

const messages = Effect.fn("SessionHttpApi.messages")(function* (ctx: {
  params: { sessionID: SessionID }
  query: typeof MessagesQuery.Type
}) {
  return yield* withForegroundRead(
    ctx.params.sessionID,
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      if (ctx.query.before !== undefined && ctx.query.limit === undefined) {
        return yield* new HttpApiError.BadRequest({})
      }
      // 保留原有分页逻辑不变
      const page = MessageV2.page({
        sessionID: ctx.params.sessionID,
        limit: ctx.query.limit!,
        before: ctx.query.before,
      })
      return HttpServerResponse.jsonUnsafe(page.items, {
        headers: {
          "Access-Control-Expose-Headers": "Link, X-Next-Cursor",
          "X-Next-Cursor": page.cursor ?? "",
        },
      })
    }),
  )
})

const diff = Effect.fn("SessionHttpApi.diff")(function* (ctx: {
  params: { sessionID: SessionID }
  query: typeof DiffQuery.Type
}) {
  return yield* withForegroundRead(
    ctx.params.sessionID,
    summary.diff({ sessionID: ctx.params.sessionID, messageID: ctx.query.messageID }),
  )
})
```

- [ ] **Step 4: 若标准 Hono 路由保留平行实现，同步补上同类包装**

```ts
app.get("/:sessionID/messages", (c) =>
  jsonRequest("SessionRoutes.messages", c, function* () {
    const sessionID = SessionID(c.req.param("sessionID"))
    return yield* withForegroundRead(sessionID, messagesImpl({ sessionID, query: c.req.query() }))
  }),
)

app.get("/:sessionID/diff", (c) =>
  jsonRequest("SessionRoutes.diff", c, function* () {
    const sessionID = SessionID(c.req.param("sessionID"))
    return yield* withForegroundRead(sessionID, summary.diff({ sessionID }))
  }),
)
```

- [ ] **Step 5: 重新运行后端测试，确认通过**

Run:

`bun run --cwd packages/opencode test test/server/httpapi-session.test.ts`

Expected: PASS，新增 messages/diff 读取保护断言通过，原有 visibility endpoint 回归不退化。

- [ ] **Step 6: Commit**

```bash
git add packages/opencode/src/server/routes/instance/httpapi/session.ts packages/opencode/src/server/routes/instance/session.ts packages/opencode/test/server/httpapi-session.test.ts
git commit -m "fix: prioritize foreground session reads over diff"
```

### Task 2: 让前端 activation 会话在收口前不进入 background visible set

**Files:**

- Modify: `packages/opencode/webgui/src/hooks/useSessionVisibilitySync.ts`
- Modify: `packages/opencode/webgui/src/hooks/useSessionVisibilitySync.test.tsx`
- Modify: `packages/opencode/webgui/src/App.tsx`
- Modify: `packages/opencode/webgui/src/state/SessionContext.tsx`

- [ ] **Step 1: 先写 hook 失败测试，锁定“激活中的当前会话暂不纳入 syncVisible 集合”**

```ts
const mocks = vi.hoisted(() => ({
  syncVisible: vi.fn(),
  state: {
    currentSession: { id: "s2" } as { id: string } | null,
    openTabs: ["s1", "s2"] as string[],
    activating: new Set<string>(["s2"]),
  },
}))

vi.mock("../state/SessionContext", () => ({
  useSession: () => ({
    currentSession: mocks.state.currentSession,
    foregroundSessions: mocks.state.activating,
  }),
}))

it("激活中的当前会话不会立即进入 background visible set，收口后再加入", async () => {
  const view = renderHook(() => useSessionVisibilitySync())

  await waitFor(() => {
    expect(mocks.syncVisible).toHaveBeenCalledWith({
      body: {
        sessionIDs: ["s1"],
      },
    })
  })

  mocks.state.activating = new Set<string>()
  mocks.syncVisible.mockResolvedValueOnce({ data: { sessionIDs: ["s1", "s2"] }, error: null })

  await act(async () => {
    view.rerender()
  })

  await waitFor(() => {
    expect(mocks.syncVisible).toHaveBeenLastCalledWith({
      body: {
        sessionIDs: ["s1", "s2"],
      },
    })
  })
})
```

- [ ] **Step 2: 运行 hook 测试，确认当前失败**

Run:

`bun run --cwd packages/opencode/webgui test:run src/hooks/useSessionVisibilitySync.test.tsx`

Expected: FAIL，因为现有 `useSessionVisibilitySync()` 还不知道 activating/foreground-protected session IDs。

- [ ] **Step 3: 在 `SessionContext` 中新增轻量 activation 协调状态**

```ts
type SessionContextType = {
  // ...existing fields
  foregroundSessions: Set<string>
  beginForegroundSession: (sessionID: string) => void
  endForegroundSession: (sessionID: string) => void
}

const [foregroundSessionMap, setForegroundSessionMap] = useState<Record<string, number>>({})

const beginForegroundSession = useCallback((sessionID: string) => {
  if (!sessionID) return
  setForegroundSessionMap((prev) => ({
    ...prev,
    [sessionID]: (prev[sessionID] ?? 0) + 1,
  }))
}, [])

const endForegroundSession = useCallback((sessionID: string) => {
  if (!sessionID) return
  setForegroundSessionMap((prev) => {
    const current = prev[sessionID] ?? 0
    if (current <= 1) {
      const next = { ...prev }
      delete next[sessionID]
      return next
    }
    return { ...prev, [sessionID]: current - 1 }
  })
}, [])

const foregroundSessions = useMemo(
  () => new Set(Object.keys(foregroundSessionMap).filter((sessionID) => foregroundSessionMap[sessionID] > 0)),
  [foregroundSessionMap],
)
```

- [ ] **Step 4: 让 `useSessionVisibilitySync()` 排除 foreground-protected session IDs**

```ts
function visibleSessionIDs(
  openTabs: string[],
  currentSessionID: string | null | undefined,
  foregroundSessions: Set<string>,
) {
  const ids = currentSessionID ? [...openTabs, currentSessionID] : openTabs
  return Array.from(new Set(ids))
    .filter((sessionID) => !foregroundSessions.has(sessionID))
    .sort()
}

export function useSessionVisibilitySync() {
  const { currentSession, foregroundSessions } = useSession()
  const { openTabs } = useTabStore()
  const sessionIDs = visibleSessionIDs(openTabs, currentSession?.id, foregroundSessions)
  const key = JSON.stringify(sessionIDs)
  // 保留原有 inFlight / retry / latest 收敛逻辑不变
}
```

- [ ] **Step 5: 在 `App.tsx` 继续原地调用 hook，不新增额外副作用入口**

```ts
function AppInner({ connectionState }: { connectionState: ConnectionState }) {
  const { currentSession } = useSession()
  const activateSession = useSessionActivation()
  useSessionVisibilitySync()

  const gate = currentSession?.id
    ? chatState({
        loading: isSessionLoading(currentSession.id),
        loaded: isSessionLoaded(currentSession.id),
        error: isSessionLoadError(currentSession.id),
        ready: getMessagesBySession(currentSession.id).length > 0,
      })
    : { loading: false, error: false, blocked: false }
}
```

- [ ] **Step 6: 重新运行 hook/上下文测试，确认通过**

Run:

`bun run --cwd packages/opencode/webgui test:run src/hooks/useSessionVisibilitySync.test.tsx src/state/SessionContext.test.tsx`

Expected: PASS，激活中的 session 暂时不再进入 `/session/visibility` 上报集合，相关 context 测试保持通过。

- [ ] **Step 7: Commit**

```bash
git add packages/opencode/webgui/src/hooks/useSessionVisibilitySync.ts packages/opencode/webgui/src/hooks/useSessionVisibilitySync.test.tsx packages/opencode/webgui/src/App.tsx packages/opencode/webgui/src/state/SessionContext.tsx
git commit -m "fix: delay visible sync for activating sessions"
```

### Task 3: 让消息加载、历史扫描和首次 diff 读取都参与 activation 收口

**Files:**

- Modify: `packages/opencode/webgui/src/state/useSessionActivation.ts`
- Modify: `packages/opencode/webgui/src/state/useSessionActivation.test.tsx`
- Modify: `packages/opencode/webgui/src/state/MessagesContext.tsx`
- Modify: `packages/opencode/webgui/src/state/SessionContext.tsx`
- Test: `packages/opencode/webgui/src/state/SessionContext.test.tsx`

- [ ] **Step 1: 先写失败测试，锁定 activation 在 fallback/error 路径也必须收口**

```ts
it("selection 恢复失败时也会结束 foreground session，避免一直卡在切换会话设置中", async () => {
  const latest = deferred<any>()
  ;(sdk.session.messages as any).mockImplementationOnce(() => latest.promise)

  render(
    <Providers>
      <ActivationHarness />
      <Capture />
    </Providers>,
  )

  await waitFor(() => {
    expect(sessionApi).toBeTruthy()
    expect(sessionApi!.sessions.length).toBe(1)
  })

  await act(async () => {
    await sessionApi!.switchSession("s1")
  })

  expect(sessionApi!.foregroundSessions.has("s1")).toBe(true)

  await act(async () => {
    latest.resolve({ error: { message: "load failed" }, data: null })
    await Promise.resolve()
    await Promise.resolve()
  })

  await waitFor(() => {
    expect(sessionApi!.foregroundSessions.has("s1")).toBe(false)
  })
})

it("当前会话首次 diff 读取完成前保持 foreground session，完成后才释放", async () => {
  const diff = deferred<any>()
  ;(sdk.session.diff as any).mockImplementationOnce(() => diff.promise)

  render(
    <Providers>
      <ActivationHarness />
      <Capture />
    </Providers>,
  )

  await waitFor(() => {
    expect(sessionApi).toBeTruthy()
  })

  await act(async () => {
    await sessionApi!.switchSession("s1")
  })

  await waitFor(() => {
    expect(sessionApi!.foregroundSessions.has("s1")).toBe(true)
  })

  await act(async () => {
    diff.resolve({ data: [], error: null })
    await Promise.resolve()
    await Promise.resolve()
  })

  await waitFor(() => {
    expect(sessionApi!.foregroundSessions.has("s1")).toBe(false)
  })
})
```

- [ ] **Step 2: 运行 activation / context 测试，确认当前失败**

Run:

`bun run --cwd packages/opencode/webgui test:run src/state/useSessionActivation.test.tsx src/state/SessionContext.test.tsx`

Expected: FAIL，因为当前没有显式 foreground session 生命周期，失败/回退路径不会统一释放。

- [ ] **Step 3: 在 `useSessionActivation()` 中显式包住 selection restore 生命周期**

```ts
export function useSessionActivation() {
  const { currentSession, restoreSelections, resolveSelections, beginForegroundSession, endForegroundSession } =
    useSession()

  const activate = useCallback(async (sessionID?: string | null) => {
    if (!sessionID) return
    const token = ++activationTokenRef.current
    beginForegroundSession(sessionID)

    try {
      const loadedMessages = await ensureRef.current(sessionID)
      if (token !== activationTokenRef.current) return
      if (!loadedMessages) {
        const cached = getRef.current(sessionID)
        const restored = selectionFromMessages(cached, revertRef.current)
        if (restored) {
          restoreRef.current(restored, sessionID)
        } else {
          resolveRef.current(sessionID, "未能恢复该会话的设置，继续使用当前配置")
        }
        return
      }

      let rows = merge(getRef.current(sessionID), loadedMessages)
      let restoredSelection = selectionFromMessages(rows, revertRef.current)
      let cursor = cursorRef.current(sessionID)
      const seen = new Set<string>()
      if (cursor) seen.add(cursor)

      for (let i = 0; !restoredSelection && cursor && i < 10; i++) {
        const older = await scanRef.current(sessionID, cursor)
        if (token !== activationTokenRef.current) return
        if (!older) {
          resolveRef.current(sessionID, "未能恢复该会话的设置，继续使用当前配置")
          return
        }
        rows = merge(rows, older.rows)
        restoredSelection = selectionFromMessages(rows, revertRef.current)
        const next = older.cursor
        if (!next || seen.has(next)) break
        seen.add(next)
        cursor = next
      }

      if (!restoredSelection) {
        resolveRef.current(sessionID)
        return
      }

      restoreRef.current(restoredSelection, sessionID)
    } finally {
      endForegroundSession(sessionID)
    }
  }, [])
}
```

- [ ] **Step 4: 在 `SessionContext` 的当前会话首次 diff 读取里也加入同一生命周期**

```ts
useEffect(() => {
  const sessionId = currentSession?.id
  if (!sessionId) return

  const controller = new AbortController()
  beginForegroundSession(sessionId)

  const fetchDiff = async () => {
    try {
      const response = await sdk.session.diff({ path: { id: sessionId } })
      if (controller.signal.aborted) return
      if (response.data) {
        setSessionDiffMap((prev) => ({ ...prev, [sessionId]: response.data }))
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        console.error("[SessionContext] Failed to load session diff:", err)
      }
    } finally {
      if (!controller.signal.aborted) {
        endForegroundSession(sessionId)
      }
    }
  }

  void fetchDiff()
  return () => {
    controller.abort()
    endForegroundSession(sessionId)
  }
}, [beginForegroundSession, currentSession?.id, endForegroundSession])
```

- [ ] **Step 5: 确保 `MessagesContext` 保持“失败也返回 null、而不是悬挂 promise”**

```ts
const loadLatest = useCallback(
  async (sessionID: string) => {
    const pending = latestLoadRef.current[sessionID]
    if (pending) return pending

    const run = (async () => {
      try {
        const response = await sdk.session.messages({
          path: { id: sessionID },
          query: { limit: PAGE },
        } as any)

        if (response.error) {
          setPage(sessionID, (prev) => ({
            ...prev,
            latest_loading: false,
            loaded: false,
            latest_error: true,
          }))
          return null
        }

        const loadedMessages = ((response.data ?? []) as unknown as Message[]).map((msg) => normalizeMsg(msg))
        setPage(sessionID, {
          cursor: nextCursor(response),
          complete: !nextCursor(response),
          loaded: true,
          latest_loading: false,
          latest_error: false,
          older_loading: false,
          older_error: false,
        })
        return loadedMessages
      } catch {
        setPage(sessionID, (prev) => ({
          ...prev,
          latest_loading: false,
          loaded: false,
          latest_error: true,
        }))
        return null
      }
    })()

    latestLoadRef.current[sessionID] = run
    return run.finally(() => {
      if (latestLoadRef.current[sessionID] === run) delete latestLoadRef.current[sessionID]
    })
  },
  [normalizeMsg, setPage],
)
```

- [ ] **Step 6: 重新运行前端测试，确认 activation 会正常收口**

Run:

`bun run --cwd packages/opencode/webgui test:run src/state/useSessionActivation.test.tsx src/state/SessionContext.test.tsx src/hooks/useSessionVisibilitySync.test.tsx`

Expected: PASS，失败/回退/首次 diff 读取路径都会释放 foreground session，selectionPending 不再长期悬挂。

- [ ] **Step 7: Commit**

```bash
git add packages/opencode/webgui/src/state/useSessionActivation.ts packages/opencode/webgui/src/state/useSessionActivation.test.tsx packages/opencode/webgui/src/state/MessagesContext.tsx packages/opencode/webgui/src/state/SessionContext.tsx packages/opencode/webgui/src/state/SessionContext.test.tsx
git commit -m "fix: finish session activation before background diff"
```

### Task 4: 全链路验证并补回归 smoke

**Files:**

- Test: `packages/opencode/webgui/src/components/MessageInput/FooterPanels.test.tsx`
- Test: `packages/opencode/webgui/src/components/FileChangesPanel.test.tsx`
- Verify only: working tree changes from Tasks 1-3

- [ ] **Step 1: 补一条前端回归，确认 Diff 状态提示链不受前台优先修复影响**

```ts
it("当前会话 activation 收口后仍会显示 updating/latest/failed 状态", async () => {
  mocks.sessionState.sessionDiffStatus = {
    s1: { type: "updating", message: "Summary refresh scheduled" },
  }

  render(<FooterPanels sessionID="s1" />)

  expect(screen.getByText("差异仍在后台刷新，当前显示的是上一版结果")).toBeInTheDocument()
})
```

- [ ] **Step 2: 运行受影响前端测试集**

Run:

`bun run --cwd packages/opencode/webgui test:run src/hooks/useSessionVisibilitySync.test.tsx src/state/useSessionActivation.test.tsx src/state/SessionContext.test.tsx src/components/MessageInput/FooterPanels.test.tsx src/components/FileChangesPanel.test.tsx`

Expected: PASS。

- [ ] **Step 3: 运行后端类型检查与 WebGUI 构建**

Run:

`bun run --cwd packages/opencode typecheck`

`bun run --cwd packages/opencode/webgui build`

Expected: 两条命令都通过，没有新增的类型错误或构建错误。

- [ ] **Step 4: 做一个最小 smoke，确认切换加载和底部恢复不再被后台 Diff 长时间卡住**

Run:

`bun run --cwd packages/opencode/webgui test:run src/state/useSessionActivation.test.tsx --testNamePattern "selection 恢复失败时也会结束 foreground session|当前会话首次 diff 读取完成前保持 foreground session"`

Expected: PASS，至少能证明会话切换相关的关键收口路径已自动化覆盖。

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/webgui/src/components/MessageInput/FooterPanels.test.tsx packages/opencode/webgui/src/components/FileChangesPanel.test.tsx packages/opencode/webgui/src/hooks/useSessionVisibilitySync.test.tsx packages/opencode/webgui/src/state/useSessionActivation.test.tsx packages/opencode/webgui/src/state/SessionContext.test.tsx packages/opencode/test/server/httpapi-session.test.ts
git commit -m "test: cover foreground session read priority"
```

---

## Self-Review Checklist

- Spec coverage:
  - 前端延后 visibility 上报 → Task 2
  - 后端关键读取 foreground 保护 → Task 1
  - messages / scanOlder / diff 首次读取都参与 activation 收口 → Task 3
  - 不新增 diff 触发源、保留 scheduler 合并语义 → Tasks 1-3 的实现约束
  - 前端/后端/构建验证 → Task 4
- Placeholder scan:
  - 无 `TODO` / `TBD` / “稍后实现” 占位语句
- Type consistency:
  - 统一使用 `foregroundSessions`、`beginForegroundSession`、`endForegroundSession`
  - 后端统一使用 `withForegroundRead(sessionID, fx)` 包装关键读取
