# 快捷短语固定交互 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 去掉 WebGUI 快捷短语可切换的"输入模式"，固定为左键双击立即发送、右键双击回填输入框，并彻底移除 `mode` 概念。

**Architecture:** 短语按钮左键双击沿用原生 `dblclick` 触发发送；右键双击在 `onContextMenu` 中 `preventDefault()` 阻止系统菜单，用组件内 `useRef` 记录上次右键时间戳，间隔 ≤ 400ms 判定为右键双击触发回填。数据层删除 `mode` 字段与 `setQuickPhraseMode`，设置页删除输入模式下拉。

**Tech Stack:** React + TypeScript + Vitest + @testing-library/react，包路径 `packages/opencode/webgui`。

设计依据：`docs/superpowers/specs/2026-06-01-quick-phrase-fixed-interaction-design.md`

---

## 约定

- 所有测试命令在 `packages/opencode/webgui` 目录下执行（使用工具的 `workdir` 参数，不要 `cd`）。
- 运行单个测试文件：`bun run test:run <相对路径>`
- 运行单个用例：`bun run test:run <相对路径> -t "<用例名>"`
- 类型检查/构建：`bun run build`（即 `tsc -b && vite build`）

## 文件结构

本次改动涉及以下文件，按职责划分：

| 文件                                                  | 职责                   | 改动                                                   |
| ----------------------------------------------------- | ---------------------- | ------------------------------------------------------ |
| `src/state/repo/quickPhraseRepo.ts`                   | 快捷短语持久化与归一化 | 删除 `mode` 类型/字段/解析/`setQuickPhraseMode`        |
| `src/state/repo/quickPhraseRepo.test.ts`              | repo 单测              | 删除 3 处 `mode` 断言                                  |
| `src/components/settings/QuickPhrasesTab.tsx`         | 设置页快捷短语管理     | 删除输入模式下拉与 `mode` state                        |
| `src/components/settings/QuickPhrasesTab.test.tsx`    | 设置页单测             | 删除"可以切换输入模式"用例与相关 mock                  |
| `src/components/MessageInput/QuickPhraseBar.tsx`      | 短语栏渲染与交互       | 用 `onSend`/`onFill` 替代 `onActivate`，加右键双击检测 |
| `src/components/MessageInput/QuickPhraseBar.test.tsx` | 短语栏单测             | 改 props 签名，加左/右键双击与禁用用例                 |
| `src/components/MessageInput/index.tsx`               | 输入区主组件           | 删除 mode 分发与确认弹窗，接 `onSend`/`onFill`         |
| `src/components/MessageInput/index.test.tsx`          | 主组件单测             | 重写 6 个 mode 用例为 onSend/onFill                    |
| `docs/repowiki/06-settings-update-localization.md`    | 文档                   | 更新模式描述为固定行为                                 |
| `docs/repowiki/04-session-chat.md`                    | 文档                   | 更新模式描述为固定行为                                 |

---

## Task 1: 数据层移除 mode 概念

**Files:**

- Modify: `src/state/repo/quickPhraseRepo.ts`
- Test: `src/state/repo/quickPhraseRepo.test.ts`

- [ ] **Step 1: 改写 repo 测试，移除 mode 断言**

打开 `src/state/repo/quickPhraseRepo.test.ts`：

第一个用例（第 25-35 行）改名并删除 mode 断言：

```typescript
it("loadQuickPhraseState 在空存储时注入预置", async () => {
  vi.mocked(scopedStateGetJSON).mockResolvedValue(null)

  const value = await loadQuickPhraseState()

  expect(value.preset_version).toBe(quick_phrase_preset.version)
  expect(value.order).toEqual(quick_phrase_preset.items.map((item) => item.id))
  expect(Object.values(value.items).map((item) => item.source)).toEqual(quick_phrase_preset.items.map(() => "preset"))
  expect(scopedStateGetJSON).toHaveBeenCalledWith("global", "opencode:webgui:global:quick_phrase:v1", null)
})
```

