# WebGUI Core API Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 WebGUI 从 `/app/api/*` 兼容路由迁移到上游官方核心 API（SDK client 调用），并在迁移完成后删除 `WebGuiRoute` 依赖。

**Architecture:** 采用“兼容层保留 + 分阶段迁移”的方式。先让 `sdkClient.ts` 对外 API 不变（调用方不需要一次性重写），内部逐项改为核心 API；对核心 API 不提供的能力（`state`、`session.retry`）先用最小自建路由补齐，再评估是否下线功能。

**Tech Stack:** TypeScript, React, Hono, OpenAPI SDK (`@opencode-ai/sdk/client`), Bun, Vitest.

---

### Task 1: 建立迁移基线与保护测试

**Files:**

- Modify: `packages/opencode/webgui/src/lib/api/sdkClient.ts`
- Create: `packages/opencode/webgui/src/lib/api/sdkClient.migration.test.ts`
- Test: `packages/opencode/webgui/src/lib/api/sdkClient.migration.test.ts`

**Step 1: 写失败测试（先锁定现有行为）**

```ts
import { describe, expect, it, vi } from "vitest"
import { sdk } from "./sdkClient"

describe("sdk migration baseline", () => {
  it("state.get returns {data,error} shape", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ theme: "dark" }), { status: 200 }),
    )
    const r = await sdk.state.get()
    expect(r.error).toBeNull()
    expect(r.data?.theme).toBe("dark")
  })
})
```

**Step 2: 运行测试确认失败**

Run: `npx vitest run packages/opencode/webgui/src/lib/api/sdkClient.migration.test.ts`

Expected: FAIL（当前环境下需补更多 mock 或返回结构不完整）。

**Step 3: 最小实现让测试通过**

- 不改生产逻辑，只补齐测试 mock 与断言。

**Step 4: 再次运行测试确认通过**

Run: `npx vitest run packages/opencode/webgui/src/lib/api/sdkClient.migration.test.ts`

Expected: PASS。

**Step 5: Commit**

```bash
git add packages/opencode/webgui/src/lib/api/sdkClient.migration.test.ts
git commit -m "test(webgui): add sdk migration baseline tests"
```

---

### Task 2: 迁移 Provider/Auth 到核心 API（保持 sdk 对外签名不变）

**Files:**

- Modify: `packages/opencode/webgui/src/lib/api/sdkClient.ts`
- Test: `packages/opencode/webgui/src/lib/api/sdkClient.migration.test.ts`

**Step 1: 写失败测试（覆盖新旧语义映射）**

```ts
it("auth.list maps to provider.list().connected", async () => {
  // mock core endpoint /provider response
})

it("auth.methods maps provider.auth record to single-provider array", async () => {
  // mock /provider/auth response
})
```

**Step 2: 运行测试确认失败**

Run: `npx vitest run packages/opencode/webgui/src/lib/api/sdkClient.migration.test.ts`

Expected: FAIL。

**Step 3: 最小实现**

- `sdk.auth.set(provider, value)` → `baseClient.auth.set({ path: { providerID: provider }, body: value })`
- `sdk.auth.remove(provider)` → `baseClient.auth.remove({ path: { providerID: provider } })`
- `sdk.auth.list()` → `baseClient.provider.list()` 后映射为 `Record<string, any>`（keys = connected providers）
- `sdk.auth.methods(provider)` → `baseClient.provider.auth()` 后取 `record[provider] ?? []`
- `sdk.auth.start/submit/status` 兼容：
  - `start` 返回 `{ id, url, method, instructions }`，其中 `id` 为本地生成流程标识
  - `submit/status` 改为基于本地状态机（或直接下沉到调用方重构，二选一，优先局部兼容）

**Step 4: 运行测试确认通过**

Run: `npx vitest run packages/opencode/webgui/src/lib/api/sdkClient.migration.test.ts`

Expected: PASS。

**Step 5: Commit**

```bash
git add packages/opencode/webgui/src/lib/api/sdkClient.ts packages/opencode/webgui/src/lib/api/sdkClient.migration.test.ts
git commit -m "refactor(webgui): migrate auth provider calls to core api"
```

---

### Task 3: 重构 OAuth UI 流程（轮询 status → await callback）

**Files:**

