# WebGUI Message Copy Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一 WebGUI 对话区域复制逻辑，修复用户消息选区复制“时灵时不灵”的问题。

**Architecture:** 新增 `messageCopy.ts` 作为消息复制领域边界，集中处理消息级复制文本、用户选区到原文映射和 fallback。`TextPart.tsx` 只负责渲染与 copy event 接线，`MessageRow.tsx` 复用统一 serializer 给悬浮按钮提供文本，`KeyboardHandler` 仅补测试保障现有快捷键语义。

**Tech Stack:** React 19、TypeScript、Vitest、Testing Library、Bun。不要提交 commit，除非用户后续明确要求。

---

## Files

- Create: `packages/opencode/webgui/src/components/MessageList/messageCopy.ts`
- Create: `packages/opencode/webgui/src/components/MessageList/messageCopy.test.ts`
- Modify: `packages/opencode/webgui/src/components/MessageList/TextPart.tsx`
- Modify: `packages/opencode/webgui/src/components/MessageList/TextPart.test.tsx`
- Modify: `packages/opencode/webgui/src/components/MessageList/MessageRow.tsx`
- Modify: `packages/opencode/webgui/src/components/MessageList/MessageRow.test.tsx`
- Modify: `packages/opencode/webgui/src/lib/keyboardHandler.test.ts`

---

### Task 1: 新增消息复制纯函数与失败测试

**Files:**

- Create: `packages/opencode/webgui/src/components/MessageList/messageCopy.ts`
- Create: `packages/opencode/webgui/src/components/MessageList/messageCopy.test.ts`

- [ ] **Step 1: 创建空实现文件**

Create `packages/opencode/webgui/src/components/MessageList/messageCopy.ts`:

```ts
import type { Message } from "../../state/MessagesContext"

export function getMessageCopyText(_message: Message) {
  return null
}

export function getUserTextCopySelection(_input: { text: string; wrapper: HTMLElement; selection: Selection }) {
  return null
}
```

- [ ] **Step 2: 写 serializer 失败测试**

Create `packages/opencode/webgui/src/components/MessageList/messageCopy.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { getMessageCopyText } from "./messageCopy"

describe("messageCopy", () => {
  it("用户消息按钮复制应复用 canonical 文本规则", () => {
    const message = {
      info: { id: "u1", role: "user", time: { created: 1 } },
      parts: [
        { id: "p1", type: "text", text: "  第一段" },
        { id: "p2", type: "text", text: "忽略", synthetic: true },
        { id: "p3", type: "tool", tool: "bash" },
        { id: "p4", type: "text", text: "第二段  " },
      ],
    }

    expect(getMessageCopyText(message as never)).toBe("第一段\n第二段")
  })

  it("助手消息按钮复制应保留当前非 synthetic text 拼接规则", () => {
    const message = {
      info: { id: "a1", role: "assistant", time: { created: 1 } },
      parts: [
        { id: "p1", type: "text", text: "hello" },
        { id: "p2", type: "text", text: "忽略", synthetic: true },
        { id: "p3", type: "text", text: " world" },
      ],
    }

    expect(getMessageCopyText(message as never)).toBe("hello world")
  })

  it("没有可复制文本时返回 null", () => {
    const message = {
      info: { id: "u1", role: "user", time: { created: 1 } },
      parts: [{ id: "p1", type: "text", text: "   " }],
    }

    expect(getMessageCopyText(message as never)).toBeNull()
  })
})
```

- [ ] **Step 3: 运行测试确认 RED**

Run:

```powershell
bun test src/components/MessageList/messageCopy.test.ts
```

Working directory: `packages/opencode/webgui`

Expected: FAIL，`getMessageCopyText` 返回 `null`，但期望 canonical 文本。

- [ ] **Step 4: 实现 serializer 最小代码**

Update `messageCopy.ts`:

```ts
import type { Message } from "../../state/MessagesContext"
import { getUserMessagePlainText } from "./utils"

export function getMessageCopyText(message: Message) {
  if (message.info.role === "user") return getUserMessagePlainText(message)

  const text = message.parts
    .flatMap((part) => {
      if (part.type !== "text") return []
      const synthetic = (part as { synthetic?: boolean }).synthetic
      if (synthetic) return []
      const value = (part as { text?: string }).text
      return typeof value === "string" && value.length > 0 ? [value] : []
    })
    .join("")

  return text.length > 0 ? text : null
}

export function getUserTextCopySelection(_input: { text: string; wrapper: HTMLElement; selection: Selection }) {
  return null
}
```

