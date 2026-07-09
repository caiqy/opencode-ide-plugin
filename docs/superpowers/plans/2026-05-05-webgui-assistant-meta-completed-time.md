# WebGUI AssistantMeta 相对日期结束时间展示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 WebGUI 聊天气泡底部的 assistant meta 标签在现有时长后面追加按用户本地日期显示的结束时间：今天/昨天/前天显示相对日期，其余日期显示 `YYYY年MM月DD日 HH:mm:ss`。

**Architecture:** 只改 WebGUI 展示链路：在 `formatting.ts` 增加一个支持传入 `now` 的相对日期时间 formatter，用用户本地时间判断今天/昨天/前天；`AssistantMeta` 继续只负责拼装展示文案；`MessageRow` 继续只透传 `assistantInfo.time.completed`。测试按 TDD 分两层推进：先锁定 formatter 与 `AssistantMeta` 的相对日期展示，再锁定 `MessageRow` 的透传行为。

**Tech Stack:** TypeScript、React 19、Vitest、Testing Library、Bun

---

## 文件结构与职责

所有 `bun run test:run ...` 命令都从 `packages/opencode/webgui` 目录执行。

- `docs/superpowers/specs/2026-05-05-webgui-assistant-meta-completed-time-design.md`
  - 已确认的设计说明，执行时按此限制范围：只改 WebGUI 这一处标签，不扩散到 transcript 或其他页面
- `packages/opencode/webgui/src/utils/formatting.ts`
  - WebGUI 通用格式化函数集合
  - 本次新增相对日期时间 formatter，统一生成“今天/昨天/前天/完整日期 + HH:mm:ss”文案
- `packages/opencode/webgui/src/utils/formatting.test.ts`
  - `formatting.ts` 的纯函数测试
  - 本次新增今天、昨天、前天、完整日期四类输出测试
- `packages/opencode/webgui/src/components/MessageList/AssistantMeta.tsx`
  - assistant meta 标签展示组件
  - 本次新增 `completedAt` props，并把结束时间插入到 duration 与 `interrupted` 之间
- `packages/opencode/webgui/src/components/MessageList/AssistantMeta.test.tsx`
  - `AssistantMeta` 的展示测试
  - 本次新增“今天文案渲染”“结束时间 + interrupted 共存”“非法时间不显示”回归用例
- `packages/opencode/webgui/src/components/MessageList/MessageRow.tsx`
  - 从 message 对象提取 assistant 元信息并渲染 `AssistantMeta`
  - 本次只新增 `completedAt={assistantInfo?.time?.completed}` 透传，不改现有 showMeta 判定
- `packages/opencode/webgui/src/components/MessageList/MessageRow.test.tsx`
  - `MessageRow` 的组件级回归测试
  - 本次改为用 spy mock `AssistantMeta`，验证 `completedAt` 和 `interrupted` 被正确透传

### Task 1: 先用测试锁定相对日期时间格式与 AssistantMeta 文案

**Files:**

- Modify: `packages/opencode/webgui/src/utils/formatting.test.ts`
- Modify: `packages/opencode/webgui/src/components/MessageList/AssistantMeta.test.tsx`
- Modify: `packages/opencode/webgui/src/utils/formatting.ts`
- Modify: `packages/opencode/webgui/src/components/MessageList/AssistantMeta.tsx`

- [ ] **Step 1: 在 `formatting.test.ts` 和 `AssistantMeta.test.tsx` 先写失败测试**

先改 `packages/opencode/webgui/src/utils/formatting.test.ts` 顶部导入，把 `formatRelativeDateTimeLabel` 也加进来：

```ts
import {
  formatK,
  formatKM,
  formatCost,
  formatTimestamp,
  formatRelativeDateTimeLabel,
  formatFileSize,
  formatDate,
  formatDateTime,
  formatRelativeTime,
  formatDuration,
  truncate,
  capitalize,
  toTitleCase,
  formatPercentage,
} from "./formatting"
```

然后在 `describe("formatTimestamp", ...)` 后面插入一个新的测试块：

