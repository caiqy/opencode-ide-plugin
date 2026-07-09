# 文件写入工具的实时流式预览 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 webgui 在 write / edit / apply_patch 工具执行期间，header 实时显示已接收行数，展开区实时显示流入的内容，告别"长时间空白卡片"。

**Architecture:** LLM 流式管线已存在 `tool-input-delta` 事件，processor 当前丢弃。改动两处：(1) processor 把 delta 累积到现成的 `state.raw` 字段，(2) webgui 在 pending 状态下用 partial-json 解析 `state.raw`，渲染 header 行数与内容预览。前端用 `useDeferredValue` 处理高频更新。

**Tech Stack:** TypeScript / Effect / React 19 / Vitest+jsdom / partial-json@0.1.7（仓库已声明）

**Spec:** `docs/superpowers/specs/2026-05-26-streaming-file-write-preview-design.md`

---

## 文件结构

| 操作 | 路径                                                                              | 职责                                                  |
| ---- | --------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 改   | `packages/opencode/src/session/processor.ts`                                      | `tool-input-delta` 分支累积到 `state.raw`，限定三件套 |
| 新   | `packages/opencode/src/session/streamable-tools.ts`                               | 共享常量 `STREAMABLE_TOOLS`，避免前后端漂移           |
| 新   | `packages/opencode/webgui/src/lib/partial-tool-input.ts`                          | partial JSON 解析、行数统计纯函数                     |
| 新   | `packages/opencode/webgui/src/components/parts/ToolPart/usePartialToolInput.ts`   | hook，含 `useDeferredValue` 节流                      |
| 改   | `packages/opencode/webgui/src/components/parts/ToolPart/index.tsx`                | 串联 partialInput / 行数 / 自动展开 / type 补 raw     |
| 新   | `packages/opencode/test/session/processor-streaming-input.test.ts`                | processor 累积测试                                    |
| 新   | `packages/opencode/webgui/src/lib/partial-tool-input.test.ts`                     | 解析与计数测试                                        |
| 新   | `packages/opencode/webgui/src/components/parts/ToolPart/index.streaming.test.tsx` | UI 渲染测试                                           |

DRY 关键：白名单只在一处定义（`streamable-tools.ts`），前后端各自 import。

---

## Task 1: 共享常量

**Files:**

- Create: `packages/opencode/src/session/streamable-tools.ts`

- [ ] **Step 1.1: 写共享常量文件**

```ts
// packages/opencode/src/session/streamable-tools.ts

/**
 * Tools whose `tool-input-delta` events should be accumulated into
 * `ToolStatePending.raw` so clients can render partial input while it is
 * still being streamed.
 *
 * Limited to write-class tools where args may be large (file content,
 * patches). Adding a tool here is cheap; both the session processor and
 * the webgui import this constant.
 */
export const STREAMABLE_TOOLS = new Set<string>(["write", "edit", "apply_patch"])
```

- [ ] **Step 1.2: 提交**

```bash
git add packages/opencode/src/session/streamable-tools.ts
git commit -m "feat(session): add STREAMABLE_TOOLS shared constant"
```

---

## Task 2: Processor 累积 delta 到 state.raw（TDD）

**Files:**

- Modify: `packages/opencode/src/session/processor.ts:377-380`
- Create: `packages/opencode/test/session/processor-streaming-input.test.ts`

- [ ] **Step 2.1: 写失败测试**

新文件 `packages/opencode/test/session/processor-streaming-input.test.ts`：

