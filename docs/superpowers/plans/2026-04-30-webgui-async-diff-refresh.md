# WebGUI 异步 Diff 刷新 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把会话回复与重 Diff 刷新彻底解耦，让长上下文会话不再通过同步 `summary.summarize()` / `snapshot.diffFull()` 拖慢同工作区其他对话，同时在 WebGUI 的“文件变更 / Diff”区域提供轻量异步状态提示。

**Architecture:** 在 `packages/opencode/src/session/` 新增一个 per-instance 的 `SessionSummaryScheduler`，由 `prompt.ts` / `processor.ts` 只上报 dirty，不再直接等待 summary。scheduler 负责前台优先、后台限 1、latest-wins、可见 session 同步、删除会话清理，并通过新的 `session.diff.status` bus event 把状态同步到 WebGUI。

**Tech Stack:** TypeScript、Effect、Hono/HttpApi、React 19、Vitest、Bun test

---

## 文件结构

### 后端新增

- `packages/opencode/src/session/summary-scheduler.ts` — per-instance Diff 异步调度器
- `packages/opencode/test/session/summary-scheduler.test.ts` — scheduler 合并、抢占、删除、可见性测试

### 后端修改

- `packages/opencode/src/session/session.ts` — 新增 `session.diff.status` event schema
- `packages/opencode/src/session/summary.ts` — 为后台调度提供 guard / cancelled 安全写回点
- `packages/opencode/src/session/prompt.ts` — 首轮 summary 改为 `markDirty`，并包裹前台 foreground 生命周期
- `packages/opencode/src/session/processor.ts` — finish-step summary 改为 `markDirty`
- `packages/opencode/src/server/routes/instance/session.ts` — 新增标准路由 `PUT /session/visibility`
- `packages/opencode/src/server/routes/instance/httpapi/session.ts` — 新增 HttpApi `visibility` endpoint
- `packages/opencode/test/session/summary.test.ts` — summary guard / stale-write 行为
- `packages/opencode/test/session/prompt.test.ts` — prompt 改为 scheduler.markDirty
- `packages/opencode/test/session/processor-effect.test.ts` — processor 改为 scheduler.markDirty
- `packages/opencode/test/server/httpapi-session.test.ts` — visibility endpoint 覆盖

### WebGUI 新增

- `packages/opencode/webgui/src/hooks/useSessionVisibilitySync.ts` — 将 open tabs + currentSession 同步给后端
- `packages/opencode/webgui/src/hooks/useSessionVisibilitySync.test.tsx` — 可见 session 同步测试
- `packages/opencode/webgui/src/components/FileChangesPanel.test.tsx` — Diff 轻提示 UI 测试

### WebGUI 修改

- `packages/opencode/webgui/src/App.tsx` — 接入 `useSessionVisibilitySync`
- `packages/opencode/webgui/src/lib/api/sdkClient.ts` — 新增 `sdk.session.syncVisible(...)`
- `packages/opencode/webgui/src/lib/api/events.ts` — 新增 `session.diff.status` 事件类型
- `packages/opencode/webgui/src/state/SessionContext.tsx` — 维护 `sessionDiffStatus` map 并响应 SSE
- `packages/opencode/webgui/src/components/MessageInput/FooterPanels.tsx` — 将 diff 状态传给文件变更面板
- `packages/opencode/webgui/src/components/MessageInput/FooterPanels.test.tsx` — 断言状态透传
- `packages/opencode/webgui/src/components/FileChangesPanel.tsx` — 面板内轻提示条 UI
- `packages/opencode/webgui/src/state/SessionContext.test.tsx` — diff 状态 map 的事件更新和删除清理

---

### Task 1: 建立后端 scheduler 骨架与状态事件

**Files:**

- Create: `packages/opencode/src/session/summary-scheduler.ts`
- Create: `packages/opencode/test/session/summary-scheduler.test.ts`
- Modify: `packages/opencode/src/session/session.ts`

- [ ] **Step 1: 先写 scheduler 失败测试**

