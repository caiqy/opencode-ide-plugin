# Diff 主线需求测试覆盖补齐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Diff 主线建立明确的需求覆盖矩阵，并只补齐未覆盖或高风险仅间接覆盖的回归测试，降低后续继续更新时的回归风险。

**Architecture:** 先围绕 `2026-04-30-webgui-async-diff-refresh-*` 与 `2026-05-01-session-foreground-read-priority-over-diff-*` 两组正式 spec/plan，梳理“需求 -> 测试 -> 覆盖级别”的矩阵；再按优先级补真实路由、调度语义、前端前台优先与状态链中缺失或仅间接覆盖的测试。实现尽量少改产品代码，优先通过补测试和小幅测试夹具整理来锁住正式行为。

**Tech Stack:** TypeScript、Effect、Hono/HttpApi、React 19、Vitest、Bun test

---

## 文件结构

### 文档将新增

- `docs/superpowers/coverage/2026-05-01-diff-mainline-coverage-matrix.md` — Diff 主线需求覆盖矩阵，逐条标注已覆盖 / 间接覆盖 / 未覆盖

### 后端测试将修改

- `packages/opencode/test/server/httpapi-session.test.ts` — 补真实路由 `messages?before=...&limit=...` 的 foreground 保护回归（若矩阵显示仍属间接覆盖）
- `packages/opencode/test/session/summary-scheduler.test.ts` — 补缺失的正式调度语义测试（若矩阵显示仍有仅间接覆盖）
- `packages/opencode/test/session/summary.test.ts` — 补 `canWrite` / stale write / 正式闭环缺口（若矩阵显示需要）

### 前端测试将修改

- `packages/opencode/webgui/src/hooks/useSessionVisibilitySync.test.tsx` — 补 visible-set 直接语义断言（若矩阵显示仍有仅间接覆盖）
- `packages/opencode/webgui/src/state/useSessionActivation.test.tsx` — 补 activation 生命周期缺口
- `packages/opencode/webgui/src/state/MessagesContext.pagination.test.tsx` — 补 `loadLatest/loadOlder/scanOlder` 的直接 abort/状态测试
- `packages/opencode/webgui/src/state/SessionContext.test.tsx` — 补 switch/diff/status map 的直接需求断言
- `packages/opencode/webgui/src/components/MessageInput/FooterPanels.test.tsx` — 若需要，补“状态透传不回退”的更贴需求断言
- `packages/opencode/webgui/src/components/FileChangesPanel.test.tsx` — 若需要，补 `updating/latest/failed` 的更贴需求断言

### 不应修改的范围

- cleanup 相关 spec / plan / tests
- 非 Diff 主线的工作树改动
- 生产代码逻辑（除非为了让现有需求可测试，需要极小测试性调整）

---

### Task 1: 产出需求覆盖矩阵并标记直接 / 间接 / 未覆盖

**Files:**

- Create: `docs/superpowers/coverage/2026-05-01-diff-mainline-coverage-matrix.md`
- Read/Reference: `docs/superpowers/specs/2026-04-30-webgui-async-diff-refresh-design.md`
- Read/Reference: `docs/superpowers/specs/2026-05-01-session-foreground-read-priority-over-diff-design.md`
- Read/Reference: `packages/opencode/test/server/httpapi-session.test.ts`
- Read/Reference: `packages/opencode/test/session/summary-scheduler.test.ts`
- Read/Reference: `packages/opencode/test/session/summary.test.ts`
- Read/Reference: `packages/opencode/webgui/src/hooks/useSessionVisibilitySync.test.tsx`
- Read/Reference: `packages/opencode/webgui/src/state/useSessionActivation.test.tsx`
- Read/Reference: `packages/opencode/webgui/src/state/MessagesContext.pagination.test.tsx`
- Read/Reference: `packages/opencode/webgui/src/state/SessionContext.test.tsx`
- Read/Reference: `packages/opencode/webgui/src/components/MessageInput/FooterPanels.test.tsx`
- Read/Reference: `packages/opencode/webgui/src/components/FileChangesPanel.test.tsx`

- [ ] **Step 1: 先写覆盖矩阵文件骨架，明确需求分类与判定列**