```ts
import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { Image } from "@/image/image"
import { Permission } from "@/permission"
import { Plugin } from "@/plugin"
import { Provider } from "@/provider/provider"
import { Session } from "@/session/session"
import { LLM } from "@/session/llm"
import { SessionProcessor } from "@/session/processor"
import { SessionStatus } from "@/session/status"
import { SessionSummary } from "@/session/summary"
import { SessionSummaryScheduler } from "@/session/summary-scheduler"
import { Snapshot } from "@/snapshot"
import { Agent as AgentSvc } from "@/agent/agent"
import { SyncEvent } from "@/sync"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { reply, TestLLMServer } from "../lib/llm-server"
import { testEffect } from "../lib/effect"
import { provideTmpdirServer } from "../fixture/fixture"

const summaryStub = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
  }),
)

const schedulerStub = Layer.succeed(
  SessionSummaryScheduler.Service,
  SessionSummaryScheduler.Service.of({
    markDirty: () => Effect.void,
    foregroundStart: () => Effect.void,
    foregroundFinish: () => Effect.void,
    syncVisible: () => Effect.void,
    deleteSession: () => Effect.void,
    flush: () => Effect.void,
  }),
)

const status = SessionStatus.layer.pipe(Layer.provideMerge(Bus.layer))
const infra = Layer.mergeAll(NodeFileSystem.layer, CrossSpawnSpawner.defaultLayer)
const deps = Layer.mergeAll(
  Session.defaultLayer,
  Snapshot.defaultLayer,
  AgentSvc.defaultLayer,
  Permission.defaultLayer,
  Plugin.defaultLayer,
  Config.defaultLayer,
  LLM.defaultLayer,
  Provider.defaultLayer,
  status,
  SyncEvent.defaultLayer,
  EventV2Bridge.defaultLayer,
).pipe(Layer.provideMerge(infra))

const env = Layer.mergeAll(
  TestLLMServer.layer,
  SessionProcessor.layer.pipe(
    Layer.provide(schedulerStub),
    Layer.provide(summaryStub),
    Layer.provide(Image.defaultLayer),
    Layer.provide(RuntimeFlags.layer({ experimentalEventSystem: true })),
    Layer.provide(AppFileSystem.defaultLayer),
    Layer.provideMerge(deps),
  ),
)

const it = testEffect(env)

it.live("accumulates tool-input-delta into state.raw for write tool", () =>
  provideTmpdirServer(({ llm }) =>
    Effect.gen(function* () {
      llm.queue(reply().pendingTool("write", { filePath: "/tmp/x.txt", content: "hello world" }).item())

      // pendingTool sends tool-start + half args then hangs; observe state
      const session = yield* Session.Service
      const chat = yield* session.create({ title: "streaming-input" })
      yield* session.prompt({ sessionID: chat.id, parts: [{ type: "text", text: "go" }] })

      // Wait until a pending tool part appears with non-empty raw
      const part = yield* pollUntilToolPending(chat.id)

      expect(part.state.status).toBe("pending")
      expect((part.state as { raw: string }).raw.length).toBeGreaterThan(0)
      // Half the args of {"filePath":"/tmp/x.txt","content":"hello world"}
      expect((part.state as { raw: string }).raw.startsWith("{")).toBe(true)
    }),
  ),
)

// Helper: poll the message store until a tool part is in pending with raw filled
const pollUntilToolPending = Effect.fn("pollUntilToolPending")(function* (sessionID: string) {
  const session = yield* Session.Service
  for (let i = 0; i < 50; i++) {
    const messages = yield* session.messages(sessionID as any)
    for (const msg of messages) {
      for (const part of msg.parts) {
        if (part.type === "tool" && part.state.status === "pending" && (part.state as { raw: string }).raw) {
          return part as Extract<typeof part, { type: "tool" }>
        }
      }
    }
    yield* Effect.sleep("50 millis")
  }
  throw new Error("no pending tool part with raw observed within 2.5s")
})
```

注意 `pollUntilToolPending` 是 superpowers 测试规范要求的"等待发布信号"模式（`AGENTS.md` 同步并发节）。`pendingTool` 发完 toolStart + 半段 args 后挂起，processor 收到 tool-input-start + tool-input-delta（半段）后会让 part 处于 pending、raw 累积；测试观察这个状态即可。

- [ ] **Step 2.2: 跑测试，确认失败**

```bash
cd packages/opencode
bun test test/session/processor-streaming-input.test.ts
```

预期：FAIL — `raw.length` 为 0，因为 processor.ts:377-380 当前丢弃 delta。

- [ ] **Step 2.3: 改 processor.ts**

定位 `packages/opencode/src/session/processor.ts:377-380`，把：

```ts
case "tool-input-delta":
  // AI SDK emits a final `tool-call` with the parsed `input`; accumulating
  // delta fragments into `state.raw` is redundant work for no current consumer.
  return
```

改为：

```ts
case "tool-input-delta": {
  if (!STREAMABLE_TOOLS.has(value.name)) return
  yield* ensureToolCall({ id: value.id, name: value.name, providerExecuted: false })
  yield* updateToolCall(value.id, (match) => {
    if (match.state.status !== "pending") return match
    return {
      ...match,
      state: { ...match.state, raw: match.state.raw + value.text },
    }
  })
  return
}
```

