# WebGUI 三域存储硬切 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 以硬切方式完成 WebGUI 与双宿主的 scoped storage 改造，仅保留 `storageGet/storageSet` 与 `global/workspace/mem`。

**Architecture:** 先重建协议与底座，再迁移 WebGUI 状态读写，随后清理 VSCode/JetBrains 历史路由。全链路删除旧入口与兼容字段，不读取旧 key、不 fallback、不双写、不迁移。

**Tech Stack:** TypeScript, React, Zustand, Vitest, Bun, VSCode Extension API, Kotlin

## 当前执行进度（上下文压缩用）

### 任务状态

- Task 1：已完成
- Task 2：已完成
- Task 3：已完成
- Task 4：已完成
- Task 5：已完成
- Task 6：已完成（自动化回归已通过，待最终手工回归）

### 已完成的关键改动摘要

- 已完成 WebGUI scoped storage 三域底座（global/workspace/mem）与 ideBridge scope 协议落地
- 已删除 `uiBridgeState` / `lastSelectionStore` 旧路径及相关依赖链路
- 已完成 `global:model` 与 `workspace:last_selection` 的新归属拆分
- VSCode host 已收敛为仅保留 `storageGet/storageSet`，并按 scope 路由
- JetBrains host 已删除 legacy case，切换为 scoped storage + mem map
- 已补齐 host 侧硬切断言：`model.get` 在 VSCode/JetBrains bridge 均返回 unsupported
- 已修复 JetBrains 测试稳定性（SSE 建连同步），避免 `SocketTimeoutException` 偶发/稳定失败
- 已补齐 `gradle/wrapper/gradle-wrapper.jar`，`./gradlew` 可在本地直接执行

### 当前阻塞与验证状态

- VSCode 侧整套测试仍有既有噪音（与本改动无关），已改用 `pnpm exec vscode-test --grep "IdeBridgeServer"` 收敛验证入口。
- JetBrains 侧环境阻塞已解除；`./gradlew test --tests "paviko.opencode.ui.IdeBridgeStorageScopeTest"` 可稳定通过。

### 下一个会话最小继续步骤

1. 执行手工回归（跨项目隔离 + 全局共享 + mem 非持久）并记录截图/日志。
2. 在后续 CI 中补充 VSCode 定向测试入口（可传入 `--grep` 或按文件过滤），减少本地与 CI 噪音差异。
3. 准备合并前核对：仅保留 `storageGet/storageSet(scope, ...)`，确认无 legacy host case 回流。

---

### Task 1: 先重建三域底座与协议

**Files:**

- Modify: `packages/opencode/webgui/src/lib/ideBridge.ts`
- Modify: `packages/opencode/webgui/src/state/globalState.ts`
- Modify: `packages/opencode/webgui/src/state/globalState.test.ts`
- Modify: `packages/opencode/webgui/src/state/ThemeContext.tsx`
- Test: `packages/opencode/webgui/src/state/globalState.test.ts`

**Step 1: Write the failing test**

```ts
it("scoped API 显式支持 global/workspace/mem 且三域均有内存镜像", async () => {
  vi.mocked(ideBridge.isInstalled).mockReturnValue(true)
  vi.mocked(ideBridge.storageGet).mockResolvedValue({
    "opencode:webgui:workspace:tabs:v1": JSON.stringify({ open_tabs: ["s1"], active_tab: "s1" }),
  })

  await scopedStateSetJSON("mem", "opencode:webgui:mem:runtime:v1", { panel: "chat" })
  const tabs = await scopedStateGetJSON("workspace", "opencode:webgui:workspace:tabs:v1", {
    open_tabs: [],
    active_tab: "",
  })

  expect(tabs.active_tab).toBe("s1")
  expect(ideBridge.storageGet).toHaveBeenCalledWith("workspace", ["opencode:webgui:workspace:tabs:v1"])
})
```

**Step 2: Run test to verify it fails**

Run（在 `packages/opencode/webgui`）：`bun run test:run src/state/globalState.test.ts`  
Expected: FAIL（当前仍是旧 `globalStateGet/Set/JSON` 与无 scope 协议）。

**Step 3: Write minimal implementation**