```ts
import { describe, expect } from "bun:test"
import { Effect, Layer, Ref } from "effect"
import { SessionSummaryScheduler } from "../../src/session/summary-scheduler"
import { SessionSummary } from "../../src/session/summary"
import { Session } from "../../src/session"
import { Bus } from "../../src/bus"
import { MessageID, SessionID } from "../../src/session/schema"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const calls = { summarize: [] as string[] }

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: ({ sessionID }) =>
      Effect.sync(() => {
        calls.summarize.push(sessionID)
      }),
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
  }),
)

const env = Layer.mergeAll(Session.defaultLayer, Bus.layer, summary, SessionSummaryScheduler.defaultLayer)
const it = testEffect(env)

describe("SessionSummaryScheduler", () => {
  it.live("coalesces repeated dirty marks and reruns only once", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        calls.summarize = []
        const session = yield* Session.Service
        const scheduler = yield* SessionSummaryScheduler.Service
        const chat = yield* session.create({ title: "scheduler" })

        yield* scheduler.markDirty({ sessionID: chat.id, messageID: MessageID.ascending() })
        yield* scheduler.markDirty({ sessionID: chat.id, messageID: MessageID.ascending() })
        yield* scheduler.foregroundFinish()
        yield* scheduler.flush()

        expect(calls.summarize).toEqual([chat.id])
      }),
    ),
  )

  it.live("deleteSession drops pending work and publishes no stale completion", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        calls.summarize = []
        const session = yield* Session.Service
        const scheduler = yield* SessionSummaryScheduler.Service
        const chat = yield* session.create({ title: "delete" })

        yield* scheduler.markDirty({ sessionID: chat.id, messageID: MessageID.ascending() })
        yield* scheduler.deleteSession(chat.id)
        yield* scheduler.flush()

        expect(calls.summarize).toEqual([])
      }),
    ),
  )
})
```

- [ ] **Step 2: 运行新测试，确认当前失败**

Run: `bun run --cwd packages/opencode test test/session/summary-scheduler.test.ts`

Expected: FAIL，报 `Cannot find module '../../src/session/summary-scheduler'` 或缺少 `SessionSummaryScheduler` 导出。

- [ ] **Step 3: 新建 scheduler 服务和状态机骨架**

