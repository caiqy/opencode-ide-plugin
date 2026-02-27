# WebGUI Scoped Storage Repo 化硬切 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 以“先引入、再迁移、后删除”的顺序完成硬切：先落地 `scopedStorage + Repositories`，再迁移所有调用点，最后删除 `sdk.kv/model` 与 `globalState*`，并补齐双宿主存储协议断言与关键回归测试。

**Architecture:** 存储能力下沉为纯技术层 `scopedStorage`，业务状态上收为 `theme/modelPrefs/selection/tabs/draft` 五个 Repo。UI/Context 仅调用 Repo，不直接接触 key/scope。Host 继续作为总桥梁保留 `openFile/openUrl` 等非存储能力，但存储子协议仅允许 `storageGet/storageSet` 且 legacy storage message 全拒绝。

**Tech Stack:** TypeScript, React, Vitest, Bun, VSCode Extension API, Kotlin, Gradle

---

### Task 1: 建立 `scopedStorage` 基础设施（仅新增，不删旧接口）

**Files:**

- Create: `packages/opencode/webgui/src/state/scopedStorage.ts`
- Create: `packages/opencode/webgui/src/state/scopedStorage.test.ts`

**Step 1: 写失败测试（新文件）**

在 `scopedStorage.test.ts` 写三组用例：

1. 三域 `global/workspace/mem` 读写与 cache 行为
2. host 写失败节流告警
3. JSON 解析失败返回 fallback

**Step 2: 运行测试确认失败**

Run（在 `packages/opencode/webgui`）：
`bun run test:run src/state/scopedStorage.test.ts`

Expected: FAIL（模块不存在或导出不匹配）。

**Step 3: 最小实现 `scopedStorage.ts`**

实现并仅导出：

- `type StorageScope = "global" | "workspace" | "mem"`
- `scopedStateGet/scopedStateSet`
- `scopedStateGetJSON/scopedStateSetJSON`
- `setScopedStateWriteErrorReporter`
- `resetScopedStateForTest`

说明：此任务阶段不删除 `globalState*`，仅完成新基建可用。

**Step 4: 运行定向测试**

Run（在 `packages/opencode/webgui`）：
`bun run test:run src/state/scopedStorage.test.ts`

Expected: PASS。

---

### Task 2: 建立 Repo 层并固化真源 schema（仅新增，不迁调用方）

**Files:**

- Create:
  - `packages/opencode/webgui/src/state/repo/themeRepo.ts`
  - `packages/opencode/webgui/src/state/repo/modelPrefsRepo.ts`
  - `packages/opencode/webgui/src/state/repo/selectionRepo.ts`
  - `packages/opencode/webgui/src/state/repo/tabsRepo.ts`
  - `packages/opencode/webgui/src/state/repo/draftRepo.ts`
- Create tests:
  - `packages/opencode/webgui/src/state/repo/themeRepo.test.ts`
  - `packages/opencode/webgui/src/state/repo/modelPrefsRepo.test.ts`
  - `packages/opencode/webgui/src/state/repo/selectionRepo.test.ts`
  - `packages/opencode/webgui/src/state/repo/tabsRepo.test.ts`
  - `packages/opencode/webgui/src/state/repo/draftRepo.test.ts`

**Step 1: 先写失败测试（每个 repo 至少 2 条）**

重点断言：

- `modelPrefsRepo` 仅 `{recent,favorite}`
- `selectionRepo` 包含 `variant` 且 scope=workspace
- `tabsRepo.activate()` 是唯一 `active_tab` 更新入口

**Step 2: 运行测试确认失败**

Run（在 `packages/opencode/webgui`）：
`bun run test:run src/state/repo/*.test.ts`

Expected: FAIL。

**Step 3: 实现 Repo 最小代码**

Repo 内部仅通过 `scopedState*` 访问 key；本阶段不改业务调用点。

**Step 4: 运行测试验证通过**

Run（在 `packages/opencode/webgui`）：
`bun run test:run src/state/repo/*.test.ts`

Expected: PASS。

---

### Task 3: 迁移所有调用方到 Repo，并固化恢复优先级与一致性契约

**Files:**

- Modify:
  - `packages/opencode/webgui/src/state/SessionContext.tsx`
  - `packages/opencode/webgui/src/components/ModelSelector.tsx`
  - `packages/opencode/webgui/src/state/tabStore.ts`
  - `packages/opencode/webgui/src/state/useSessionActivation.ts`
  - `packages/opencode/webgui/src/components/MessageInput/**/*`
  - `packages/opencode/webgui/src/components/CompactHeader/index.tsx`
  - `packages/opencode/webgui/src/components/CompactHeader/SessionDropdown.tsx`
  - `packages/opencode/webgui/src/components/CommandPalette/index.tsx`
  - 其余会话切换或模型恢复入口
- Modify tests:
  - `packages/opencode/webgui/src/state/SessionContext.test.tsx`
  - `packages/opencode/webgui/src/state/tabStore.test.ts`
  - `packages/opencode/webgui/src/state/useSessionActivation.test.tsx`
  - `packages/opencode/webgui/src/components/ModelSelector.test.tsx`
  - `packages/opencode/webgui/src/App.test.tsx`（若无则新增）

**Step 1: 写失败测试**

新增并覆盖：

