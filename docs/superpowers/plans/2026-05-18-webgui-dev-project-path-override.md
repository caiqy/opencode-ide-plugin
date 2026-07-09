# WebGUI 测试环境项目路径覆盖 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修正 WebGUI 本地测试环境默认项目路径为仓库根目录，并允许仅在 dev 测试链路中手动覆盖到其他项目路径。

**Architecture:** 保持最小改动：`.vscode/launch.json` 负责提供默认根目录与可选覆盖输入；`packages/opencode/webgui/vite.config.ts` 仅在 `vite serve` 时读取该覆盖值，并通过 dev proxy 为所有实例请求注入 `x-opencode-directory`。正式 `vite build` 不读取该变量，也不携带任何覆盖头。

**Tech Stack:** VSCode launch.json、Bun、Vite dev proxy、Vitest

**Spec:** `docs/superpowers/specs/2026-05-18-webgui-dev-project-path-override-design.md`

---

## 文件结构

- `.vscode/launch.json`
  - VSCode 本地调试入口
  - 本次负责：修正 backend 启动 cwd 语义、为 `WebGUI: dev` 提供可选目录覆盖输入

- `packages/opencode/webgui/vite.config.ts`
  - WebGUI dev server 配置
  - 本次负责：仅在 `serve` 模式读取 `OPENCODE_DEV_DIRECTORY_OVERRIDE` 并注入 `x-opencode-directory`

- `packages/opencode/webgui/vite.config.test.ts`
  - Vite 配置单测
  - 本次负责：覆盖“默认不注入 header”和“存在 override 时注入 header”两个行为

---

### Task 1: 修正 launch.json 默认路径并增加测试环境目录覆盖输入

**Files:**

- Modify: `.vscode/launch.json`

- [ ] **Step 1: 先写失败前的目标 launch 结构，明确默认根目录与可选输入**

```json
{
  "version": "0.2.0",
  "inputs": [
    {
      "id": "opencodeDevDirectoryOverride",
      "type": "promptString",
      "description": "WebGUI 测试环境项目路径覆盖（留空则使用当前工作区根目录）",
      "default": "${workspaceFolder}"
    }
  ],
  "configurations": [
    {
      "type": "node-terminal",
      "request": "launch",
      "name": "WebGUI: dev",
      "env": {
        "OPENCODE_DEV_DIRECTORY_OVERRIDE": "${input:opencodeDevDirectoryOverride}"
      },
      "command": "bun run --cwd packages/opencode/webgui dev"
    },
    {
      "type": "node-terminal",
      "request": "launch",
      "name": "Backend: source web 4300",
      "command": "bun run --conditions=browser packages/opencode/src/index.ts web --hostname 127.0.0.1 --port 4300 --print-logs"
    }
  ]
}
```

- [ ] **Step 2: 按 Step 1 修改 `.vscode/launch.json`**

```text
路径：D:\Caiqy\Projects\Github\opencode-ide-plugin\.vscode\launch.json
要求：
- 新增顶层 `inputs`
- `WebGUI: dev` 增加 `env.OPENCODE_DEV_DIRECTORY_OVERRIDE`
- `Backend: source web 4300` 去掉 `--cwd packages/opencode`
- 后端命令改为从仓库根目录直接运行 `packages/opencode/src/index.ts`
```

- [ ] **Step 3: 读取 launch.json，确认默认值和命令都正确**

Run: 读取 `.vscode/launch.json`

Expected:

- 存在 `inputs[0].id === "opencodeDevDirectoryOverride"`
- `inputs[0].default === "${workspaceFolder}"`
- `WebGUI: dev` 包含 `env.OPENCODE_DEV_DIRECTORY_OVERRIDE`
- `Backend: source web 4300` 命令为 `bun run --conditions=browser packages/opencode/src/index.ts web --hostname 127.0.0.1 --port 4300 --print-logs`

- [ ] **Step 4: 在 VSCode 中手工验证两个调试入口的交互**

```text
1. 启动 `Backend: source web 4300`
2. 确认终端执行的是：
   bun run --conditions=browser packages/opencode/src/index.ts web --hostname 127.0.0.1 --port 4300 --print-logs
3. 启动 `WebGUI: dev`
4. 第一次保持默认 `${workspaceFolder}`
5. 第二次改填一个其他绝对路径（例如 D:\demo\other-project）
6. 记录两次启动时的输入体验是否符合预期
```

Expected:

- 后端默认以仓库根目录为 `process.cwd()`
- WebGUI: dev 启动前会出现可编辑输入框
- 输入框默认值是 `${workspaceFolder}`
- 可手工覆盖成其他绝对路径

- [ ] **Step 5: Commit（仅在用户明确要求提交时执行，否则跳过）**

```bash
git add .vscode/launch.json
git commit -m "chore(vscode): support dev project path override"
```

---

### Task 2: 先写 Vite 配置失败测试，覆盖目录 override 注入行为

**Files:**

- Modify: `packages/opencode/webgui/vite.config.test.ts`
- Test: `packages/opencode/webgui/vite.config.test.ts`

- [ ] **Step 1: 新增“存在 override 时注入 x-opencode-directory”失败测试**

```ts
it("在 serve 模式下存在目录 override 时会为代理请求注入 x-opencode-directory", async () => {
  process.argv = ["node", "vite"]
  process.env.OPENCODE_DEV_DIRECTORY_OVERRIDE = "D:/demo/other-project"

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
  const proxy = config.server?.proxy as Record<
    string,
    { configure?: (proxy: { on: (event: string, cb: (...args: any[]) => void) => void }) => void }
  >
  const handlers = new Map<string, (...args: any[]) => void>()

  proxy["/event"]?.configure?.({
    on(event, cb) {
      handlers.set(event, cb)
    },
  })

  const setHeader = vi.fn()
  handlers.get("proxyReq")?.({ setHeader }, {}, {})

  expect(setHeader).toHaveBeenCalledWith("x-opencode-directory", "D:/demo/other-project")
})
```