```ts
import { Context, Effect, Layer, Ref, Schema } from "effect"
import * as InstanceState from "@/effect/instance-state"
import { Bus } from "@/bus"
import * as Session from "./session"
import { MessageID, SessionID } from "./schema"
import { SessionSummary } from "./summary"

type SessionState = {
  dirty: boolean
  scheduled: boolean
  running: boolean
  rerunNeeded: boolean
  closed: boolean
  deleted: boolean
  version: number
  runVersion: number
  messageID?: MessageID
}

type State = {
  foregroundCount: number
  backgroundRunning: SessionID | null
  sessions: Map<SessionID, SessionState>
  visible: Set<SessionID>
}

export interface Interface {
  readonly markDirty: (input: { sessionID: SessionID; messageID: MessageID }) => Effect.Effect<void>
  readonly foregroundStart: () => Effect.Effect<void>
  readonly foregroundFinish: () => Effect.Effect<void>
  readonly syncVisible: (input: { sessionIDs: SessionID[] }) => Effect.Effect<void>
  readonly deleteSession: (sessionID: SessionID) => Effect.Effect<void>
  readonly flush: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionSummaryScheduler") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const summary = yield* SessionSummary.Service
    const bus = yield* Bus.Service
    const ref = yield* Ref.make<State>({
      foregroundCount: 0,
      backgroundRunning: null,
      sessions: new Map(),
      visible: new Set(),
    })

    const publishStatus = (
      sessionID: SessionID,
      status: "idle" | "scheduled" | "running" | "failed",
      message?: string,
    ) => bus.publish(Session.Event.DiffStatus, { sessionID, status, message })

    const ensure = (state: State, sessionID: SessionID) => {
      const current = state.sessions.get(sessionID)
      if (current) return current
      const next: SessionState = {
        dirty: false,
        scheduled: false,
        running: false,
        rerunNeeded: false,
        closed: true,
        deleted: false,
        version: 0,
        runVersion: 0,
      }
      state.sessions.set(sessionID, next)
      return next
    }

    const runNext = Effect.fn("SessionSummaryScheduler.runNext")(function* () {
      const state = yield* Ref.get(ref)
      if (state.foregroundCount > 0 || state.backgroundRunning) return
      const next = [...state.sessions.entries()].find(([, item]) => item.dirty && !item.closed && !item.deleted)
      if (!next) return
      const [sessionID, item] = next
      item.running = true
      item.scheduled = false
      item.runVersion = item.version
      state.backgroundRunning = sessionID
      yield* publishStatus(sessionID, "running")
      yield* summary
        .summarize({
          sessionID,
          messageID: item.messageID!,
          canWrite: () =>
            Ref.get(ref).pipe(
              Effect.map((latest) => {
                const current = latest.sessions.get(sessionID)
                return !!current && !current.deleted && current.runVersion === current.version
              }),
            ),
        })
        .pipe(
          Effect.catchAll((error) => publishStatus(sessionID, "failed", String(error))),
          Effect.ensuring(
            Ref.update(ref, (latest) => {
              const current = latest.sessions.get(sessionID)
              if (current) {
                current.running = false
                current.dirty = current.rerunNeeded
                current.rerunNeeded = false
                current.scheduled = current.dirty
              }
              latest.backgroundRunning = null
              return latest
            }),
          ),
        )
      yield* publishStatus(sessionID, "idle")
      yield* runNext
    })

    const markDirty = Effect.fn("SessionSummaryScheduler.markDirty")(function* (input: {
      sessionID: SessionID
      messageID: MessageID
    }) {
      yield* Ref.update(ref, (state) => {
        const item = ensure(state, input.sessionID)
        item.messageID = input.messageID
        item.version += 1
        item.dirty = true
        item.closed = !state.visible.has(input.sessionID)
        if (item.running) item.rerunNeeded = true
        else item.scheduled = true
        return state
      })
      yield* publishStatus(input.sessionID, "scheduled")
      yield* runNext
    })

    const foregroundStart = Ref.update(ref, (state) => ({ ...state, foregroundCount: state.foregroundCount + 1 }))
    const foregroundFinish = Ref.update(ref, (state) => ({
      ...state,
      foregroundCount: Math.max(0, state.foregroundCount - 1),
    })).pipe(Effect.zipRight(runNext))
    const syncVisible = Effect.fn("SessionSummaryScheduler.syncVisible")(function* (input: {
      sessionIDs: SessionID[]
    }) {
      yield* Ref.update(ref, (state) => {
        state.visible = new Set(input.sessionIDs)
        for (const [sessionID, item] of state.sessions) {
          item.closed = !state.visible.has(sessionID)
          if (!item.closed && item.dirty && !item.running) item.scheduled = true
        }
        return state
      })
      yield* runNext
    })
    const deleteSession = Effect.fn("SessionSummaryScheduler.deleteSession")(function* (sessionID: SessionID) {
      yield* Ref.update(ref, (state) => {
        const item = ensure(state, sessionID)
        item.deleted = true
        item.dirty = false
        item.scheduled = false
        state.visible.delete(sessionID)
        return state
      })
    })
    const flush = runNext

    return Service.of({
      markDirty,
      foregroundStart: () => foregroundStart,
      foregroundFinish: () => foregroundFinish,
      syncVisible,
      deleteSession,
      flush: () => flush,
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(SessionSummary.defaultLayer), Layer.provide(Bus.layer))
export * as SessionSummaryScheduler from "./summary-scheduler"
```

- [ ] **Step 4: 在 `session.ts` 增加 `session.diff.status` bus event**

```ts
  DiffStatus: BusEvent.define(
    "session.diff.status",
    Schema.Struct({
      sessionID: SessionID,
      status: Schema.Union(
        Schema.Literal("idle"),
        Schema.Literal("scheduled"),
        Schema.Literal("running"),
        Schema.Literal("failed"),
      ),
      message: Schema.optional(Schema.String),
    }),
  ),
```

- [ ] **Step 5: 运行 scheduler 测试，确认骨架通过**

Run: `bun run --cwd packages/opencode test test/session/summary-scheduler.test.ts`

Expected: PASS，至少包含 `coalesces repeated dirty marks` 与 `deleteSession drops pending work`。

- [ ] **Step 6: Commit**

```bash
git add packages/opencode/src/session/summary-scheduler.ts packages/opencode/src/session/session.ts packages/opencode/test/session/summary-scheduler.test.ts
git commit -m "refactor: add background diff scheduler skeleton"
```

### Task 2: 把 prompt / processor 的同步 summary 改为 markDirty

**Files:**

- Modify: `packages/opencode/src/session/prompt.ts`
- Modify: `packages/opencode/src/session/processor.ts`
- Modify: `packages/opencode/src/session/summary.ts`
- Modify: `packages/opencode/test/session/summary.test.ts`
- Modify: `packages/opencode/test/session/prompt.test.ts`
- Modify: `packages/opencode/test/session/processor-effect.test.ts`

- [ ] **Step 1: 先补失败测试，锁定不再直接调用 `summary.summarize()`**

