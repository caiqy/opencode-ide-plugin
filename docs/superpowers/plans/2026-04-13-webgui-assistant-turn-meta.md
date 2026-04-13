# WebGUI Assistant Turn Meta 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 WebGUI 的主会话和子任务弹层中，于最后一条 assistant 消息底部显示 `Agent · ModelName · Variant · Duration` meta 信息行。

**Architecture:** 新增一个 `useProviderStore` hook 缓存 provider 数据并暴露 model 名称解析；新增 `AssistantMeta` 纯展示组件；在 `MessageList` 和 `SubtaskMessageList` 中计算 turn duration 并传给 `MessageRow`，由 `MessageRow` 有条件渲染 meta。

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-04-13-webgui-assistant-turn-meta-design.md`

---

### Task 1: 新增 turn duration 计算纯函数 + 测试

**Files:**

- Create: `packages/opencode/webgui/src/components/MessageList/turnMeta.ts`
- Create: `packages/opencode/webgui/src/components/MessageList/turnMeta.test.ts`

- [ ] **Step 1: 创建 `turnMeta.ts`，编写 `computeTurnMeta` 和 `formatDuration` 纯函数**

```ts
// packages/opencode/webgui/src/components/MessageList/turnMeta.ts
import type { Message } from "../../types/messages"
import { isAssistantMessage } from "../../types/messages"
import type { AssistantMessage } from "../../types/messages"

export interface TurnMeta {
  turnDurationMs: number | undefined
  lastAssistantID: string | undefined
}

/**
 * 计算最后一轮 turn 的 duration 和最后一条 assistant message ID。
 * turn = 最后一条 user message → 其后所有 assistant messages。
 */
export function computeTurnMeta(messages: Message[]): TurnMeta {
  const sorted = [...messages].sort((a, b) => a.info.time.created - b.info.time.created)

  const lastUser = sorted.findLast((m) => m.info.role === "user")
  if (!lastUser) return { turnDurationMs: undefined, lastAssistantID: undefined }

  const turnAssistants = sorted.filter(
    (m) => isAssistantMessage(m.info) && m.info.time.created >= lastUser.info.time.created,
  )
  if (turnAssistants.length === 0) return { turnDurationMs: undefined, lastAssistantID: undefined }

  const completedTimes = turnAssistants
    .map((m) => (m.info as AssistantMessage).time.completed)
    .filter((t): t is number => typeof t === "number" && t > 0)

  const lastCompleted = completedTimes.length > 0 ? Math.max(...completedTimes) : undefined
  const turnDurationMs =
    lastCompleted !== undefined && lastCompleted >= lastUser.info.time.created
      ? lastCompleted - lastUser.info.time.created
      : undefined

  const lastAssistantID = turnAssistants.at(-1)?.info.id

  return { turnDurationMs, lastAssistantID }
}

/**
 * 将毫秒格式化为人类可读的时长字符串。
 * < 60s → "Xs"，≥ 60s → "Xm Ys"
 */
export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000)
  if (total < 0) return ""
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}m ${seconds}s`
}
```

- [ ] **Step 2: 编写 `turnMeta.test.ts` 测试**

