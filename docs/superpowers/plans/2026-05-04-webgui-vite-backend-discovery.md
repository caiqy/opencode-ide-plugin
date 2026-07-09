# WebGUI Vite 本地后端自动发现 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `packages/opencode/webgui` 在 Vite dev 模式下自动发现当前 localhost 上已运行的 opencode backend，并通过 Vite proxy 让浏览器页面获得 HMR 的同时继续连到真实后端；若未发现 backend，则 Vite 启动直接失败。

**Architecture:** 先新增一个纯 Node 侧的 `discoverBackend` helper，用可注入 `fetch` 的方式扫描 `127.0.0.1:4096-4100` 并通过 `/global/config` 结构校验识别 opencode backend；再把它接入 `vite.config.ts` 的 dev 配置，显式代理当前 WebGUI 已经使用的根路径前缀。`sdkClient.ts` 与 `events.ts` 现有根路径写法保持不变，本次只通过手工验证确认 `/app` 页面下 API / SSE 仍然命中站点根路径。

**Tech Stack:** TypeScript 5.9、Vite 7、Vitest 4、React 19、Node fetch、Vite dev proxy

**Spec:** `docs/superpowers/specs/2026-05-04-webgui-vite-backend-discovery-design.md`

---

## 文件结构

- `packages/opencode/webgui/dev/discoverBackend.ts`
  - 新增的 Node 侧纯 helper
  - 负责扫描固定候选端口、请求 `/global/config`、返回命中的 backend URL 或结构化失败信息

- `packages/opencode/webgui/dev/discoverBackend.test.ts`
  - 新增 helper 单测
  - 锁定：候选端口顺序、首个命中即停止、非目标 JSON 不误判、全部失败抛出错误

- `packages/opencode/webgui/vite.config.ts`
  - 接入 `discoverBackend`
  - 只在 `command === "serve"` 时配置 dev proxy 和启动失败语义
  - 保持 build 配置与 `/app` base 不变

- `packages/opencode/webgui/tsconfig.node.json`
  - 让新增 `dev/*.ts` 被 Node 侧类型检查覆盖

- `packages/opencode/webgui/src/lib/api/sdkClient.ts`
  - 现有前端 API 封装
  - 本次不计划修改；只在手工验证中确认其现有根路径写法可被 Vite proxy 正确代理

- `packages/opencode/webgui/src/lib/api/events.ts`
  - 现有 SSE 事件流封装
  - 本次不计划修改；只在手工验证中确认其现有 `/event` 连接可被 Vite proxy 正确代理

---

### Task 1: 先写 backend discovery 纯逻辑测试并实现最小 helper

**Files:**

- Create: `packages/opencode/webgui/dev/discoverBackend.ts`
- Create: `packages/opencode/webgui/dev/discoverBackend.test.ts`
- Modify: `packages/opencode/webgui/tsconfig.node.json`

- [ ] **Step 1: 先写失败测试，锁定 discovery 的 4 个核心行为**

```ts
// packages/opencode/webgui/dev/discoverBackend.test.ts
import { describe, expect, it, vi } from "vitest"

type MockResponse = {
  ok: boolean
  status: number
  headers?: Record<string, string>
  json?: () => Promise<unknown>
}

function jsonResponse(data: unknown): MockResponse {
  return {
    ok: true,
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
    json: async () => data,
  }
}

describe("discoverBackend", () => {
  it("按 4096-4100 顺序探测，命中后立即停止", async () => {
    const calls: string[] = []
    const fetcher = vi.fn(async (input: string) => {
      calls.push(input)
      if (input === "http://127.0.0.1:4098/global/config") {
        return jsonResponse({ theme: "dark", command: {} })
      }
      throw new Error("ECONNREFUSED")
    })

    const { discoverBackend } = await import("./discoverBackend")
    const found = await discoverBackend({ fetch: fetcher })

    expect(found).toEqual({
      url: "http://127.0.0.1:4098",
      port: 4098,
      probe: "http://127.0.0.1:4098/global/config",
    })
    expect(calls).toEqual([
      "http://127.0.0.1:4096/global/config",
      "http://127.0.0.1:4097/global/config",
      "http://127.0.0.1:4098/global/config",
    ])
  })

  it("非 JSON 响应不应被识别为 opencode backend", async () => {
    const fetcher = vi.fn(async (_input: string) => ({
      ok: true,
      status: 200,
      headers: { "content-type": "text/html" },
      json: async () => ({}),
    }))

    const { discoverBackend } = await import("./discoverBackend")

    await expect(discoverBackend({ fetch: fetcher, ports: [4096] })).rejects.toThrow(
      "No running opencode backend found on localhost",
    )
  })

  it("JSON 存在但缺少关键配置字段时不应误判成功", async () => {
    const fetcher = vi.fn(async (_input: string) => jsonResponse({ ok: true }))

    const { discoverBackend } = await import("./discoverBackend")

    await expect(discoverBackend({ fetch: fetcher, ports: [4096] })).rejects.toThrow(
      "No running opencode backend found on localhost",
    )
  })

  it("全部端口失败时应抛出带尝试明细的错误", async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input === "http://127.0.0.1:4096/global/config") throw new Error("ECONNREFUSED")
      return jsonResponse({ ok: true })
    })

    const { discoverBackend, BackendDiscoveryError } = await import("./discoverBackend")

    await expect(discoverBackend({ fetch: fetcher, ports: [4096, 4097] })).rejects.toBeInstanceOf(BackendDiscoveryError)
  })
})
```