```ts
export type StorageScope = "global" | "workspace" | "mem"

const cache = {
  global: new Map<string, string>(),
  workspace: new Map<string, string>(),
  mem: new Map<string, string>(),
}

export async function scopedStateGet(scope: StorageScope, keys: string[]) {
  const host = await ideBridge.storageGet(scope, keys)
  return Object.fromEntries(keys.map((k) => [k, host?.[k] ?? cache[scope].get(k)]))
}
```

**Step 4: Run test to verify it passes**

Run（在 `packages/opencode/webgui`）：`bun run test:run src/state/globalState.test.ts`  
Expected: PASS。

**Step 5: Commit**

```bash
git add packages/opencode/webgui/src/lib/ideBridge.ts packages/opencode/webgui/src/state/globalState.ts packages/opencode/webgui/src/state/globalState.test.ts packages/opencode/webgui/src/state/ThemeContext.tsx
git commit -m "feat(webgui): add scoped storage base for global workspace mem"
```

---

### Task 2: 再迁移 WebGUI 并删除桥接旧入口

**Files:**

- Delete: `packages/opencode/webgui/src/state/uiBridgeState.ts`
- Modify: `packages/opencode/webgui/src/main.tsx`
- Modify: `packages/opencode/webgui/src/App.tsx`
- Modify: `packages/opencode/webgui/src/components/MessageInput/EditorToolbar.tsx`
- Modify: `packages/opencode/webgui/src/components/CompactHeader/SessionDropdown.tsx`
- Modify: `packages/opencode/webgui/src/state/useSessionActivation.ts`
- Modify: `packages/opencode/webgui/src/components/MessageInput/index.tsx`
- Modify: `packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.ts`
- Delete: `packages/opencode/webgui/src/state/uiBridgeState.test.ts`
- Test: `packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.test.ts`

**Step 1: Write the failing test**

```ts
it("输入与会话切换仅写 scoped keys，不再依赖 uiBridgeState", async () => {
  await onDraftChange("s1", "hello")
  expect(scopedStateSetJSON).toHaveBeenCalledWith(
    "workspace",
    "opencode:webgui:workspace:drafts:v1",
    expect.any(Object),
  )
  expect(scopedStateSetJSON).toHaveBeenCalledWith("workspace", "opencode:webgui:workspace:draft_session:v1", "s1")
})
```

**Step 2: Run test to verify it fails**

Run（在 `packages/opencode/webgui`）：`bun run test:run src/components/MessageInput/hooks/useMessageInput.test.ts`  
Expected: FAIL（当前调用链仍含 `uiBridgeUpdate*` / `uiBridgeSubscribe*`）。

**Step 3: Write minimal implementation**

```ts
await scopedStateSetJSON("workspace", "opencode:webgui:workspace:drafts:v1", nextDrafts)
await scopedStateSetJSON("workspace", "opencode:webgui:workspace:draft_session:v1", sessionId ?? null)
```

并删除 `uiGetState/uiSetState`、`getState/setState`、`opencode:ui-bridge-state` 事件通道与全部调用点。

**Step 4: Run test to verify it passes**

Run（在 `packages/opencode/webgui`）：`bun run test:run src/components/MessageInput/hooks/useMessageInput.test.ts src/state/globalState.test.ts`  
Expected: PASS。

**Step 5: Commit**

```bash
git add packages/opencode/webgui/src/main.tsx packages/opencode/webgui/src/App.tsx packages/opencode/webgui/src/components/MessageInput/EditorToolbar.tsx packages/opencode/webgui/src/components/CompactHeader/SessionDropdown.tsx packages/opencode/webgui/src/state/useSessionActivation.ts packages/opencode/webgui/src/components/MessageInput/index.tsx packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.ts packages/opencode/webgui/src/lib/ideBridge.ts
git add -u packages/opencode/webgui/src/state/uiBridgeState.ts packages/opencode/webgui/src/state/uiBridgeState.test.ts
git commit -m "refactor(webgui): remove ui bridge state channel and switch to scoped keys"
```

---

### Task 3: 收敛选择态与模型字段到新结构

**Files:**

