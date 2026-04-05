# 子任务阻塞状态指示器 - 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 当子任务被 permission 或 question 阻塞时，在主界面 task 工具行上显示醒目的阻塞状态，引导用户打开弹层操作。

**Architecture:** 复用已有 SSE 事件驱动的 `permissions` 和 `questions` 状态，在 `ToolPart` 渲染层新增 `blocked` 计算，将结果传给 `ToolHeader` 控制视觉和交互变化。

**Tech Stack:** React, TypeScript, Tailwind CSS, Vitest

**Spec:** `docs/superpowers/specs/2026-04-06-subtask-blocked-indicator-design.md`

---

### Task 1: `utils.tsx` — 新增阻塞状态的图标和样式函数

**Files:**

- Modify: `packages/opencode/webgui/src/components/parts/ToolPart/utils.tsx`
- Test: `packages/opencode/webgui/src/components/parts/ToolPart/utils.test.tsx`

- [ ] **Step 1: 创建测试文件，编写 `getBlockedIcon` 和 `getBlockedClasses` 的失败测试**

```tsx
// packages/opencode/webgui/src/components/parts/ToolPart/utils.test.tsx
import { describe, expect, it } from "vitest"
import { render } from "@testing-library/react"
import { getBlockedIcon, getBlockedClasses, getBorderColor } from "./utils"

describe("getBlockedIcon", () => {
  it("permission 类型返回三角警告图标", () => {
    const icon = getBlockedIcon("permission")
    const { container } = render(icon)
    const svg = container.querySelector("svg")
    expect(svg).toBeTruthy()
    expect(svg?.classList.contains("text-amber-500")).toBe(true)
  })

  it("question 类型返回问号圆圈图标", () => {
    const icon = getBlockedIcon("question")
    const { container } = render(icon)
    const svg = container.querySelector("svg")
    expect(svg).toBeTruthy()
    expect(svg?.classList.contains("text-blue-500")).toBe(true)
  })
})

describe("getBlockedClasses", () => {
  it("permission 返回琥珀色背景类", () => {
    const cls = getBlockedClasses("permission")
    expect(cls).toContain("bg-amber-50/50")
    expect(cls).toContain("text-amber-700")
  })

  it("question 返回蓝色背景类", () => {
    const cls = getBlockedClasses("question")
    expect(cls).toContain("bg-blue-50/50")
    expect(cls).toContain("text-blue-700")
  })
})

describe("getBorderColor", () => {
  it("blocked 为 permission 时返回琥珀色边框", () => {
    const cls = getBorderColor("running", false, "permission")
    expect(cls).toContain("border-amber-400")
  })

  it("blocked 为 question 时返回蓝色边框", () => {
    const cls = getBorderColor("running", false, "question")
    expect(cls).toContain("border-blue-500")
  })

  it("blocked 为 null 时保持原有行为", () => {
    const cls = getBorderColor("running", false, null)
    expect(cls).toContain("border-gray-200")
  })

  it("error 状态始终优先", () => {
    const cls = getBorderColor("error", false, "permission")
    expect(cls).toContain("border-red-300")
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test packages/opencode/webgui/src/components/parts/ToolPart/utils.test.tsx`
Expected: FAIL — `getBlockedIcon` 和 `getBlockedClasses` 不存在，`getBorderColor` 签名不匹配

- [ ] **Step 3: 在 `utils.tsx` 中实现 `getBlockedIcon` 和 `getBlockedClasses`，并修改 `getBorderColor` 签名**

在 `utils.tsx` 末尾新增两个函数，并修改 `getBorderColor` 的签名以支持 `blocked` 参数：

```tsx
// 在 utils.tsx 中 getBorderColor 函数修改为：
export function getBorderColor(
  status: "pending" | "running" | "completed" | "error",
  hasPermission: boolean,
  blocked?: "permission" | "question" | null,
) {
  switch (status) {
    case "error":
      return "border-red-300 dark:border-red-700"
    default:
      if (blocked === "permission") return "border-amber-400 dark:border-amber-600"
      if (blocked === "question") return "border-blue-500 dark:border-blue-600"
      return hasPermission ? "border-amber-400 dark:border-amber-600" : "border-gray-200 dark:border-gray-700"
  }
}

// 在文件末尾新增：
export function getBlockedIcon(type: "permission" | "question"): ReactElement {
  if (type === "permission") {
    return (
      <svg className="w-3.5 h-3.5 animate-pulse text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"
        />
      </svg>
    )
  }
  return (
    <svg className="w-3.5 h-3.5 animate-pulse text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  )
}

export function getBlockedClasses(type: "permission" | "question") {
  if (type === "permission") {
    return "bg-amber-50/50 dark:bg-amber-900/10 text-amber-700 dark:text-amber-300"
  }
  return "bg-blue-50/50 dark:bg-blue-900/10 text-blue-700 dark:text-blue-300"
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `bun test packages/opencode/webgui/src/components/parts/ToolPart/utils.test.tsx`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/opencode/webgui/src/components/parts/ToolPart/utils.tsx packages/opencode/webgui/src/components/parts/ToolPart/utils.test.tsx
git commit -m "feat(webgui): add blocked state icon and style helpers for subtask indicator"
```