- Modify: `packages/opencode/webgui/src/components/settings/ApiKeysTab/hooks/useOAuthFlow.ts`
- Test: `packages/opencode/webgui/src/components/settings/ApiKeysTab/hooks/useOAuthFlow.test.ts`

**Step 1: 写失败测试**

```ts
it("auto oauth flow completes without polling", async () => {
  // expect no setInterval usage
  // expect connected state after callback resolves
})

it("code oauth flow submits code via callback", async () => {
  // start => method=code
  // manual submit => callback(code)
})
```

**Step 2: 运行测试确认失败**

Run: `npx vitest run packages/opencode/webgui/src/components/settings/ApiKeysTab/hooks/useOAuthFlow.test.ts`

Expected: FAIL。

**Step 3: 最小实现**

- 删除 `pollIntervals` 与 `status` 轮询逻辑。
- `handleOAuthLogin`:
  - `method === "auto"`：打开 URL 后直接 await callback 完成，成功后更新 UI。
  - `method === "code"`：展示手工输入；`handleManualCodeSubmit` 调 callback(code)。
- 保持 UI 文案与现有交互一致（Waiting/Connected/Failed）。

**Step 4: 运行测试确认通过**

Run: `npx vitest run packages/opencode/webgui/src/components/settings/ApiKeysTab/hooks/useOAuthFlow.test.ts`

Expected: PASS。

**Step 5: Commit**

```bash
git add packages/opencode/webgui/src/components/settings/ApiKeysTab/hooks/useOAuthFlow.ts packages/opencode/webgui/src/components/settings/ApiKeysTab/hooks/useOAuthFlow.test.ts
git commit -m "refactor(webgui): switch oauth flow from polling to callback"
```

---

### Task 4: 迁移 Providers 列表和配置页数据装配

**Files:**

- Modify: `packages/opencode/webgui/src/lib/api/sdkClient.ts`
- Modify: `packages/opencode/webgui/src/components/SettingsPanel/hooks/useSettingsForm.ts`
- Modify: `packages/opencode/webgui/src/components/settings/ApiKeysTab/hooks/useApiKeys.ts`

**Step 1: 写失败测试**

```ts
it("settings form loads providers from provider.list all[]", async () => {
  // providers sort and render
})

it("configuredProviders derived from connected[]", async () => {
  // Object.keys(authList) compatibility
})
```

**Step 2: 运行测试确认失败**

Run: `npx vitest run packages/opencode/webgui/src/components/SettingsPanel`

Expected: FAIL。

**Step 3: 最小实现**

- `sdk.config.allProviders()` 改为调用 `baseClient.provider.list()`，返回值适配旧结构：
  - `providers <- all`
  - `default <- default`
- `useSettingsForm.ts`：配置列表来源改为 `connected`（通过 `sdk.auth.list()` 映射得到）。
- `useApiKeys.ts`：`methods(providerId)` 使用 provider.auth 结果映射。

**Step 4: 运行测试确认通过**

Run: `npx vitest run packages/opencode/webgui/src/components/SettingsPanel packages/opencode/webgui/src/components/settings/ApiKeysTab`

Expected: PASS。

**Step 5: Commit**

```bash
git add packages/opencode/webgui/src/lib/api/sdkClient.ts packages/opencode/webgui/src/components/SettingsPanel/hooks/useSettingsForm.ts packages/opencode/webgui/src/components/settings/ApiKeysTab/hooks/useApiKeys.ts
git commit -m "refactor(webgui): migrate provider settings data source to core api"
```

---

### Task 5: 处理 state 与 session.retry（核心 API 无原生端点）

**Files:**

- Modify: `packages/opencode/src/server/server.ts`
- Modify: `packages/opencode/src/webgui/server/webgui.ts`
- Modify: `packages/opencode/webgui/src/lib/api/sdkClient.ts`
- Test: `packages/opencode/webgui/src/state/SessionContext.test.tsx`

**Step 1: 写失败测试**

```ts
it("session context still initializes model and agent from state api", async () => {
  // ensure selected model/agent initialization unchanged
})

it("retry still triggers assistant loop and updates messages", async () => {
  // call sdk.session.retry and expect message update path
})
```

**Step 2: 运行测试确认失败**

Run: `npx vitest run packages/opencode/webgui/src/state/SessionContext.test.tsx`

Expected: FAIL。

**Step 3: 最小实现（两种方案二选一）**

方案 A（推荐，风险最低）：