```ts
describe("formatRelativeDateTimeLabel", () => {
  const now = new Date(2026, 4, 5, 18, 0, 0).getTime()

  it("formats today as 今天 HH:mm:ss", () => {
    const timestamp = new Date(2026, 4, 5, 14, 23, 18).getTime()
    expect(formatRelativeDateTimeLabel(timestamp, now)).toBe("今天 14:23:18")
  })

  it("formats yesterday as 昨天 HH:mm:ss", () => {
    const timestamp = new Date(2026, 4, 4, 9, 10, 11).getTime()
    expect(formatRelativeDateTimeLabel(timestamp, now)).toBe("昨天 09:10:11")
  })

  it("formats the day before yesterday as 前天 HH:mm:ss", () => {
    const timestamp = new Date(2026, 4, 3, 22, 8, 30).getTime()
    expect(formatRelativeDateTimeLabel(timestamp, now)).toBe("前天 22:08:30")
  })

  it("formats older dates as YYYY年MM月DD日 HH:mm:ss", () => {
    const timestamp = new Date(2026, 4, 1, 8, 0, 0).getTime()
    expect(formatRelativeDateTimeLabel(timestamp, now)).toBe("2026年05月01日 08:00:00")
  })
})
```

再改 `packages/opencode/webgui/src/components/MessageList/AssistantMeta.test.tsx`，把系统时间固定到 2026-05-05 18:00:00 本地时间，并把“结束时间渲染”断言改成相对日期文案：

```ts
describe("AssistantMeta", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 4, 5, 18, 0, 0))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("有 completedAt 时追加完整结束时间", () => {
    const completedAt = new Date(2026, 4, 5, 14, 23, 18).getTime()

    render(<AssistantMeta agent="code" modelName="Claude Sonnet 4" variant="high" durationMs={23000} completedAt={completedAt} />)

    expect(screen.getByTestId("assistant-meta")).toHaveTextContent(
      "Code · Claude Sonnet 4 · high · 23s · 今天 14:23:18",
    )
  })

  it("completedAt 与 interrupted 可同时显示", () => {
    const completedAt = new Date(2026, 4, 5, 14, 23, 18).getTime()

    render(
      <AssistantMeta
        agent="code"
        modelName="Claude Sonnet 4"
        variant="high"
        durationMs={23000}
        completedAt={completedAt}
        interrupted
      />,
    )

    expect(screen.getByTestId("assistant-meta")).toHaveTextContent(
      "Code · Claude Sonnet 4 · high · 23s · 今天 14:23:18 · interrupted",
    )
  })

  it("非法 completedAt 时不显示结束时间", () => {
    render(
      <AssistantMeta agent="code" modelName="Claude Sonnet 4" variant="high" durationMs={23000} completedAt={Number.MAX_SAFE_INTEGER} />,
    )

    expect(screen.getByTestId("assistant-meta").textContent).toBe("Code · Claude Sonnet 4 · high · 23s")
  })
})
```

- [ ] **Step 2: 运行目标测试，确认它们先失败**

Run:

```bash
bun run test:run src/utils/formatting.test.ts src/components/MessageList/AssistantMeta.test.tsx
```

Expected:

- `formatRelativeDateTimeLabel` 相关测试失败，因为导出尚不存在
- `AssistantMeta` 的新断言失败，因为组件还没有把结束时间拼成今天/昨天/前天文案
- 其余既有测试保持通过

- [ ] **Step 3: 在 `formatting.ts` 和 `AssistantMeta.tsx` 写最小实现**

先在 `packages/opencode/webgui/src/utils/formatting.ts` 的 `formatTimestamp(...)` 后面增加下面这个函数，不改现有 `formatTimestamp` 行为：

```ts
export function formatRelativeDateTimeLabel(timestamp: number, now: number = Date.now()): string {
  const date = new Date(timestamp)
  const current = new Date(now)

  if (!Number.isFinite(date.getTime()) || !Number.isFinite(current.getTime())) return ""

  const formatClock = (value: Date) => {
    const hours = String(value.getHours()).padStart(2, "0")
    const minutes = String(value.getMinutes()).padStart(2, "0")
    const seconds = String(value.getSeconds()).padStart(2, "0")
    return `${hours}:${minutes}:${seconds}`
  }

  const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
  const diffDays = Math.round((startOfDay(current) - startOfDay(date)) / (24 * 60 * 60 * 1000))

  if (diffDays === 0) return `今天 ${formatClock(date)}`
  if (diffDays === 1) return `昨天 ${formatClock(date)}`
  if (diffDays === 2) return `前天 ${formatClock(date)}`

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}年${month}月${day}日 ${formatClock(date)}`
}
```

再把 `packages/opencode/webgui/src/components/MessageList/AssistantMeta.tsx` 中的结束时间 formatter 调用替换成 `formatRelativeDateTimeLabel(completedAt)`，其余结构保持不动：

```ts
import { formatRelativeDateTimeLabel } from "../../utils/formatting"
import { formatDuration } from "./turnMeta"