---

### Task 2: `ToolHeader.tsx` — 支持 `blocked` prop 改变视觉和交互

**Files:**

- Modify: `packages/opencode/webgui/src/components/parts/ToolPart/ToolHeader.tsx`

- [ ] **Step 1: 在 `ToolHeaderProps` 中新增两个可选 prop**

在 `ToolHeader.tsx` 的 `ToolHeaderProps` interface 中新增：

```tsx
interface ToolHeaderProps {
  // ...existing props...
  blocked?: "permission" | "question" | null
  onBlockedClick?: () => void
}
```

在函数参数解构中接收它们（默认值为 `null` 和 `undefined`）。

- [ ] **Step 2: 修改图标渲染：blocked 时替换 status icon**

在 `ToolHeader` 组件内部，将 `{getStatusIcon(status)}` 替换为条件渲染：

```tsx
import { getStatusIcon, getStatusClasses, getToolLabel, getBlockedIcon, getBlockedClasses } from "./utils"

// 在 return JSX 中：
{
  blocked ? getBlockedIcon(blocked) : getStatusIcon(status)
}
```

- [ ] **Step 3: 修改背景样式：blocked 时使用阻塞状态类**

将 header div 的 className 中 `${getStatusClasses(status)}` 改为条件选择：

```tsx
const bgClasses = blocked ? getBlockedClasses(blocked) : getStatusClasses(status)
```

在 className 模板中使用 `bgClasses` 替代 `getStatusClasses(status)`。

- [ ] **Step 4: 修改点击行为：blocked 时整行点击触发 `onBlockedClick`**

修改 header div 的 `onClick`：

```tsx
onClick={blocked && onBlockedClick ? onBlockedClick : isExpandable ? onToggle : undefined}
```

- [ ] **Step 5: 运行现有测试确认没有回归**

Run: `bun test packages/opencode/webgui/src/components/parts/ToolPart/`
Expected: 全部 PASS（现有测试不传 `blocked` prop，走默认 null 路径）

- [ ] **Step 6: 提交**

```bash
git add packages/opencode/webgui/src/components/parts/ToolPart/ToolHeader.tsx
git commit -m "feat(webgui): ToolHeader supports blocked prop for visual and click changes"
```

---

### Task 3: `ToolPart/index.tsx` — 核心逻辑：计算 blocked 并串联所有变更

**Files:**

- Modify: `packages/opencode/webgui/src/components/parts/ToolPart/index.tsx`

- [ ] **Step 1: 从 `useMessages` 额外解构 `permissions` 和 `getQuestionsBySession`**

修改第 61 行的解构：

```tsx
const { getPermissionForCall, getMessagesBySession, respondPermission, permissions, getQuestionsBySession } =
  useMessages()
```

- [ ] **Step 2: 新增 `blocked` 的 useMemo 计算**

在 `subtaskSessionId` 的 useMemo 之后新增：

```tsx
const blocked = useMemo(() => {
  if (!subtaskSessionId) return null
  if (permissions.some((p) => p.sessionID === subtaskSessionId)) return "permission" as const
  if (getQuestionsBySession(subtaskSessionId).length > 0) return "question" as const
  return null
}, [subtaskSessionId, permissions, getQuestionsBySession])
```

- [ ] **Step 3: 修改 `taskProgressName` 在 blocked 时替换文案**

修改 `taskProgressName` 的 useMemo（约第 234-254 行），在 `blocked` 非 null 时替换进度文案：

```tsx
const taskProgressName = useMemo(() => {
  if (part.tool !== "task") return null
  if (!subtaskSessionId) return null

  const label = getToolLabel(part.tool)
  const base = `${label}${subtaskTitle ? `：${subtaskTitle}` : ""}`

  if (blocked === "permission") return `${base} [ ⚠ 等待授权 — 点击查看 ]`
  if (blocked === "question") return `${base} [ ❓ 等待回答 — 点击查看 ]`

  const toolParts = getMessagesBySession(subtaskSessionId)
    .flatMap((message) => message.parts)
    .filter((messagePart) => messagePart.type === "tool")

  const currentTool = [...toolParts]
    .reverse()
    .find((toolPart) => toolPart.state?.status === "running" || toolPart.state?.status === "pending")

  const currentLabel = currentTool
    ? getToolLabel(currentTool.tool)
    : part.state.status === "completed"
      ? "已完成"
      : "空闲"
  return `${base} [ ${toolParts.length} 工具调用 / ${currentLabel} ]`
}, [part.tool, part.state.status, subtaskSessionId, subtaskTitle, blocked, getMessagesBySession])
```