```ts
it.live("debug disable summary test still keeps prompt path async by marking dirty", () =>
  provideTmpdirServer(({ url }) =>
    Effect.gen(function* () {
      const marked: Array<{ sessionID: SessionID; messageID: MessageID }> = []
      const scheduler = Layer.succeed(
        SessionSummaryScheduler.Service,
        SessionSummaryScheduler.Service.of({
          markDirty: (input) => Effect.sync(() => void marked.push(input)),
          foregroundStart: () => Effect.void,
          foregroundFinish: () => Effect.void,
          syncVisible: () => Effect.void,
          deleteSession: () => Effect.void,
          flush: () => Effect.void,
        }),
      )

      const prompt = yield* SessionPrompt.Service
      const session = yield* Session.Service
      const chat = yield* session.create({ title: "async prompt" })

      yield* prompt
        .prompt({
          sessionID: chat.id,
          parts: [{ type: "text", text: "继续" }],
          model: ref,
          agent: "build",
        })
        .pipe(Effect.provide(scheduler))

      expect(marked.length).toBeGreaterThan(0)
    }),
  ),
)
```

- [ ] **Step 2: 运行定向测试，确认当前失败**

Run: `bun run --cwd packages/opencode test --test-name-pattern "async by marking dirty" test/session/prompt.test.ts test/session/processor-effect.test.ts`

Expected: FAIL，因为 `SessionSummaryScheduler.Service` 还未注入，且 `prompt.ts` / `processor.ts` 仍直接 fork `summary.summarize()`。

- [ ] **Step 3: 修改 `prompt.ts`，在前台生命周期里 mark dirty**

```ts
const scheduler = yield * SessionSummaryScheduler.Service

const prompt: (input: PromptInput) => Effect.Effect<MessageV2.WithParts> = Effect.fn("SessionPrompt.prompt")(
  function* (input) {
    yield* scheduler.foregroundStart()
    yield* Effect.addFinalizer(() => scheduler.foregroundFinish())
    return yield* runLoop(input.sessionID)
  },
)

if (step === 1) {
  if (disableSummary) {
    yield *
      Effect.sync(() => {
        void trace.event({ tag: "summary.skipped", sessionID, meta: { reason: "disabled-in-prompt", step } })
      })
  } else {
    yield * scheduler.markDirty({ sessionID, messageID: lastUser.id })
  }
}
```

- [ ] **Step 4: 修改 `processor.ts`，在 finish-step 只 mark dirty**

```ts
const scheduler = yield * SessionSummaryScheduler.Service

if (disableSummary) {
  yield *
    Effect.sync(() => {
      void trace.event({
        tag: "summary.skipped",
        sessionID: ctx.sessionID,
        meta: { reason: "disabled-in-processor", messageID: ctx.assistantMessage.parentID },
      })
    })
} else {
  yield *
    scheduler.markDirty({
      sessionID: ctx.sessionID,
      messageID: ctx.assistantMessage.parentID,
    })
}
```

- [ ] **Step 5: 给 `summary.ts` 增加 `canWrite` guard，防止 stale/delete 回写**

```ts
export interface Interface {
  readonly summarize: (input: {
    sessionID: SessionID
    messageID: MessageID
    canWrite?: () => Effect.Effect<boolean>
  }) => Effect.Effect<void>
  readonly diff: (input: { sessionID: SessionID; messageID?: MessageID }) => Effect.Effect<Snapshot.FileDiff[]>
  readonly computeDiff: (input: { messages: MessageV2.WithParts[] }) => Effect.Effect<Snapshot.FileDiff[]>
}

const summarize = Effect.fn("SessionSummary.summarize")(function* (input) {
  const all = yield* sessions.messages({ sessionID: input.sessionID })
  if (!all.length) return
  const diffs = skipSummaryDiff ? [] : yield* computeDiff({ messages: all })
  const allowed = input.canWrite ? yield* input.canWrite() : true
  if (!allowed) return

  yield* sessions.setSummary({
    sessionID: input.sessionID,
    summary: {
      additions: diffs.reduce((sum, x) => sum + x.additions, 0),
      deletions: diffs.reduce((sum, x) => sum + x.deletions, 0),
      files: diffs.length,
    },
  })
  yield* storage.write(["session_diff", input.sessionID], diffs).pipe(Effect.ignore)
  yield* bus.publish(Session.Event.Diff, { sessionID: input.sessionID, diff: diffs })
})
```