文件顶部 import 区加：

```ts
import { STREAMABLE_TOOLS } from "./streamable-tools"
```

注意：`ensureToolCall` 入参看 `processor.ts:248-259` 的现有签名，对应 `tool-input-start` 入参类型；如果该签名要求 `providerExecuted` 必填则保留，反之删掉那行。

- [ ] **Step 2.4: 跑测试，确认通过**

```bash
cd packages/opencode
bun test test/session/processor-streaming-input.test.ts
```

预期：PASS。

- [ ] **Step 2.5: 跑全量 processor 测试，确认无回归**

```bash
cd packages/opencode
bun test test/session/processor-effect.test.ts
```

预期：全部 PASS。

- [ ] **Step 2.6: 提交**

```bash
git add packages/opencode/src/session/processor.ts packages/opencode/test/session/processor-streaming-input.test.ts
git commit -m "feat(session): accumulate tool-input-delta into state.raw for write/edit/apply_patch"
```

---

## Task 3: Webgui partial JSON 解析模块（TDD）

**Files:**

- Create: `packages/opencode/webgui/src/lib/partial-tool-input.ts`
- Create: `packages/opencode/webgui/src/lib/partial-tool-input.test.ts`

- [ ] **Step 3.1: 写失败测试**

新文件 `packages/opencode/webgui/src/lib/partial-tool-input.test.ts`：

```ts
import { describe, it, expect } from "vitest"
import { parsePartialInput, countLines } from "./partial-tool-input"

describe("parsePartialInput", () => {
  it("returns empty object for empty input", () => {
    expect(parsePartialInput("")).toEqual({})
  })

  it("returns empty object for unparseable head", () => {
    expect(parsePartialInput("not json")).toEqual({})
  })

  it("returns empty object for half-written field name", () => {
    expect(parsePartialInput('{"fil')).toEqual({})
  })

  it("recovers full field when closed", () => {
    expect(parsePartialInput('{"filePath":"/tmp/a.ts"}')).toEqual({ filePath: "/tmp/a.ts" })
  })

  it("recovers partial trailing string", () => {
    const out = parsePartialInput('{"filePath":"/tmp/a.ts","content":"line 1\\nlin')
    expect(out.filePath).toBe("/tmp/a.ts")
    expect(typeof out.content).toBe("string")
    expect((out.content as string).startsWith("line 1\n")).toBe(true)
  })

  it("preserves boolean and number fields", () => {
    expect(parsePartialInput('{"replaceAll":true,"count":42}')).toEqual({ replaceAll: true, count: 42 })
  })

  it("returns empty object on null result", () => {
    expect(parsePartialInput("null")).toEqual({})
  })
})

describe("countLines", () => {
  it("returns 0 for non-string or empty", () => {
    expect(countLines(undefined)).toBe(0)
    expect(countLines(null)).toBe(0)
    expect(countLines(42)).toBe(0)
    expect(countLines("")).toBe(0)
  })

  it("counts lines including trailing newline", () => {
    expect(countLines("a")).toBe(1)
    expect(countLines("a\nb")).toBe(2)
    expect(countLines("a\nb\n")).toBe(3)
    expect(countLines("\n\n\n")).toBe(4)
  })
})
```

- [ ] **Step 3.2: 跑测试，确认失败**

```bash
cd packages/opencode/webgui
bun run test:run src/lib/partial-tool-input.test.ts
```

预期：FAIL — 模块不存在。

- [ ] **Step 3.3: 写实现**

新文件 `packages/opencode/webgui/src/lib/partial-tool-input.ts`：

```ts
import { parse, Allow } from "partial-json"

const ALLOWED = Allow.STR | Allow.OBJ | Allow.ARR

/**
 * Best-effort parse of a possibly-truncated JSON object emitted by an LLM
 * mid-stream. Returns the recovered fields, dropping anything that can't be
 * salvaged (half-typed field names, NaN, etc.). Always returns a plain object;
 * never throws.
 */
export function parsePartialInput(raw: string): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = parse(raw, ALLOWED)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/**
 * Count newline-separated lines in a string. Empty / non-string inputs return
 * 0 so the caller can treat "no value yet" and "0 lines" identically.
 */
export function countLines(value: unknown): number {
  if (typeof value !== "string" || value.length === 0) return 0
  let count = 1
  for (let i = 0; i < value.length; i++) if (value.charCodeAt(i) === 10) count++
  return count
}
```