第二个用例（第 37-77 行）：删除存储输入里的 `mode: "confirm_send",` 这一行（第 40 行），并删除断言 `expect(value.mode).toBe("confirm_send")`（第 70 行）。其余断言保留。

第三个用例（第 79-107 行）`saveQuickPhraseState 写入 global quick_phrase key`：删除 `saveQuickPhraseState` 入参对象里的 `mode: "fill_input",`（第 83 行），并把断言里的 `expect.objectContaining({ mode: "fill_input", preset_version: ... })` 改为只断言 `preset_version`：

```typescript
expect(scopedStateSetJSON).toHaveBeenCalledWith(
  "global",
  "opencode:webgui:global:quick_phrase:v1",
  expect.objectContaining({
    preset_version: quick_phrase_preset.version,
  }),
)
```

- [ ] **Step 2: 运行 repo 测试，确认因 ts/类型或断言失败**

Run: `bun run test:run src/state/repo/quickPhraseRepo.test.ts`
Expected: 仍 PASS（此步只改了测试，实现还在），因为删除断言不会让测试失败；此步用于确认改过的测试在旧实现下不报错。若有 TS 报错（如未用变量）按提示修正。

- [ ] **Step 3: 修改 quickPhraseRepo.ts 删除 mode**

打开 `src/state/repo/quickPhraseRepo.ts`：

删除第 6 行类型导出：

```typescript
export type QuickPhraseMode = "double_send" | "confirm_send" | "fill_input"
```

从 `QuickPhraseState`（第 18-23 行）删除 `mode: QuickPhraseMode` 字段，改为：

```typescript
export type QuickPhraseState = {
  preset_version: number
  order: string[]
  items: Record<string, QuickPhraseItem>
}
```

删除第 27-30 行的内部 `mode` 辅助函数：

```typescript
function mode(input: unknown): QuickPhraseMode {
  if (input === "double_send" || input === "confirm_send" || input === "fill_input") return input
  return "double_send"
}
```

在 `normalize()` 的返回对象（第 99-104 行）删除 `mode: mode((raw as { mode?: unknown }).mode),` 这一行，改为：

```typescript
return {
  preset_version: quick_phrase_preset.version,
  order: [...new Set([...base, ...rest])],
  items,
}
```

删除 `setQuickPhraseMode` 函数（第 146-156 行）整段。

- [ ] **Step 4: 运行 repo 测试，确认通过**

Run: `bun run test:run src/state/repo/quickPhraseRepo.test.ts`
Expected: PASS（全部用例通过）

- [ ] **Step 5: 提交**

```bash
git add src/state/repo/quickPhraseRepo.ts src/state/repo/quickPhraseRepo.test.ts
git commit -m "refactor(webgui): remove quick phrase mode from repo"
```

---

## Task 2: 设置页移除输入模式下拉

**Files:**

- Modify: `src/components/settings/QuickPhrasesTab.tsx`
- Test: `src/components/settings/QuickPhrasesTab.test.tsx`

- [ ] **Step 1: 改写设置页测试，删除切换模式用例与相关 mock**

打开 `src/components/settings/QuickPhrasesTab.test.tsx`：

从 `vi.hoisted` mock 对象（第 4-12 行）删除 `setQuickPhraseMode: vi.fn(),`。

从 `vi.mock("../../state/repo/quickPhraseRepo", ...)`（第 14-23 行）删除这一行：

```typescript
  setQuickPhraseMode: (mode: "double_send" | "confirm_send" | "fill_input") => mocks.setQuickPhraseMode(mode),
```

从 `state` 对象（第 27-28 行）删除 `mode: "fill_input" as const,`。

从 `beforeEach`（第 57 行）删除 `mocks.setQuickPhraseMode.mockResolvedValue(state)`。

删除整个"可以切换输入模式"用例（第 65-76 行）。