- [ ] **Step 5: 运行测试确认 GREEN**

Run:

```powershell
bun test src/components/MessageList/messageCopy.test.ts
```

Expected: PASS。

---

### Task 2: 增加用户选区映射纯函数

**Files:**

- Modify: `packages/opencode/webgui/src/components/MessageList/messageCopy.ts`
- Modify: `packages/opencode/webgui/src/components/MessageList/messageCopy.test.ts`

- [ ] **Step 1: 写普通文本选区失败测试**

Append to `messageCopy.test.ts` inside `describe`:

```ts
it("普通用户文本选区应返回原文片段", () => {
  const wrapper = document.createElement("div")
  wrapper.innerHTML =
    '<span data-rawpart="1" data-raw="hello world" data-raw-start="0" data-raw-end="11">hello world</span>'
  document.body.appendChild(wrapper)
  const text = wrapper.firstChild?.firstChild
  expect(text).toBeTruthy()

  const range = document.createRange()
  range.setStart(text!, 6)
  range.setEnd(text!, 11)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)

  expect(getUserTextCopySelection({ text: "hello world", wrapper, selection })).toBe("world")
  wrapper.remove()
  selection.removeAllRanges()
})
```

- [ ] **Step 2: 运行测试确认 RED**

Run:

```powershell
bun test src/components/MessageList/messageCopy.test.ts
```

Expected: FAIL，选区函数返回 `null`。

- [ ] **Step 3: 实现普通文本选区映射**

Update `getUserTextCopySelection` in `messageCopy.ts`:

```ts
export function getUserTextCopySelection(input: { text: string; wrapper: HTMLElement; selection: Selection }) {
  const { text, wrapper, selection } = input
  if (selection.rangeCount === 0) return null

  const range = selection.getRangeAt(0)
  if (!wrapper.contains(range.commonAncestorContainer)) return null
  if (range.collapsed) return text.length > 0 ? text : null

  const fallback = selection.toString()
  const parts = Array.from(wrapper.querySelectorAll<HTMLElement>("[data-rawpart]"))
  if (parts.length === 0) return fallback.length > 0 ? fallback : null

  const contains = (node: Node, element: HTMLElement) => node === element || element.contains(node)
  let start = parts.findIndex((part) => contains(range.startContainer, part))
  let end = parts.findIndex((part) => contains(range.endContainer, part))

  if (start === -1 && range.startContainer === wrapper) start = Math.min(range.startOffset, parts.length - 1)
  if (end === -1 && range.endContainer === wrapper) end = Math.min(range.endOffset, parts.length) - 1
  if (start < 0 || end < start) return fallback.length > 0 ? fallback : null

  let rawStart = text.length
  let rawEnd = 0

  parts.slice(start, end + 1).forEach((part, index) => {
    const partStart = Number(part.getAttribute("data-raw-start"))
    const partEnd = Number(part.getAttribute("data-raw-end"))
    if (Number.isNaN(partStart) || Number.isNaN(partEnd)) return

    if (part.hasAttribute("data-raw-mention")) {
      rawStart = Math.min(rawStart, partStart)
      rawEnd = Math.max(rawEnd, partEnd)
      return
    }

    const first = index === 0
    const last = index === end - start
    const localStart =
      first && contains(range.startContainer, part) ? offsetWithin(part, range.startContainer, range.startOffset) : 0
    const localEnd =
      last && contains(range.endContainer, part)
        ? offsetWithin(part, range.endContainer, range.endOffset)
        : partEnd - partStart
    const boundedStart = Math.max(0, Math.min(localStart, partEnd - partStart))
    const boundedEnd = Math.max(0, Math.min(localEnd, partEnd - partStart))

    if (boundedEnd > boundedStart) {
      rawStart = Math.min(rawStart, partStart + boundedStart)
      rawEnd = Math.max(rawEnd, partStart + boundedEnd)
    }
  })

  if (rawEnd > rawStart) return text.slice(rawStart, rawEnd)
  return fallback.length > 0 ? fallback : null
}

function offsetWithin(element: HTMLElement, container: Node, offset: number) {
  const range = document.createRange()
  range.selectNodeContents(element)
  range.setEnd(container, offset)
  return range.toString().length
}
```