```md
# Diff 主线需求覆盖矩阵（2026-05-01）

## 判定标准

- **已直接覆盖**：测试直接断言该需求本身
- **仅间接覆盖**：路径经过相关代码，但断言未锁住需求语义
- **未覆盖**：只能依赖 code review / 推断相信正确

## A. 后端调度语义

| 需求                                       | 当前测试                                     | 覆盖级别   | 是否补测 | 备注                   |
| ------------------------------------------ | -------------------------------------------- | ---------- | -------- | ---------------------- |
| foreground 期间不启动后台 diff             | `test/server/httpapi-session.test.ts`        | 已直接覆盖 | 否       | bridge/standard 已覆盖 |
| `messages?before=...` 历史扫描真实路由保护 | 暂无直接路由级断言（预期由 Step 2 完成判定） | 仅间接覆盖 | 是       | 重点检查               |

## B. 前端会话切换与前台优先

| 需求                           | 当前测试                                                              | 覆盖级别   | 是否补测 | 备注                                    |
| ------------------------------ | --------------------------------------------------------------------- | ---------- | -------- | --------------------------------------- |
| switchSession 不会过早 visible | `useSessionActivation.test.tsx` / `useSessionVisibilitySync.test.tsx` | 仅间接覆盖 | 是       | 需要明确锁住“先 foreground，再 visible” |

## C. Diff 状态链

| 需求                                            | 当前测试                  | 覆盖级别   | 是否补测 | 备注                                  |
| ----------------------------------------------- | ------------------------- | ---------- | -------- | ------------------------------------- |
| `session.diff.status -> sessionDiffStatus` 映射 | `SessionContext.test.tsx` | 已直接覆盖 | 否       | Step 2 复核现有断言是否足够贴需求语言 |

## D. 真实路由 / 集成兜底

| 需求                           | 当前测试                  | 覆盖级别   | 是否补测 | 备注                              |
| ------------------------------ | ------------------------- | ---------- | -------- | --------------------------------- |
| bridge / standard 双入口一致性 | `httpapi-session.test.ts` | 已直接覆盖 | 否       | Step 2 仅复核是否覆盖 before 分支 |
```

- [ ] **Step 2: 手工梳理两组 spec 中的 Diff 主线关键需求并填入矩阵**

```md
## A. 后端调度语义

| 需求                                                | 当前测试                                 | 覆盖级别   | 是否补测 | 备注                              |
| --------------------------------------------------- | ---------------------------------------- | ---------- | -------- | --------------------------------- |
| `markDirty -> scheduler -> summarize/diff` 正式闭环 | `test/session/summary.test.ts`           | 已直接覆盖 | 否       |                                   |
| foreground 期间不启动后台 diff                      | `test/server/httpapi-session.test.ts`    | 已直接覆盖 | 否       |                                   |
| foreground 结束后恢复调度                           | `test/server/httpapi-session.test.ts`    | 已直接覆盖 | 否       | 状态序列 `scheduled/running/idle` |
| visible session gating                              | `test/server/httpapi-session.test.ts`    | 已直接覆盖 | 否       |                                   |
| latest-wins / rerunNeeded                           | `test/session/summary-scheduler.test.ts` | 仅间接覆盖 | 是       | 重点检查                          |
| delete / failed / retry 正式状态语义                | `test/session/summary-scheduler.test.ts` | 仅间接覆盖 | 是       | 需要复核状态序列断言              |
```

- [ ] **Step 3: 对照现有测试文件，把每条需求标成“已直接 / 间接 / 未覆盖”**

Run（可选辅助搜索）:

`rg "foreground|visible|scanOlder|AbortSignal|session.diff.status|latest_error|older_error|rerunNeeded|retry|deleted" packages/opencode/test packages/opencode/webgui/src/**/*.test.tsx`

Expected: 能定位到每条需求的现有测试落点，并在矩阵里写出明确判定，不保留“待判定”。

- [ ] **Step 4: 只把“未覆盖”和“高风险仅间接覆盖”标为需要补测**

