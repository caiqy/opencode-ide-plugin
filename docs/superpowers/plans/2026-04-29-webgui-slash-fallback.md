# WebGUI 未知 /输入降级为普通消息实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 webgui 在用户输入 `/123`、`/123 abc` 这类未匹配 slash 项时不再触发 `Command not found`，而是按普通消息原样发送，同时保持已知 command / skill / MCP prompt 的 slash 执行行为不变。

**Architecture:** 先把“解析 `/` 开头文本并根据 `/command` 列表决定是 command 还是 prompt”的逻辑提取成一个小型 helper，并用独立单测锁定已知命令、未知命令、列表加载失败三类行为；随后只在 `useMessageInput` 的发送分流点接入该 helper，让编辑器发送与 quick phrase 共用同一条 slash 降级链路，不改后端 `session.command` 语义。

**Tech Stack:** TypeScript 5.9, React 19, Vitest 4, Testing Library, webgui `sdk.session` / `sdk.command`

**Spec:** `docs/superpowers/specs/2026-04-29-webgui-slash-fallback-design.md`

---

## 文件结构

- `packages/opencode/webgui/src/components/MessageInput/hooks/resolveSlashInput.ts`
  - 新增的纯逻辑 helper
  - 负责解析 `/review foo` 这类文本，并在需要时查询 `/command` 列表
  - 输出只有两种模式：`command` 或 `prompt`

- `packages/opencode/webgui/src/components/MessageInput/hooks/resolveSlashInput.test.ts`
  - 新增 helper 单测
  - 锁定：非 slash 跳过查询、已知 slash 命中、未知 slash 降级、列表失败降级、缓存复用

- `packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.ts`
  - 现有发送主链路
  - 只修改 `submitText()` 内部 slash 分流，不改 abort / compact / retry 逻辑

- `packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.test.tsx`
  - 现有 hook 回归测试
  - 补充 slash 降级场景，并把 `sdk.command.list()` mock 纳入默认测试装配

---

### Task 1: 提取 slash 解析 helper，并用单测锁定降级规则

**Files:**

- Create: `packages/opencode/webgui/src/components/MessageInput/hooks/resolveSlashInput.ts`
- Create: `packages/opencode/webgui/src/components/MessageInput/hooks/resolveSlashInput.test.ts`

- [ ] **Step 1: 先写失败测试，锁定 helper 的 5 个核心行为**

```ts
// packages/opencode/webgui/src/components/MessageInput/hooks/resolveSlashInput.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
}))

vi.mock("../../../lib/api/sdkClient", () => ({
  sdk: {
    command: {
      list: () => mocks.list(),
    },
  },
}))

async function loadModule() {
  vi.resetModules()
  return import("./resolveSlashInput")
}

describe("resolveSlashInput", () => {
  beforeEach(() => {
    mocks.list.mockReset()
  })

  it("普通文本不应触发命令列表查询", async () => {
    const { resolveSlashInput } = await loadModule()

    await expect(resolveSlashInput("hello world")).resolves.toEqual({ mode: "prompt" })
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it("已知 slash 应解析为 command 模式并保留参数", async () => {
    mocks.list.mockResolvedValueOnce({
      data: [{ name: "review" }],
      error: null,
    })

    const { resolveSlashInput } = await loadModule()

    await expect(resolveSlashInput("/review repo status")).resolves.toEqual({
      mode: "command",
      name: "review",
      arguments: "repo status",
    })
  })

  it("未知 slash 应降级为 prompt 模式", async () => {
    mocks.list.mockResolvedValueOnce({
      data: [{ name: "review" }],
      error: null,
    })

    const { resolveSlashInput } = await loadModule()

    await expect(resolveSlashInput("/123 abc")).resolves.toEqual({ mode: "prompt" })
  })

  it("slash 列表加载失败时应降级为 prompt 模式", async () => {
    mocks.list.mockRejectedValueOnce(new Error("offline"))

    const { resolveSlashInput } = await loadModule()

    await expect(resolveSlashInput("/review repo status")).resolves.toEqual({ mode: "prompt" })
  })

  it("同一模块实例内应复用已加载的 slash 列表", async () => {
    mocks.list.mockResolvedValue({
      data: [{ name: "review" }],
      error: null,
    })

    const { resolveSlashInput } = await loadModule()

    await resolveSlashInput("/review first")
    await resolveSlashInput("/review second")

    expect(mocks.list).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: 运行新测试，确认它先失败**

Run: `bun run --cwd packages/opencode/webgui test:run src/components/MessageInput/hooks/resolveSlashInput.test.ts`

Expected: FAIL，报错类似 `Failed to resolve import "./resolveSlashInput"`，因为 helper 文件还不存在。

- [ ] **Step 3: 写最小 helper，实现 slash 解析、列表查询与失败降级**

```ts
// packages/opencode/webgui/src/components/MessageInput/hooks/resolveSlashInput.ts
import { sdk } from "../../../lib/api/sdkClient"