- [ ] **Step 4: 运行测试确认 GREEN**

Run:

```powershell
bun test src/components/MessageList/messageCopy.test.ts
```

Expected: PASS。

- [ ] **Step 5: 写 mention 与 fallback 失败测试**

Append to `messageCopy.test.ts` inside `describe`:

```ts
it("包含 mention 的选区应复制 raw mention 文本", () => {
  const wrapper = document.createElement("div")
  wrapper.innerHTML = [
    '<span data-rawpart="1" data-raw="open " data-raw-start="0" data-raw-end="5">open </span>',
    '<span data-rawpart="1" data-raw-mention="1" data-raw="@file.txt" data-raw-start="5" data-raw-end="14"><button>file.txt</button></span>',
  ].join("")
  document.body.appendChild(wrapper)

  const range = document.createRange()
  range.setStart(wrapper.firstChild!.firstChild!, 0)
  range.setEnd(wrapper.lastChild!, 1)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)

  expect(getUserTextCopySelection({ text: "open @file.txt", wrapper, selection })).toBe("open @file.txt")
  wrapper.remove()
  selection.removeAllRanges()
})

it("部分选中 mention 时应复制完整 raw mention 文本", () => {
  const wrapper = document.createElement("div")
  wrapper.innerHTML =
    '<span data-rawpart="1" data-raw-mention="1" data-raw="@file.txt" data-raw-start="0" data-raw-end="9"><button>file.txt</button></span>'
  document.body.appendChild(wrapper)

  const label = wrapper.querySelector("button")!.firstChild!
  const range = document.createRange()
  range.setStart(label, 1)
  range.setEnd(label, 4)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)

  expect(getUserTextCopySelection({ text: "@file.txt", wrapper, selection })).toBe("@file.txt")
  wrapper.remove()
  selection.removeAllRanges()
})

it("选区不在 wrapper 内时返回 null 以放行默认复制", () => {
  const wrapper = document.createElement("div")
  wrapper.textContent = "inside"
  const outside = document.createElement("div")
  outside.textContent = "outside"
  document.body.append(wrapper, outside)

  const range = document.createRange()
  range.selectNodeContents(outside)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)

  expect(getUserTextCopySelection({ text: "inside", wrapper, selection })).toBeNull()
  wrapper.remove()
  outside.remove()
  selection.removeAllRanges()
})

it("映射失败时应 fallback 到可见选区文本", () => {
  const wrapper = document.createElement("div")
  wrapper.innerHTML = '<span data-rawpart="1" data-raw="broken" data-raw-start="x" data-raw-end="y">visible</span>'
  document.body.appendChild(wrapper)

  const range = document.createRange()
  range.selectNodeContents(wrapper.firstChild!)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)

  expect(getUserTextCopySelection({ text: "broken", wrapper, selection })).toBe("visible")
  wrapper.remove()
  selection.removeAllRanges()
})
```

- [ ] **Step 6: 运行测试确认 RED 或发现缺口**

Run:

```powershell
bun test src/components/MessageList/messageCopy.test.ts
```

Expected: 如果 mention 跨节点 end 处理不足则 FAIL；如果已 PASS，继续补回归测试即可。

- [ ] **Step 7: 完善 endContainer/focusNode 处理**

If needed, update `getUserTextCopySelection` to prefer `selection.focusNode` for end part matching, while retaining fallback to `range.endContainer`.

- [ ] **Step 8: 运行测试确认 GREEN**

Run:

```powershell
bun test src/components/MessageList/messageCopy.test.ts
```

Expected: PASS。

- [ ] **Step 9: 补充评审提出的组件级边界测试**

Add TextPart tests for wrapper 外 selection 放行默认复制，以及跨普通文本、mention、后续普通文本时复制 raw 原文。Run:

```powershell
bun run test -- src/components/MessageList/TextPart.test.tsx
```

Expected: PASS。

---

### Task 3: TextPart 接入统一选区复制

**Files:**

- Modify: `packages/opencode/webgui/src/components/MessageList/TextPart.tsx`
- Modify: `packages/opencode/webgui/src/components/MessageList/TextPart.test.tsx`

- [ ] **Step 1: 写 TextPart copy 失败测试**

