# Local `/app` Embedded WebGUI Serving Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 VSCode 插件内的 `/app` 页面改为本地托管（embedded WebGUI），不再依赖 `https://app.opencode.ai` 页面代理。

**Architecture:** 在 `packages/opencode` 服务端新增 WebGUI 静态路由，直接从 `src/webgui/embed.generated.ts` 返回 `index.html` 与 `assets/*`。`/app` 与 `/app/*` 命中本地资源；非 `/app` 路径维持现有上游代理兜底。这样可与已迁移的 `sdkClient`（核心 API + 本地 state/retry 兼容）形成闭环。

**Tech Stack:** TypeScript, Hono, Bun, embedded assets (`embed.generated.ts`), bun:test.

---

### Task 1: 建立回归保护测试（TDD 红灯）

**Files:**

- Create: `packages/opencode/test/server/webgui-app-route.test.ts`

**Step 1: 写失败测试（锁定 `/app` 不应走上游代理）**

- 用 `Server.App().request("/app")` 与 `Server.App().request("/app/assets/*.js")` 发请求。
- 通过 mock `globalThis.fetch` 返回特征字符串（如 `UPSTREAM_MARKER`）。
- 断言响应不等于该 marker，且内容等于 `embeddedWebGui` 对应文件解码后的内容。

**Step 2: 运行测试确认失败**

Run: `bun run --cwd packages/opencode test test/server/webgui-app-route.test.ts`

Expected: FAIL（当前会命中 `.all("/*")` 上游代理，返回 marker）。

---

### Task 2: 实现 `/app` 本地托管路由（最小实现）

**Files:**

- Create: `packages/opencode/src/webgui/server/app.ts`
- Modify: `packages/opencode/src/server/server.ts`

**Step 1: 新增 WebGUI 资源路由**

- 从 `embeddedWebGui` 读取资源，按请求路径解析：
  - `/app` -> `index.html`
  - `/app/assets/*`、`/app/vite.svg` -> 对应静态资源
  - 客户端路由（无后缀）fallback 到 `index.html`
  - `/app/api/*` 直接 404（避免旧兼容接口悄悄回流）

**Step 2: 挂载路由优先于上游代理**

- 在 `Server.App()` 中添加：
  - `.get("/app", ...)`
  - `.get("/app/*", ...)`
    放在 `.all("/*")` 之前，确保 `/app` 不再落到上游代理。

**Step 3: 再跑测试确认通过**

Run: `bun run --cwd packages/opencode test test/server/webgui-app-route.test.ts`

Expected: PASS。

---

### Task 3: 验证与收尾

**Files:**

- Verify only

**Step 1: 跑关键回归测试**

Run:

```bash
bun run --cwd packages/opencode test test/server/webgui-app-route.test.ts
bun run --cwd packages/opencode test test/session/retry.test.ts
```

Expected: PASS。

**Step 2: 跑受影响包类型检查**

Run: `./node_modules/.bin/tsc -p packages/opencode/tsconfig.json --noEmit`

Expected: PASS。

**Step 3: 生成物检查**

- 若本次修改触及 `packages/opencode/src/server/server.ts`，按仓库约定执行：
  `bun run ./script/generate.ts`

**Step 4: 手工冒烟（你本地）**

- 重新打包并安装插件后：
  - 打开插件 UI，确认页面是本地 WebGUI（而非上游网页）。
  - Settings / OAuth / Session Retry 可用。
