# WebGUI task_result Markdown 展示 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让主会话中的 `task` 工具展开区仅展示 `<task_result>` 标签内内容，并按 Markdown 渲染；缺失或空内容时展示空状态。

**Architecture:** 采用数据层预解析（方案 C）：在消息进入前端状态时通过统一适配器解析 `task` 输出，产出结构化字段。`ToolPart` 只消费结构化字段进行渲染，不在 UI 层解析协议文本。实时 SSE 与历史加载共用同一适配入口，避免路径分叉。

**Tech Stack:** React + TypeScript + Vitest + React Testing Library + 现有 `MarkdownRenderer`。

---

### Task 1：实现 `task_result` 解析器（纯函数）

**Files:**

- Create: `packages/opencode/webgui/src/lib/task-result.ts`
- Create: `packages/opencode/webgui/src/lib/task-result.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest"
import { parseTaskResult } from "./task-result"

describe("parseTaskResult", () => {
  it("只提取 task_result 标签内文本", () => {
    const out = `task_id: s1\n\n<task_result>## 标题\n- a\n</task_result>`
    const res = parseTaskResult(out)
    expect(res.hasTag).toBe(true)
    expect(res.hasContent).toBe(true)
    expect(res.text).toBe("## 标题\n- a")
  })

  it("标签缺失时返回无内容", () => {
    const res = parseTaskResult("task_id: s1")
    expect(res.hasTag).toBe(false)
    expect(res.hasContent).toBe(false)
    expect(res.text).toBe("")
  })

  it("空标签或仅空白时返回无内容", () => {
    const res = parseTaskResult("<task_result> \n\t </task_result>")
    expect(res.hasTag).toBe(true)
    expect(res.hasContent).toBe(false)
    expect(res.text).toBe("")
  })

  it("多个标签时优先取第一段合法内容", () => {
    const out = "<task_result>first</task_result>\n<task_result>second</task_result>"
    const res = parseTaskResult(out)
    expect(res.text).toBe("first")
  })

  it("CRLF 文本可被正确提取并 trim", () => {
    const out = "<task_result>\r\n# t\r\n- a\r\n</task_result>"
    const res = parseTaskResult(out)
    expect(res.text).toBe("# t\r\n- a")
  })

  it("不闭合标签按无内容处理", () => {
    const res = parseTaskResult("<task_result>abc")
    expect(res.hasTag).toBe(false)
    expect(res.hasContent).toBe(false)
    expect(res.text).toBe("")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/lib/task-result.test.ts`

Expected: FAIL（`parseTaskResult` 未实现）

- [ ] **Step 3: Write minimal implementation**

```ts
export function parseTaskResult(output: string) {
  const m = output.match(/<task_result>\n?([\s\S]*?)\n?<\/task_result>/i)
  if (!m) return { hasTag: false, hasContent: false, text: "" }
  const text = (m[1] ?? "").trim()
  return { hasTag: true, hasContent: text.length > 0, text }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/lib/task-result.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/webgui/src/lib/task-result.ts packages/opencode/webgui/src/lib/task-result.test.ts
git commit -m "test(webgui): add task_result parser coverage"
```

---

### Task 2：定义结构化字段并封装 part 适配函数

**Files:**

- Modify: `packages/opencode/webgui/src/types/messages.ts`
- Create: `packages/opencode/webgui/src/lib/task-part.ts`
- Create: `packages/opencode/webgui/src/lib/task-part.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest"
import { adaptPart } from "./task-part"

describe("adaptPart", () => {
  it("仅对 tool=task 注入 parsed.task_result", () => {
    const part = {
      id: "p1",
      type: "tool",
      tool: "task",
      callID: "c1",
      sessionID: "s1",
      messageID: "m1",
      state: { status: "completed", output: "<task_result>**ok**</task_result>" },
    }
    const next = adaptPart(part)
    expect(next.parsed?.task_result?.text).toBe("**ok**")
  })

  it("非 task 工具不注入 parsed.task_result", () => {
    const part = {
      id: "p2",
      type: "tool",
      tool: "bash",
      callID: "c2",
      sessionID: "s1",
      messageID: "m1",
      state: { status: "completed", output: "ok" },
    }
    const next = adaptPart(part)
    expect(next).toEqual(part)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/lib/task-part.test.ts`

Expected: FAIL（`adaptPart` 或扩展类型未定义）

- [ ] **Step 3: Write minimal implementation**

```ts
import type { WebguiToolPart } from "../types/messages"
import { parseTaskResult } from "./task-result"

export function adaptPart(part: WebguiToolPart): WebguiToolPart {
  if (part.type !== "tool") return part
  if (part.tool !== "task") return part
  const out = typeof part.state?.output === "string" ? part.state.output : ""
  return {
    ...part,
    parsed: {
      ...part.parsed,
      task_result: parseTaskResult(out),
    },
  }
}
```

并在 `types/messages.ts` 显式扩展类型，避免 `any`：

```ts
export type TaskResultParsed = {
  hasTag: boolean
  hasContent: boolean
  text: string
}

export type WebguiToolPart = Extract<Part, { type: "tool" }> & {
  parsed?: {
    task_result?: TaskResultParsed
  }
}

type NonToolPart = Exclude<Part, { type: "tool" }>

export type WebguiPart = NonToolPart | WebguiToolPart | SessionErrorPart | QuestionRequestPart
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/lib/task-part.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/webgui/src/types/messages.ts packages/opencode/webgui/src/lib/task-part.ts packages/opencode/webgui/src/lib/task-part.test.ts
git commit -m "feat(webgui): add structured task part adapter"
```

---

### Task 3：在 MessagesContext 两条入口接入适配（SSE + 历史加载）

**Files:**

- Modify: `packages/opencode/webgui/src/state/MessagesContext.tsx`
- Create: `packages/opencode/webgui/src/state/MessagesContext.task-result.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("message.part.updated 的 task part 应写入 parsed.task_result", async () => {
  // 通过 EventEmitter 触发 message.part.updated
  // 断言 provider 内部状态中的 tool part 含 parsed.task_result
})

it("loadSessionMessages 返回的 task part 也应写入 parsed.task_result", async () => {
  // mock sdk.session.messages 返回 task part
  // 调用 loadSessionMessages 后断言解析字段存在
})

it("addPart 直接入库 task part 也应经过同一适配", async () => {
  // 直接调用 context.addPart
  // 断言解析字段存在，避免未来新增入口遗漏
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/state/MessagesContext.task-result.test.tsx`

Expected: FAIL（当前未接入适配）

- [ ] **Step 3: Write minimal implementation**

```ts
// 统一入口，避免 SSE/历史加载/直接 addPart 分叉
const normalizePart = (part: WebguiPart): WebguiPart => {
  if (part.type !== "tool") return part
  return adaptPart(part)
}

const normalizeMsg = (msg: Message): Message => ({
  ...msg,
  parts: msg.parts.map((part) => normalizePart(part)),
})

// addPart
const addPart = useCallback((messageID: string, part: WebguiPart) => {
  setMessages((prev) => Store.upsertPart(prev, messageID, normalizePart(part)))
}, [])

// handlePartUpdated
addPart(part.messageID, normalizePart(part as WebguiPart))

// loadSessionMessages
const loadedMessages = ((response.data ?? []) as Message[]).map((msg) => normalizeMsg(msg))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/state/MessagesContext.task-result.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/webgui/src/state/MessagesContext.tsx packages/opencode/webgui/src/state/MessagesContext.task-result.test.tsx
git commit -m "feat(webgui): adapt task part on message ingestion"
```

---

### Task 4：实现 `task` 展开区 Markdown 渲染与空状态

**Files:**

- Create: `packages/opencode/webgui/src/components/parts/ToolPart/TaskTool.tsx`
- Modify: `packages/opencode/webgui/src/components/parts/ToolPart/index.tsx`
- Modify: `packages/opencode/webgui/src/components/parts/ToolPart/index.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("task 工具仅渲染 task_result 标签内 Markdown", () => {
  // output 含 task_id + task_result
  // 断言展开区显示 markdown 内容，不显示 task_id
})

it("task_result 缺失或空内容时显示空状态", () => {
  // completed 状态下断言空状态文案
})

it("task 处于 running/pending 时不展示空状态", () => {
  // 避免执行中误导性“无可展示内容”
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/components/parts/ToolPart/index.test.tsx`

Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```tsx
// TaskTool.tsx
import { MarkdownRenderer } from "../../MarkdownRenderer"

export function TaskTool({ text, empty }: { text: string; empty: boolean }) {
  if (empty) return <div className="px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400">无可展示内容</div>
  return (
    <div className="px-3 py-1.5 text-xs overflow-x-auto max-h-60 overflow-y-auto">
      <MarkdownRenderer>{text}</MarkdownRenderer>
    </div>
  )
}
```

在 `ToolPart/index.tsx` 增加 `task` 分支逻辑：

1. 仅当 `part.tool === "task"` 且展开时读取 `part.parsed?.task_result`。
2. `state.status === "completed"` 且 `hasContent=false` 才显示空状态。
3. `running/pending` 不显示空状态。
4. `task` 不再走 `GenericOutput` 原始文本渲染。

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/components/parts/ToolPart/index.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/webgui/src/components/parts/ToolPart/TaskTool.tsx packages/opencode/webgui/src/components/parts/ToolPart/index.tsx packages/opencode/webgui/src/components/parts/ToolPart/index.test.tsx
git commit -m "feat(webgui): render task_result as markdown in task tool"
```

---

### Task 5：全量验证与最小回归

**Files:**

- Verify only (no mandatory file edits)

- [ ] **Step 1: Run focused tests**

Run:

- `bun run --cwd packages/opencode/webgui test:run -- src/lib/task-result.test.ts`
- `bun run --cwd packages/opencode/webgui test:run -- src/lib/task-part.test.ts`
- `bun run --cwd packages/opencode/webgui test:run -- src/state/MessagesContext.task-result.test.tsx`
- `bun run --cwd packages/opencode/webgui test:run -- src/components/parts/ToolPart/index.test.tsx`

Expected: 全部 PASS

- [ ] **Step 2: Run package test suite**

Run: `bun run --cwd packages/opencode/webgui test:run`

Expected: PASS（无新增回归）

- [ ] **Step 3: Manual smoke check**

- 触发主会话中的 `task` 工具调用。
- 展开工具项：确认仅显示 `task_result` 内 Markdown。
- 确认 `task_id` 不在展开区出现。
- 构造无标签/空标签输出，确认展示“无可展示内容”。
- 构造 `running/pending` 的 `task` part，确认不展示“无可展示内容”。

- [ ] **Step 4: Final commit**

```bash
git add packages/opencode/webgui/src/types/messages.ts packages/opencode/webgui/src/lib/task-result.ts packages/opencode/webgui/src/lib/task-result.test.ts packages/opencode/webgui/src/lib/task-part.ts packages/opencode/webgui/src/lib/task-part.test.ts packages/opencode/webgui/src/state/MessagesContext.tsx packages/opencode/webgui/src/state/MessagesContext.task-result.test.tsx packages/opencode/webgui/src/components/parts/ToolPart/TaskTool.tsx packages/opencode/webgui/src/components/parts/ToolPart/index.tsx packages/opencode/webgui/src/components/parts/ToolPart/index.test.tsx
git commit -m "feat(webgui): show delegated task_result as markdown"
```