type SlashResolution = { mode: "prompt" } | { mode: "command"; name: string; arguments: string }

let slashNames: Set<string> | null = null
let slashNamesPromise: Promise<Set<string> | null> | null = null

function parseSlashInput(text: string) {
  const trimmed = text.trim()
  if (!trimmed.startsWith("/")) return null

  const [head, ...tail] = trimmed.split(/\s+/)
  const name = head.slice(1)
  if (!name) return null

  return {
    name,
    arguments: tail.join(" "),
  }
}

async function loadSlashNames() {
  if (slashNames) return slashNames
  if (slashNamesPromise) return slashNamesPromise

  slashNamesPromise = (async () => {
    try {
      const response = await sdk.command.list()
      if (response.error || !response.data) return null

      const loaded = new Set(response.data.map((item) => item.name))
      slashNames = loaded
      return loaded
    } catch (error) {
      console.error("[resolveSlashInput] Failed to load slash commands:", error)
      return null
    }
  })()

  return slashNamesPromise.finally(() => {
    slashNamesPromise = null
  })
}

export async function resolveSlashInput(text: string): Promise<SlashResolution> {
  const parsed = parseSlashInput(text)
  if (!parsed) {
    return { mode: "prompt" }
  }

  const loaded = await loadSlashNames()
  if (!loaded?.has(parsed.name)) {
    return { mode: "prompt" }
  }

  return {
    mode: "command",
    name: parsed.name,
    arguments: parsed.arguments,
  }
}
```

- [ ] **Step 4: 重新运行 helper 测试，确认全部通过**

Run: `bun run --cwd packages/opencode/webgui test:run src/components/MessageInput/hooks/resolveSlashInput.test.ts`

Expected: PASS，5 个测试全部通过；未知 slash 与列表失败都返回 `{ mode: "prompt" }`。

- [ ] **Step 5: 提交这一小步**

```bash
git add packages/opencode/webgui/src/components/MessageInput/hooks/resolveSlashInput.ts packages/opencode/webgui/src/components/MessageInput/hooks/resolveSlashInput.test.ts
git commit -m "test(webgui): lock slash input fallback rules"
```

---

### Task 2: 把 helper 接入 `useMessageInput`，让未知 slash 真正走普通消息发送

**Files:**

- Modify: `packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.ts`
- Modify: `packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.test.tsx`

- [ ] **Step 1: 先写失败测试，覆盖已知 slash、未知 slash、加载失败 3 条发送路径**

```ts
// packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.test.tsx
const mocks = vi.hoisted(() => {
  const root = {
    getTextContent: vi.fn(() => "/status"),
    clear: vi.fn(),
    append: vi.fn(),
  }

  return {
    root,
    setSessionIdle: vi.fn(),
    showToast: vi.fn(),
    addMessage: vi.fn(),
    setMessages: vi.fn(),
    commandList: vi.fn(async () => ({
      data: [{ name: "status" }, { name: "review" }],
      error: null,
    })),
    command: vi.fn(async (_input: unknown) => ({ data: {}, error: null })),
    prompt: vi.fn(async (_input: unknown) => ({ data: {}, error: null })),
    summarize: vi.fn(async (_input: unknown): Promise<any> => ({ data: true, error: null })),
    abort: vi.fn(async (_input: unknown) => ({ data: true, error: null })),
    getQuestionsBySession: vi.fn(() => []),
    rejectQuestion: vi.fn(async (_requestID: string) => true),
    loadDraftSession: vi.fn(async (): Promise<string | null> => null),
    saveDraftSession: vi.fn(async (_value: string | null) => ({ ok: true })),
  }
})

