# WebGUI 会话激活选择恢复解耦 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将“加载会话消息”和“从历史消息恢复 agent/model/variant”解耦；自动恢复只在“切换/打开会话”发生一次，之后用户手动切换不会被任何 `loadSessionMessages(...)` 覆盖。

**Architecture:** 引入一个明确的“会话激活协调器”（hook/控制器），负责在 `currentSession.id` 变化时：加载该会话 messages → 从最后一条 user message 推导选择快照 → 调用 `SessionContext.restoreSelections(...)`。`MessagesContext.loadSessionMessages` 退回为纯数据层：仅 fetch + 写入 messages store（以及 reasoning/idle 同步），不再包含“恢复选择”的副作用。

**Tech Stack:** TypeScript, React, Vitest, Testing Library.

---

## 约束/验收标准

1. `MessagesContext.loadSessionMessages(sessionID)` **不再**改变 `SessionContext` 的 `selectedAgent/selectedProviderId/selectedModelId/selectedVariant`。
2. 只有当 `currentSession.id` 发生变化（切换/打开会话）时，才会基于该 session 的历史消息恢复一次选择。
3. 在同一会话内手动切换 model/agent/variant 不会触发再次 `sdk.session.messages(...)` 拉取，也不会“切回去”。
4. `SubtaskDrawer` 打开/加载子会话消息不会影响主会话选择（因为 load 变成纯数据层）。

---

### Task 1: 提取“从 messages 推导选择快照”的纯函数（TDD）

**Files:**

- Create: `packages/opencode/webgui/src/lib/selection/selectionFromMessages.ts`
- Create: `packages/opencode/webgui/src/lib/selection/selectionFromMessages.test.ts`

**Step 1: 写失败测试（纯函数行为）**

覆盖：

```ts
it("返回最后一条 user message 的 agent/model/variant", () => {})
it("无 user message 时返回 null", () => {})
it("variant 缺失时返回 variant: null", () => {})
```

**Step 2: 运行测试确认失败**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/lib/selection/selectionFromMessages.test.ts`

Expected: FAIL（模块不存在/未实现）。

**Step 3: 写最小实现**

实现：

- 输入：`Message[]`
- 输出：`{ providerId, modelId, agent, variant } | null`
- 规则：按 `info.time.created` 排序取最后一条 user；`variant` 缺失则返回 `null`。

**Step 4: 运行测试确认通过**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/lib/selection/selectionFromMessages.test.ts`

Expected: PASS。

---

### Task 2: 让 loadSessionMessages 变成纯数据层，并返回加载结果（TDD）

**Files:**

- Modify: `packages/opencode/webgui/src/state/MessagesContext.tsx`
- Modify: `packages/opencode/webgui/src/state/MessagesContext.selection-restore.test.tsx`

**Step 1: 写失败测试（load 不应恢复选择）**

把现有用例改为断言：调用 `api.loadSessionMessages("s1")` 后 **不会**调用 `restoreSelections(...)`。

**Step 2: 运行测试确认失败**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/state/MessagesContext.selection-restore.test.tsx`

Expected: FAIL（当前 load 内部会调用 restoreSelections）。

**Step 3: 写最小实现**

在 `MessagesContext.tsx`：

1. 移除 `loadSessionMessages` 内的 `restoreSelections(...)` 逻辑。
2. 将 `loadSessionMessages(sessionID)` 的返回类型改为 `Promise<Message[] | null>`：
   - virtual session：直接返回 `null`
   - 请求错误：返回 `null`
   - 成功：返回 `loadedMessages`（允许空数组）
3. 依赖数组移除 `restoreSelections`。

**Step 4: 运行测试确认通过**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/state/MessagesContext.selection-restore.test.tsx`

Expected: PASS。

---

### Task 3: 增加“会话激活协调器”并在 App 挂载（TDD）

**Files:**

- Create: `packages/opencode/webgui/src/state/useSessionActivation.ts`
- Modify: `packages/opencode/webgui/src/App.tsx`
- Create: `packages/opencode/webgui/src/state/useSessionActivation.test.tsx`

**Step 1: 写失败测试（只在 session 切换时恢复一次）**

在 `useSessionActivation.test.tsx` 用 `SessionProvider + MessagesProvider` 包一层测试组件：

- 初始切到 `s1` 后：应调用一次 `sdk.session.messages({ id: "s1" })`
- 并且在 load 返回包含 user message 的情况下：应把选择恢复到该 user message 的 `{ agent, providerId/modelId, variant }`
- 再手动调用 `setSelectedModel(...)`：不应触发第二次 `sdk.session.messages`（避免“切回去”）

（测试可复用现有 `SelectionLock.test.tsx` 的 mock 方式。）

**Step 2: 运行测试确认失败**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/state/useSessionActivation.test.tsx`

Expected: FAIL（协调器未实现/未挂载）。

**Step 3: 写最小实现**

1. 在 `useSessionActivation.ts` 实现一个 hook：
   - 监听 `currentSession?.id`
   - 每次变化时 `await loadSessionMessages(id)`
   - 对非 virtual session：用 `selectionFromMessages(loadedMessages)` 推导快照并 `restoreSelections(...)`
2. 在 `App.tsx` 删除/收敛原“Load messages when session changes”的 effect，改为调用该 hook。
   - `uiBridgeUpdate({ sessionID })` 也应放入同一条“会话激活”链路中，避免分散。
   - `focus` 可保留在 App 内另一个 effect（只依赖 `currentSession?.id`），不参与选择恢复。

**Step 4: 运行测试确认通过**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/state/useSessionActivation.test.tsx`

Expected: PASS。

---

### Task 4: 更新现有回归用例并补充边界覆盖

**Files:**

- Modify: `packages/opencode/webgui/src/state/SelectionLock.test.tsx`
- (Optional) Add: `packages/opencode/webgui/src/components/SubtaskDrawer/SubtaskDrawer.selection-isolation.test.tsx`

**Step 1: 让 SelectionLock.test.tsx 对齐新架构**

如果 `App` 不再直接负责 load/restore，测试应改为：渲染会话激活协调器（hook 对应的测试组件）而不是手写 effect。

**Step 2: （可选）增加子会话隔离测试**

打开 `SubtaskDrawer` 时触发 `loadSessionMessages(childSessionId)`，断言主会话选择不变。

**Step 3: 运行相关测试**

Run:

```bash
bun run --cwd packages/opencode/webgui test:run -- \
  src/state/SessionContext.test.tsx \
  src/state/MessagesContext.selection-restore.test.tsx \
  src/state/useSessionActivation.test.tsx \
  src/state/SelectionLock.test.tsx
```

Expected: 全部 PASS。

---

### Task 5: 最小验证清单

1. 手动操作：切换到任意历史会话 → 改 model/agent/variant → 不再自动切回。
2. 打开子任务抽屉（如果有子会话）→ 主会话选择不被覆盖。
3. 控制台日志中不再出现“切换选择就触发 [MessagesContext] Loading messages for session: <当前会话>”。

---

## 执行方式

计划已写入本文件。两种执行方式：

1. **Subagent-Driven（本会话）**：我按 Task 顺序逐个执行（每个 Task 都先红后绿），中间你可以随时 review。

2. **Parallel Session**：你开一个新会话，用 `executing-plans` skill 按本文逐条执行。

你选哪一种？