interface AssistantMetaProps {
  agent: string
  modelName: string
  variant?: string
  durationMs?: number
  completedAt?: number
  interrupted?: boolean
}

export function AssistantMeta({ agent, modelName, variant, durationMs, completedAt, interrupted }: AssistantMetaProps) {
  const agentLabel = agent ? agent[0].toUpperCase() + agent.slice(1) : ""
  const durationLabel = typeof durationMs === "number" && durationMs >= 0 ? formatDuration(durationMs) : ""
  const completedLabel = typeof completedAt === "number" ? formatRelativeDateTimeLabel(completedAt) : ""

  const items = [agentLabel, modelName, variant || "", durationLabel, completedLabel, interrupted ? "interrupted" : ""].filter(Boolean)

  if (items.length === 0) return null

  return (
    <div className="flex items-center" data-testid="assistant-meta">
      <div className="flex-1 border-t border-gray-200 dark:border-gray-800" />
      <span className="mx-3 text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">{items.join(" · ")}</span>
      <div className="flex-1 border-t border-gray-200 dark:border-gray-800" />
    </div>
  )
}
```

实现约束：

- 不改 `turnMeta.ts` 的时长格式化逻辑
- 不使用 `toLocaleString()`
- `completedAt` 缺失或非法时必须退回旧文案
- 今天/昨天/前天必须按用户本地时间自然日判断

- [ ] **Step 4: 重新运行目标测试，确认 formatter 与 AssistantMeta 转绿**

Run:

```bash
bun run test:run src/utils/formatting.test.ts src/components/MessageList/AssistantMeta.test.tsx
```

Expected:

- `formatRelativeDateTimeLabel` 新测试 PASS
- `AssistantMeta` 新增的今天文案、interrupted 共存、非法时间不显示测试 PASS
- 既有 “无 variant / 无 duration / interrupted” 断言继续 PASS

### Task 2: 让 MessageRow 把 assistant 完成时间透传给 AssistantMeta

**Files:**

- Modify: `packages/opencode/webgui/src/components/MessageList/MessageRow.test.tsx`
- Modify: `packages/opencode/webgui/src/components/MessageList/MessageRow.tsx`

- [ ] **Step 1: 在 `MessageRow.test.tsx` 增加 completedAt 透传的失败测试**

先把 `AssistantMeta` 的 mock 改成带 spy 的形式，替换文件顶部现有那段 `vi.mock("./AssistantMeta", ...)`：

```ts
const assistantMetaSpy = vi.fn(() => <div data-testid="assistant-meta" />)

vi.mock("./AssistantMeta", () => ({
  AssistantMeta: (props: Record<string, unknown>) => assistantMetaSpy(props),
}))
```

然后在现有布局测试后面追加一个新测试：

```ts
  it("把 assistant 完成时间与中断状态透传给 AssistantMeta", () => {
    const completedAt = new Date(2026, 4, 5, 14, 23, 18).getTime()

    const message = {
      info: {
        id: "a1",
        sessionID: "s1",
        role: "assistant",
        agent: "build",
        providerID: "anthropic",
        modelID: "claude-sonnet-4",
        variant: "high",
        time: { created: 1, completed: completedAt },
        error: { name: "MessageAbortedError", message: "stopped" },
      },
      parts: [
        {
          id: "p1",
          type: "text",
          text: "done",
        },
      ],
    }

    render(<MessageRow message={message as never} isLast showMeta turnDurationMs={71000} />)

    expect(screen.getByTestId("assistant-meta")).toBeInTheDocument()
    expect(assistantMetaSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "build",
        modelName: "Claude Sonnet 4",
        variant: "high",
        durationMs: 71000,
        completedAt,
        interrupted: true,
      }),
    )
  })