```md
| 需求                                                 | 当前测试                                 | 覆盖级别   | 是否补测 | 备注             |
| ---------------------------------------------------- | ---------------------------------------- | ---------- | -------- | ---------------- |
| `messages?before=...&limit=...` 历史扫描真实路由保护 | `useSessionActivation.test.tsx` 间接经过 | 仅间接覆盖 | 是       | 缺真实路由级断言 |
| abort `{ error }` resolve 不应落失败态               | `MessagesContext.pagination.test.tsx`    | 已直接覆盖 | 否       |                  |
| stale remote switch response 不覆盖 currentSession   | `SessionContext.test.tsx`                | 已直接覆盖 | 否       |                  |
```

- [ ] **Step 5: 运行相关测试，确认矩阵引用的测试文件都仍通过**

Run:

`bun run --cwd packages/opencode test test/server/httpapi-session.test.ts test/session/summary-scheduler.test.ts test/session/summary.test.ts`

`bun run --cwd packages/opencode/webgui test:run src/hooks/useSessionVisibilitySync.test.tsx src/state/useSessionActivation.test.tsx src/state/MessagesContext.pagination.test.tsx src/state/SessionContext.test.tsx src/components/MessageInput/FooterPanels.test.tsx src/components/FileChangesPanel.test.tsx`

Expected: PASS，矩阵引用的现有覆盖点都成立；若有失败，先修矩阵引用与现实不一致的问题。

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/coverage/2026-05-01-diff-mainline-coverage-matrix.md
git commit -m "docs: map diff mainline test coverage"
```

### Task 2: 补后端真实路由与调度语义的测试缺口

**Files:**

- Modify: `packages/opencode/test/server/httpapi-session.test.ts`
- Modify: `packages/opencode/test/session/summary-scheduler.test.ts`
- Modify: `packages/opencode/test/session/summary.test.ts`

- [ ] **Step 1: 先把矩阵中标记为“需要补测”的后端需求写成失败测试**

```ts
test("messages before-page request also keeps dirty diff pending until foreground read finishes", async () => {
  await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
  const headers = { "x-opencode-directory": tmp.path, "content-type": "application/json" }
  const session = await createSession(tmp.path, { title: "foreground before page" })
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
        svc.markDirty({ sessionID: session.id, messageID: MessageID.ascending(), version: 1 }),
      ),
    )

    const req = standardApp().request(`${SessionPaths.byId.messages("s1")}?before=c1&limit=10`, {
      method: "GET",
      headers,
    })

    await Bun.sleep(20)
    expect(statuses).toEqual([])

    await req
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

- [ ] **Step 2: 运行定向后端测试，确认当前失败点确实存在**

Run:

`bun run --cwd packages/opencode test test/server/httpapi-session.test.ts test/session/summary-scheduler.test.ts test/session/summary.test.ts`

Expected: FAIL，新增测试能明确指出矩阵中标记的后端缺口仍未被直接覆盖。

- [ ] **Step 3: 只补最小测试夹具或断言，不改正式产品语义**

```ts
// httpapi-session.test.ts
function holdRequestUntil(check: () => boolean) {
  return waitFor(check, 1000)
}

expect(statuses).toEqual([])
await holdRequestUntil(() => responseGateOpened)
expect(statuses).toEqual(["scheduled", "running", "idle"])

// summary-scheduler.test.ts
it.live("rerunNeeded only replays latest dirty version once", () =>
  provideTmpdirInstance(() =>
    Effect.gen(function* () {
      const scheduler = yield* SessionSummaryScheduler.Service
      // 只断言 latest-wins / rerunNeeded 正式语义
    }),
  ),
)
```

- [ ] **Step 4: 重新运行后端测试，确认通过**

Run:

`bun run --cwd packages/opencode test test/server/httpapi-session.test.ts test/session/summary-scheduler.test.ts test/session/summary.test.ts`