```ts
// packages/opencode/webgui/src/components/MessageList/turnMeta.test.ts
import { describe, it, expect } from "vitest"
import { computeTurnMeta, formatDuration } from "./turnMeta"
import type { Message } from "../../types/messages"

function msg(role: "user" | "assistant", id: string, created: number, completed?: number): Message {
  const base = { id, sessionID: "s1", role, time: { created } } as any
  if (role === "assistant") {
    base.time.completed = completed
  }
  return { info: base, parts: [] }
}

describe("computeTurnMeta", () => {
  it("空消息列表返回 undefined", () => {
    const result = computeTurnMeta([])
    expect(result.turnDurationMs).toBeUndefined()
    expect(result.lastAssistantID).toBeUndefined()
  })

  it("只有 user 消息返回 undefined", () => {
    const result = computeTurnMeta([msg("user", "u1", 1000)])
    expect(result.turnDurationMs).toBeUndefined()
    expect(result.lastAssistantID).toBeUndefined()
  })

  it("正常 user → assistant 计算 turn duration", () => {
    const result = computeTurnMeta([msg("user", "u1", 1000), msg("assistant", "a1", 1100, 4000)])
    expect(result.turnDurationMs).toBe(3000) // 4000 - 1000
    expect(result.lastAssistantID).toBe("a1")
  })

  it("多条 assistant 取最晚 completed", () => {
    const result = computeTurnMeta([
      msg("user", "u1", 1000),
      msg("assistant", "a1", 1100, 3000),
      msg("assistant", "a2", 2000, 5000),
    ])
    expect(result.turnDurationMs).toBe(4000) // 5000 - 1000
    expect(result.lastAssistantID).toBe("a2")
  })

  it("assistant 未完成时 turnDurationMs 为 undefined", () => {
    const result = computeTurnMeta([msg("user", "u1", 1000), msg("assistant", "a1", 1100, undefined)])
    expect(result.turnDurationMs).toBeUndefined()
    expect(result.lastAssistantID).toBe("a1")
  })

  it("多轮对话只取最后一轮", () => {
    const result = computeTurnMeta([
      msg("user", "u1", 1000),
      msg("assistant", "a1", 1100, 2000),
      msg("user", "u2", 3000),
      msg("assistant", "a2", 3100, 6000),
    ])
    expect(result.turnDurationMs).toBe(3000) // 6000 - 3000
    expect(result.lastAssistantID).toBe("a2")
  })

  it("消息乱序时仍正确排序计算", () => {
    const result = computeTurnMeta([msg("assistant", "a1", 1100, 4000), msg("user", "u1", 1000)])
    expect(result.turnDurationMs).toBe(3000)
    expect(result.lastAssistantID).toBe("a1")
  })
})

describe("formatDuration", () => {
  it("0 毫秒显示 0s", () => {
    expect(formatDuration(0)).toBe("0s")
  })

  it("短于 60 秒显示秒数", () => {
    expect(formatDuration(23000)).toBe("23s")
  })

  it("60 秒整显示 1m 0s", () => {
    expect(formatDuration(60000)).toBe("1m 0s")
  })

  it("超过 60 秒显示分秒", () => {
    expect(formatDuration(133000)).toBe("2m 13s")
  })

  it("四舍五入到最近秒", () => {
    expect(formatDuration(23400)).toBe("23s")
    expect(formatDuration(23600)).toBe("24s")
  })

  it("负数返回空字符串", () => {
    expect(formatDuration(-1000)).toBe("")
  })
})
```

- [ ] **Step 3: 运行测试验证通过**

Run: `cd packages/opencode/webgui && npx vitest run src/components/MessageList/turnMeta.test.ts`
Expected: 全部 PASS

- [ ] **Step 4: 提交**

```bash
git add packages/opencode/webgui/src/components/MessageList/turnMeta.ts packages/opencode/webgui/src/components/MessageList/turnMeta.test.ts
git commit -m "feat(webgui): add turn meta computation and duration formatting"
```

---

### Task 2: 新增 `useProviderStore` hook + 测试

**Files:**

- Create: `packages/opencode/webgui/src/hooks/useProviderStore.ts`
- Create: `packages/opencode/webgui/src/hooks/useProviderStore.test.ts`

- [ ] **Step 1: 创建 `useProviderStore.ts`**