- [ ] **Step 3.4: 跑测试，确认通过**

```bash
cd packages/opencode/webgui
bun run test:run src/lib/partial-tool-input.test.ts
```

预期：PASS。

- [ ] **Step 3.5: 提交**

```bash
git add packages/opencode/webgui/src/lib/partial-tool-input.ts packages/opencode/webgui/src/lib/partial-tool-input.test.ts
git commit -m "feat(webgui): add partial JSON parser for streaming tool args"
```

---

## Task 4: usePartialToolInput hook

**Files:**

- Create: `packages/opencode/webgui/src/components/parts/ToolPart/usePartialToolInput.ts`

- [ ] **Step 4.1: 写实现**

```ts
// packages/opencode/webgui/src/components/parts/ToolPart/usePartialToolInput.ts
import { useDeferredValue, useMemo } from "react"
import { parsePartialInput } from "../../../lib/partial-tool-input"

const STREAMABLE = new Set(["write", "edit", "apply_patch"])

/**
 * In `pending` status, returns a best-effort parse of the streaming
 * tool args from `state.raw`. Returns `null` outside of pending or for
 * non-streamable tools — callers can fall back to `state.input`.
 *
 * Uses `useDeferredValue` so a flood of `part.updated` events (each LLM
 * delta) is folded into a low-priority render queue, keeping scroll and
 * input interactions snappy.
 */
export function usePartialToolInput(
  tool: string,
  status: string,
  raw: string | undefined,
): Record<string, unknown> | null {
  const deferredRaw = useDeferredValue(raw ?? "")
  return useMemo(() => {
    if (status !== "pending") return null
    if (!STREAMABLE.has(tool)) return null
    if (!deferredRaw) return null
    return parsePartialInput(deferredRaw)
  }, [status, tool, deferredRaw])
}
```

注：`STREAMABLE` 这里写一份字面量，与后端 `STREAMABLE_TOOLS` 各占一份。前端不便直接 import 后端 src/，因此通过 spec 的"风险"条目记入：新增工具时两处都要加。

- [ ] **Step 4.2: 提交（无单测，下一任务的 UI 测试间接覆盖）**

```bash
git add packages/opencode/webgui/src/components/parts/ToolPart/usePartialToolInput.ts
git commit -m "feat(webgui): add usePartialToolInput hook"
```

---

## Task 5: ToolPart UI 串联（TDD）

**Files:**

- Modify: `packages/opencode/webgui/src/components/parts/ToolPart/index.tsx`
- Create: `packages/opencode/webgui/src/components/parts/ToolPart/index.streaming.test.tsx`

- [ ] **Step 5.1: 写失败测试**

新文件 `packages/opencode/webgui/src/components/parts/ToolPart/index.streaming.test.tsx`：