- [ ] **Step 4: 新增 `handleBlockedClick` 回调**

在 `rightActions` 的 useMemo 之前新增：

```tsx
const handleBlockedClick = useMemo(() => {
  if (!blocked || !subtaskSessionId) return undefined
  const parent = sessionID ? { sessionId: sessionID, messageId: messageID, partId: part.id } : null
  return () =>
    openSubtaskDrawer({
      sessionId: subtaskSessionId,
      title: subtaskTitle,
      parent,
    })
}, [blocked, subtaskSessionId, subtaskTitle, sessionID, messageID, part.id, openSubtaskDrawer])
```

- [ ] **Step 5: 修改 `getBorderColor` 调用，传入 `blocked`**

修改第 289 行外层 div 的 className：

```tsx
className={`my-0.5 border ${getBorderColor(part.state.status, Boolean(permission), blocked)} overflow-hidden bg-gray-50 dark:bg-gray-900`}
```

- [ ] **Step 6: 将 `blocked` 和 `handleBlockedClick` 传给 `ToolHeader`**

修改 `ToolHeader` 的 props 传入（约第 292-304 行）：

```tsx
<ToolHeader
  tool={part.tool}
  status={part.state.status}
  toolName={headerToolName}
  filePath={filePath}
  patchFilePaths={patchFilePaths}
  isExpanded={isExpanded}
  isExpandable={isExpandable}
  onToggle={() => open.toggle(part.id)}
  time={part.state.time}
  rightActions={rightActions}
  lineRange={lineRange}
  blocked={blocked}
  onBlockedClick={handleBlockedClick}
/>
```

- [ ] **Step 7: 运行现有测试确认没有回归**

Run: `bun test packages/opencode/webgui/src/components/parts/ToolPart/`
Expected: 全部 PASS

- [ ] **Step 8: 提交**

```bash
git add packages/opencode/webgui/src/components/parts/ToolPart/index.tsx
git commit -m "feat(webgui): detect subtask blocked state and pass to ToolHeader"
```

---

### Task 4: `index.test.tsx` — 新增阻塞状态的测试用例

**Files:**

- Modify: `packages/opencode/webgui/src/components/parts/ToolPart/index.test.tsx`

- [ ] **Step 1: 在 mock 中暴露 `permissions` 和 `getQuestionsBySession`**

修改测试文件顶部的 `mocks` 和 `useMessages` mock：

```tsx
const mocks = vi.hoisted(() => ({
  isOpen: vi.fn(),
  toggle: vi.fn(),
  setOpen: vi.fn(),
  getPermissionForCall: vi.fn(),
  getMessagesBySession: vi.fn(),
  respondPermission: vi.fn(),
  openSubtaskDrawer: vi.fn(),
  permissions: [] as Array<{ id: string; sessionID: string; tool?: { messageID: string; callID: string } }>,
  getQuestionsBySession: vi.fn<(sessionID: string) => Array<any>>(),
}))

vi.mock("../../../state/MessagesContext", () => ({
  useMessages: () => ({
    getPermissionForCall: mocks.getPermissionForCall,
    getMessagesBySession: mocks.getMessagesBySession,
    respondPermission: mocks.respondPermission,
    permissions: mocks.permissions,
    getQuestionsBySession: mocks.getQuestionsBySession,
  }),
}))
```

在 `beforeEach` 中添加默认值：

```tsx
beforeEach(() => {
  // ...existing resets...
  mocks.permissions = []
  mocks.getQuestionsBySession.mockReturnValue([])
})
```

- [ ] **Step 2: 新增测试：子会话有 pending permission 时显示「等待授权」**

```tsx
it("子任务有待处理授权时，工具行显示等待授权状态", () => {
  mocks.permissions = [{ id: "perm-1", sessionID: "s-child", tool: { messageID: "m-sub", callID: "c-sub" } }]
  mocks.getMessagesBySession.mockReturnValue([
    {
      info: { id: "m1", sessionID: "s-child", role: "assistant", time: { created: 1 } },
      parts: [{ id: "t1", type: "tool", tool: "bash", state: { status: "running" } }],
    },
  ])

  const part = {
    id: "p-blocked-perm",
    type: "tool",
    callID: "c-blocked-perm",
    tool: "task",
    state: {
      status: "running",
      title: "Execute Commands",
      input: { description: "Execute Commands", subagent_type: "general", prompt: "run" },
      metadata: { sessionId: "s-child" },
    },
  } as any

  render(<ToolPart part={part} sessionID="s1" messageID="m1" />)

  expect(screen.getByText(/⚠ 等待授权/)).toBeInTheDocument()
  expect(screen.getByText(/点击查看/)).toBeInTheDocument()
})
```