vi.mock("../../../lib/api/sdkClient", () => ({
  sdk: {
    command: {
      list: () => mocks.commandList(),
    },
    session: {
      command: (input: unknown) => mocks.command(input),
      prompt: (input: unknown) => mocks.prompt(input),
      abort: (input: unknown) => mocks.abort(input),
      summarize: (input: unknown) => mocks.summarize(input),
    },
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.commandList.mockResolvedValue({
    data: [{ name: "status" }, { name: "review" }],
    error: null,
  })
})

it("已知 slash quick phrase 仍走 command", async () => {
  const editor = {
    getEditorState: () => ({ read: (fn: () => void) => fn() }),
    update: (fn: () => void) => fn(),
    focus: vi.fn(),
  } as any

  const { result } = renderHook(() =>
    useMessageInput({
      sessionID: "s-known",
      editor,
      isEmpty: true,
      selectedProviderId: "openai",
      selectedModelId: "gpt-4.1",
      selectedAgent: "build",
      selectedVariant: undefined,
      extractMessageParts: vi.fn(() => []),
    }),
  )

  await act(async () => {
    await result.current.submitQuickPhrase("/review repo status")
  })

  expect(mocks.command).toHaveBeenCalledWith(
    expect.objectContaining({
      path: { id: "s-known" },
      body: expect.objectContaining({
        command: "review",
        arguments: "repo status",
      }),
    }),
  )
  expect(mocks.prompt).not.toHaveBeenCalled()
})

it("未知 slash quick phrase 会按普通消息原样发送", async () => {
  mocks.commandList.mockResolvedValueOnce({
    data: [{ name: "status" }],
    error: null,
  })

  const editor = {
    getEditorState: () => ({ read: (fn: () => void) => fn() }),
    update: (fn: () => void) => fn(),
    focus: vi.fn(),
  } as any

  const { result } = renderHook(() =>
    useMessageInput({
      sessionID: "s-unknown",
      editor,
      isEmpty: true,
      selectedProviderId: "openai",
      selectedModelId: "gpt-4.1",
      selectedAgent: "build",
      selectedVariant: undefined,
      extractMessageParts: vi.fn(() => []),
    }),
  )

  await act(async () => {
    await result.current.submitQuickPhrase("/123 abc")
  })

  expect(mocks.command).not.toHaveBeenCalled()
  expect(mocks.prompt).toHaveBeenCalledWith(
    expect.objectContaining({
      path: { id: "s-unknown" },
      body: expect.objectContaining({
        parts: [{ type: "text", text: "/123 abc" }],
      }),
    }),
  )
})

it("slash 列表加载失败时会降级为普通消息", async () => {
  mocks.commandList.mockRejectedValueOnce(new Error("offline"))

  const editor = {
    getEditorState: () => ({ read: (fn: () => void) => fn() }),
    update: (fn: () => void) => fn(),
    focus: vi.fn(),
  } as any

  const { result } = renderHook(() =>
    useMessageInput({
      sessionID: "s-offline",
      editor,
      isEmpty: true,
      selectedProviderId: "openai",
      selectedModelId: "gpt-4.1",
      selectedAgent: "build",
      selectedVariant: undefined,
      extractMessageParts: vi.fn(() => []),
    }),
  )

  await act(async () => {
    await result.current.submitQuickPhrase("/review repo status")
  })

  expect(mocks.command).not.toHaveBeenCalled()
  expect(mocks.prompt).toHaveBeenCalledWith(
    expect.objectContaining({
      path: { id: "s-offline" },
      body: expect.objectContaining({
        parts: [{ type: "text", text: "/review repo status" }],
      }),
    }),
  )
})
```

- [ ] **Step 2: 运行 hook 测试，确认它先失败**

Run: `bun run --cwd packages/opencode/webgui test:run src/components/MessageInput/hooks/useMessageInput.test.tsx`

Expected: FAIL，至少 `未知 slash quick phrase 会按普通消息原样发送` 会失败，因为当前实现只要 `startsWith("/")` 就直接走 `sdk.session.command(...)`。

- [ ] **Step 3: 在 `useMessageInput.ts` 中接入 helper，只在已知 slash 时走 command**

```ts
// packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.ts
import { resolveSlashInput } from "./resolveSlashInput"
```

```ts
// packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.ts
const submitText = useCallback(
  async (saved: string, source: "editor" | "quick_phrase") => {
    if (!sessionID) return

    const text = saved.trim()
    if (!text) return

    const resolvedSlash = await resolveSlashInput(text)
    const slashCommand = resolvedSlash.mode === "command" ? resolvedSlash : null
    const id = ++seq.current
    const optimistic = !slashCommand && source === "editor" ? createOptimisticUserMessage(sessionID, text) : null

    setSessionIdle(sessionID, false)

    if (source === "editor") {
      editor.update(() => {
        const root = $getRoot()
        root.clear()
        const paragraph = $createParagraphNode()
        root.append(paragraph)
      })
      setFailed(sessionID, null)
      onMessageSent?.()
      setTimeout(() => {
        editor.focus()
      }, 0)
    }

    if (optimistic) {
      addMessage(optimistic)
    }

    try {
      if (slashCommand) {
        const request: any = {
          command: slashCommand.name,
          arguments: slashCommand.arguments,
          agent: selectedAgent,
        }

        if (selectedProviderId && selectedModelId) {
          request.model = `${selectedProviderId}/${selectedModelId}`
        }

        if (selectedVariant) {
          request.variant = selectedVariant
        }

        const response = await sdk.session.command({
          path: { id: sessionID },
          body: request,
        })

        if (response.error) {
          throw new Error(errorMessage(response.error, "Failed to execute command"))
        }
      }

      if (!slashCommand) {
        const request: any = {
          parts: source === "editor" ? extractMessageParts() : [{ type: "text", text }],
          agent: selectedAgent,
        }

        if (request.parts.length === 0) {
          throw new Error("No message content")
        }

        if (selectedProviderId && selectedModelId) {
          request.model = {
            providerID: selectedProviderId,
            modelID: selectedModelId,
          }
        }

        if (selectedVariant) {
          request.variant = selectedVariant
        }

        const response = await sdk.session.prompt({
          path: { id: sessionID },
          body: request,
        })

        if (response.error) {
          throw new Error(errorMessage(response.error, "发送消息失败"))
        }
      }

      if (source === "editor") {
        const activeDraft = await loadDraftSession()
        if (activeDraft === sessionID) {
          await saveDraftSession(null)
        }
      }
    } catch (err) {
      if (optimistic) {
        setMessages((prev) => removeMessage(prev, optimistic.info.id))
      }

      if (id !== seq.current) return

      const msg = errorMessage(err, "发送消息失败")
      const error = err instanceof Error ? err : new Error(msg)
      console.error("[MessageInput] Failed to send message:", error)
      setSessionIdle(sessionID, true)

      if (source === "editor") {
        setFailed(sessionID, saved)
      }

      showToast(msg, {
        title: "发送失败",
        variant: "error",
        duration: 8000,
      })
      onError?.(error)
    }
  },
  [
    addMessage,
    editor,
    extractMessageParts,
    onError,
    onMessageSent,
    selectedAgent,
    selectedModelId,
    selectedProviderId,
    selectedVariant,
    sessionID,
    setFailed,
    setMessages,
    setSessionIdle,
    showToast,
  ],
)
```

- [ ] **Step 4: 重新运行 hook 测试，确认 slash 行为全部通过**

Run: `bun run --cwd packages/opencode/webgui test:run src/components/MessageInput/hooks/useMessageInput.test.tsx`

Expected: PASS；已知 slash 仍调用 `sdk.session.command`，未知 slash 与列表失败都改为 `sdk.session.prompt`。

- [ ] **Step 5: 提交这一小步**

```bash
git add packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.ts packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.test.tsx
git commit -m "fix(webgui): fallback unknown slash input to prompt"
```

---

### Task 3: 做最终回归与构建验证，确保 MessageInput 入口没有被连带破坏

**Files:**

- Verify: `packages/opencode/webgui/src/components/MessageInput/hooks/resolveSlashInput.test.ts`
- Verify: `packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.test.tsx`
- Verify: `packages/opencode/webgui/src/components/MessageInput/index.test.tsx`

- [ ] **Step 1: 运行 helper + hook 的聚焦回归测试**

Run: `bun run --cwd packages/opencode/webgui test:run src/components/MessageInput/hooks/resolveSlashInput.test.ts src/components/MessageInput/hooks/useMessageInput.test.tsx`

Expected: PASS；helper 与发送分流测试同时通过。

- [ ] **Step 2: 再跑一次 MessageInput 组件层回归，确认 hook 接入没有破坏现有装配**

Run: `bun run --cwd packages/opencode/webgui test:run src/components/MessageInput/index.test.tsx`

Expected: PASS；现有 compact confirm、quick phrase、retry 等组件层测试继续通过。

- [ ] **Step 3: 运行 webgui build，顺带做 TypeScript / bundling 验证**

Run: `bun run --cwd packages/opencode/webgui build`

Expected: PASS；输出包含 `vite build` 完成信息，无新的 TypeScript 报错。

- [ ] **Step 4: 检查最终改动只落在计划内文件**

Run: `git diff --stat -- packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.ts packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.test.tsx packages/opencode/webgui/src/components/MessageInput/hooks/resolveSlashInput.ts packages/opencode/webgui/src/components/MessageInput/hooks/resolveSlashInput.test.ts`

Expected: 只看到这 4 个文件变更；没有把 slash 降级逻辑扩散到无关模块。

- [ ] **Step 5: 确认 Task 1 与 Task 2 的提交之后工作树已干净**

Run: `git status --short -- packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.ts packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.test.tsx packages/opencode/webgui/src/components/MessageInput/hooks/resolveSlashInput.ts packages/opencode/webgui/src/components/MessageInput/hooks/resolveSlashInput.test.ts`

Expected: 无输出；说明 helper 提交与 slash fallback 提交已经覆盖全部目标文件，没有把未提交改动留到计划结束。

---

## 最终验收清单

- `/review` 这类已知 slash 仍走 `sdk.session.command`
- `/123`、`/123 abc` 这类未知 slash 不再触发 `Command not found`
- 未知 slash 文本在 prompt body 中保留原始前导 `/`
- `sdk.command.list()` 失败时仍能发送，不出现前端发送失败 toast
- `useMessageInput` 现有回归测试与 `MessageInput/index.test.tsx` 没有被本次改动打坏
- `bun run --cwd packages/opencode/webgui build` 通过