- [ ] **Step 2: 运行设置页测试，确认其余用例通过**

Run: `bun run test:run src/components/settings/QuickPhrasesTab.test.tsx`
Expected: 仍 PASS（删了用例和 mock，实现还在旧版，未引用已删 mock 不会报错）。若 TS 报"setQuickPhraseMode 未使用导入"等，按提示清理。

- [ ] **Step 3: 修改 QuickPhrasesTab.tsx 删除模式 UI 与 state**

打开 `src/components/settings/QuickPhrasesTab.tsx`：

修改 import（第 2-12 行），删除 `setQuickPhraseMode,` 与 `type QuickPhraseMode,`：

```typescript
import {
  addCustomQuickPhrase,
  loadQuickPhraseState,
  reorderQuickPhrase,
  removeQuickPhrase,
  toggleQuickPhraseHidden,
  updateCustomQuickPhrase,
  type QuickPhraseState,
} from "../../state/repo/quickPhraseRepo"
```

删除第 16 行 `const [mode, setMode] = useState<QuickPhraseMode>("fill_input")`。

在 `apply()`（第 27-32 行）删除 `setMode(state.mode)`，改为：

```typescript
function apply(state: QuickPhraseState) {
  setOrder(state.order)
  setItems(state.items)
  window.dispatchEvent(new Event(quick_phrase_updated_event))
}
```

删除整个输入模式区块（第 72-90 行 `<div>` 含 `<label htmlFor="quick-phrase-mode">` 与 `<select id="quick-phrase-mode">`）。

检查 `useState` 是否仍被其它 state 使用（`order`、`items`、`title`、`body`、`editing` 等都还在用），保留 `useState` import。

- [ ] **Step 4: 运行设置页测试，确认通过**

Run: `bun run test:run src/components/settings/QuickPhrasesTab.test.tsx`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/components/settings/QuickPhrasesTab.tsx src/components/settings/QuickPhrasesTab.test.tsx
git commit -m "refactor(webgui): remove input mode dropdown from quick phrases settings"
```

---

## Task 3: QuickPhraseBar 改为左/右键双击交互

**Files:**

- Modify: `src/components/MessageInput/QuickPhraseBar.tsx`
- Test: `src/components/MessageInput/QuickPhraseBar.test.tsx`

- [ ] **Step 1: 重写 QuickPhraseBar 测试**

把 `src/components/MessageInput/QuickPhraseBar.test.tsx` 整体替换为：

```tsx
import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { QuickPhraseBar } from "./QuickPhraseBar"

const items = [
  { id: "a", title: "提交总结", body: "x" },
  { id: "b", title: "风险检查", body: "y" },
]