- [ ] **Step 2: 新增“未设置 override 时不注入 header”失败测试**

```ts
it("在 serve 模式下未设置目录 override 时不会注入目录 header", async () => {
  process.argv = ["node", "vite"]
  delete process.env.OPENCODE_DEV_DIRECTORY_OVERRIDE

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
  const proxy = config.server?.proxy as Record<
    string,
    { configure?: (proxy: { on: (event: string, cb: (...args: any[]) => void) => void }) => void }
  >
  const handlers = new Map<string, (...args: any[]) => void>()

  proxy["/generated-image"]?.configure?.({
    on(event, cb) {
      handlers.set(event, cb)
    },
  })

  expect(handlers.has("proxyReq")).toBe(false)
})
```

- [ ] **Step 3: 运行测试，确认它先失败**

Run: `bun run test:run vite.config.test.ts`

Expected: FAIL，报错指向 `configure` 缺失或未调用 `setHeader("x-opencode-directory", ...)`。

- [ ] **Step 4: Commit（仅在用户明确要求提交时执行，否则跳过）**

```bash
git add packages/opencode/webgui/vite.config.test.ts
git commit -m "test(webgui): cover dev project path override"
```

---

### Task 3: 最小实现 Vite dev-only header 注入并让测试转绿

**Files:**

- Modify: `packages/opencode/webgui/vite.config.ts`
- Modify: `packages/opencode/webgui/vite.config.test.ts`
- Test: `packages/opencode/webgui/vite.config.test.ts`

- [ ] **Step 1: 在 `vite.config.ts` 中加入 override 读取与 proxy 配置辅助逻辑**

```ts
function devDirectoryOverride() {
  const value = process.env.OPENCODE_DEV_DIRECTORY_OVERRIDE?.trim()
  return value ? value : null
}

function proxyEntry(root: string, backendUrl: string, directoryOverride: string | null) {
  return [
    root,
    {
      target: backendUrl,
      changeOrigin: true,
      ws: root === "/event" || root === "/pty",
      configure(proxy: { on: (event: string, cb: (...args: any[]) => void) => void }) {
        if (!directoryOverride) return
        proxy.on("proxyReq", (proxyReq: { setHeader: (name: string, value: string) => void }) => {
          proxyReq.setHeader("x-opencode-directory", directoryOverride)
        })
      },
    },
  ] as const
}
```

- [ ] **Step 2: 在 `serve` 分支中使用 Step 1 的辅助逻辑生成 proxy**

```ts
const directoryOverride = devDirectoryOverride()

config = {
  ...shared,
  define: {
    ...shared.define,
    __OPENCODE_BACKEND_URL__: JSON.stringify(backend.url),
  },
  server: {
    proxy: Object.fromEntries(proxyRoots.map((root) => proxyEntry(root, backend.url, directoryOverride))),
  },
}
```

- [ ] **Step 3: 运行 Vite 配置测试，确认转绿**

Run: `bun run test:run vite.config.test.ts`

Expected:

- PASS：已有 generated-image 代理测试继续通过
- PASS：未设置 override 时不注入 header
- PASS：设置 override 时 `proxyReq.setHeader("x-opencode-directory", ...)` 被调用

- [ ] **Step 4: 运行一次 build，确认正式构建不受影响**

Run: `bun run build`

Expected: PASS，且不要求设置 `OPENCODE_DEV_DIRECTORY_OVERRIDE`。

- [ ] **Step 5: 手工验证状态面板路径切换**

```text
1. 启动 `Backend: source web 4300`
2. 启动 `WebGUI: dev`，保持默认 `${workspaceFolder}`
3. 打开状态面板，确认“路径”为 D:\Caiqy\Projects\Github\opencode-ide-plugin
4. 停掉 WebGUI: dev
5. 再次启动 `WebGUI: dev`，输入另一个项目绝对路径
6. 打开状态面板，确认“路径”切换到该目标目录
7. 在该目录下打开历史会话或继续测试，确认实例请求随之切换
```

Expected:

- 默认值时显示仓库根目录
- 覆盖值时显示目标项目目录
- `/event`、`/path`、会话请求均跟随 override

- [ ] **Step 6: Commit（仅在用户明确要求提交时执行，否则跳过）**

```bash
git add .vscode/launch.json packages/opencode/webgui/vite.config.ts packages/opencode/webgui/vite.config.test.ts
git commit -m "feat(webgui): allow dev project path override"
```

---

## 计划自检

- **Spec coverage:**
  - 默认仓库根目录 → Task 1 Step 1-4
  - 测试环境可手动覆盖项目路径 → Task 1 Step 1-4、Task 3 Step 5
  - 仅限 dev 测试链路 → Task 3 Step 1-4
  - 正式 build / 发版不受影响 → Task 3 Step 4
  - SSE 与实例请求跟随 override → Task 2 Step 1、Task 3 Step 1-5
- **Placeholder scan:** 无 `TODO` / `TBD` / “后续补充” 占位语句。
- **Type consistency:** 全程统一使用 `OPENCODE_DEV_DIRECTORY_OVERRIDE`、`x-opencode-directory`、`Backend: source web 4300`、`WebGUI: dev`。