Expected: PASS，矩阵中标记的后端测试缺口被补齐。

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/test/server/httpapi-session.test.ts packages/opencode/test/session/summary-scheduler.test.ts packages/opencode/test/session/summary.test.ts docs/superpowers/coverage/2026-05-01-diff-mainline-coverage-matrix.md
git commit -m "test: cover backend diff mainline gaps"
```

### Task 3: 补前端前台优先与消息读取的直接需求断言

**Files:**

- Modify: `packages/opencode/webgui/src/hooks/useSessionVisibilitySync.test.tsx`
- Modify: `packages/opencode/webgui/src/state/useSessionActivation.test.tsx`
- Modify: `packages/opencode/webgui/src/state/MessagesContext.pagination.test.tsx`
- Modify: `packages/opencode/webgui/src/state/SessionContext.test.tsx`

- [ ] **Step 1: 先把矩阵中“仅间接覆盖”的前端需求写成失败测试**

```ts
// useSessionVisibilitySync.test.tsx
it("foreground session membership 未变化时，不会因伪变化重复上报 visible set", async () => {
  const view = renderHook(() => useSessionVisibilitySync())
  await waitFor(() => expect(mocks.syncVisible).toHaveBeenCalledTimes(1))

  mocks.state.foregroundSessions = new Set(["s2"])
  await act(async () => {
    view.rerender()
    await Promise.resolve()
  })

  expect(mocks.syncVisible).toHaveBeenCalledTimes(1)
})

// MessagesContext.pagination.test.tsx
it("abort 后 SDK resolve 为 { error } 时，不会把 latest 标记成真实失败", async () => {
  let signal: AbortSignal | undefined
  ;(sdk.session.messages as any).mockImplementationOnce(({ signal: next }: { signal?: AbortSignal }) => {
    signal = next
    return Promise.resolve({ data: null, error: { message: "aborted" } })
  })

  const result = await (api as any).loadLatest("s-abort")
  expect(signal?.aborted).toBe(true)
  expect(result).toBeNull()
  expect(api?.getSessionPagination("s-abort").latestLoading).toBe(false)
  expect(api?.isSessionLoadError("s-abort")).toBe(false)
})
```

- [ ] **Step 2: 运行前端定向测试，确认新增断言先失败**

Run:

`bun run --cwd packages/opencode/webgui test:run src/hooks/useSessionVisibilitySync.test.tsx src/state/useSessionActivation.test.tsx src/state/MessagesContext.pagination.test.tsx src/state/SessionContext.test.tsx`

Expected: FAIL，新增断言能明确暴露矩阵里标记的前端间接覆盖缺口。

- [ ] **Step 3: 只补测试夹具或最小实现，使断言直接锁住需求语义**

```ts
// SessionContext.test.tsx
it("session.diff.status deleted 后再收到 session.diff，不会复活已删除状态", async () => {
  // 显式锁住状态机边界，而不是只顺带消费事件
})

// useSessionActivation.test.tsx
it("旧 activation 的晚到 scanOlder 结果不会覆盖当前 selection", async () => {
  // 显式断言 stale response 被忽略
})
```

- [ ] **Step 4: 重新运行前端测试，确认通过**

Run:

`bun run --cwd packages/opencode/webgui test:run src/hooks/useSessionVisibilitySync.test.tsx src/state/useSessionActivation.test.tsx src/state/MessagesContext.pagination.test.tsx src/state/SessionContext.test.tsx`

Expected: PASS，矩阵中标记的前端间接覆盖缺口被补成直接回归。

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/webgui/src/hooks/useSessionVisibilitySync.test.tsx packages/opencode/webgui/src/state/useSessionActivation.test.tsx packages/opencode/webgui/src/state/MessagesContext.pagination.test.tsx packages/opencode/webgui/src/state/SessionContext.test.tsx docs/superpowers/coverage/2026-05-01-diff-mainline-coverage-matrix.md
git commit -m "test: cover frontend diff mainline gaps"
```

### Task 4: 补状态链最终 UI 断言并做全量验证

**Files:**

- Modify: `packages/opencode/webgui/src/components/MessageInput/FooterPanels.test.tsx`
- Modify: `packages/opencode/webgui/src/components/FileChangesPanel.test.tsx`
- Modify: `docs/superpowers/coverage/2026-05-01-diff-mainline-coverage-matrix.md`

- [ ] **Step 1: 若矩阵显示状态链仍只有间接覆盖，先写失败测试补“贴需求语言”的 UI 断言**