- [ ] **Step 6: 把 defaultLayer 接上 scheduler**

```ts
export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(Session.defaultLayer),
    Layer.provide(Snapshot.defaultLayer),
    Layer.provide(Agent.defaultLayer),
    Layer.provide(LLM.defaultLayer),
    Layer.provide(Permission.defaultLayer),
    Layer.provide(Plugin.defaultLayer),
    Layer.provide(SessionSummary.defaultLayer),
    Layer.provide(SessionSummaryScheduler.defaultLayer),
    Layer.provide(SessionStatus.defaultLayer),
    Layer.provide(Bus.layer),
    Layer.provide(Config.defaultLayer),
  ),
)
```

- [ ] **Step 7: 跑后端定向测试**

Run:

`bun run --cwd packages/opencode test test/session/summary-scheduler.test.ts test/session/summary.test.ts`

`bun run --cwd packages/opencode test --test-name-pattern "async by marking dirty|debug disable summary" test/session/prompt.test.ts test/session/processor-effect.test.ts`

Expected: PASS，旧的 `summary.skipped` 调试开关测试仍通过，新增 `markDirty` 断言通过。

- [ ] **Step 8: Commit**

```bash
git add packages/opencode/src/session/prompt.ts packages/opencode/src/session/processor.ts packages/opencode/src/session/summary.ts packages/opencode/test/session/summary.test.ts packages/opencode/test/session/prompt.test.ts packages/opencode/test/session/processor-effect.test.ts
git commit -m "refactor: move session diff refresh off prompt path"
```

### Task 3: 增加可见 session 同步接口，并把标签可见性同步到后端

**Files:**

- Modify: `packages/opencode/src/server/routes/instance/session.ts`
- Modify: `packages/opencode/src/server/routes/instance/httpapi/session.ts`
- Modify: `packages/opencode/test/server/httpapi-session.test.ts`
- Modify: `packages/opencode/webgui/src/lib/api/sdkClient.ts`
- Create: `packages/opencode/webgui/src/hooks/useSessionVisibilitySync.ts`
- Create: `packages/opencode/webgui/src/hooks/useSessionVisibilitySync.test.tsx`
- Modify: `packages/opencode/webgui/src/App.tsx`

- [ ] **Step 1: 先补 route / hook 的失败测试**

```ts
test("updates visible sessions through HttpApi visibility endpoint", async () => {
  await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
  const headers = { "x-opencode-directory": tmp.path, "content-type": "application/json" }

  const response = await app().request(SessionPaths.visibility, {
    method: "PUT",
    headers,
    body: JSON.stringify({ sessionIDs: ["ses_visible_a", "ses_visible_b"] }),
  })

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ sessionIDs: ["ses_visible_a", "ses_visible_b"] })
})
```

```tsx
import { describe, it, expect, vi } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { useSessionVisibilitySync } from "./useSessionVisibilitySync"
import { sdk } from "../lib/api/sdkClient"

vi.mock("../lib/api/sdkClient", () => ({
  sdk: { session: { syncVisible: vi.fn().mockResolvedValue({ data: { sessionIDs: ["s1"] }, error: null }) } },
}))

describe("useSessionVisibilitySync", () => {
  it("syncs open tabs plus current session as a sorted unique set", async () => {
    renderHook(() =>
      useSessionVisibilitySync({
        loaded: true,
        openTabs: ["s2", "s1", "s2"],
        currentSessionID: "s3",
      }),
    )

    await waitFor(() => {
      expect(sdk.session.syncVisible).toHaveBeenCalledWith({ body: { sessionIDs: ["s1", "s2", "s3"] } })
    })
  })
})
```

- [ ] **Step 2: 运行这些测试，确认当前失败**

Run:

`bun run --cwd packages/opencode test --test-name-pattern "visibility endpoint" test/server/httpapi-session.test.ts`

`bun run --cwd packages/opencode/webgui test:run src/hooks/useSessionVisibilitySync.test.tsx`

Expected: FAIL，因为路由、SDK wrapper、hook 都还不存在。

- [ ] **Step 3: 后端新增 `PUT /session/visibility` 接口**

```ts
const VisibilityPayload = Schema.Struct({
  sessionIDs: Schema.Array(SessionID),
}).annotate({ identifier: "SessionVisibilityInput" })

export const SessionPaths = {
  // ...existing paths
  visibility: `${root}/visibility`,
} as const

HttpApiEndpoint.put("visibility", SessionPaths.visibility, {
  payload: VisibilityPayload,
  success: Schema.Struct({ sessionIDs: Schema.Array(SessionID) }),
})
```