```tsx
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { ToolPart } from "./index"
import { PartOpenProvider } from "../../MessageList/PartOpenContext"
import { MessagesProvider } from "../../../state/MessagesContext"

function renderWithProviders(part: any) {
  return render(
    <MessagesProvider>
      <PartOpenProvider items={[{ type: "tool", id: part.id, tool: part.tool, status: part.state.status }]}>
        <ToolPart part={part} sessionID="ses_test" messageID="msg_test" />
      </PartOpenProvider>
    </MessagesProvider>,
  )
}

describe("ToolPart streaming preview", () => {
  it("shows received line count in header for pending write with raw content", () => {
    const part = {
      id: "prt_w1",
      type: "tool" as const,
      callID: "call_1",
      tool: "write",
      state: {
        status: "pending" as const,
        input: {},
        raw: '{"filePath":"/tmp/a.ts","content":"line1\\nline2\\nline3 unfinish',
      },
    }
    renderWithProviders(part)
    expect(screen.getByText(/已接收\s*3\s*行/)).toBeTruthy()
  })

  it("renders partial content under WriteTool when pending", () => {
    const part = {
      id: "prt_w2",
      type: "tool" as const,
      callID: "call_2",
      tool: "write",
      state: {
        status: "pending" as const,
        input: {},
        raw: '{"filePath":"/tmp/a.ts","content":"hello\\nworld',
      },
    }
    renderWithProviders(part)
    // WriteTool prefixes each line with "+"
    expect(screen.getByText(/\+hello/)).toBeTruthy()
  })

  it("does not show line count for read tool (not streamable)", () => {
    const part = {
      id: "prt_r1",
      type: "tool" as const,
      callID: "call_3",
      tool: "read",
      state: {
        status: "pending" as const,
        input: {},
        raw: '{"filePath":"/tmp/a.ts"}',
      },
    }
    renderWithProviders(part)
    expect(screen.queryByText(/已接收/)).toBeNull()
  })

  it("falls back to completed input/diff after status change", () => {
    const part = {
      id: "prt_w3",
      type: "tool" as const,
      callID: "call_4",
      tool: "write",
      state: {
        status: "completed" as const,
        input: { filePath: "/tmp/a.ts", content: "done\nfinal" },
        output: "Wrote file successfully.",
        title: "a.ts",
        metadata: {},
        time: { start: 1, end: 2 },
      },
    }
    renderWithProviders(part)
    // No streaming line count
    expect(screen.queryByText(/已接收/)).toBeNull()
    // Final content visible
    expect(screen.getByText(/\+done/)).toBeTruthy()
  })
})
```

如 `MessagesProvider` 的 default props 不接受裸用法，请先在测试 `setup.ts` 中复用现有 mock pattern——查 `webgui/src/test/setup.ts` 与现存 `*.test.tsx` 看其他测试是怎么提供 `MessagesProvider` 的，照抄。

- [ ] **Step 5.2: 跑测试，确认失败**

```bash
cd packages/opencode/webgui
bun run test:run src/components/parts/ToolPart/index.streaming.test.tsx
```

预期：FAIL — pending 状态下没有行数文本，partial content 也不渲染。

- [ ] **Step 5.3: 改 ToolPart/index.tsx**

定位 `packages/opencode/webgui/src/components/parts/ToolPart/index.tsx`。

(a) 顶部 import 区加：

```ts
import { usePartialToolInput } from "./usePartialToolInput"
import { countLines } from "../../../lib/partial-tool-input"
```

(b) 内联 `state` 类型补 `raw` 字段（约第 29-47 行）：

```ts
state: {
  status: "pending" | "running" | "completed" | "error"
  input?: Record<string, unknown>
  raw?: string
  output?: string
  // ... 其余保持不变
}
```

(c) 在组件函数顶部、紧跟现有 `usePartOpen()` 之后，加：

```ts
const partialInput = usePartialToolInput(part.tool, part.state.status, part.state.raw)
const displayInput = (partialInput ?? part.state.input ?? {}) as Record<string, unknown>
```

(d) 现有几处读 `part.state.input?.xxx` 改为读 `displayInput.xxx`：

- `filePath`（约第 84 行）
- `applyPatchContent`（约第 262-269 行）
- `showWriteContent`、`showApplyPatchContent` 的 boolean 表达式中的 `part.state.input?.content`、`part.state.input?.patchText` / `patch` 同步换。

注意 `showWriteContent`、`showApplyPatchContent` 的 status 守卫要放宽：

```ts
const showWriteContent =
  part.tool === "write" && (part.state.status === "completed" || partialInput !== null) && Boolean(displayInput.content)

const showApplyPatchContent =
  part.tool === "apply_patch" &&
  (part.state.status === "completed" || partialInput !== null) &&
  Boolean(displayInput.patchText || displayInput.patch)
```

(e) `edit` 在 pending 期间没有 diff，新增 partial 预览 gate：

```ts
const showEditPartial =
  part.tool === "edit" &&
  partialInput !== null &&
  typeof displayInput.newString === "string" &&
  (displayInput.newString as string).length > 0
```

JSX 渲染区（紧跟现有 `{showDiff && <EditTool ... />}` 之后）加：

```tsx
{
  showEditPartial && (
    <WriteTool content={String(displayInput.newString)} filePath={String(displayInput.filePath ?? "")} />
  )
}
```

(f) header 行数：在组件顶部计算 `streamingLineCount`：

