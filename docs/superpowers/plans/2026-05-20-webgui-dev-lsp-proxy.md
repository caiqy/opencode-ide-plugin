# WebGUI 开发环境 LSP 代理修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 `packages/opencode/webgui` 开发环境下 `/lsp`（并同步 `/formatter`）未被 Vite 代理的问题，并用自动化测试把代理白名单契约锁死。

**Architecture:** 只修改 WebGUI 的 dev proxy 配置与对应测试，不改前端业务请求代码，也不改状态弹层 UI 聚合逻辑。实现上继续使用现有 `proxyRoots -> proxyEntry -> server.proxy` 统一生成路径，通过测试同时锁住“路径存在”与“路径来自统一代理表”两层约束。

**Tech Stack:** TypeScript, Vite, Vitest, React, Node test environment

---

## 文件结构与职责

- `packages/opencode/webgui/vite.config.ts`
  - WebGUI 开发环境 Vite 配置；`proxyRoots` 是 dev proxy 白名单的唯一来源。
- `packages/opencode/webgui/vite.config.test.ts`
  - 针对 `vite.config.ts` 的 node 环境回归测试；适合锁定 dev proxy 路径是否进入统一代理表。
- `docs/superpowers/specs/2026-05-20-webgui-dev-lsp-proxy-design.md`
  - 本次修复设计说明。
- 浏览器实测目标页面：`http://localhost:5173/app`
  - 用于确认 `GET /lsp` 不再返回 `404`。

---

### Task 1: 先写失败测试锁定 dev proxy 契约

**Files:**

- Modify: `packages/opencode/webgui/vite.config.test.ts`
- Reference: `packages/opencode/webgui/vite.config.ts`

- [ ] **Step 1: 在 `vite.config.test.ts` 添加失败测试，锁定 `/lsp` 与 `/formatter` 必须存在于统一代理表**

在 `packages/opencode/webgui/vite.config.test.ts` 新增一个测试，先写出期望：

```ts
it("在 serve 模式下会统一代理 lsp、formatter、mcp、skill 路由到后端", async () => {
  process.argv = ["node", "vite"]

  vi.doMock("./dev/discoverBackend", () => ({
    BackendDiscoveryError: class BackendDiscoveryError extends Error {
      attempts = []
    },
    discoverBackend: vi.fn(async () => ({
      url: "http://127.0.0.1:4300",
      port: 4300,
      probe: "http://127.0.0.1:4300/global/config",
    })),
  }))

  const { default: config } = await import("./vite.config")
  const proxy = config.server?.proxy as Record<string, { target?: string }>

  expect(proxy["/mcp"]?.target).toBe("http://127.0.0.1:4300")
  expect(proxy["/skill"]?.target).toBe("http://127.0.0.1:4300")
  expect(proxy["/lsp"]?.target).toBe("http://127.0.0.1:4300")
  expect(proxy["/formatter"]?.target).toBe("http://127.0.0.1:4300")
})
```

这个测试同时完成两件事：

- 锁住 `/lsp`、`/formatter` 的存在性
- 用与 `/mcp`、`/skill` 相同的断言形式，锁住“统一代理表”语义，而不是临时分支单独拼接

- [ ] **Step 2: 运行测试确认当前先失败**

Run:

```powershell
bun test vite.config.test.ts
```

Workdir:

```text
packages/opencode/webgui
```

Expected:

- 新增测试失败
- 失败应表现为 `proxy["/lsp"]` 或 `proxy["/formatter"]` 为 `undefined`，从而证明当前代理白名单确有缺口

- [ ] **Step 3: 如有必要，再补一条更语义化断言，证明这些路径不是临时特判拼进去的**

如果你希望把语义再锁紧一层，可额外写一个测试，通过列举一组关键路径都存在来表达“统一代理表”约束：

```ts
it("关键状态接口都来自同一 proxyRoots 白名单", async () => {
  process.argv = ["node", "vite"]

  vi.doMock("./dev/discoverBackend", () => ({
    BackendDiscoveryError: class BackendDiscoveryError extends Error {
      attempts = []
    },
    discoverBackend: vi.fn(async () => ({
      url: "http://127.0.0.1:4300",
      port: 4300,
      probe: "http://127.0.0.1:4300/global/config",
    })),
  }))

  const { default: config } = await import("./vite.config")
  const proxy = config.server?.proxy as Record<string, unknown>

  expect(Object.keys(proxy)).toEqual(expect.arrayContaining(["/mcp", "/skill", "/lsp", "/formatter"]))
})
```

这条测试不直接读取内部常量，但能把“这些路径都属于统一生成出的代理表”表达清楚。

- [ ] **Step 4: 提交红灯测试前的本地检查点（可选）**

```bash
git add packages/opencode/webgui/vite.config.test.ts
git commit -m "test: lock webgui dev proxy roots"
```

如果你不想在红灯状态提交，这一步可以跳过。

---

### Task 2: 最小实现修复 dev proxy 白名单