```ts
// packages/opencode/webgui/src/hooks/useProviderStore.ts
import { useEffect, useState } from "react"
import { sdk } from "../lib/api/sdkClient"

interface ProviderModel {
  name: string
  [key: string]: unknown
}

interface ProviderEntry {
  id: string
  name: string
  models: Record<string, ProviderModel>
}

// 模块级缓存：所有组件实例共享同一份 provider 列表
let cachedProviders: ProviderEntry[] | null = null
let fetchPromise: Promise<void> | null = null

function fetchProviders(): Promise<void> {
  if (fetchPromise) return fetchPromise
  fetchPromise = sdk.config
    .providers()
    .then((res) => {
      if (res.data) {
        cachedProviders = res.data.providers as unknown as ProviderEntry[]
      }
    })
    .catch(() => {
      // 静默失败，resolveModelName 会 fallback 到 modelID
    })
    .finally(() => {
      fetchPromise = null
    })
  return fetchPromise
}

/**
 * 提供 model 名称解析能力。
 * 使用模块级缓存，provider 列表只请求一次。
 */
export function useProviderStore() {
  const [, setTick] = useState(0)

  useEffect(() => {
    if (cachedProviders) return
    fetchProviders().then(() => {
      setTick((t) => t + 1) // 触发重渲染以使用缓存数据
    })
  }, [])

  return {
    resolveModelName(providerID: string, modelID: string): string {
      if (!cachedProviders) return modelID
      const provider = cachedProviders.find((p) => p.id === providerID)
      return provider?.models?.[modelID]?.name ?? modelID
    },
  }
}

// 仅用于测试：重置模块级缓存
export function _resetProviderCache() {
  cachedProviders = null
  fetchPromise = null
}
```

- [ ] **Step 2: 编写 `useProviderStore.test.ts` 测试**

```ts
// packages/opencode/webgui/src/hooks/useProviderStore.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { useProviderStore, _resetProviderCache } from "./useProviderStore"

vi.mock("../lib/api/sdkClient", () => ({
  sdk: {
    config: {
      providers: vi.fn(),
    },
  },
}))

import { sdk } from "../lib/api/sdkClient"

const mockProviders = vi.mocked(sdk.config.providers)

beforeEach(() => {
  _resetProviderCache()
  vi.clearAllMocks()
})

describe("useProviderStore", () => {
  it("加载 provider 后 resolveModelName 返回显示名", async () => {
    mockProviders.mockResolvedValueOnce({
      data: {
        providers: [
          {
            id: "anthropic",
            name: "Anthropic",
            models: {
              "claude-sonnet-4-20250514": { name: "Claude Sonnet 4" },
            },
          },
        ],
        default: {},
      },
      error: null,
    } as any)

    const { result } = renderHook(() => useProviderStore())

    // 初始时缓存为空，fallback 到 modelID
    expect(result.current.resolveModelName("anthropic", "claude-sonnet-4-20250514")).toBe("claude-sonnet-4-20250514")

    // 等待异步加载完成
    await waitFor(() => {
      expect(result.current.resolveModelName("anthropic", "claude-sonnet-4-20250514")).toBe("Claude Sonnet 4")
    })
  })

  it("provider 或 model 不存在时 fallback 到 modelID", async () => {
    mockProviders.mockResolvedValueOnce({
      data: { providers: [], default: {} },
      error: null,
    } as any)

    const { result } = renderHook(() => useProviderStore())

    await waitFor(() => {
      expect(mockProviders).toHaveBeenCalled()
    })

    expect(result.current.resolveModelName("unknown", "unknown-model")).toBe("unknown-model")
  })

  it("SDK 调用失败时静默 fallback", async () => {
    mockProviders.mockRejectedValueOnce(new Error("network error"))

    const { result } = renderHook(() => useProviderStore())

    await waitFor(() => {
      expect(mockProviders).toHaveBeenCalled()
    })

    expect(result.current.resolveModelName("anthropic", "some-model")).toBe("some-model")
  })

  it("多个实例共享缓存，只请求一次", async () => {
    mockProviders.mockResolvedValueOnce({
      data: {
        providers: [
          {
            id: "openai",
            name: "OpenAI",
            models: { "gpt-4o": { name: "GPT-4o" } },
          },
        ],
        default: {},
      },
      error: null,
    } as any)

    const { result: r1 } = renderHook(() => useProviderStore())
    const { result: r2 } = renderHook(() => useProviderStore())

    await waitFor(() => {
      expect(r1.current.resolveModelName("openai", "gpt-4o")).toBe("GPT-4o")
    })

    expect(r2.current.resolveModelName("openai", "gpt-4o")).toBe("GPT-4o")
    expect(mockProviders).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 3: 运行测试验证通过**

Run: `cd packages/opencode/webgui && npx vitest run src/hooks/useProviderStore.test.ts`
Expected: 全部 PASS

- [ ] **Step 4: 提交**

```bash
git add packages/opencode/webgui/src/hooks/useProviderStore.ts packages/opencode/webgui/src/hooks/useProviderStore.test.ts
git commit -m "feat(webgui): add useProviderStore hook with module-level caching"
```

---

### Task 3: 新增 `AssistantMeta` 展示组件 + 测试

**Files:**

- Create: `packages/opencode/webgui/src/components/MessageList/AssistantMeta.tsx`
- Create: `packages/opencode/webgui/src/components/MessageList/AssistantMeta.test.tsx`

- [ ] **Step 1: 创建 `AssistantMeta.tsx`**

```tsx
// packages/opencode/webgui/src/components/MessageList/AssistantMeta.tsx
import { formatDuration } from "./turnMeta"