1. 恢复优先级：`workspace:last_selection -> global:model.recent -> config.model -> providers首个可用`
2. 会话切换成功：`currentSession.id === tabsRepo.activeTab`
3. 会话切换失败：`switchSession` 异常时 `active_tab/currentSession` 按契约回滚
4. `session.deleted` 后 `tabs/drafts/draft_session` 清理规则

**Step 2: 运行失败验证**

Run（在 `packages/opencode/webgui`）：
`bun run test:run src/state/SessionContext.test.tsx src/state/tabStore.test.ts src/state/useSessionActivation.test.tsx src/components/ModelSelector.test.tsx src/App.test.tsx`

Expected: FAIL。

**Step 3: 完成调用方迁移**

所有业务入口改走 Repo API，不再直接依赖 key/scope 或旧聚合接口。

**Step 4: 运行定向测试**

Run（在 `packages/opencode/webgui`）：
`bun run test:run src/state/SessionContext.test.tsx src/state/tabStore.test.ts src/state/useSessionActivation.test.tsx src/components/ModelSelector.test.tsx src/App.test.tsx`

Expected: PASS。

---

### Task 4: 删除旧接口（`sdk.kv/model` 与 `globalState*`）并补迁移门禁

**Files:**

- Modify: `packages/opencode/webgui/src/lib/api/sdkClient.ts`
- Delete: `packages/opencode/webgui/src/state/globalState.ts`
- Delete: `packages/opencode/webgui/src/state/globalState.test.ts`
- Modify imports:
  - `packages/opencode/webgui/src/state/ThemeContext.tsx`
  - `packages/opencode/webgui/src/state/tabStore.ts`
  - 其余引用 `globalState*` 文件
- Modify tests:
  - `packages/opencode/webgui/src/lib/api/sdkClient.migration.test.ts`

**Step 1: 写失败测试（禁止旧接口）**

在 `sdkClient.migration.test.ts` 新增断言：

- `("kv" in sdk) === false`
- `("model" in sdk) === false`

并补静态检索门禁，命中旧符号即失败。

**Step 2: 运行失败验证**

Run（在 `packages/opencode/webgui`）：
`bun run test:run src/lib/api/sdkClient.migration.test.ts`

Expected: FAIL。

**Step 3: 删除旧接口并修复编译**

删除 `sdk.kv/model` 与 `globalState*`，确保调用链已由 Task 3 完成迁移。

**Step 4: 运行测试通过**

Run（在 `packages/opencode/webgui`）：
`bun run test:run src/lib/api/sdkClient.migration.test.ts src/state/SessionContext.test.tsx src/state/tabStore.test.ts src/state/useSessionActivation.test.tsx src/components/ModelSelector.test.tsx src/App.test.tsx`

Expected: PASS。

---

### Task 5: 补齐 Host 硬切断言（双宿主 + 路由断言）

**Files:**

- Modify: `hosts/vscode-plugin/src/test/suite/ideBridgeServer.test.ts`
- Modify: `hosts/jetbrains-plugin/src/test/kotlin/paviko/opencode/ui/IdeBridgeStorageScopeTest.kt`

**Step 1: 写失败测试**

VSCode + JetBrains 均补：

- reject `uiSetState`
- reject `kv.update`
- reject `model.update`
- `global/workspace/mem` 三域路由断言

**Step 2: 运行失败验证**

Run（在 `hosts/vscode-plugin`）：
`pnpm run compile && pnpm exec vscode-test --grep "IdeBridgeServer"`

Run（在 `hosts/jetbrains-plugin`）：
`./gradlew.bat test --tests "paviko.opencode.ui.IdeBridgeStorageScopeTest"`

Expected: FAIL。

**Step 3: 最小修正**

保证存储子协议仅 `storageGet/storageSet`，legacy storage message 全部 unsupported，同时不改动 `openFile/openUrl` 等非存储桥接能力。

**Step 4: 回归测试**

重复 Step 2 命令，Expected: PASS。

---

### Task 6: 全量验收与文档收敛

**Files:**

- Modify: `docs/plans/2026-02-27-webgui-storage-repo-hardcut-design.md`
- Modify: `docs/plans/2026-02-27-webgui-storage-repo-hardcut-implementation.md`

**Step 1: 生产代码禁用符号检索**

Run（仓库根目录）：
`rg -n "globalStateGet|globalStateSet|globalStateGetJSON|globalStateSetJSON|sdk\.kv|sdk\.model|uiGetState|uiSetState|kv\.get|kv\.update|model\.get|model\.update|opencode_webgui_state_v1|opencode_favorite_models_v1" packages/opencode/webgui/src hosts/vscode-plugin/src hosts/jetbrains-plugin/src --glob "!**/*.test.*"`

Expected: 无命中。

**Step 2: WebGUI 回归**

Run（在 `packages/opencode/webgui`）：
`bun run test:run`

Expected: PASS。

**Step 3: Host 回归**

Run（在 `hosts/vscode-plugin`）：
`pnpm run compile && pnpm exec vscode-test --grep "IdeBridgeServer"`

Run（在 `hosts/jetbrains-plugin`）：
`./gradlew.bat test --tests "paviko.opencode.ui.IdeBridgeStorageScopeTest"`

Expected: PASS。

**Step 4: 更新实施文档状态**

将任务状态、阻塞、回归结果更新为最终验收结论，并记录手工回归项结果。

**Step 5: 核对最小验收项**

- 双 host reject 写路径（`uiSetState/kv.update/model.update`）
- `global/workspace/mem` scope 路由断言
- 会话切换失败回滚测试
- `session.deleted` 清理测试