```ts
it("前台优先修复后，diff 状态链仍会向文件面板显示 updating 提示", () => {
  mocks.sessionState.sessionDiffStatus = {
    s1: { type: "updating", message: "Summary refresh scheduled" },
  }

  render(<FooterPanels sessionID="s1" />)
  expect(screen.getByText("差异仍在后台刷新，当前显示的是上一版结果")).toBeInTheDocument()
})

it("diff 状态从 failed -> latest 时，面板文案会按正式状态链切换", () => {
  const { rerender } = render(<FileChangesPanel diffStatus={{ type: "failed", message: "Summary refresh failed" }} />)
  expect(screen.getByText("刷新失败，将在空闲后重试")).toBeInTheDocument()

  rerender(<FileChangesPanel diffStatus={{ type: "latest", message: "Summary refresh complete" }} />)
  expect(screen.getByText("已是最新结果")).toBeInTheDocument()
})
```

- [ ] **Step 2: 运行受影响前端测试，确认新增断言先失败（如果当前确有缺口）**

Run:

`bun run --cwd packages/opencode/webgui test:run src/components/MessageInput/FooterPanels.test.tsx src/components/FileChangesPanel.test.tsx`

Expected: 若矩阵判定这些需求尚非直接覆盖，则 FAIL；若矩阵确认现有测试已直接覆盖，则跳过新增代码并在矩阵中记录“无需补测”。

- [ ] **Step 3: 只补最小测试断言，不改产品代码**

```md
| 需求                             | 当前测试                                              | 覆盖级别   | 是否补测 | 备注              |
| -------------------------------- | ----------------------------------------------------- | ---------- | -------- | ----------------- |
| `updating/latest/failed` UI 文案 | `FooterPanels.test.tsx` + `FileChangesPanel.test.tsx` | 已直接覆盖 | 否       | Task 4 验证后确认 |
```

- [ ] **Step 4: 运行全量 Diff 主线验证集**

Run:

`bun run --cwd packages/opencode test test/server/httpapi-session.test.ts test/session/summary-scheduler.test.ts test/session/summary.test.ts`

`bun run --cwd packages/opencode/webgui test:run src/hooks/useSessionVisibilitySync.test.tsx src/state/useSessionActivation.test.tsx src/state/MessagesContext.pagination.test.tsx src/state/SessionContext.test.tsx src/components/MessageInput/FooterPanels.test.tsx src/components/FileChangesPanel.test.tsx`

`bun run --cwd packages/opencode typecheck`

`bun run --cwd packages/opencode/webgui build`

Expected: 全部 PASS（构建允许已有 chunk-size warning，但不能失败）。

- [ ] **Step 5: 更新覆盖矩阵为最终状态**

```md
| 需求                                                 | 当前测试                              | 覆盖级别   | 是否补测 | 备注       |
| ---------------------------------------------------- | ------------------------------------- | ---------- | -------- | ---------- |
| `messages?before=...&limit=...` 历史扫描真实路由保护 | `test/server/httpapi-session.test.ts` | 已直接覆盖 | 已补     | 2026-05-01 |
| stale remote switch response 不覆盖 currentSession   | `SessionContext.test.tsx`             | 已直接覆盖 | 否       |            |
| abort `{ error }` resolve 不应落失败态               | `MessagesContext.pagination.test.tsx` | 已直接覆盖 | 否       |            |
```

- [ ] **Step 6: Commit**

```bash
git add packages/opencode/webgui/src/components/MessageInput/FooterPanels.test.tsx packages/opencode/webgui/src/components/FileChangesPanel.test.tsx docs/superpowers/coverage/2026-05-01-diff-mainline-coverage-matrix.md
git commit -m "test: finalize diff mainline coverage"
```

---

## Self-Review Checklist

- Spec coverage:
  - Diff 主线需求矩阵 → Task 1
  - 后端真实路由 / 调度语义缺口 → Task 2
  - 前端前台优先 / 消息读取缺口 → Task 3
  - 状态链与全量验证 → Task 4
- Placeholder scan:
  - 无 `TODO` / `TBD` / “以后补” 占位
- Type consistency:
  - 统一使用“已直接覆盖 / 仅间接覆盖 / 未覆盖”判定术语
  - 覆盖矩阵文件路径统一为 `docs/superpowers/coverage/2026-05-01-diff-mainline-coverage-matrix.md`