- Delete: `packages/opencode/webgui/src/state/lastSelectionStore.ts`
- Delete: `packages/opencode/webgui/src/state/lastSelectionStore.test.ts`
- Modify: `packages/opencode/webgui/src/lib/api/sdkClient.ts`
- Modify: `packages/opencode/webgui/src/lib/api/sdkClient.migration.test.ts`
- Modify: `packages/opencode/webgui/src/state/globalState.test.ts`
- Test: `packages/opencode/webgui/src/lib/api/sdkClient.migration.test.ts`

**Step 1: Write the failing test**

```ts
it("global:model 仅 recent/favorite，variant 仅存 workspace:last_selection", async () => {
  const model = await loadGlobalModel()
  expect(model).toEqual({ recent: [], favorite: [] })

  const selection = await loadWorkspaceSelection()
  expect(selection.variant).toBe("reasoning")
})
```

**Step 2: Run test to verify it fails**

Run（在 `packages/opencode/webgui`）：`bun run test:run src/lib/api/sdkClient.migration.test.ts`  
Expected: FAIL（当前仍有聚合 `kv`、`variant` 旧归属或直连 host 请求）。

**Step 3: Write minimal implementation**

```ts
const GLOBAL_MODEL_KEY = "opencode:webgui:global:model:v1"
const WORKSPACE_SELECTION_KEY = "opencode:webgui:workspace:last_selection:v1"

type GlobalModel = { recent: unknown[]; favorite: unknown[] }
```

并删除 `kv.get/kv.update/model.get/model.update` 依赖路径与 `lastSelectionStore.ts` 直连请求。

**Step 4: Run test to verify it passes**

Run（在 `packages/opencode/webgui`）：`bun run test:run src/lib/api/sdkClient.migration.test.ts src/state/globalState.test.ts`  
Expected: PASS。

**Step 5: Commit**

```bash
git add packages/opencode/webgui/src/lib/api/sdkClient.ts packages/opencode/webgui/src/lib/api/sdkClient.migration.test.ts packages/opencode/webgui/src/state/globalState.test.ts
git add -u packages/opencode/webgui/src/state/lastSelectionStore.ts packages/opencode/webgui/src/state/lastSelectionStore.test.ts
git commit -m "refactor(webgui): hard cut legacy selection paths and model variant split"
```

---

### Task 4: 清理 VSCode host 历史路由

**Files:**

- Modify: `hosts/vscode-plugin/src/ui/IdeBridgeServer.ts`
- Modify: `hosts/vscode-plugin/src/ui/WebviewController.ts`
- Modify: `hosts/vscode-plugin/src/ui/WebviewManager.ts`
- Modify: `hosts/vscode-plugin/src/ui/ActivityBarProvider.ts`
- Modify: `hosts/vscode-plugin/src/test/suite/ideBridgeServer.test.ts`
- Test: `hosts/vscode-plugin/src/test/suite/ideBridgeServer.test.ts`

**Step 1: Write the failing test**

```ts
test("IdeBridgeServer 仅处理 storageGet/storageSet，且 scope 支持 mem", async () => {
  const res = await send("storageSet", { scope: "mem", key: "opencode:webgui:mem:runtime:v1", value: "{}" })
  expect(res.ok).toBe(true)
  expect(await send("uiGetState", {})).toMatchObject({ ok: false })
  expect(await send("kv.get", {})).toMatchObject({ ok: false })
})
```

**Step 2: Run test to verify it fails**

Run（在 `hosts/vscode-plugin`）：`pnpm test -- ideBridgeServer.test.ts`  
Expected: FAIL（当前仍保留 `uiGetState/uiSetState` 与 `kv/model` case）。

**Step 3: Write minimal implementation**

```ts
if (msg.type === "storageGet") return handleStorageGet(msg.payload)
if (msg.type === "storageSet") return handleStorageSet(msg.payload)
return replyError("unsupported message type")
```

并删除 `uiState` 注入链路，仅保留 scoped storage 路由。

**Step 4: Run test to verify it passes**

Run（在 `hosts/vscode-plugin`）：`pnpm test -- ideBridgeServer.test.ts`  
Expected: PASS。

**Step 5: Commit**