```ts
const streamingLineCount = useMemo(() => {
  if (!partialInput) return undefined
  if (part.tool === "write") return countLines(partialInput.content)
  if (part.tool === "edit") return countLines(partialInput.newString)
  if (part.tool === "apply_patch") return countLines(partialInput.patchText ?? partialInput.patch)
  return undefined
}, [partialInput, part.tool])
```

把现有传给 `<ToolHeader lineRange={lineRange} ... />` 的那一行改为：

```tsx
lineRange={streamingLineCount ? `(已接收 ${streamingLineCount} 行)` : lineRange}
```

(g) 自动展开。在组件底部、`return` 之前加 `useEffect`：

```ts
useEffect(() => {
  if (part.state.status !== "pending") return
  if (part.tool !== "write" && part.tool !== "edit" && part.tool !== "apply_patch") return
  if (open.isOpen(part.id)) return
  open.setOpen(part.id, true)
}, [part.state.status, part.tool, part.id, open])
```

`useEffect` 已在文件顶部 import 列里（约第 1 行），无需新增。

- [ ] **Step 5.4: 跑测试，确认通过**

```bash
cd packages/opencode/webgui
bun run test:run src/components/parts/ToolPart/index.streaming.test.tsx
```

预期：PASS。

- [ ] **Step 5.5: 跑全量 ToolPart 测试，确认无回归**

```bash
cd packages/opencode/webgui
bun run test:run src/components/parts/ToolPart
```

预期：全部 PASS。

- [ ] **Step 5.6: 提交**

```bash
git add packages/opencode/webgui/src/components/parts/ToolPart/index.tsx packages/opencode/webgui/src/components/parts/ToolPart/index.streaming.test.tsx
git commit -m "feat(webgui): live preview write/edit/apply_patch streaming args"
```

---

## Task 6: 端到端校验

**Files:** 无

- [ ] **Step 6.1: 跑后端测试**

```bash
cd packages/opencode
bun test
```

预期：所有原本通过的测试仍 PASS，新增的 `processor-streaming-input.test.ts` PASS。

- [ ] **Step 6.2: 跑 webgui 测试**

```bash
cd packages/opencode/webgui
bun run test:run
```

预期：全部 PASS。

- [ ] **Step 6.3: 跑 lint**

```bash
cd packages/opencode/webgui
bun run lint
```

预期：0 error。

- [ ] **Step 6.4: 手动验证（仅当本地有可流式的 LLM 凭据）**

启动 dev：

```bash
# 终端 1
cd packages/opencode
tmux new-session -d -s opencode-dev 'bun dev'

# 浏览器打开 webgui，连接到 dev session
# 让 agent 执行：写一个 200 行的 README.md
# 观察：
#  - pending 卡片自动展开
#  - header "已接收 N 行" 数值随生成递增
#  - 展开区内容随之变多
#  - completed 后切换为正常渲染
```

清理：

```bash
tmux kill-session -t opencode-dev
```

- [ ] **Step 6.5: 不需要额外提交（前面任务已逐步提交）**

---

## Self-Review

1. **Spec 覆盖**：
   - 后端累积 → Task 2
   - 共享白名单常量 → Task 1
   - partial JSON 解析 → Task 3
   - 频率调控（useDeferredValue）→ Task 4
   - UI 串联 / 行数 / 自动展开 / type 补 raw → Task 5
   - 测试矩阵（spec 测试节）→ Task 2.1 + Task 3.1 + Task 5.1，全覆盖
   - 风险（漏配 STREAMABLE）→ Task 4.1 注释 + Task 1 共享常量已最大缓解
   - 验证（spec 验证节）→ Task 6

2. **Placeholder 扫描**：所有步骤含可执行代码或具体命令，无 TBD。Task 5.3 (b) 涉及"约第 N 行"的措辞是引导性而非占位（实际编辑时按具体行号读取），可接受。

3. **类型一致性**：
   - `STREAMABLE_TOOLS`（后端）vs `STREAMABLE`（前端） — 名字不同但作用域分离，不会引入漂移
   - `parsePartialInput` 返回 `Record<string, unknown>` 与 `usePartialToolInput` 返回 `Record<string, unknown> | null` 一致
   - `countLines(value: unknown)` 与调用点 `displayInput.content` 类型 `unknown` 匹配
   - `displayInput.newString` 在 Task 5.3 (e) 用 `typeof === "string"` guard，避免 `String(undefined)`
   - 全部 OK

无修改。