**Files:**

- Modify: `packages/opencode/webgui/vite.config.ts`
- Test: `packages/opencode/webgui/vite.config.test.ts`

- [ ] **Step 1: 在 `proxyRoots` 中加入 `/lsp` 与 `/formatter`**

找到 `packages/opencode/webgui/vite.config.ts` 里的：

```ts
const proxyRoots = [
  "/generated-image",
  "/app/generated-image",
  "/global",
  "/session",
  "/config",
  "/project",
  "/provider",
  "/sync",
  "/mcp",
  "/permission",
  "/question",
  "/tui",
  "/command",
  "/agent",
  "/skill",
  "/path",
  "/event",
  "/pty",
  "/experimental",
  "/auth",
  "/vcs",
]
```

改成包含：

```ts
const proxyRoots = [
  "/generated-image",
  "/app/generated-image",
  "/global",
  "/session",
  "/config",
  "/project",
  "/provider",
  "/sync",
  "/mcp",
  "/permission",
  "/question",
  "/tui",
  "/command",
  "/agent",
  "/skill",
  "/path",
  "/lsp",
  "/formatter",
  "/event",
  "/pty",
  "/experimental",
  "/auth",
  "/vcs",
]
```

不要新增特殊分支，不要单独手工 merge 一个 `/lsp` 或 `/formatter` 代理对象，必须继续走：

```ts
Object.fromEntries(proxyRoots.map((root) => proxyEntry(root, backend.url, directoryOverride)))
```

这正是本次要锁死的统一代理表契约。

- [ ] **Step 2: 重新跑 `vite.config.test.ts`，确认红灯转绿**

Run:

```powershell
bun test vite.config.test.ts
```

Workdir:

```text
packages/opencode/webgui
```

Expected:

- 新增 `/lsp`、`/formatter` 代理断言通过
- 原有 `/generated-image` 与目录 override 行为测试继续通过

- [ ] **Step 3: 再做一轮最小静态验证，确保没有引入配置层语法/导入问题**

Run:

```powershell
bun run test:run -- vite.config.test.ts
```

Workdir:

```text
packages/opencode/webgui
```

Expected:

- `vite.config.test.ts` 在完整 Vitest 入口下也能通过

如果当前测试脚本不支持这样过滤，则保持 Step 2 即可，不额外扩大验证面。

- [ ] **Step 4: 提交 dev proxy 实现改动**

```bash
git add packages/opencode/webgui/vite.config.ts packages/opencode/webgui/vite.config.test.ts
git commit -m "fix(webgui): proxy lsp and formatter in dev"
```

如果你当前不希望提交，这一步改为仅暂存或跳过。

---

### Task 3: 浏览器实测确认 `/lsp` 不再 404

**Files:**

- No code changes expected
- Verify: `packages/opencode/webgui/vite.config.ts`
- Verify: `packages/opencode/webgui/vite.config.test.ts`

- [ ] **Step 1: 启动/保持当前 dev 环境，并在浏览器中重现状态弹层请求**

确认页面仍是：

```text
http://localhost:5173/app
```

打开状态弹层，触发 `Server` / `MCP` / `LSP` 相关请求。

- [ ] **Step 2: 在浏览器网络面确认 `/lsp` 已被代理并返回成功**

Expected:

- `GET /lsp` 不再是 `404`
- 如果 `/formatter` 被触发，也应返回成功而不是落到 Vite 本地 404

可接受证据示例：

- `/lsp` → `200`
- 返回 JSON 列表或空数组

- [ ] **Step 3: 记录浏览器实测结论**

需要在最终汇报中明确记录：

- 修复前 `/lsp` 是 `404`
- 修复后 `/lsp` 正常
- 本次没有修改 `StatusPopover` / `useStatusPopoverData` 的 UI 逻辑

- [ ] **Step 4: 提交浏览器验证后的最终状态（可选）**

```bash
git add packages/opencode/webgui/vite.config.ts packages/opencode/webgui/vite.config.test.ts docs/superpowers/specs/2026-05-20-webgui-dev-lsp-proxy-design.md docs/superpowers/plans/2026-05-20-webgui-dev-lsp-proxy.md
git commit -m "test: lock webgui dev proxy coverage"
```

如果当前不提交，则只整理验证结果。

---

## 计划自检

- Spec coverage：
  - `/lsp` dev 代理修复 → Task 2
  - `/formatter` 同步补齐 → Task 2
  - 自动化测试锁定 → Task 1 / Task 2
  - “与 `/mcp`、`/skill` 一样进入统一代理表”语义断言 → Task 1
  - 浏览器实测 `/lsp` 不再 404 → Task 3
- Placeholder scan：已去除 `TODO` / `TBD` / “后续再补” 之类占位。
- Type consistency：统一使用 `proxyRoots`、`proxyEntry(...)`、`/lsp`、`/formatter`、`/mcp`、`/skill` 这些现有命名，不引入新的特判 API。
