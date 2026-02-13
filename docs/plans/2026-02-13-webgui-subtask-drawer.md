# WebGUI 子任务抽屉（Subtask Drawer）Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在父会话的 `task` 工具运行期间，用户可从工具头部打开右侧抽屉，实时查看子会话对话/工具调用，并能在抽屉内处理该子会话的 permission/question；全程不切换父会话 `currentSession`。

**Architecture:** 利用 `task` 工具 part 的 `part.state.metadata.sessionId` 定位子会话；抽屉只从 `MessagesContext` 全局 store 按 `sessionID` 过滤渲染；打开抽屉时补一次 `loadSessionMessages(childSessionId)` 拉历史，后续实时更新依赖现有 SSE 事件流。

**Tech Stack:** React + Tailwind class、现有 SSE EventSource、Vitest + React Testing Library。

---

### Task 1：按 session 读取 idle/reasoning 状态

**Files:**
- Modify: `packages/opencode/webgui/src/state/SessionContext.tsx`

**Step 1: Write the failing test**

新增测试：断言 `useSession()` 产出的 context 包含 `isSessionIdle/isSessionReasoning` 且行为正确。

**Step 2: Run test to verify it fails**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/state/SessionContext.test.tsx`

Expected: FAIL（方法缺失或行为不符合预期）

**Step 3: Write minimal implementation**

- 在 `SessionContextState` 增加：
  - `isSessionIdle: (sessionId: string) => boolean`
  - `isSessionReasoning: (sessionId: string) => boolean`
- 基于现有 `busyMap/reasoningMap` 实现：
  - 未记录默认 idle=true / reasoning=false

**Step 4: Run test to verify it passes**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/state/SessionContext.test.tsx`

Expected: PASS

---

### Task 2：新增抽屉状态 Context（仅 UI 状态）

**Files:**
- Create: `packages/opencode/webgui/src/state/SubtaskDrawerContext.tsx`

**Step 1: Write the failing test**

新增测试：Provider + hook 正常工作（open/close + sessionId）。

**Step 2: Run test to verify it fails**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/state/SubtaskDrawerContext.test.tsx`

Expected: FAIL（模块/行为缺失）

**Step 3: Write minimal implementation**

实现 `SubtaskDrawerProvider` 与 `useSubtaskDrawer`，不依赖 session 切换。

**Step 4: Run test to verify it passes**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/state/SubtaskDrawerContext.test.tsx`

Expected: PASS

---

### Task 3：实现右侧抽屉容器（overlay + header + close）

**Files:**
- Create: `packages/opencode/webgui/src/components/SubtaskDrawer/SubtaskDrawer.tsx`

**Step 1: Write the failing test**

新增测试：抽屉打开时渲染标题与关闭按钮；点击 backdrop/ESC 可关闭。

**Step 2: Run test to verify it fails**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/components/SubtaskDrawer/SubtaskDrawer.test.tsx`

Expected: FAIL

**Step 3: Write minimal implementation**

- `fixed` overlay + 右侧 panel
- `useEffect`：打开且 `sessionId` 变化时调用 `loadSessionMessages(sessionId)`

**Step 4: Run test to verify it passes**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/components/SubtaskDrawer/SubtaskDrawer.test.tsx`

Expected: PASS

---

### Task 4：只读子会话消息列表（复用现有渲染链）

**Files:**
- Create: `packages/opencode/webgui/src/components/SubtaskDrawer/SubtaskMessageList.tsx`
- Modify: `packages/opencode/webgui/src/components/MessageList/MessageRow.tsx`（使 onFork/onRevert 可选）

**Step 1: Write the failing test**

新增测试：在 SubtaskMessageList 中渲染 session 的消息；MessageRow 在未提供 onFork/onRevert 时不崩溃。

**Step 2: Run test to verify it fails**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/components/SubtaskDrawer/SubtaskMessageList.test.tsx`

Expected: FAIL

**Step 3: Write minimal implementation**

- 过滤 `getMessagesBySession(sessionId)`
- 过滤 `getQuestionsBySession(sessionId)`
- 读取 `isSessionIdle/isSessionReasoning`
- 复用 `useMessageScroll` / `TypingIndicator` / `ScrollToBottomButton` / `PartOpenProvider`

**Step 4: Run test to verify it passes**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/components/SubtaskDrawer/SubtaskMessageList.test.tsx`

Expected: PASS

---

### Task 5：ToolHeader 支持右侧 actions（为 task 入口预留）

**Files:**
- Modify: `packages/opencode/webgui/src/components/parts/ToolPart/ToolHeader.tsx`
- Modify: `packages/opencode/webgui/src/components/parts/ToolPart/ToolHeader.test.tsx`

**Step 1: Write the failing test**

新增测试：传入 `rightActions` 能渲染；点击 actions 不会触发展开切换。

**Step 2: Run test to verify it fails**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/components/parts/ToolPart/ToolHeader.test.tsx`

Expected: FAIL

**Step 3: Write minimal implementation**

- 增加 `rightActions?: ReactNode`
- 调整结构避免 `<button>` 嵌套 `<button>`

**Step 4: Run test to verify it passes**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/components/parts/ToolPart/ToolHeader.test.tsx`

Expected: PASS

---

### Task 6：在 `task` 工具头部加「查看子任务」入口，并接入抽屉

**Files:**
- Modify: `packages/opencode/webgui/src/components/parts/ToolPart/index.tsx`
- Modify: `packages/opencode/webgui/src/components/parts/ToolPart/index.test.tsx`
- Modify: `packages/opencode/webgui/src/App.tsx`（挂载 provider + drawer）

**Step 1: Write the failing test**

新增测试：`tool=task` 且 `metadata.sessionId` 存在时，显示「查看子任务」；点击后调用 `openSubtaskDrawer`。

**Step 2: Run test to verify it fails**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/components/parts/ToolPart/index.test.tsx`

Expected: FAIL

**Step 3: Write minimal implementation**

- 解析 `childSessionId`
- ToolHeader 右侧渲染入口
- App 内挂载 Provider + Drawer

**Step 4: Run test to verify it passes**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/components/parts/ToolPart/index.test.tsx`

Expected: PASS

---

### Task 7：验证与最小手动回归

**Commands（不要在仓库根目录跑 bun test）**
- `bun run --cwd packages/opencode/webgui test:run`
- （可选）`bun run --cwd packages/opencode/webgui lint`

**手动回归**
- 触发一次会出现 `task` 工具的对话
- `task` 运行中点「查看子任务」：
  - 抽屉打开
  - 子会话消息/工具调用能持续刷新
  - 子会话出现 permission/question 时能在抽屉里处理
  - 父会话不发生 session 切换（标题、输入框焦点、uiBridge sessionID 不变）
