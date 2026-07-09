# MCP 开关 HttpApi 路由补齐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐 MCP server/tool enable 路由，让状态弹层开关命中真实 JSON API，并用后端/覆盖/前端测试锁住回归。

**Architecture:** 先在现有 MCP HttpApi 测试里加红灯，证明 `PATCH /mcp/:name/enabled` 与 `PATCH /mcp/:name/tools/:toolId` 当前没有命中 handler。然后在 `groups/mcp.ts` 和 `handlers/mcp.ts` 里补最小 endpoint 与 handler 接线，最后把 `httpapi-exercise` 与前端 hook 测试补齐，确保后续上游合并不会再次漏掉这组路由。

**Tech Stack:** TypeScript, Effect HttpApi, Bun test, Vitest, React hook tests

---

## 文件结构与职责

- `packages/opencode/src/server/routes/instance/httpapi/groups/mcp.ts`
  - MCP HttpApi schema 与 endpoint 声明，是本次新增 PATCH 路由的权威位置。
- `packages/opencode/src/server/routes/instance/httpapi/handlers/mcp.ts`
  - MCP HttpApi handler 接线，负责把 PATCH payload 落到 `MCP.Service`。
- `packages/opencode/test/server/httpapi-mcp.test.ts`
  - 现有 MCP HttpApi focused 测试，适合先锁定 PATCH 路由红灯。
- `packages/opencode/test/server/httpapi-exercise/index.ts`
  - route coverage exerciser，若不补场景，后续合并上游时可能再次遗漏。
- `packages/opencode/webgui/src/components/CompactHeader/useStatusPopoverData.test.tsx`
  - 前端 toggle 链路测试，适合锁定 `toggleMcp` / `toggleTool` 仍然调用这两个 PATCH surface 并在成功后 refresh。
- 浏览器实测页面：`http://localhost:5173/app`
  - 用于确认点击开关时 `PATCH /mcp/.../enabled` 不再返回 HTML fallback 页面。

---

### Task 1: 先写后端红灯测试锁定 MCP PATCH 路由缺口

**Files:**

- Modify: `packages/opencode/test/server/httpapi-mcp.test.ts`
- Reference: `packages/opencode/src/server/routes/instance/httpapi/groups/mcp.ts`
- Reference: `packages/opencode/src/server/routes/instance/httpapi/handlers/mcp.ts`

- [ ] **Step 1: 在 `httpapi-mcp.test.ts` 增加 server enabled PATCH 失败测试**

新增一条 focused 测试，先按当前期望写：

```ts
it.instance(
  "serves enabled toggle endpoint",
  () =>
    Effect.gen(function* () {
      const tmp = yield* TestInstance
      const handler = yield* handlerScoped
      const response = yield* request(handler, "/mcp/demo/enabled", tmp.directory, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      })

      expect(response.status).toBe(200)
      expect(yield* json(response)).toBe(true)
    }),
  {
    config: {
      mcp: {
        demo: {
          type: "local",
          command: ["echo", "demo"],
          enabled: false,
        },
      },
    },
  },
)
```

- [ ] **Step 2: 在同一文件增加 tool enabled PATCH 失败测试**

再加一条 focused 测试：

```ts
it.instance(
  "serves tool enabled toggle endpoint",
  () =>
    Effect.gen(function* () {
      const tmp = yield* TestInstance
      const handler = yield* handlerScoped
      const response = yield* request(handler, "/mcp/demo/tools/demo_read/enabled", tmp.directory, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      })

      expect(response.status).toBe(200)
      expect(yield* json(response)).toBe(true)
    }),
  {
    config: {
      mcp: {
        demo: {
          type: "local",
          command: ["echo", "demo"],
          enabled: true,
        },
      },
    },
  },
)
```

如果实际 tool path 使用的是别的参数名，按最终 `groups/mcp.ts` 设计同步即可，但测试必须先写在生产实现之前。

- [ ] **Step 3: 运行 focused 后端测试，确认先红灯**

Run:

```powershell
bun test test/server/httpapi-mcp.test.ts --timeout 30000
```

Workdir:

```text
packages/opencode
```

Expected:

- 新增 PATCH 测试失败
- 失败形态应表现为未命中真实 MCP PATCH route（例如 404、schema miss，或落不到当前 handler）

- [ ] **Step 4: （可选）记录红灯检查点，不实际提交**

```bash
git add packages/opencode/test/server/httpapi-mcp.test.ts
```

本计划不要求实际 commit，除非用户后续明确要求。

---

### Task 2: 最小实现补齐 MCP PATCH routes 与 handlers

**Files:**

- Modify: `packages/opencode/src/server/routes/instance/httpapi/groups/mcp.ts`
- Modify: `packages/opencode/src/server/routes/instance/httpapi/handlers/mcp.ts`
- Test: `packages/opencode/test/server/httpapi-mcp.test.ts`