Append to `TextPart.test.tsx` inside `describe`:

```tsx
it("用户消息普通选区复制应写入选区文本", () => {
  render(<TextPart part={{ id: "p4", type: "text", text: "hello world" } as any} isUser={true} />)

  const content = screen.getByText("hello world")
  const text = content.firstChild!
  const range = document.createRange()
  range.setStart(text, 6)
  range.setEnd(text, 11)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)

  const setData = vi.fn()
  fireEvent.copy(content, {
    clipboardData: { setData },
  })

  expect(setData).toHaveBeenCalledWith("text/plain", "world")
  selection.removeAllRanges()
})

it("用户消息折叠选区复制应写入整条消息", () => {
  render(<TextPart part={{ id: "p5", type: "text", text: "hello world" } as any} isUser={true} />)

  const content = screen.getByText("hello world")
  const text = content.firstChild!
  const range = document.createRange()
  range.setStart(text, 3)
  range.collapse(true)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)

  const setData = vi.fn()
  fireEvent.copy(content, {
    clipboardData: { setData },
  })

  expect(setData).toHaveBeenCalledWith("text/plain", "hello world")
  selection.removeAllRanges()
})
```

- [ ] **Step 2: 运行测试确认 RED**

Run:

```powershell
bun test src/components/MessageList/TextPart.test.tsx
```

Expected: 至少普通选区用旧逻辑仍可能 PASS；若没有失败，增加 mention/fallback 测试确保旧逻辑暴露问题。

- [ ] **Step 3: 改 TextPart 使用 messageCopy**

Update `TextPart.tsx`:

```ts
import { getUserTextCopySelection } from "./messageCopy"
```

Replace the large `handleCopy` body in the user branch with:

```ts
const handleCopy = (e: React.ClipboardEvent<HTMLDivElement>) => {
  if (!e.clipboardData) return

  const selection = window.getSelection()
  const wrapper = ref.current
  if (!selection || !wrapper || selection.rangeCount === 0) return

  const value = getUserTextCopySelection({ text, wrapper, selection })
  if (!value) return

  e.preventDefault()
  e.stopPropagation()
  e.clipboardData.setData("text/plain", value)
}
```

- [ ] **Step 4: 运行 TextPart 测试确认 GREEN**

Run:

```powershell
bun test src/components/MessageList/TextPart.test.tsx
```

Expected: PASS。

---

### Task 4: MessageRow 接入统一按钮复制文本

**Files:**

- Modify: `packages/opencode/webgui/src/components/MessageList/MessageRow.tsx`
- Modify: `packages/opencode/webgui/src/components/MessageList/MessageRow.test.tsx`

- [ ] **Step 1: 调整 ActionButtons mock 记录 props**

Update top of `MessageRow.test.tsx`:

```tsx
const actionButtonsSpy = vi.fn((_props: Record<string, unknown>) => <div data-testid="action-buttons" />)
```

Update mock:

```tsx
vi.mock("./ActionButtons", () => ({
  ActionButtons: (props: Record<string, unknown>) => actionButtonsSpy(props),
}))
```

- [ ] **Step 2: 写按钮复制文本失败测试**

Append to `MessageRow.test.tsx` inside `describe`:

```tsx
it("用户消息复制按钮应接收 canonical copyText", () => {
  const message = {
    info: {
      id: "u-copy",
      sessionID: "s1",
      role: "user",
      time: { created: 1 },
    },
    parts: [
      { id: "p1", type: "text", text: "  第一段" },
      { id: "p2", type: "text", text: "忽略", synthetic: true },
      { id: "p3", type: "text", text: "第二段  " },
    ],
  }

  const { container } = render(<MessageRow message={message as never} isLast />)
  fireEvent.mouseEnter(container.firstElementChild!)

  expect(actionButtonsSpy).toHaveBeenCalledWith(expect.objectContaining({ copyText: "第一段\n第二段" }))
})
```

Ensure `fireEvent` is imported:

```ts
import { fireEvent, render, screen } from "@testing-library/react"
```

- [ ] **Step 3: 运行测试确认 RED**

Run:

```powershell
bun test src/components/MessageList/MessageRow.test.tsx
```

Expected: FAIL，当前 copyText 是 `"  第一段第二段  "` 或类似空字符串拼接结果。

