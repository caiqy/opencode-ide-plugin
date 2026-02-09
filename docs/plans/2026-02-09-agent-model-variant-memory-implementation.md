# Agent/Model/Variant 全局记忆 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 VSCode WebGUI 记住最后一次使用的 `agent + model + variant`，并在跨项目/跨重启时自动恢复。

**Architecture:** 在 WebGUI 增加一个专用的 host 持久化适配层（`ideBridge storageGet/storageSet`），将 VSCode `globalState` 作为主数据源。`SessionContext` 初始化时按 `host -> kv/model -> config/default` 的优先级恢复选择；当记录不可用时自动回退到可用模型并产出一次性提示。状态变更后异步回写 host，localStorage/kv/model 保持兼容。

**Tech Stack:** TypeScript, React, Vitest, Testing Library, ideBridge (`storageGet/storageSet`).

---

### Task 1: 新增 host 记忆适配层（TDD）

**Files:**

- Create: `packages/opencode/webgui/src/state/lastSelectionStore.ts`
- Create: `packages/opencode/webgui/src/state/lastSelectionStore.test.ts`

**Step 1: 写失败测试（适配层行为）**

在 `lastSelectionStore.test.ts` 覆盖：

```ts
it("bridge 未安装时 load 返回 null", async () => {})
it("storageGet 返回合法 JSON 时可解析", async () => {})
it("非法 JSON / 非法结构时返回 null", async () => {})
it("save 会调用 storageSet 并写入 opencode_last_selection_v1", async () => {})
```

**Step 2: 运行测试确认失败**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/state/lastSelectionStore.test.ts`

Expected: FAIL（模块不存在 / 行为未实现）。

**Step 3: 写最小实现**

在 `lastSelectionStore.ts` 实现：

- `LAST_SELECTION_KEY = "opencode_last_selection_v1"`
- `LastSelectionV1` 类型（含 `v: 1`, `agent`, `providerId`, `modelId`, `variant`, `updatedAt`）
- `loadLastSelectionFromHost()`：读取并校验结构，不合法返回 `null`
- `saveLastSelectionToHost()`：序列化后写入 host storage

**Step 4: 运行测试确认通过**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/state/lastSelectionStore.test.ts`

Expected: PASS。

**Step 5: Commit**

```bash
git add packages/opencode/webgui/src/state/lastSelectionStore.ts packages/opencode/webgui/src/state/lastSelectionStore.test.ts
git commit -m "feat(webgui): add host-backed last selection store"
```

---

### Task 2: SessionContext 启动恢复优先级与不可用回退（TDD）

**Files:**

- Modify: `packages/opencode/webgui/src/state/SessionContext.tsx`
- Modify: `packages/opencode/webgui/src/state/SessionContext.test.tsx`

**Step 1: 写失败测试（恢复优先级 + 回退）**

在 `SessionContext.test.tsx` 增加：

```ts
it("host 记录优先于 kv/model", async () => {})
it("host 模型不可用时自动回退到可用模型", async () => {})
it("host variant 不可用时清空为 undefined", async () => {})
```

Mock 点：`sdk.config.providers()`、`sdk.kv.get()`、`sdk.model.get()`、`ideBridge.request("storageGet")`。

**Step 2: 运行测试确认失败**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/state/SessionContext.test.tsx`

Expected: FAIL（当前未读取 host last selection、未做可用性校验）。

**Step 3: 写最小实现**

在 `SessionContext.tsx` 中：

- 接入 `loadLastSelectionFromHost()`
- 初始化改为：`host -> kv/model -> config/default`
- 增加模型可用性校验（基于 `sdk.config.providers()`）
- 模型不可用时自动选择可用候选（recent/config/首个可用）
- variant 不可用时置空
- 新增一次性提示状态（如 `selectionRestoreNotice`）供 UI 展示

**Step 4: 运行测试确认通过**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/state/SessionContext.test.tsx`

Expected: PASS。

**Step 5: Commit**

```bash
git add packages/opencode/webgui/src/state/SessionContext.tsx packages/opencode/webgui/src/state/SessionContext.test.tsx
git commit -m "feat(webgui): restore last selection from host with availability fallback"
```

---

### Task 3: 状态变更持久化与提示落地（TDD）

**Files:**

- Modify: `packages/opencode/webgui/src/state/SessionContext.tsx`
- Modify: `packages/opencode/webgui/src/state/SessionContext.test.tsx`
- Modify: `packages/opencode/webgui/src/App.tsx`

**Step 1: 写失败测试（持久化写回）**

在 `SessionContext.test.tsx` 增加：

```ts
it("变更 agent/model/variant 后会写回 host storage", async () => {})
```

断言 `ideBridge.request("storageSet", { key: "opencode_last_selection_v1", value: ... })` 被调用。

**Step 2: 运行测试确认失败**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/state/SessionContext.test.tsx`

Expected: FAIL（当前未写回 host last selection）。

**Step 3: 写最小实现**

- `SessionContext` 中增加持久化 effect：在恢复完成后，监听 `selectedAgent/selectedProviderId/selectedModelId/selectedVariant` 并调用 `saveLastSelectionToHost()`
- 暴露 `selectionRestoreNotice` + `clearSelectionRestoreNotice()`
- `App.tsx` 监听该 notice，显示一次轻提示 toast（`warning`/`info`），然后清理 notice

**Step 4: 运行测试确认通过**

Run: `bun run --cwd packages/opencode/webgui test:run -- src/state/SessionContext.test.tsx`

Expected: PASS。

**Step 5: Commit**

```bash
git add packages/opencode/webgui/src/state/SessionContext.tsx packages/opencode/webgui/src/state/SessionContext.test.tsx packages/opencode/webgui/src/App.tsx
git commit -m "feat(webgui): persist last selection to host and show fallback notice"
```

---

### Task 4: 回归验证与交付检查

**Files:**

- Verify only

**Step 1: 跑新增与受影响测试**

Run:

```bash
bun run --cwd packages/opencode/webgui test:run -- src/state/lastSelectionStore.test.ts
bun run --cwd packages/opencode/webgui test:run -- src/state/SessionContext.test.tsx
bun run --cwd packages/opencode/webgui test:run -- src/components/ModelSelector.test.tsx
```

Expected: PASS。

**Step 2: 跑受影响包构建（含 typecheck）**

Run: `bun run --cwd packages/opencode/webgui build`

Expected: PASS。

**Step 3: 手工验证（VSCode）**

- 项目 A 选择 agent/model/variant 后关闭 VSCode
- 打开项目 B，确认自动恢复
- 模拟不可用模型（断开 provider 或切换不存在模型）后，确认自动回退并提示一次

**Step 4: 记录验证证据**

- 保存命令输出与关键行为截图（恢复成功、回退提示）

**Step 5: Commit（若有补充修复）**

```bash
git add -A
git commit -m "test(webgui): verify global last selection restore flow"
```

---

Plan complete and saved to `docs/plans/2026-02-09-agent-model-variant-memory-implementation.md`.

Two execution options:

**1. Subagent-Driven (this session)** - 我在当前会话按任务逐个实现并在每个任务后汇报。

**2. Parallel Session (separate)** - 你新开会话，按本计划用 executing-plans 模式批量推进。

你选哪种？