```ts
.put(
  "/visibility",
  validator("json", z.object({ sessionIDs: z.array(SessionID.zod) })),
  async (c) =>
    jsonRequest("SessionRoutes.visibility", c, function* () {
      const scheduler = yield* SessionSummaryScheduler.Service
      const body = c.req.valid("json")
      yield* scheduler.syncVisible({ sessionIDs: body.sessionIDs })
      return { sessionIDs: body.sessionIDs }
    }),
)
```

- [ ] **Step 4: 在 WebGUI 侧加 SDK wrapper 和同步 hook**

```ts
session: Object.assign(baseClient.session, {
  list: sessionList,
  regenerateTitle: sessionRegenerateTitle,
  syncVisible: async (options: { body: { sessionIDs: string[] } }) => {
    const response = await fetch("/session/visibility", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options.body),
    })
    if (!response.ok) {
      return { error: { message: "Failed to sync visible sessions" }, data: null }
    }
    return { data: (await response.json()) as { sessionIDs: string[] }, error: null }
  },
})
```

```ts
import { useEffect, useMemo, useRef } from "react"
import { sdk } from "../lib/api/sdkClient"

export function useSessionVisibilitySync(input: {
  loaded: boolean
  openTabs: string[]
  currentSessionID: string | null
}) {
  const last = useRef("")
  const sessionIDs = useMemo(() => {
    return [...new Set([...input.openTabs, ...(input.currentSessionID ? [input.currentSessionID] : [])])].sort()
  }, [input.currentSessionID, input.openTabs])

  useEffect(() => {
    if (!input.loaded) return
    const key = sessionIDs.join("\n")
    if (key === last.current) return
    last.current = key
    void sdk.session.syncVisible({ body: { sessionIDs } })
  }, [input.loaded, sessionIDs])
}
```

```tsx
useSessionVisibilitySync({
  loaded: tabStore.loaded,
  openTabs: tabStore.openTabs,
  currentSessionID: currentSession?.id ?? null,
})
```

- [ ] **Step 5: 运行 route + hook 测试**

Run:

`bun run --cwd packages/opencode test --test-name-pattern "visibility endpoint" test/server/httpapi-session.test.ts`

`bun run --cwd packages/opencode/webgui test:run src/hooks/useSessionVisibilitySync.test.tsx`

Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add packages/opencode/src/server/routes/instance/session.ts packages/opencode/src/server/routes/instance/httpapi/session.ts packages/opencode/test/server/httpapi-session.test.ts packages/opencode/webgui/src/lib/api/sdkClient.ts packages/opencode/webgui/src/hooks/useSessionVisibilitySync.ts packages/opencode/webgui/src/hooks/useSessionVisibilitySync.test.tsx packages/opencode/webgui/src/App.tsx
git commit -m "feat: sync visible sessions for async diff refresh"
```

### Task 4: 把 `session.diff.status` 接到 SessionContext 和 Diff 面板轻提示

**Files:**

- Modify: `packages/opencode/webgui/src/lib/api/events.ts`
- Modify: `packages/opencode/webgui/src/state/SessionContext.tsx`
- Modify: `packages/opencode/webgui/src/state/SessionContext.test.tsx`
- Modify: `packages/opencode/webgui/src/components/MessageInput/FooterPanels.tsx`
- Modify: `packages/opencode/webgui/src/components/MessageInput/FooterPanels.test.tsx`
- Modify: `packages/opencode/webgui/src/components/FileChangesPanel.tsx`
- Create: `packages/opencode/webgui/src/components/FileChangesPanel.test.tsx`

- [ ] **Step 1: 先补失败测试，锁定状态 map 与轻提示 UI**

```tsx
it("updates diff status map from session.diff.status and clears it on session.deleted", async () => {
  const { result } = renderHook(() => useSession(), { wrapper })

  act(() => {
    events.emit("session.diff.status", {
      type: "session.diff.status",
      properties: { sessionID: "s1", status: "running" },
    })
  })

  await waitFor(() => {
    expect(result.current.sessionDiffStatus["s1"]).toEqual({ state: "updating" })
  })

  act(() => {
    events.emit("session.deleted", {
      type: "session.deleted",
      properties: { info: { id: "s1" } },
    })
  })

  await waitFor(() => {
    expect(result.current.sessionDiffStatus["s1"]).toBeUndefined()
  })
})
```

```tsx
it("shows updating and failed banner inside file changes panel", () => {
  const diffs = [{ file: "src/a.ts", before: "", after: "x", additions: 1, deletions: 0 }]
  const { rerender } = render(<FileChangesPanel diffs={diffs} status={{ state: "updating" }} />)
  expect(screen.getByText("差异仍在后台刷新，当前显示的是上一版结果")).toBeInTheDocument()

  rerender(<FileChangesPanel diffs={diffs} status={{ state: "failed", message: "刷新失败，将在空闲后重试" }} />)
  expect(screen.getByText("刷新失败，将在空闲后重试")).toBeInTheDocument()
})
```

- [ ] **Step 2: 运行这些 WebGUI 测试，确认当前失败**

Run: `bun run --cwd packages/opencode/webgui test:run src/state/SessionContext.test.tsx src/components/MessageInput/FooterPanels.test.tsx src/components/FileChangesPanel.test.tsx`

Expected: FAIL，因为 `session.diff.status` 类型、`sessionDiffStatus` state、`FileChangesPanel` 新 props 都还不存在。

- [ ] **Step 3: 扩展事件类型和 SessionContext 状态**

```ts
export type ServerEvent =
  | { type: "session.diff"; properties: { sessionID: string; diff: FileDiff[] } }
  | {
      type: "session.diff.status"
      properties: { sessionID: string; status: "idle" | "scheduled" | "running" | "failed"; message?: string }
    }