```bash
git add hosts/vscode-plugin/src/ui/IdeBridgeServer.ts hosts/vscode-plugin/src/ui/WebviewController.ts hosts/vscode-plugin/src/ui/WebviewManager.ts hosts/vscode-plugin/src/ui/ActivityBarProvider.ts hosts/vscode-plugin/src/test/suite/ideBridgeServer.test.ts
git commit -m "refactor(vscode-host): keep scoped storage protocol only"
```

---

### Task 5: 清理 JetBrains host 历史路由

**Files:**

- Modify: `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt`
- Create: `hosts/jetbrains-plugin/src/test/kotlin/paviko/opencode/ui/IdeBridgeStorageScopeTest.kt`
- Test: `hosts/jetbrains-plugin/src/test/kotlin/paviko/opencode/ui/IdeBridgeStorageScopeTest.kt`

**Step 1: Write the failing test**

```kotlin
@Test
fun `only storageGet and storageSet are accepted`() {
    assertFalse(send("uiGetState").ok)
    assertFalse(send("kv.get").ok)
    assertTrue(send("storageSet", mapOf("scope" to "mem")).ok)
}
```

**Step 2: Run test to verify it fails**

Run（在 `hosts/jetbrains-plugin`）：`./gradlew test --tests "paviko.opencode.ui.IdeBridgeStorageScopeTest"`  
Expected: FAIL（当前仍有 `Session.uiState` 与旧 case）。

**Step 3: Write minimal implementation**

```kotlin
when (type) {
    "storageGet" -> handleStorageGet(payload)
    "storageSet" -> handleStorageSet(payload)
    else -> replyError(id, "unsupported message type")
}
```

并移除 `Session.uiState` 字段与 `uiGetState/uiSetState/kv/model` 分支。

**Step 4: Run test to verify it passes**

Run（在 `hosts/jetbrains-plugin`）：`./gradlew test --tests "paviko.opencode.ui.IdeBridgeStorageScopeTest"`  
Expected: PASS。

**Step 5: Commit**

```bash
git add hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt hosts/jetbrains-plugin/src/test/kotlin/paviko/opencode/ui/IdeBridgeStorageScopeTest.kt
git commit -m "refactor(jetbrains-host): remove legacy ui and kv routes"
```

---

### Task 6: 最后执行硬切清理与验收

**Files:**

- Modify: `packages/opencode/webgui/src/state/globalState.test.ts`
- Modify: `packages/opencode/webgui/src/lib/api/sdkClient.migration.test.ts`
- Modify: `hosts/vscode-plugin/src/test/suite/ideBridgeServer.test.ts`
- Modify: `hosts/jetbrains-plugin/src/test/kotlin/paviko/opencode/ui/IdeBridgeStorageScopeTest.kt`
- Test: `packages/opencode/webgui/src/state/globalState.test.ts`
- Test: `packages/opencode/webgui/src/lib/api/sdkClient.migration.test.ts`
- Test: `hosts/vscode-plugin/src/test/suite/ideBridgeServer.test.ts`
- Test: `hosts/jetbrains-plugin/src/test/kotlin/paviko/opencode/ui/IdeBridgeStorageScopeTest.kt`

**Step 1: Write the failing test**

```ts
it("hydrate 不再接受 sessionId/providerID/modelID/input 且不读取旧 key", async () => {
  const s = hydrateFromScopedStorage({ sessionId: "old", providerID: "old", modelID: "old", input: "old" })
  expect(s).toEqual(defaultState)
})
```

**Step 2: Run test to verify it fails**

Run（在 `packages/opencode/webgui`）：`bun run test:run src/state/globalState.test.ts src/lib/api/sdkClient.migration.test.ts`  
Expected: FAIL（仍有旧字段兼容或旧 key 路径）。

Run（在 `hosts/vscode-plugin`）：`pnpm test -- ideBridgeServer.test.ts`  
Expected: FAIL（仍可能接受历史 message type）。

Run（在 `hosts/jetbrains-plugin`）：`./gradlew test --tests "paviko.opencode.ui.IdeBridgeStorageScopeTest"`  
Expected: FAIL（仍可能接受历史 message type）。

**Step 3: Write minimal implementation**

```ts
const legacy = ["sessionId", "providerID", "modelID", "input"]
legacy.forEach((k) => delete (payload as Record<string, unknown>)[k])
```

并删除所有 fallback、双写与迁移逻辑，只保留 scoped key 真源。