```

测试目的：

- 锁定 `assistantInfo.time.completed` 的数据来源
- 锁定结束时间在中断场景下也要透传
- 避免未来有人只改 `AssistantMeta`、忘了 `MessageRow` 这层接线

- [ ] **Step 2: 运行 `MessageRow` 测试，确认新断言先失败**

Run:

```bash
bun run test:run src/components/MessageList/MessageRow.test.tsx
```

Expected:

- 新测试失败，原因是 `assistantMetaSpy` 收到的 props 里还没有 `completedAt`
- 现有布局测试继续通过

- [ ] **Step 3: 在 `MessageRow.tsx` 增加 `completedAt` 透传**

把 `packages/opencode/webgui/src/components/MessageList/MessageRow.tsx` 中 `AssistantMeta` 调用点改成下面这样，只新增一行 `completedAt={assistantInfo?.time?.completed}`：

```tsx
{
  showMeta && isAssistant && (assistantInfo?.time?.completed || error?.name === "MessageAbortedError") && (
    <AssistantMeta
      agent={assistantInfo?.agent ?? ""}
      modelName={resolveModelName(assistantInfo?.providerID ?? "", assistantInfo?.modelID ?? "")}
      variant={assistantInfo?.variant || undefined}
      durationMs={turnDurationMs}
      completedAt={assistantInfo?.time?.completed}
      interrupted={error?.name === "MessageAbortedError"}
    />
  )
}
```

约束：

- 不修改现有 `showMeta` 条件
- 不在 `MessageRow` 里自己格式化时间
- 不新增任何 fallback 到 `Date.now()` 的逻辑

- [ ] **Step 4: 重新运行 `MessageRow` 测试，确认透传转绿**

Run:

```bash
bun run test:run src/components/MessageList/MessageRow.test.tsx
```

Expected:

- 新增的 props 透传测试 PASS
- 现有布局测试 PASS

- [ ] **Step 5: 跑完整的目标回归套件**

Run:

```bash
bun run test:run src/utils/formatting.test.ts src/components/MessageList/AssistantMeta.test.tsx src/components/MessageList/MessageRow.test.tsx
```

Expected:

- 三个测试文件全部 PASS
- 没有新的 snapshot 或类型错误
- 文案顺序稳定为 `Agent · Model · Variant · Duration · 今天/昨天/前天/完整日期 HH:mm:ss · interrupted`

- [ ] **Step 6: 检查 diff，只保留本次标签时间改动**

Run:

```bash
git diff -- packages/opencode/webgui/src/utils/formatting.ts packages/opencode/webgui/src/utils/formatting.test.ts packages/opencode/webgui/src/components/MessageList/AssistantMeta.tsx packages/opencode/webgui/src/components/MessageList/AssistantMeta.test.tsx packages/opencode/webgui/src/components/MessageList/MessageRow.tsx packages/opencode/webgui/src/components/MessageList/MessageRow.test.tsx
```

Expected:

- diff 只包含 `completedAt` formatter、`AssistantMeta` 文案拼接、`MessageRow` 透传和对应测试
- 没有顺手格式化或无关 UI 改动

- [ ] **Step 7: 提交这次功能改动**

Run:

```bash
git add packages/opencode/webgui/src/utils/formatting.ts packages/opencode/webgui/src/utils/formatting.test.ts packages/opencode/webgui/src/components/MessageList/AssistantMeta.tsx packages/opencode/webgui/src/components/MessageList/AssistantMeta.test.tsx packages/opencode/webgui/src/components/MessageList/MessageRow.tsx packages/opencode/webgui/src/components/MessageList/MessageRow.test.tsx
git commit -m "fix(webgui): show assistant meta completed timestamp"
```

Expected:

- commit 成功
- 提交只包含 WebGUI assistant meta 结束时间展示相关改动

## 自查

- **Spec coverage:** 已覆盖 spec 的全部要求：只改 WebGUI 聊天气泡底部标签、按用户本地日期输出今天/昨天/前天或完整中文日期、与现有一行标签拼接、中断场景保留结束时间、不扩散到 transcript 或其他页面
- **Placeholder scan:** 计划中没有 `TODO`、`TBD`、`类似 Task N`、`写一些测试` 之类的占位表达；每个代码步骤都给了具体测试代码、实现代码和运行命令
- **Type consistency:** 全文统一使用 `completedAt` 作为 props 名称、`formatRelativeDateTimeLabel(...)` 作为格式化函数名、`assistantInfo.time.completed` 作为消息来源，与 spec 和现有代码命名一致