```

```ts
type SessionDiffStatus = {
  state: "updating" | "latest" | "failed"
  message?: string
}

interface SessionContextState {
  // ...existing fields
  sessionDiffStatus: Record<string, SessionDiffStatus>
}

const [sessionDiffStatusMap, setSessionDiffStatusMap] = useState<Record<string, SessionDiffStatus>>({})

const handleSessionDiff = (event: any) => {
  if (event.type !== "session.diff" || !event.properties) return
  const { sessionID, diff } = event.properties as { sessionID: string; diff: FileDiff[] }
  setSessionDiffMap((prev) => ({ ...prev, [sessionID]: Array.isArray(diff) ? diff : [] }))
  setSessionDiffStatusMap((prev) => ({ ...prev, [sessionID]: { state: "latest" } }))
}

const handleSessionDiffStatus = (event: any) => {
  if (event.type !== "session.diff.status" || !event.properties) return
  const { sessionID, status, message } = event.properties as {
    sessionID: string
    status: "idle" | "scheduled" | "running" | "failed"
    message?: string
  }
  setSessionDiffStatusMap((prev) => ({
    ...prev,
    [sessionID]:
      status === "failed"
        ? { state: "failed", message: message ?? "刷新失败，将在空闲后重试" }
        : status === "idle"
          ? { state: "latest" }
          : { state: "updating" },
  }))
}
```

- [ ] **Step 4: 给 `FileChangesPanel` / `FooterPanels` 增加轻提示**

```tsx
interface FileChangesPanelProps {
  diffs?: FileDiff[]
  fallbackFiles?: string[]
  status?: { state: "updating" | "latest" | "failed"; message?: string }
}

{
  status?.state === "updating" && (
    <div className="px-3 py-2 text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-900/40">
      差异仍在后台刷新，当前显示的是上一版结果
    </div>
  )
}
{
  status?.state === "failed" && (
    <div className="px-3 py-2 text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/30 border-b border-red-200 dark:border-red-900/40">
      {status.message ?? "刷新失败，将在空闲后重试"}
    </div>
  )
}
{
  status?.state === "latest" && (
    <div className="px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 border-b border-emerald-200 dark:border-emerald-900/40">
      已是最新结果
    </div>
  )
}
```

```tsx
const { sessionDiff, sessionDiffStatus } = useSession()
const diffStatus = sessionID ? sessionDiffStatus[sessionID] : undefined

{
  filesExpanded && hasFiles && <FileChangesPanel diffs={diffs} fallbackFiles={modifiedFiles} status={diffStatus} />
}
```

- [ ] **Step 5: 运行 WebGUI 测试**

Run: `bun run --cwd packages/opencode/webgui test:run src/state/SessionContext.test.tsx src/components/MessageInput/FooterPanels.test.tsx src/components/FileChangesPanel.test.tsx`

Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add packages/opencode/webgui/src/lib/api/events.ts packages/opencode/webgui/src/state/SessionContext.tsx packages/opencode/webgui/src/state/SessionContext.test.tsx packages/opencode/webgui/src/components/MessageInput/FooterPanels.tsx packages/opencode/webgui/src/components/MessageInput/FooterPanels.test.tsx packages/opencode/webgui/src/components/FileChangesPanel.tsx packages/opencode/webgui/src/components/FileChangesPanel.test.tsx
git commit -m "feat: show async diff refresh status in file changes panel"
```