describe("QuickPhraseBar", () => {
  it("默认单行横向滚动并显示展开按钮", () => {
    render(<QuickPhraseBar items={items} disabled={false} onSend={vi.fn()} onFill={vi.fn()} />)

    expect(screen.getByText("提交总结")).toBeInTheDocument()
    expect(screen.getByText("风险检查")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "展开" })).toBeInTheDocument()
    expect(screen.getByTestId("quick-phrase-row")).toHaveClass("whitespace-nowrap")
    expect(screen.getByTestId("quick-phrase-row")).toHaveClass("overflow-x-auto")
  })

  it("点击展开后显示收起状态", () => {
    render(<QuickPhraseBar items={items} disabled={false} onSend={vi.fn()} onFill={vi.fn()} />)

    fireEvent.click(screen.getByRole("button", { name: "展开" }))
    expect(screen.getByRole("button", { name: "收起" })).toBeInTheDocument()
    expect(screen.getByTestId("quick-phrase-row")).toHaveClass("flex-wrap")
  })

  it("禁用时标签与展开按钮不可交互", () => {
    render(<QuickPhraseBar items={items} disabled={true} onSend={vi.fn()} onFill={vi.fn()} />)

    expect(screen.getByRole("button", { name: "提交总结" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "展开" })).toBeDisabled()
  })

  it("按下短语行时不会立即捕获指针", () => {
    render(<QuickPhraseBar items={items} disabled={false} onSend={vi.fn()} onFill={vi.fn()} />)

    const row = screen.getByTestId("quick-phrase-row")
    const set = vi.fn()

    Object.defineProperty(row, "setPointerCapture", {
      value: set,
      configurable: true,
    })

    fireEvent.pointerDown(row, {
      button: 0,
      pointerId: 1,
      clientX: 100,
    })

    expect(set).not.toHaveBeenCalled()
  })

  it("左键双击短语会发送", () => {
    const onSend = vi.fn()
    const onFill = vi.fn()
    render(<QuickPhraseBar items={items} disabled={false} onSend={onSend} onFill={onFill} />)

    fireEvent.doubleClick(screen.getByRole("button", { name: "提交总结" }))

    expect(onSend).toHaveBeenCalledWith(items[0])
    expect(onFill).not.toHaveBeenCalled()
  })

  it("右键双击短语会回填且阻止系统菜单", () => {
    const onSend = vi.fn()
    const onFill = vi.fn()
    render(<QuickPhraseBar items={items} disabled={false} onSend={onSend} onFill={onFill} />)

    const btn = screen.getByRole("button", { name: "提交总结" })
    const first = fireEvent.contextMenu(btn)
    expect(first).toBe(false) // preventDefault 返回 false
    expect(onFill).not.toHaveBeenCalled()

    fireEvent.contextMenu(btn)
    expect(onFill).toHaveBeenCalledWith(items[0])
    expect(onSend).not.toHaveBeenCalled()
  })

  it("单次右键不触发回填", () => {
    const onFill = vi.fn()
    render(<QuickPhraseBar items={items} disabled={false} onSend={vi.fn()} onFill={onFill} />)

    fireEvent.contextMenu(screen.getByRole("button", { name: "提交总结" }))

    expect(onFill).not.toHaveBeenCalled()
  })

  it("两次右键落在不同短语上不触发回填", () => {
    const onFill = vi.fn()
    render(<QuickPhraseBar items={items} disabled={false} onSend={vi.fn()} onFill={onFill} />)

    fireEvent.contextMenu(screen.getByRole("button", { name: "提交总结" }))
    fireEvent.contextMenu(screen.getByRole("button", { name: "风险检查" }))

    expect(onFill).not.toHaveBeenCalled()
  })

  it("禁用时左键双击与右键双击都不触发", () => {
    const onSend = vi.fn()
    const onFill = vi.fn()
    render(<QuickPhraseBar items={items} disabled={true} onSend={onSend} onFill={onFill} />)

    const btn = screen.getByRole("button", { name: "提交总结" })
    fireEvent.doubleClick(btn)
    fireEvent.contextMenu(btn)
    fireEvent.contextMenu(btn)

    expect(onSend).not.toHaveBeenCalled()
    expect(onFill).not.toHaveBeenCalled()
  })
})
```

注：`fireEvent.contextMenu` 返回值为 `false` 表示事件的默认行为被 `preventDefault()` 阻止（testing-library 的 `fireEvent` 在 `dispatchEvent` 返回 `false` 时即代表 defaultPrevented）。

- [ ] **Step 2: 运行 QuickPhraseBar 测试，确认新用例失败**

Run: `bun run test:run src/components/MessageInput/QuickPhraseBar.test.tsx`
Expected: FAIL（旧实现用 `onActivate`/`mode`，新测试传 `onSend`/`onFill` 且断言右键双击行为，类型与行为都不匹配）

- [ ] **Step 3: 重写 QuickPhraseBar.tsx**

把 `src/components/MessageInput/QuickPhraseBar.tsx` 整体替换为：

```tsx
import { useCallback, useMemo, useRef, useState } from "react"

interface QuickPhraseItem {
  id: string
  title: string
  body: string
}