- [ ] **Step 1: 在 `groups/mcp.ts` 为 server enabled 新增 path 与 payload schema**

在 `McpPaths` 中新增：

```ts
enabled: "/mcp/:name/enabled",
toolEnabled: "/mcp/:name/tools/:toolId",
```

并新增共享 payload schema：

```ts
export const EnabledPayload = Schema.Struct({
  enabled: Schema.Boolean,
})
```

- [ ] **Step 2: 在 `groups/mcp.ts` 注册两个 PATCH endpoint**

补进 `HttpApiGroup.make("mcp")` 的 `.add(...)` 列表：

```ts
HttpApiEndpoint.patch("enabled", McpPaths.enabled, {
  params: { name: Schema.String },
  query: WorkspaceRoutingQuery,
  payload: EnabledPayload,
  success: described(Schema.Boolean, "MCP server enabled state updated"),
}).annotateMerge(
  OpenApi.annotations({
    identifier: "mcp.enabled",
    summary: "Enable or disable MCP server",
    description: "Persist and apply the enabled state for one MCP server.",
  }),
),
HttpApiEndpoint.patch("toolEnabled", McpPaths.toolEnabled, {
  params: { name: Schema.String, toolId: Schema.String },
  query: WorkspaceRoutingQuery,
  payload: EnabledPayload,
  success: described(Schema.Boolean, "MCP tool enabled state updated"),
}).annotateMerge(
  OpenApi.annotations({
    identifier: "mcp.tool.enabled",
    summary: "Enable or disable MCP tool",
    description: "Persist and apply the enabled state for one MCP tool.",
  }),
),
```

- [ ] **Step 3: 在 `handlers/mcp.ts` 接线到 `MCP.Service`**

新增两个 handler：

```ts
const enabled = Effect.fn("McpHttpApi.enabled")(function* (ctx: {
  params: { name: string }
  payload: { enabled: boolean }
}) {
  yield* mcp.setEnabled(ctx.params.name, ctx.payload.enabled)
  return true
})

const toolEnabled = Effect.fn("McpHttpApi.toolEnabled")(function* (ctx: {
  params: { name: string; toolId: string }
  payload: { enabled: boolean }
}) {
  void ctx.params.name
  yield* mcp.setToolEnabled(ctx.params.toolId, ctx.payload.enabled)
  return true
})
```

然后在返回的 handlers 链中补：

```ts
.handle("enabled", enabled)
.handle("toolEnabled", toolEnabled)
```

如果你在实现时发现 `toolId` 需要和 `name` 做额外一致性校验，再作为最小补充加上；但不要在第一步过度扩展业务规则。

- [ ] **Step 4: 重跑 focused 后端测试，确认红灯转绿**

Run:

```powershell
bun test test/server/httpapi-mcp.test.ts --timeout 30000
```

Expected:

- MCP PATCH 路由测试通过
- 原有 `status/add/connect/disconnect/auth` 测试不回退

- [ ] **Step 5: （可选）暂存当前后端改动**

```bash
git add packages/opencode/src/server/routes/instance/httpapi/groups/mcp.ts packages/opencode/src/server/routes/instance/httpapi/handlers/mcp.ts packages/opencode/test/server/httpapi-mcp.test.ts
```

---

### Task 3: 补 `httpapi-exercise` 覆盖，锁死后续上游回归

**Files:**

- Modify: `packages/opencode/test/server/httpapi-exercise/index.ts`
- Reference: `packages/opencode/src/server/routes/instance/httpapi/groups/mcp.ts`

- [ ] **Step 1: 在 exerciser 中补 MCP server enabled 场景**

在 `packages/opencode/test/server/httpapi-exercise/index.ts` 里新增一个 scenario，风格参考现有 `app.skill.enabled`：

```ts
http.protected
  .patch("/mcp/{name}/enabled", "mcp.enabled")
  .at((ctx) => ({
    path: route("/mcp/{name}/enabled", { name: "demo" }),
    headers: ctx.headers(),
    body: { enabled: true },
  }))
  .json(200, (body) => {
    check(body === true, "mcp enabled route should return true")
  })
```

如果 scenario 需要 seed MCP config，就按 exerciser 当前约定补到对应 seed 段里。

- [ ] **Step 2: 在 exerciser 中补 MCP tool enabled 场景**

再新增：

```ts
http.protected
  .patch("/mcp/{name}/tools/{toolId}/enabled", "mcp.tool.enabled")
  .at((ctx) => ({
    path: route("/mcp/{name}/tools/{toolId}/enabled", { name: "demo", toolId: "demo_read" }),
    headers: ctx.headers(),
    body: { enabled: false },
  }))
  .json(200, (body) => {
    check(body === true, "mcp tool enabled route should return true")
  })
```

- [ ] **Step 3: 运行 exerciser，确认 coverage 不再漏这两个 PATCH**

Run:

```powershell
bun run script/httpapi-exercise.ts --mode coverage --fail-on-missing --fail-on-skip
```