### Task 5: 完成回归验证与人工 smoke test

**Files:**

- Modify as needed: `packages/opencode/src/session/summary-scheduler.ts`
- Modify as needed: `packages/opencode/webgui/src/state/SessionContext.tsx`
- Modify as needed: `packages/opencode/webgui/src/components/FileChangesPanel.tsx`

- [ ] **Step 1: 跑后端完整定向回归**

Run:

`bun run --cwd packages/opencode test test/session/summary-scheduler.test.ts test/session/summary.test.ts test/server/httpapi-session.test.ts`

`bun run --cwd packages/opencode test --test-name-pattern "marking dirty|debug disable summary|visibility endpoint" test/session/prompt.test.ts test/session/processor-effect.test.ts test/server/httpapi-session.test.ts`

Expected: PASS。

- [ ] **Step 2: 跑 WebGUI 定向回归**

Run:

`bun run --cwd packages/opencode/webgui test:run src/hooks/useSessionVisibilitySync.test.tsx src/components/FileChangesPanel.test.tsx src/components/MessageInput/FooterPanels.test.tsx src/state/SessionContext.test.tsx`

Expected: PASS。

- [ ] **Step 3: 跑类型检查 / 构建验证**

Run:

`bun run --cwd packages/opencode typecheck`

`bun run --cwd packages/opencode/webgui build`

Expected: 两条命令都成功结束，无 TypeScript 错误。

- [ ] **Step 4: 手工 smoke test 真实交互**

```text
1. 打开 WebGUI，进入长上下文会话，发送“继续”。
2. 确认聊天回复先正常返回，不再等待 100s+ summary 尾段。
3. 同时切到另一个短会话，再发一条普通消息，确认不再被长会话拖慢。
4. 在长会话后台 Diff 刷新期间关闭该标签，确认文件变更面板不再继续刷新到最新。
5. 重新打开该标签，确认文件变更面板恢复“更新中”后最终到“已是最新结果”。
6. 在后台 Diff 待刷新时删除会话，确认不会再收到该 session 的幽灵 diff 更新。
```

- [ ] **Step 5: 收尾 commit**

```bash
git add packages/opencode/src/session/summary-scheduler.ts packages/opencode/src/session/prompt.ts packages/opencode/src/session/processor.ts packages/opencode/src/session/summary.ts packages/opencode/src/server/routes/instance/session.ts packages/opencode/src/server/routes/instance/httpapi/session.ts packages/opencode/src/session/session.ts packages/opencode/webgui/src/App.tsx packages/opencode/webgui/src/lib/api/sdkClient.ts packages/opencode/webgui/src/lib/api/events.ts packages/opencode/webgui/src/state/SessionContext.tsx packages/opencode/webgui/src/components/MessageInput/FooterPanels.tsx packages/opencode/webgui/src/components/FileChangesPanel.tsx packages/opencode/test/session/summary-scheduler.test.ts packages/opencode/test/session/summary.test.ts packages/opencode/test/session/prompt.test.ts packages/opencode/test/session/processor-effect.test.ts packages/opencode/test/server/httpapi-session.test.ts packages/opencode/webgui/src/hooks/useSessionVisibilitySync.ts packages/opencode/webgui/src/hooks/useSessionVisibilitySync.test.tsx packages/opencode/webgui/src/components/FileChangesPanel.test.tsx packages/opencode/webgui/src/components/MessageInput/FooterPanels.test.tsx packages/opencode/webgui/src/state/SessionContext.test.tsx
git commit -m "fix: move diff refresh to background scheduler"
```

## 自检

- Spec coverage：计划覆盖了异步调度、前台优先、latest-wins、关闭标签、删除会话、Diff 面板轻提示、测试与手工验证。
- Placeholder scan：无 `TODO` / `TBD` / “后续补” 占位词。
- Type consistency：计划内统一使用 `SessionSummaryScheduler`、`session.diff.status`、`syncVisible`、`sessionDiffStatus` 这些命名。