- 保留 `/app/api/state` 与 `/app/api/session/:id/retry`，但将 auth/provider/config 全部迁移后，`WebGuiRoute` 精简到只保留这两类端点。

方案 B（完全跟进上游）：

- 删除 state/retry 功能或迁移到 `global/config` + 新交互（取消“Retry without new prompt”）。

**Step 4: 运行测试确认通过**

Run: `npx vitest run packages/opencode/webgui/src/state/SessionContext.test.tsx`

Expected: PASS。

**Step 5: Commit**

```bash
git add packages/opencode/src/server/server.ts packages/opencode/src/webgui/server/webgui.ts packages/opencode/webgui/src/lib/api/sdkClient.ts packages/opencode/webgui/src/state/SessionContext.test.tsx
git commit -m "refactor(webgui): isolate legacy state and retry compatibility routes"
```

---

### Task 6: 删除 `/app/api` 依赖与清理兼容层

**Files:**

- Modify: `packages/opencode/webgui/src/lib/api/sdkClient.ts`
- Modify: `packages/opencode/src/server/server.ts`
- Delete: `packages/opencode/src/webgui/server/webgui.ts`（仅在 state/retry 也迁移完成后）
- Search: `packages/opencode/webgui/src/**`

**Step 1: 写失败测试（防回归）**

```ts
it("has no /app/api hardcoded endpoint", async () => {
  // grep-level test or lint assertion
})
```

**Step 2: 运行检查确认失败**

Run: `grep -R "app/api" packages/opencode/webgui/src packages/opencode/src/server`

Expected: 存在匹配。

**Step 3: 最小实现**

- 删除 `sdkClient.ts` 中所有 `/app/api` 字符串。
- 删除 `.route("/app/api", WebGuiRoute)` 挂载。
- 如果 `webgui.ts` 已无有效端点，删除文件并清理 import。

**Step 4: 运行检查确认通过**

Run: `grep -R "app/api" packages/opencode/webgui/src packages/opencode/src/server`

Expected: 无匹配。

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor(webgui): remove app/api compatibility layer"
```

---

### Task 7: 全量验证与发布前检查

**Files:**

- Verify only

**Step 1: 运行类型检查**

Run:

```bash
./node_modules/.bin/tsc -b
./node_modules/.bin/tsc --noEmit
```

Expected: 全部通过。

**Step 2: 运行关键测试集**

Run:

```bash
npx vitest run packages/opencode/webgui/src/lib/api/sdkClient.migration.test.ts
npx vitest run packages/opencode/webgui/src/components/settings/ApiKeysTab
npx vitest run packages/opencode/webgui/src/state/SessionContext.test.tsx
```

Expected: 全部通过。

**Step 3: 手工冒烟（VSCode 插件）**

- 打开设置页：Provider 列表加载正常。
- API Key 保存/删除可用。
- OAuth（auto/code）流程可完成。
- Slash command 执行可用。
- Session retry（若保留）可用。

**Step 4: 记录验证证据**

- 在 PR 描述附命令、退出码、关键截图。

**Step 5: Commit（若有文档或测试修正）**

```bash
git add -A
git commit -m "chore(webgui): finalize core api migration verification"
```

---

## 迁移决策说明（必须先确认）

1. **`state` 功能是否保留？**
   - 保留：继续保留最小兼容端点或迁移到 `global/config` + IDE bridge state。
   - 不保留：需要同步删 UI 入口与初始化逻辑。

2. **`session.retry` 功能是否保留？**
   - 保留：维持最小端点。
   - 不保留：删按钮和调用链。

3. **OAuth `status` 轮询是否保留兼容接口？**
   - 建议不保留，直接迁移 UI 到 callback 模式。

---

## 风险点清单

- `sdk.auth.list()` 返回语义变化可能影响 `configuredProviders`。
- OAuth auto/code 流程切换可能导致状态文案不同步。
- `SessionContext` 初始化依赖 `sdk.state.get()`，迁移时容易回归模型/agent 记忆。
- `session.retry` 若取消，需同步产品行为与文案。

---

Plan complete and saved to `docs/plans/2026-02-07-webgui-core-api-migration.md`.

Two execution options:

**1. Subagent-Driven (this session)** - 我在当前会话按任务逐个执行并在每个任务后汇报。

**2. Parallel Session (separate)** - 你新开会话，按本计划用 executing-plans 模式批量推进。

你选哪种？