- [ ] **Step 4: 修改 MessageRow 使用 getMessageCopyText**

Update imports in `MessageRow.tsx`:

```ts
import { getMessageCopyText } from "./messageCopy"
```

Replace `copyText` construction with:

```ts
const copyText = getMessageCopyText(message) ?? ""
```

- [ ] **Step 5: 运行测试确认 GREEN**

Run:

```powershell
bun test src/components/MessageList/MessageRow.test.tsx
```

Expected: PASS。

---

### Task 5: 补强 KeyboardHandler 快捷键语义测试

**Files:**

- Modify: `packages/opencode/webgui/src/lib/keyboardHandler.test.ts`

- [ ] **Step 1: 写 copy 成功阻止默认测试**

Append to `keyboardHandler.test.ts` inside `describe`:

```ts
it("当 Ctrl+C 的 execCommand(copy) 成功时应阻止默认行为", () => {
  const el = createEditable()
  el.value = "hello"
  el.setSelectionRange(0, 5)

  const prev = Reflect.get(document, "execCommand")
  const cmd = vi.fn(() => true)
  Object.defineProperty(document, "execCommand", {
    value: cmd,
    configurable: true,
  })
  const handler = new KeyboardHandler()
  const ev = new KeyboardEvent("keydown", {
    key: "c",
    code: "KeyC",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  })

  el.dispatchEvent(ev)

  expect(cmd).toHaveBeenCalledWith("copy")
  expect(ev.defaultPrevented).toBe(true)

  handler.destroy()
  Object.defineProperty(document, "execCommand", {
    value: prev,
    configurable: true,
  })
})

it("非编辑区域存在 DOM 选区时 Ctrl+C 应在 iframe 内执行 copy 命令", () => {
  const text = document.createElement("div")
  text.textContent = "message text"
  document.body.appendChild(text)
  const range = document.createRange()
  range.selectNodeContents(text)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)

  const prev = Reflect.get(document, "execCommand")
  const cmd = vi.fn(() => true)
  Object.defineProperty(document, "execCommand", {
    value: cmd,
    configurable: true,
  })
  const handler = new KeyboardHandler()
  const ev = new KeyboardEvent("keydown", {
    key: "c",
    code: "KeyC",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  })

  text.dispatchEvent(ev)

  expect(cmd).toHaveBeenCalledWith("copy")
  expect(ev.defaultPrevented).toBe(true)
  expect(postMessageSpy).not.toHaveBeenCalled()

  handler.destroy()
  Object.defineProperty(document, "execCommand", {
    value: prev,
    configurable: true,
  })
  selection.removeAllRanges()
})
```

- [ ] **Step 2: 运行测试确认 GREEN**

Run:

```powershell
bun test src/lib/keyboardHandler.test.ts
```

Expected: PASS。此任务不改生产代码。

---

### Task 6: 全量相关验证

**Files:**

- No code changes unless tests reveal issues.

- [ ] **Step 1: 运行 MessageList 相关测试**

Run:

```powershell
bun test src/components/MessageList/messageCopy.test.ts src/components/MessageList/TextPart.test.tsx src/components/MessageList/MessageRow.test.tsx src/components/MessageList/ActionButtons.test.tsx src/lib/keyboardHandler.test.ts
```

Working directory: `packages/opencode/webgui`

Expected: PASS。

- [ ] **Step 2: 运行 WebGUI typecheck**

Run:

```powershell
bun typecheck
```

Working directory: `packages/opencode/webgui`

Expected: PASS。

- [ ] **Step 3: 检查 git diff**

Run:

```powershell
git diff -- packages/opencode/webgui/src/components/MessageList/messageCopy.ts packages/opencode/webgui/src/components/MessageList/messageCopy.test.ts packages/opencode/webgui/src/components/MessageList/TextPart.tsx packages/opencode/webgui/src/components/MessageList/TextPart.test.tsx packages/opencode/webgui/src/components/MessageList/MessageRow.tsx packages/opencode/webgui/src/components/MessageList/MessageRow.test.tsx packages/opencode/webgui/src/lib/keyboardHandler.test.ts docs/superpowers/specs/2026-05-22-webgui-message-copy-redesign.md docs/superpowers/plans/2026-05-22-webgui-message-copy-redesign.md
```

Expected: diff 只包含本计划相关变更。