**Step 4: Run test to verify it passes**

Run（在 `packages/opencode/webgui`）：`bun run test:run src/state/globalState.test.ts src/lib/api/sdkClient.migration.test.ts`  
Expected: PASS。

Run（在 `hosts/vscode-plugin`）：`pnpm test -- ideBridgeServer.test.ts`  
Expected: PASS。

Run（在 `hosts/jetbrains-plugin`）：`./gradlew test --tests "paviko.opencode.ui.IdeBridgeStorageScopeTest"`  
Expected: PASS。

**Step 5: Commit**

```bash
git add packages/opencode/webgui/src/state/globalState.test.ts packages/opencode/webgui/src/lib/api/sdkClient.migration.test.ts hosts/vscode-plugin/src/test/suite/ideBridgeServer.test.ts hosts/jetbrains-plugin/src/test/kotlin/paviko/opencode/ui/IdeBridgeStorageScopeTest.kt
git commit -m "test(storage): enforce hard-cut behavior without legacy compatibility"
```

---

## 终审执行清单（开工前/合并前）

### A. 设计一致性检查（开工前）

- [ ] 仅保留三域：`global | workspace | mem`。
- [ ] 仅保留桥接协议：`storageGet/storageSet(scope, ...)`。
- [ ] 明确硬切：不读旧 key、不 fallback、不双写、不迁移。
- [ ] `global:model:v1` 仅包含 `recent/favorite`。
- [ ] `variant` 仅存在于 `workspace:last_selection:v1`。
- [ ] `sessionID` 仅由 `workspace:tabs:v1.active_tab` 承担可恢复真源。

### B. 历史入口移除检查（代码完成后）

- [ ] 全局检索无 `uiGetState` / `uiSetState` 调用与 case。
- [ ] 全局检索无 `opencode:ui-bridge-state` 事件监听与派发。
- [ ] `packages/opencode/webgui/src/state/uiBridgeState.ts` 已删除。
- [ ] 全局检索无 `uiBridgeUpdate*` / `uiBridgeSubscribe*` / `uiBridgeHydrate*` 调用。
- [ ] 全局检索无 `globalStateGet/Set/JSON` 旧 API 调用与导出。
- [ ] `packages/opencode/webgui/src/state/lastSelectionStore.ts` 已删除。
- [ ] hosts 侧无 `kv.get/kv.update/model.get/model.update` case。

### C. 字段与行为检查（联调时）

- [ ] `workspace:last_selection:v1` 正确包含 `agent/provider_id/model_id/variant/agent_model_map/updated_at`。
- [ ] `workspace:tabs:v1` 正确包含 `open_tabs/active_tab`。
- [ ] `workspace:drafts:v1` 为 `session_id -> draft_text` 映射。
- [ ] `workspace:draft_session:v1` 为 `string | null`。
- [ ] `session.deleted` 后同步清理 drafts/tabs，并修正 `active_tab`。
- [ ] 删除 hydrate 历史兼容输入：`sessionId/providerID/modelID/input`。

### D. 测试与验收命令检查（合并前）

- [ ] 在 `packages/opencode/webgui` 运行：`bun run test:run src/state/globalState.test.ts src/lib/api/sdkClient.migration.test.ts`
- [ ] 在 `hosts/vscode-plugin` 运行：`pnpm test -- ideBridgeServer.test.ts`
- [ ] 在 `hosts/jetbrains-plugin` 运行：`./gradlew test --tests "paviko.opencode.ui.IdeBridgeStorageScopeTest"`
- [ ] 确认未从仓库根目录执行测试。

### E. 手工回归检查（最终）

- [ ] 切换项目后，`last_selection/tabs/drafts` 不串项目。
- [ ] `theme` 与 `global:model(recent/favorite)` 跨项目共享一致。
- [ ] `mem` 仅会话内可见，不落盘。
- [ ] 无 mem 业务 key 时，验证 mem 路由可用且不参与业务恢复。

---

## 执行方式选择

1. **Subagent-Driven（本会话）**：我在当前会话按任务逐条推进并逐条回归。
2. **Parallel Session（新会话）**：你新开会话并加载 `superpowers:executing-plans` 按计划执行。

你想选哪一种？