Workdir:

```text
packages/opencode
```

Expected:

- 不再出现 MCP enabled / tool enabled 的 missing scenario

- [ ] **Step 4: （可选）暂存 exerciser 改动**

```bash
git add packages/opencode/test/server/httpapi-exercise/index.ts
```

---

### Task 4: 补前端调用链回归并做浏览器实测

**Files:**

- Modify: `packages/opencode/webgui/src/components/CompactHeader/useStatusPopoverData.test.tsx`
- Verify: browser at `http://localhost:5173/app`

- [ ] **Step 1: 在 `useStatusPopoverData.test.tsx` 补 `toggleMcp` 成功刷新回归**

现有文件已经有 `toggleMcp` 相关测试，可以在其基础上增强断言，锁住成功后 refresh 的链路：

```ts
it("toggleMcp 成功后会调用 setEnabled 并刷新 MCP 状态", async () => {
  const view = hook(true)

  await waitFor(() => {
    expect(view.result.current.mcp.state).toBe("ready")
  })

  mocks.mcpStatus.mockResolvedValueOnce(ok({ alpha: { status: "disabled" } }))

  await act(async () => {
    await view.result.current.toggleMcp("alpha")
  })

  expect(mocks.mcpSetEnabled).toHaveBeenCalledWith({
    path: { name: "alpha" },
    body: { enabled: false },
  })
  expect(mocks.mcpStatus).toHaveBeenCalledTimes(2)
  expect(view.result.current.mcp.data.alpha?.status).toBe("disabled")
})
```

如果现有同名测试已经覆盖其中一部分，就把断言补齐，而不是重复造一个几乎一样的测试。

- [ ] **Step 2: 在 `useStatusPopoverData.test.tsx` 补 `toggleTool` 成功刷新回归**

同样补一条或增强现有测试：

```ts
it("toggleTool 成功后会调用 setToolEnabled 并刷新 MCP 工具数据", async () => {
  const view = hook(true)

  await waitFor(() => {
    expect(view.result.current.mcp.state).toBe("ready")
  })

  mocks.mcpSetToolEnabled.mockResolvedValueOnce(ok({}))
  mocks.mcpStatus.mockResolvedValueOnce(ok({ alpha: { status: "connected" } }))
  mocks.mcpTools.mockResolvedValueOnce(
    ok({
      server: "alpha",
      connected: true,
      tools: [{ id: "alpha.read", name: "Read", enabled: false }],
    }),
  )

  await act(async () => {
    await view.result.current.toggleTool("alpha", "alpha.read", false)
  })

  expect(mocks.mcpSetToolEnabled).toHaveBeenCalledWith({
    path: { name: "alpha", toolId: "alpha.read" },
    body: { enabled: false },
  })
})
```

- [ ] **Step 3: 运行前端 hook 测试，确认调用链未断**

Run:

```powershell
bun run test:run src/components/CompactHeader/useStatusPopoverData.test.tsx
```

Workdir:

```text
packages/opencode/webgui
```

Expected:

- `toggleMcp` / `toggleTool` 相关测试通过

- [ ] **Step 4: 浏览器实测点击开关，不再返回 HTML fallback 页面**

在 `http://localhost:5173/app` 打开状态弹层，点击 MCP server 开关，检查网络：

Expected:

- `PATCH /mcp/:name/enabled` 返回 JSON（例如 `true`）
- 不再返回整页 HTML
- 随后 `GET /mcp` 正常刷新

如果再点 tool 开关：

- `PATCH /mcp/:name/tools/:toolId` 也返回 JSON

- [ ] **Step 5: （可选）整理最终暂存集，不实际提交**

```bash
git add packages/opencode/src/server/routes/instance/httpapi/groups/mcp.ts packages/opencode/src/server/routes/instance/httpapi/handlers/mcp.ts packages/opencode/test/server/httpapi-mcp.test.ts packages/opencode/test/server/httpapi-exercise/index.ts packages/opencode/webgui/src/components/CompactHeader/useStatusPopoverData.test.tsx docs/superpowers/specs/2026-05-20-mcp-toggle-httpapi-design.md docs/superpowers/plans/2026-05-20-mcp-toggle-httpapi.md
```

---

## 计划自检

- Spec coverage：
  - MCP server enabled PATCH → Task 1 / Task 2
  - MCP tool enabled PATCH → Task 1 / Task 2
  - 覆盖锁定 / `httpapi-exercise` → Task 3
  - 前端 toggle 调用链回归 → Task 4
  - 浏览器确认不再返回 HTML fallback → Task 4
- Placeholder scan：已去除 `TODO` / `TBD` / “类似某任务” 之类占位描述。
- Type consistency：统一使用 `enabled`、`toolEnabled`、`EnabledPayload`、`McpPaths.enabled`、`McpPaths.toolEnabled` 这些命名，不混用 `connect/disconnect` 作为替代语义。