- [ ] **Step 2: 运行新测试，确认它先失败**

Run: `bun run --cwd packages/opencode/webgui test:run dev/discoverBackend.test.ts`

Expected: FAIL，报错类似 `Failed to resolve import "./discoverBackend"`，因为 helper 文件还不存在。

- [ ] **Step 3: 扩展 Node 侧 tsconfig，让 `dev/*.ts` 进入类型检查范围**

```json
// packages/opencode/webgui/tsconfig.node.json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.node.tsbuildinfo",
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "types": ["node"],
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true
  },
  "include": ["vite.config.ts", "dev/**/*.ts"]
}
```

- [ ] **Step 4: 写最小 discovery helper，实现端口扫描、JSON 校验与结构化错误**

```ts
// packages/opencode/webgui/dev/discoverBackend.ts
const defaultPorts = [4096, 4097, 4098, 4099, 4100]

type FetchLike = (input: string) => Promise<{
  ok: boolean
  status: number
  headers?: { get?: (name: string) => string | null } | Record<string, string>
  json?: () => Promise<unknown>
}>

type Attempt = {
  port: number
  url: string
  reason: "connect_failed" | "http_error" | "non_json" | "invalid_shape" | "invalid_json"
  detail: string
}

type BackendTarget = {
  url: string
  port: number
  probe: string
}

function headerValue(
  headers: { get?: (name: string) => string | null } | Record<string, string> | undefined,
  name: string,
) {
  if (!headers) return ""
  if (typeof headers.get === "function") return headers.get(name) ?? ""
  const found = headers[name] ?? headers[name.toLowerCase()]
  return typeof found === "string" ? found : ""
}

function isConfigShape(value: unknown) {
  if (!value || typeof value !== "object") return false
  const obj = value as Record<string, unknown>
  return "$schema" in obj || "theme" in obj || "command" in obj || "model" in obj || "provider" in obj
}

export class BackendDiscoveryError extends Error {
  attempts: Attempt[]

  constructor(attempts: Attempt[]) {
    super("No running opencode backend found on localhost")
    this.name = "BackendDiscoveryError"
    this.attempts = attempts
  }
}

export async function discoverBackend(options?: { fetch?: FetchLike; ports?: number[] }): Promise<BackendTarget> {
  const fetcher = options?.fetch ?? ((input: string) => fetch(input))
  const ports = options?.ports ?? defaultPorts
  const attempts: Attempt[] = []

  for (const port of ports) {
    const url = `http://127.0.0.1:${port}`
    const probe = `${url}/global/config`

    try {
      const response = await fetcher(probe)
      if (!response.ok) {
        attempts.push({ port, url: probe, reason: "http_error", detail: String(response.status) })
        continue
      }

      const contentType = headerValue(response.headers, "content-type")
      if (!contentType.toLowerCase().includes("application/json")) {
        attempts.push({ port, url: probe, reason: "non_json", detail: contentType || "missing content-type" })
        continue
      }

      let data: unknown
      try {
        data = await response.json?.()
      } catch (error) {
        attempts.push({
          port,
          url: probe,
          reason: "invalid_json",
          detail: error instanceof Error ? error.message : String(error),
        })
        continue
      }

      if (!isConfigShape(data)) {
        attempts.push({ port, url: probe, reason: "invalid_shape", detail: "missing config keys" })
        continue
      }

      return { url, port, probe }
    } catch (error) {
      attempts.push({
        port,
        url: probe,
        reason: "connect_failed",
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  }

  throw new BackendDiscoveryError(attempts)
}
```

- [ ] **Step 5: 重新运行 helper 测试，确认通过**

Run: `bun run --cwd packages/opencode/webgui test:run dev/discoverBackend.test.ts`

Expected: PASS，4 个测试全部通过；发现逻辑只命中第一个有效端口，失败时抛 `BackendDiscoveryError`。

- [ ] **Step 6: 运行受影响 Node 侧构建，确认 helper 与 tsconfig 可通过**

Run: `bun run --cwd packages/opencode/webgui build:dev`

Expected: PASS，`tsc -b` 与 `vite build --mode development` 都成功；若这一步因为 proxy 尚未接线而无行为差异，属于正常。

- [ ] **Step 7: Commit（仅在用户已明确要求提交时执行，否则跳过）**

```bash
git add packages/opencode/webgui/dev/discoverBackend.ts packages/opencode/webgui/dev/discoverBackend.test.ts packages/opencode/webgui/tsconfig.node.json
git commit -m "test(webgui): lock vite backend discovery rules"
```

---

### Task 2: 把 discovery 接入 Vite dev，并显式代理当前 WebGUI 会访问的根路径前缀

**Files:**

- Modify: `packages/opencode/webgui/vite.config.ts`

- [ ] **Step 1: 先写出新的 Vite 配置骨架，保留 build 配置并显式区分 serve/build**

```ts
// packages/opencode/webgui/vite.config.ts
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { readFileSync } from "fs"
import { resolve } from "path"
import { BackendDiscoveryError, discoverBackend } from "./dev/discoverBackend"

const pkg = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf-8"))

const proxyRoots = [
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

function formatDiscoveryError(error: BackendDiscoveryError) {
  return [
    "[webgui] No running opencode backend found on localhost.",
    ...error.attempts.map((item) => `- ${item.url}: ${item.reason} (${item.detail})`),
    "[webgui] Start opencode backend first, then retry Vite dev.",
  ].join("\n")
}

export default defineConfig(async ({ command, mode }) => {
  const shared = {
    plugins: [react()],
    base: "/app",
    build: {
      outDir: "../webgui-dist",
      emptyOutDir: true,
      minify: mode === "development" ? false : "esbuild",
      sourcemap: mode === "development",
    },
    resolve: {
      dedupe: ["react", "react-dom", "react/jsx-runtime"],
    },
    define: {
      "process.env.NODE_ENV": JSON.stringify(mode === "development" ? "development" : "production"),
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
  }

  if (command !== "serve") {
    return shared
  }

  try {
    const backend = await discoverBackend()
    console.log(`[webgui] Using opencode backend ${backend.url}`)

    return {
      ...shared,
      server: {
        proxy: Object.fromEntries(
          proxyRoots.map((root) => [
            root,
            {
              target: backend.url,
              changeOrigin: true,
              ws: root === "/event" || root === "/pty",
            },
          ]),
        ),
      },
    }
  } catch (error) {
    if (error instanceof BackendDiscoveryError) {
      throw new Error(formatDiscoveryError(error))
    }
    throw error
  }
})
```

- [ ] **Step 2: 手工把上述骨架落到 `vite.config.ts`，替换当前同步配置导出**

```ts
// 本步不新增新逻辑，严格按 Step 1 的代码替换 packages/opencode/webgui/vite.config.ts
// 关键点：
// 1. defineConfig 改成 async factory
// 2. build 配置保持原样
// 3. serve 才调用 discoverBackend
// 4. proxyRoots 明确列出当前 WebGUI 会访问的根路径前缀
```

- [ ] **Step 3: 运行 WebGUI 构建，确认异步 Vite 配置与 Node helper 不破坏 build**

Run: `bun run --cwd packages/opencode/webgui build:dev`

Expected: PASS，输出包含 `vite build --mode development` 成功信息；构建阶段不会尝试 discovery，因为 `command !== "serve"`。

- [ ] **Step 4: 在未启动 backend 的情况下运行 dev，确认直接失败并输出诊断**

Run: `bun run --cwd packages/opencode/webgui dev`

Expected: FAIL，终端输出类似：

```text
[webgui] No running opencode backend found on localhost.
- http://127.0.0.1:4096/global/config: connect_failed (...)
...
[webgui] Start opencode backend first, then retry Vite dev.
```

- [ ] **Step 5: 在已启动 backend 的情况下运行 dev，确认能打印命中地址并启动成功**

Run:

```bash
bun run --cwd packages/opencode --conditions=browser src/index.ts web --hostname 127.0.0.1 --port 4096 --print-logs
bun run --cwd packages/opencode/webgui dev
```

Expected: 第二条命令 PASS，终端输出类似 `[webgui] Using opencode backend http://127.0.0.1:4096`，并给出 Vite 本地访问地址。

- [ ] **Step 6: Commit（仅在用户已明确要求提交时执行，否则跳过）**

```bash
git add packages/opencode/webgui/vite.config.ts
git commit -m "feat(webgui): proxy vite dev to discovered backend"
```

---

### Task 3: 做最终浏览器联调验证并整理交付说明

**Files:**

- Verify only

- [ ] **Step 1: 启动 backend 与 Vite dev，确认浏览器能通过 `/app` 正常连通**

Run（分别在两个终端中执行）：

```bash
bun run --cwd packages/opencode --conditions=browser src/index.ts web --hostname 127.0.0.1 --port 4096 --print-logs
bun run --cwd packages/opencode/webgui dev
```

Expected: 第二个终端 PASS，输出类似 `[webgui] Using opencode backend http://127.0.0.1:4096`，并给出 Vite 本地访问地址。

- [ ] **Step 2: 在浏览器打开 `/app`，确认页面不是空白壳体且基础数据可加载**

```text
1. 打开 `http://127.0.0.1:5173/app`（若 Vite 输出端口不同，以实际为准）
2. 确认页面能渲染基础壳体、会话列表或至少不是空白页
3. 若后端已有真实会话数据，确认页面能看到对应内容
```

- [ ] **Step 3: 打开浏览器 Network，确认 API 与 SSE 都通过根路径被代理成功**

- Manual checks:

```text
- `global/config` 请求返回 200
- `path` 请求返回 200
- `event` SSE 连接成功
- 若进行会话操作，`session/*` 请求能成功返回
- Network 中不出现 `/app/global/config`、`/app/path`、`/app/event` 这类错误路径
```

- [ ] **Step 4: 修改一个简单组件，确认 HMR 立即生效**

```text
1. 修改一个可见组件，例如 `packages/opencode/webgui/src/components/CompactHeader/index.tsx` 中一小段文本或 class
2. 保存文件
3. 观察浏览器是否自动刷新或热替换后立即显示变化
```

- [ ] **Step 5: 跑最终测试集合，确认 discovery 与 build 都稳定**

Run:

```bash
bun run --cwd packages/opencode/webgui test:run dev/discoverBackend.test.ts
bun run --cwd packages/opencode/webgui build:dev
```

- [ ] **Step 6: 记录最终本地使用方式，便于后续重复联调**

```text
1. 先启动后端：
   bun run --cwd packages/opencode --conditions=browser src/index.ts web --hostname 127.0.0.1 --port 4096 --print-logs

2. 再启动前端：
   bun run --cwd packages/opencode/webgui dev

3. 浏览器打开：
   http://127.0.0.1:5173/app

4. 若 Vite 报 “No running opencode backend found on localhost”，先确认 4096-4100 中已有本地 opencode backend。
```

- [ ] **Step 7: 完成后回传验证结论**

```text
- discovery helper 已锁定 4096-4100 扫描与 JSON 结构识别
- Vite dev 会在启动期发现 backend 并配置 proxy
- `/app` 页面下 API 与 SSE 均通过站点根路径代理成功
- 找不到 backend 时 dev 直接失败
- 浏览器 HMR 可用
```

- [ ] **Step 8: Commit（仅在用户已明确要求提交时执行，否则跳过）**

```bash
git commit -m "feat(webgui): auto-discover backend for vite dev"
```

---

## 计划自检

- **Spec coverage:**
  - localhost 自动发现与固定端口顺序 → Task 1
  - Vite Node 侧 discovery + proxy → Task 2
  - `/app` 页面下根路径 API / SSE 保持正确 → Task 3（手工 Network 验证）
  - 找不到 backend 时直接失败 → Task 2 / Task 3
  - 浏览器 HMR 联调验证 → Task 3
- **Placeholder scan:** 已去除 TBD/TODO/“稍后实现”等占位表述；每个测试与命令都有明确路径。
- **Type consistency:** 统一使用 `discoverBackend`、`BackendDiscoveryError` 命名；后续任务保持一致。