interface QuickPhraseBarProps {
  items: QuickPhraseItem[]
  disabled: boolean
  onSend: (item: QuickPhraseItem) => void
  onFill: (item: QuickPhraseItem) => void
}

const RIGHT_DOUBLE_CLICK_MS = 400

export function QuickPhraseBar({ items, disabled, onSend, onFill }: QuickPhraseBarProps) {
  const [expanded, setExpanded] = useState(false)
  const row = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: number; x: number; left: number; moved: boolean } | null>(null)
  const lastRightClick = useRef<{ id: string; time: number } | null>(null)
  const list = useMemo(() => items.filter((item) => item.title.trim()), [items])
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (expanded) return
      if (e.button !== 0) return
      const el = row.current
      if (!el) return
      drag.current = {
        id: e.pointerId,
        x: e.clientX,
        left: el.scrollLeft,
        moved: false,
      }
    },
    [expanded],
  )
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const cur = drag.current
    const el = row.current
    if (!cur || !el || cur.id !== e.pointerId) return
    const delta = e.clientX - cur.x
    if (!cur.moved && Math.abs(delta) < 2) return
    if (!cur.moved) {
      cur.moved = true
      el.setPointerCapture(e.pointerId)
    }
    el.scrollLeft = cur.left - delta
    e.preventDefault()
  }, [])
  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const cur = drag.current
    const el = row.current
    if (!cur || !el || cur.id !== e.pointerId) return
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
    drag.current = null
  }, [])
  const onContextMenu = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>, item: QuickPhraseItem) => {
      e.preventDefault()
      if (disabled) return
      const now = Date.now()
      const prev = lastRightClick.current
      if (prev && prev.id === item.id && now - prev.time <= RIGHT_DOUBLE_CLICK_MS) {
        lastRightClick.current = null
        onFill(item)
        return
      }
      lastRightClick.current = { id: item.id, time: now }
    },
    [disabled, onFill],
  )
  if (list.length === 0) return null

  return (
    <div className="px-2 py-1 border-b border-gray-100 dark:border-gray-800">
      <div className="flex items-start gap-2">
        <div
          ref={row}
          data-testid="quick-phrase-row"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className={`flex gap-1 flex-1 ${expanded ? "flex-wrap" : "overflow-x-auto whitespace-nowrap scrollbar-hide cursor-grab"}`}
        >
          {list.map((item) => (
            <button
              key={item.id}
              disabled={disabled}
              title={`左键双击发送 / 右键双击回填：${item.body}`}
              onDoubleClick={() => {
                if (disabled) return
                onSend(item)
              }}
              onContextMenu={(e) => onContextMenu(e, item)}
              className="inline-flex items-center justify-center shrink-0 h-6 px-2 rounded border border-blue-300 dark:border-blue-700 bg-blue-100 dark:bg-blue-900/30 text-xs text-blue-700 dark:text-blue-300 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {item.title}
            </button>
          ))}
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          disabled={disabled}
          className="inline-flex h-6 items-center shrink-0 text-xs text-gray-500 dark:text-gray-400 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {expanded ? "收起" : "展开"}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 运行 QuickPhraseBar 测试，确认通过**

Run: `bun run test:run src/components/MessageInput/QuickPhraseBar.test.tsx`
Expected: PASS（全部用例通过）

- [ ] **Step 5: 提交**

```bash
git add src/components/MessageInput/QuickPhraseBar.tsx src/components/MessageInput/QuickPhraseBar.test.tsx
git commit -m "feat(webgui): quick phrase bar uses left/right double-click"
```

---

## Task 4: MessageInput 接入 onSend/onFill 并删除确认弹窗

**Files:**

- Modify: `src/components/MessageInput/index.tsx`
- Test: `src/components/MessageInput/index.test.tsx`

- [ ] **Step 1: 改写 MessageInput 测试的 quick phrase 部分**

打开 `src/components/MessageInput/index.test.tsx`：

(a) `mocks.loadQuickPhraseState` 默认值（第 30-45 行）删除 `mode: "fill_input",`：

```typescript
    loadQuickPhraseState: vi.fn(async () => ({
      preset_version: 1,
      order: ["preset:commit"],
      items: {
        "preset:commit": {
          id: "preset:commit",
          title: "提交总结",
          body: "请总结改动",
          source: "preset",
          hidden: false,
          order: 0,
          updated_at: 1,
        },
      },
    })),
```

(b) 顶层 `quick` 常量（第 240-255 行）删除 `mode: "fill_input",`。

(c) 删除"会在输入框上方渲染快捷短语栏"用例里对 mode 的断言（第 288 行 `expect(lastQuickPhraseBarProps.mode).toBe("fill_input")`），保留对 items 的断言。改为：

```typescript
  it("会在输入框上方渲染快捷短语栏", async () => {
    mocks.loadQuickPhraseState.mockResolvedValue(quick)
    render(<MessageInput sessionID="s1" />)

    await waitFor(() => {
      expect(lastQuickPhraseBarProps.items[0]?.body).toBe("请总结改动")
    })
    expect(lastQuickPhraseBarProps.items).toEqual([
      {
        id: "preset:commit",
        title: "提交总结",
        body: "请总结改动",
      },
    ])
  })
```

(d) 替换"fill_input 模式双击仅回填不发送"用例（第 300-321 行）为右键回填语义：

```typescript
  it("onFill 回调仅回填不发送", async () => {
    mocks.loadQuickPhraseState.mockResolvedValue(quick)
    render(<MessageInput sessionID="s1" />)

    await waitFor(() => {
      expect(lastQuickPhraseBarProps.items[0]?.body).toBe("请总结改动")
    })

    act(() => {
      lastQuickPhraseBarProps.onFill({
        id: "preset:commit",
        title: "提交总结",
        body: "请总结改动",
      })
    })

    expect(mocks.insertPlainWithMentionsImpl).toHaveBeenCalledWith(expect.anything(), expect.anything(), "请总结改动", {
      replace: true,
    })
    expect(mocks.handleSubmit).not.toHaveBeenCalled()
    expect(mocks.submitQuickPhrase).not.toHaveBeenCalled()
  })
```

(e) 替换"double_send 模式双击会直接发送"用例（第 323-359 行）为 onSend 语义。删除 mock state 里的 `mode` 字段，并改用 `onSend`：

```typescript
  it("onSend 回调会直接发送", async () => {
    const onSendIntent = vi.fn()
    mocks.loadQuickPhraseState.mockResolvedValue({
      preset_version: 1,
      order: ["preset:commit"],
      items: {
        "preset:commit": {
          id: "preset:commit",
          title: "提交总结",
          body: "请总结改动",
          source: "preset",
          hidden: false,
          order: 0,
          updated_at: 1,
        },
      },
    })

    render(<MessageInput sessionID="s1" onSendIntent={onSendIntent} />)
    await waitFor(() => {
      expect(lastQuickPhraseBarProps).toBeTruthy()
    })

    act(() => {
      lastQuickPhraseBarProps.onSend({
        id: "preset:commit",
        title: "提交总结",
        body: "请总结改动",
      })
    })

    await waitFor(() => {
      expect(mocks.submitQuickPhrase).toHaveBeenCalledWith("请总结改动")
    })
    expect(onSendIntent).toHaveBeenCalledTimes(1)
  })
```

(f) 替换"double_send 模式发送不应回填输入框"用例（第 361-393 行）：删除 mock 的 `mode` 字段，改用 `onSend`，断言不回填：

```typescript
  it("onSend 发送不应回填输入框", async () => {
    mocks.loadQuickPhraseState.mockResolvedValue({
      preset_version: 1,
      order: ["preset:commit"],
      items: {
        "preset:commit": {
          id: "preset:commit",
          title: "提交总结",
          body: "请总结改动",
          source: "preset",
          hidden: false,
          order: 0,
          updated_at: 1,
        },
      },
    })

    render(<MessageInput sessionID="s1" />)
    await waitFor(() => {
      expect(lastQuickPhraseBarProps).toBeTruthy()
    })

    act(() => {
      lastQuickPhraseBarProps.onSend({
        id: "preset:commit",
        title: "提交总结",
        body: "请总结改动",
      })
    })

    expect(mocks.insertPlainWithMentionsImpl).not.toHaveBeenCalled()
  })
```

(g) 替换"double_send 模式遇到空正文时不应发送"用例（第 395-430 行）：删除 mock 的 `mode` 字段，改用 `onSend`，断言空正文不发送：

```typescript
  it("onSend 遇到空正文时不应发送", async () => {
    const onSendIntent = vi.fn()
    mocks.loadQuickPhraseState.mockResolvedValue({
      preset_version: 1,
      order: ["preset:empty"],
      items: {
        "preset:empty": {
          id: "preset:empty",
          title: "空正文",
          body: "   ",
          source: "preset",
          hidden: false,
          order: 0,
          updated_at: 1,
        },
      },
    } as any)

    render(<MessageInput sessionID="s1" onSendIntent={onSendIntent} />)
    await waitFor(() => {
      expect(lastQuickPhraseBarProps).toBeTruthy()
    })

    act(() => {
      lastQuickPhraseBarProps.onSend({
        id: "preset:empty",
        title: "空正文",
        body: "   ",
      })
    })

    expect(mocks.handleSubmit).not.toHaveBeenCalled()
    expect(mocks.submitQuickPhrase).not.toHaveBeenCalled()
    expect(onSendIntent).not.toHaveBeenCalled()
  })
```

(h) 删除整个"confirm_send 模式双击需确认后发送"用例（第 432-476 行）。确认弹窗已移除，此用例不再适用。

(i) 替换"没有 session 时 double_send 不应触发发送意图"用例（第 478-512 行）：删除 mock 的 `mode` 字段，改用 `onSend`：

```typescript
  it("没有 session 时 onSend 不应触发发送意图", async () => {
    const onSendIntent = vi.fn()
    mocks.loadQuickPhraseState.mockResolvedValue({
      preset_version: 1,
      order: ["preset:commit"],
      items: {
        "preset:commit": {
          id: "preset:commit",
          title: "提交总结",
          body: "请总结改动",
          source: "preset",
          hidden: false,
          order: 0,
          updated_at: 1,
        },
      },
    })

    render(<MessageInput sessionID={null} onSendIntent={onSendIntent} />)
    await waitFor(() => {
      expect(lastQuickPhraseBarProps).toBeTruthy()
    })

    act(() => {
      lastQuickPhraseBarProps.onSend({
        id: "preset:commit",
        title: "提交总结",
        body: "请总结改动",
      })
    })

    expect(onSendIntent).not.toHaveBeenCalled()
    expect(mocks.submitQuickPhrase).not.toHaveBeenCalled()
  })
```

(j) 删除整个"confirm_send 弹窗切换会话后会关闭且不会发送旧会话短语"用例（第 514-560 行）。

(k) 删除整个"confirm_send 模式遇到空正文时不应弹确认也不发送"用例（第 562-595 行）。

注：编辑时请按用例标题精确定位，行号仅供参考；逐个用例替换/删除，避免误删 `精简会话确认弹窗文案为中文`（第 597 行起）等无关用例。

- [ ] **Step 2: 运行 MessageInput 测试，确认与旧实现不匹配而失败**

Run: `bun run test:run src/components/MessageInput/index.test.tsx`
Expected: FAIL（测试改用 `onSend`/`onFill`，但旧实现仍传 `onActivate`，`lastQuickPhraseBarProps.onSend` 为 undefined）

- [ ] **Step 3: 修改 index.tsx 接入 onSend/onFill 并删除确认弹窗**

打开 `src/components/MessageInput/index.tsx`：

删除第 76 行 phraseConfirm state：

```typescript
const [phraseConfirm, setPhraseConfirm] = useState<{ title: string; body: string } | null>(null)
```

删除第 442-444 行重置 phraseConfirm 的 effect：

```typescript
useEffect(() => {
  setPhraseConfirm(null)
}, [sessionID])
```

删除 `onActivatePhrase`（第 446-461 行）整段，替换为两个轻量回调：

```typescript
const onSendPhrase = useCallback(
  (item: { id: string; title: string; body: string }) => {
    sendPhrase(item.body)
  },
  [sendPhrase],
)

const onFillPhrase = useCallback(
  (item: { id: string; title: string; body: string }) => {
    if (isDisabled) return
    fillPhrase(item.body)
  },
  [fillPhrase, isDisabled],
)
```

删除 `onConfirmPhrase`（第 463-468 行）整段。

修改 `<QuickPhraseBar>` 调用（第 482-487 行），删除 `mode` prop，改传 `onSend`/`onFill`：

```tsx
<QuickPhraseBar items={phraseItems} disabled={isDisabled} onSend={onSendPhrase} onFill={onFillPhrase} />
```

删除短语确认的 `<ConfirmModal>`（第 520-529 行，`title="确认发送快捷短语"` 那个）整段。保留精简会话历史的 `<ConfirmModal>`（第 531-541 行）。

- [ ] **Step 4: 运行 MessageInput 测试，确认通过**

Run: `bun run test:run src/components/MessageInput/index.test.tsx`
Expected: PASS

- [ ] **Step 5: 检查 ConfirmModal 与未使用引用**

确认 `index.tsx` 中 `ConfirmModal` import 仍被精简会话弹窗使用（保留）。确认无残留的 `phraseConfirm`、`setPhraseConfirm`、`onConfirmPhrase`、`onActivatePhrase` 引用。

Run: `bun run build`
Expected: 构建成功，无 TS 报错。

- [ ] **Step 6: 提交**

```bash
git add src/components/MessageInput/index.tsx src/components/MessageInput/index.test.tsx
git commit -m "feat(webgui): wire quick phrase send/fill, drop confirm modal"
```

---

## Task 5: 更新文档

**Files:**

- Modify: `docs/repowiki/06-settings-update-localization.md`
- Modify: `docs/repowiki/04-session-chat.md`

- [ ] **Step 1: 更新 06-settings-update-localization.md**

把第 38 行中：

> ...并为每条短语选择执行模式：填入输入框、确认后发送或双击发送。

改为：

> ...每条短语固定通过左键双击立即发送、右键双击回填输入框。

- [ ] **Step 2: 更新 04-session-chat.md**

把第 142 行：

> - 快捷短语，支持填入输入框、确认后发送、双击发送等模式。

改为：

> - 快捷短语，左键双击立即发送、右键双击回填输入框。

- [ ] **Step 3: 提交**

```bash
git add docs/repowiki/06-settings-update-localization.md docs/repowiki/04-session-chat.md
git commit -m "docs: update quick phrase interaction description"
```

---

## Task 6: 全量验证

**Files:** 无（仅运行验证）

- [ ] **Step 1: 运行全部受影响测试**

Run: `bun run test:run src/state/repo/quickPhraseRepo.test.ts src/components/settings/QuickPhrasesTab.test.tsx src/components/MessageInput/QuickPhraseBar.test.tsx src/components/MessageInput/index.test.tsx`
Expected: 全部 PASS

- [ ] **Step 2: 类型检查与构建**

Run: `bun run build`
Expected: 构建成功

- [ ] **Step 3: 全量回归（可选但推荐）**

Run: `bun run test:run`
Expected: 全部 PASS（确认无其它文件引用已删除的 `mode`/`setQuickPhraseMode`/`onActivate`）