- [ ] **Step 3: 新增测试：子会话有 pending question 时显示「等待回答」**

```tsx
it("子任务有待回答问题时，工具行显示等待回答状态", () => {
  mocks.getQuestionsBySession.mockImplementation((sid: string) =>
    sid === "s-child" ? [{ id: "q1", sessionID: "s-child" }] : [],
  )
  mocks.getMessagesBySession.mockReturnValue([
    {
      info: { id: "m1", sessionID: "s-child", role: "assistant", time: { created: 1 } },
      parts: [{ id: "t1", type: "tool", tool: "read", state: { status: "completed" } }],
    },
  ])

  const part = {
    id: "p-blocked-q",
    type: "tool",
    callID: "c-blocked-q",
    tool: "task",
    state: {
      status: "running",
      title: "Explore Codebase",
      input: { description: "Explore Codebase", subagent_type: "explore", prompt: "look" },
      metadata: { sessionId: "s-child" },
    },
  } as any

  render(<ToolPart part={part} sessionID="s1" messageID="m1" />)

  expect(screen.getByText(/❓ 等待回答/)).toBeInTheDocument()
  expect(screen.getByText(/点击查看/)).toBeInTheDocument()
})
```

- [ ] **Step 4: 新增测试：blocked 状态下点击整行打开弹层**

```tsx
it("阻塞状态下点击工具行整行打开子任务弹层", () => {
  mocks.permissions = [{ id: "perm-2", sessionID: "s-child", tool: { messageID: "m-sub", callID: "c-sub" } }]
  mocks.getMessagesBySession.mockReturnValue([])

  const part = {
    id: "p-click-blocked",
    type: "tool",
    callID: "c-click-blocked",
    tool: "task",
    state: {
      status: "running",
      title: "My Task",
      input: { description: "My Task", subagent_type: "general", prompt: "go" },
      metadata: { sessionId: "s-child" },
    },
  } as any

  render(<ToolPart part={part} sessionID="s1" messageID="m1" />)

  const header = screen.getByRole("button", { name: /等待授权/ })
  fireEvent.click(header)

  expect(mocks.openSubtaskDrawer).toHaveBeenCalledWith({
    sessionId: "s-child",
    title: "My Task",
    parent: { sessionId: "s1", messageId: "m1", partId: "p-click-blocked" },
  })
})
```

- [ ] **Step 5: 新增测试：permission 清除后恢复正常状态**

```tsx
it("授权完成后工具行恢复正常运行状态", () => {
  mocks.permissions = [{ id: "perm-3", sessionID: "s-child", tool: { messageID: "m-sub", callID: "c-sub" } }]
  mocks.getMessagesBySession.mockReturnValue([
    {
      info: { id: "m1", sessionID: "s-child", role: "assistant", time: { created: 1 } },
      parts: [{ id: "t1", type: "tool", tool: "bash", state: { status: "running" } }],
    },
  ])

  const part = {
    id: "p-recover",
    type: "tool",
    callID: "c-recover",
    tool: "task",
    state: {
      status: "running",
      title: "My Task",
      input: { description: "My Task", subagent_type: "general", prompt: "go" },
      metadata: { sessionId: "s-child" },
    },
  } as any

  const view = render(<ToolPart part={part} sessionID="s1" messageID="m1" />)

  expect(screen.getByText(/⚠ 等待授权/)).toBeInTheDocument()

  // 模拟 permission 被清除
  mocks.permissions = []
  view.rerender(<ToolPart part={part} sessionID="s1" messageID="m1" />)

  expect(screen.queryByText(/⚠ 等待授权/)).not.toBeInTheDocument()
  expect(screen.getByText(/1 工具调用/)).toBeInTheDocument()
})
```

- [ ] **Step 6: 运行全部测试确认通过**

Run: `bun test packages/opencode/webgui/src/components/parts/ToolPart/`
Expected: 全部 PASS

- [ ] **Step 7: 提交**

```bash
git add packages/opencode/webgui/src/components/parts/ToolPart/index.test.tsx
git commit -m "test(webgui): add tests for subtask blocked state indicator"
```

---

### Task 5: 回归验证

**Files:** 无新改动

- [ ] **Step 1: 运行 webgui 全量测试**

Run: `bun test packages/opencode/webgui/`
Expected: 全部 PASS

- [ ] **Step 2: 运行类型检查**

Run: `bun typecheck` (从 `packages/opencode` 目录)
Expected: 无新增类型错误

- [ ] **Step 3: 确认 SubtaskDrawer 测试不受影响**

Run: `bun test packages/opencode/webgui/src/components/SubtaskDrawer/`
Expected: 全部 PASS

- [ ] **Step 4: 最终提交（如有格式化修复）**

```bash
git add -A
git commit -m "chore: format and final cleanup for subtask blocked indicator"
```