interface AssistantMetaProps {
  agent: string
  modelName: string
  variant?: string
  durationMs?: number
  interrupted?: boolean
}

export function AssistantMeta({ agent, modelName, variant, durationMs, interrupted }: AssistantMetaProps) {
  const agentLabel = agent ? agent[0].toUpperCase() + agent.slice(1) : ""
  const durationLabel = typeof durationMs === "number" && durationMs >= 0 ? formatDuration(durationMs) : ""

  const items = [agentLabel, modelName, variant || "", durationLabel, interrupted ? "interrupted" : ""].filter(Boolean)

  if (items.length === 0) return null

  return (
    <div className="pt-1 pb-2 text-xs text-gray-400 dark:text-gray-500" data-testid="assistant-meta">
      {items.join(" · ")}
    </div>
  )
}
```

- [ ] **Step 2: 编写 `AssistantMeta.test.tsx` 测试**

```tsx
// packages/opencode/webgui/src/components/MessageList/AssistantMeta.test.tsx
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { AssistantMeta } from "./AssistantMeta"

describe("AssistantMeta", () => {
  it("完整格式渲染：Agent · Model · Variant · Duration", () => {
    render(<AssistantMeta agent="code" modelName="Claude Sonnet 4" variant="high" durationMs={23000} />)
    expect(screen.getByTestId("assistant-meta")).toHaveTextContent("Code · Claude Sonnet 4 · high · 23s")
  })

  it("无 variant 时省略", () => {
    render(<AssistantMeta agent="code" modelName="Claude Sonnet 4" durationMs={23000} />)
    expect(screen.getByTestId("assistant-meta")).toHaveTextContent("Code · Claude Sonnet 4 · 23s")
  })

  it("中断时显示 interrupted", () => {
    render(<AssistantMeta agent="code" modelName="Claude Sonnet 4" variant="high" durationMs={23000} interrupted />)
    expect(screen.getByTestId("assistant-meta")).toHaveTextContent("Code · Claude Sonnet 4 · high · 23s · interrupted")
  })

  it("分钟级 duration 格式化", () => {
    render(<AssistantMeta agent="code" modelName="GPT-4o" durationMs={133000} />)
    expect(screen.getByTestId("assistant-meta")).toHaveTextContent("Code · GPT-4o · 2m 13s")
  })

  it("无 duration 时省略", () => {
    render(<AssistantMeta agent="code" modelName="Claude Sonnet 4" />)
    expect(screen.getByTestId("assistant-meta")).toHaveTextContent("Code · Claude Sonnet 4")
  })

  it("所有字段为空时不渲染", () => {
    const { container } = render(<AssistantMeta agent="" modelName="" />)
    expect(container.querySelector("[data-testid='assistant-meta']")).toBeNull()
  })
})
```

- [ ] **Step 3: 运行测试验证通过**

Run: `cd packages/opencode/webgui && npx vitest run src/components/MessageList/AssistantMeta.test.tsx`
Expected: 全部 PASS

- [ ] **Step 4: 提交**

```bash
git add packages/opencode/webgui/src/components/MessageList/AssistantMeta.tsx packages/opencode/webgui/src/components/MessageList/AssistantMeta.test.tsx
git commit -m "feat(webgui): add AssistantMeta display component"
```

---

### Task 4: 修改 `MessageRow` 以支持 meta 渲染

**Files:**

- Modify: `packages/opencode/webgui/src/components/MessageList/MessageRow.tsx`

- [ ] **Step 1: 给 `MessageRow` 添加 `showMeta` 和 `turnDurationMs` props，有条件渲染 `AssistantMeta`**

在 `MessageRow.tsx` 中：

1. 在 import 区域添加：

```tsx
import { AssistantMeta } from "./AssistantMeta"
import { useProviderStore } from "../../hooks/useProviderStore"
```

2. 扩展 `MessageRowProps` 接口：

```ts
interface MessageRowProps {
  message: Message
  onFork?: (messageId: string) => void
  onRevert?: (messageId: string) => void
  revertBusy?: boolean
  sessionID?: string
  isLast?: boolean
  showMeta?: boolean
  turnDurationMs?: number
}
```

3. 在函数签名中解构新 props：

```tsx
export function MessageRow({ message, onFork, onRevert, revertBusy, sessionID, isLast, showMeta, turnDurationMs }: MessageRowProps) {
```

4. 在函数体顶部（现有 `const error = ...` 之前）添加 provider store 调用：

```tsx
const { resolveModelName } = useProviderStore()
```

5. 在 `</div>` 闭合标签（包裹 parts 的 `space-y-1` div）之前，`{showMessageLevelError && ...}` 之后，`{message.parts.length === 0 && ...}` 之前，添加 meta 渲染：

```tsx
{
  /* Assistant turn meta (model, duration, etc.) */
}
{
  showMeta && isAssistant && assistantInfo?.time?.completed && (
    <AssistantMeta
      agent={(assistantInfo as any).agent ?? ""}
      modelName={resolveModelName((assistantInfo as any).providerID ?? "", (assistantInfo as any).modelID ?? "")}
      variant={(assistantInfo as any).variant || undefined}
      durationMs={turnDurationMs}
      interrupted={error?.name === "MessageAbortedError"}
    />
  )
}
```

- [ ] **Step 2: 运行现有 MessageList 测试确保无回归**

Run: `cd packages/opencode/webgui && npx vitest run src/components/MessageList/`
Expected: 全部 PASS（现有测试不传 `showMeta`，所以 meta 不会渲染，不影响）

- [ ] **Step 3: 提交**

```bash
git add packages/opencode/webgui/src/components/MessageList/MessageRow.tsx
git commit -m "feat(webgui): integrate AssistantMeta rendering into MessageRow"
```

---

### Task 5: 修改 `MessageList` 传递 turn meta 数据

**Files:**

- Modify: `packages/opencode/webgui/src/components/MessageList/index.tsx`

- [ ] **Step 1: 在 MessageList 中导入 `computeTurnMeta` 并计算 turn meta，传给 `MessageRow`**

1. 在 import 区域添加：

```tsx
import { computeTurnMeta } from "./turnMeta"
```

2. 在 `const lastMessageID = visibleMessages.at(-1)?.info.id` 行之后添加：

```tsx
const turnMeta = useMemo(() => computeTurnMeta(visibleMessages), [visibleMessages])
```

3. 修改 `renderRow` 函数，在调用 `<MessageRow>` 时增加两个 props。将原来的：

```tsx
<MessageRow
  message={message}
  onFork={handleForkStart}
  onRevert={handleRevert}
  revertBusy={isRevertBusy}
  sessionID={sessionID || undefined}
  isLast={message.info.id === lastMessageID}
/>
```

改为：

```tsx
<MessageRow
  message={message}
  onFork={handleForkStart}
  onRevert={handleRevert}
  revertBusy={isRevertBusy}
  sessionID={sessionID || undefined}
  isLast={message.info.id === lastMessageID}
  showMeta={message.info.id === turnMeta.lastAssistantID}
  turnDurationMs={message.info.id === turnMeta.lastAssistantID ? turnMeta.turnDurationMs : undefined}
/>
```

4. 在 `renderRow` 的依赖数组中追加 `turnMeta`。将原来的：

```tsx
    [handleForkStart, handleRevert, isRevertBusy, lastMessageID, revertBoundaryID, sessionID],
```

改为：

```tsx
    [handleForkStart, handleRevert, isRevertBusy, lastMessageID, revertBoundaryID, sessionID, turnMeta],
```

- [ ] **Step 2: 运行测试确保无回归**

Run: `cd packages/opencode/webgui && npx vitest run src/components/MessageList/`
Expected: 全部 PASS

- [ ] **Step 3: 提交**

```bash
git add packages/opencode/webgui/src/components/MessageList/index.tsx
git commit -m "feat(webgui): pass turn meta from MessageList to MessageRow"
```

---

### Task 6: 修改 `SubtaskMessageList` 传递 turn meta 数据

**Files:**

- Modify: `packages/opencode/webgui/src/components/SubtaskDrawer/SubtaskMessageList.tsx`

- [ ] **Step 1: 在 SubtaskMessageList 中导入 `computeTurnMeta`，计算并传递 turn meta**

1. 在 import 区域添加：

```tsx
import { useMemo } from "react"
import { computeTurnMeta } from "../MessageList/turnMeta"
```

注意：`useMemo` 需要合并到现有 react import（如果已导入则不需要重复导入）。当前文件没有导入 `useMemo`，所以需要从 react 补充导入。

2. 在 `const lastMessageID = sortedMessages.at(-1)?.info.id` 行之后添加：

```tsx
const turnMeta = useMemo(() => computeTurnMeta(sortedMessages), [sortedMessages])
```

3. 修改 `<MessageRow>` 调用，将原来的：

```tsx
<MessageRow key={message.info.id} message={message} sessionID={sessionID} isLast={message.info.id === lastMessageID} />
```

改为：

```tsx
<MessageRow
  key={message.info.id}
  message={message}
  sessionID={sessionID}
  isLast={message.info.id === lastMessageID}
  showMeta={message.info.id === turnMeta.lastAssistantID}
  turnDurationMs={message.info.id === turnMeta.lastAssistantID ? turnMeta.turnDurationMs : undefined}
/>
```

- [ ] **Step 2: 运行 SubtaskDrawer 测试确保无回归**

Run: `cd packages/opencode/webgui && npx vitest run src/components/SubtaskDrawer/`
Expected: 全部 PASS

- [ ] **Step 3: 提交**

```bash
git add packages/opencode/webgui/src/components/SubtaskDrawer/SubtaskMessageList.tsx
git commit -m "feat(webgui): add turn meta display to SubtaskMessageList"
```

---

### Task 7: 全量测试 + typecheck

**Files:** 无新文件

- [ ] **Step 1: 运行全部 webgui 测试**

Run: `cd packages/opencode/webgui && npx vitest run`
Expected: 全部 PASS

- [ ] **Step 2: 运行 typecheck**

Run: `cd packages/opencode && bun typecheck`
Expected: 无类型错误

- [ ] **Step 3: 最终提交（如 typecheck 导致改动）**

如果 typecheck 暴露需要修复的类型问题，修复后提交。否则跳过。
