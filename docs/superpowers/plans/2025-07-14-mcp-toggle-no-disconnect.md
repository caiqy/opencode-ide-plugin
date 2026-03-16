# MCP Toggle Without Disconnect Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 webgui 中切换 MCP server 开关和 MCP 子工具开关时，opencode 后端的 SSE 连接不会断开，同时 server 级开关具备持久化能力。

**Architecture:** 新增两条专用路由（`PATCH /mcp/:name/enabled` 和 `PATCH /mcp/:name/tools/:toolId`），后端只写 config 文件中对应字段，不调用 `Instance.dispose()`；通过在 `Config` namespace 引入一个内存覆盖层（overlay）来保证 `Config.get()` 返回的 `tools` 字段在不重启 instance 的情况下立即反映最新状态；前端切换逻辑改为调用新路由。

**Tech Stack:** Bun / TypeScript, Hono (后端路由), SolidJS (前端), jsonc-parser (配置文件写入), Zod

---

## 文件结构

### 后端（`packages/opencode/src/`）

| 文件                   | 操作     | 职责                                                                                                |
| ---------------------- | -------- | --------------------------------------------------------------------------------------------------- |
| `mcp/index.ts`         | **修改** | 新增 `setEnabled()` 和 `setToolEnabled()` 两个导出函数（不含 overlay，overlay 在 config.ts 中）     |
| `config/config.ts`     | **修改** | 新增 `patchProjectField()` 工具函数（只写文件，不 dispose）；新增 `toolsOverlay` Map 及相关读写方法 |
| `server/routes/mcp.ts` | **修改** | 新增两条路由 `PATCH /:name/enabled` 和 `PATCH /:name/tools/:toolId`                                 |

### 前端（`packages/app/src/`）

| 文件                               | 操作     | 职责                                                            |
| ---------------------------------- | -------- | --------------------------------------------------------------- |
| `components/dialog-select-mcp.tsx` | **修改** | `toggle()` 改调 `sdk.client.mcp.setEnabled()`                   |
| `components/status-popover.tsx`    | **修改** | `useMcpToggle` 的 `toggle()` 改调 `sdk.client.mcp.setEnabled()` |

### SDK 类型（`packages/sdk/` 或自动生成）

> SDK 客户端通过 OpenAPI spec 自动生成，路由新增后需重新生成或手动扩展类型。本计划以手动调用 `fetch` 为备选，优先走 SDK regeneration。

---

## Chunk 1: 后端核心逻辑

### Task 1: 在 `config/config.ts` 中新增 `patchProjectField()` 和 tools overlay

**目标：** 提供一个只写 config 文件、不触发 `Instance.dispose()` 的工具函数，以及一个内存覆盖层供 `Config.get()` 使用。

**Files:**

- Modify: `packages/opencode/src/config/config.ts`

**背景知识：**

- `patchJsonc()` 已存在于文件内部（`function patchJsonc(...)`），但是私有的，需要复用它
- `Config.state` 是 `Instance.state(async () => {...})` 创建的，其缓存由 `State.dispose(key)` 清除，**无法单独失效**
- 绕开方案：在 `Config` namespace 内维护一个内存 overlay Map，`Config.get()` 返回时将 overlay 中的 `tools` 字段 merge 进去；写文件后也更新 overlay

- [ ] **Step 1: 在 `config/config.ts` 的 `Config` namespace 内添加 `toolsOverlay` 和相关方法**

  在文件中找到 `export async function get()` 前，添加以下代码（放在 `global = lazy(...)` 声明之后）：

  ```typescript
  // In-memory overlay for tool/server enabled states.
  // Allows toggling without triggering Instance.dispose().
  // Key: project directory, Value: record of { toolId -> boolean }
  const toolsOverlayByDir = new Map<string, Record<string, boolean>>()

  export function getToolsOverlay(directory: string): Record<string, boolean> {
    return toolsOverlayByDir.get(directory) ?? {}
  }

  export function setToolsOverlay(directory: string, toolId: string, enabled: boolean) {
    const existing = toolsOverlayByDir.get(directory) ?? {}
    toolsOverlayByDir.set(directory, { ...existing, [toolId]: enabled })
  }

  export function clearToolsOverlay(directory: string) {
    toolsOverlayByDir.delete(directory)
  }
  ```

- [ ] **Step 2: 修改 `Config.get()` 使其合并 overlay**

  找到：

  ```typescript
  export async function get() {
    return state().then((x) => x.config)
  }
  ```

  替换为：

  ```typescript
  export async function get() {
    const cfg = await state().then((x) => x.config)
    const overlay = getToolsOverlay(Instance.directory)
    if (Object.keys(overlay).length === 0) return cfg
    return {
      ...cfg,
      tools: { ...(cfg.tools ?? {}), ...overlay },
    }
  }
  ```

- [ ] **Step 3: 新增 `patchProjectField()` 工具函数**

  在 `Config.update()` 函数之后添加：

  ```typescript
  /**
   * Patch a single field in the project config file without triggering Instance.dispose().
   * Uses jsonc-parser's modify/applyEdits to preserve formatting and comments.
   */
  export async function patchProjectField(fieldPath: string[], value: unknown): Promise<void> {
    const files = ["opencode.json", "opencode.jsonc"].map((file) => path.join(Instance.directory, file))
    const filepath = files.find((file) => existsSync(file)) ?? files[0]
    const before = await Filesystem.readText(filepath).catch((err: any) => {
      if (err.code === "ENOENT") return "{}"
      throw err
    })
    const updated = patchJsonc(before, value, fieldPath)
    await Filesystem.write(filepath, updated)
  }
  ```

  > 注意：`patchJsonc` 在同一文件内已定义为私有函数，此处可直接引用。

- [ ] **Step 4: 验证 TypeScript 编译通过**

  ```bash
  # packages/opencode 目录下
  bun run typecheck
  ```

  预期结果：无编译错误。如有错误，检查 `Instance.directory` 在 overlay 函数中是否可访问（`getToolsOverlay`/`clearToolsOverlay` 是 namespace 级函数，调用方需在 Instance context 中）。

- [ ] **Step 5: Commit**

  ```bash
  git add packages/opencode/src/config/config.ts
  git commit -m "feat(config): add tools overlay and patchProjectField for non-disruptive config patching"
  ```

---

### Task 2: 在 `mcp/index.ts` 中新增 `setEnabled()` 和 `setToolEnabled()`

**目标：** 封装 server 级持久化开关和工具级持久化开关逻辑。

**Files:**

- Modify: `packages/opencode/src/mcp/index.ts`

**背景知识：**

- 现有 `connect(name)` / `disconnect(name)` 只操作内存，不写文件——我们复用它们做连接层面的操作
- `Config.patchProjectField(["mcp", name, "enabled"], true/false)` 写 config 文件
- `Config.setToolsOverlay(Instance.directory, toolId, enabled)` 更新内存 overlay
- `Config.patchProjectField(["tools", toolId], true/false)` 持久化工具开关到文件

- [ ] **Step 1: 新增 `setEnabled()` — server 级持久化开关**

  在 `disconnect()` 函数之后，`tools()` 函数之前添加：

  ```typescript
  /**
   * Toggle an MCP server on/off with persistence.
   * Validates the server exists in config, then writes the `enabled` field
   * to the project config file without triggering Instance.dispose().
   * Then connects or disconnects the client in memory.
   */
  export async function setEnabled(name: string, enabled: boolean): Promise<void> {
    // Guard: ensure server is defined in config before writing
    const cfg = await Config.get()
    const mcpConfig = cfg.mcp?.[name]
    if (!mcpConfig || !isMcpConfigured(mcpConfig)) {
      log.error("setEnabled: MCP server not found in config", { name })
      return
    }

    // 1. Persist to config file (no Instance.dispose())
    await Config.patchProjectField(["mcp", name, "enabled"], enabled)

    // 2. Update in-memory connection state
    if (enabled) {
      await connect(name)
    } else {
      await disconnect(name)
    }
  }
  ```

- [ ] **Step 2: 新增 `setToolEnabled()` — 子工具持久化开关**

  紧接其后添加：

  ```typescript
  /**
   * Toggle a single MCP tool on/off with persistence.
   * Uses an in-memory overlay so Config.get() immediately reflects the change,
   * and also writes through to the project config file for persistence.
   * Does NOT trigger Instance.dispose().
   */
  export async function setToolEnabled(toolId: string, enabled: boolean): Promise<void> {
    // 1. Update in-memory overlay so Config.get() returns correct value immediately
    Config.setToolsOverlay(Instance.directory, toolId, enabled)

    // 2. Persist to config file (no Instance.dispose())
    await Config.patchProjectField(["tools", toolId], enabled)
  }
  ```

- [ ] **Step 3: 验证 TypeScript 编译通过**

  ```bash
  # packages/opencode 目录下
  bun run typecheck
  ```

  预期结果：无编译错误。

- [ ] **Step 4: Commit**

  ```bash
  git add packages/opencode/src/mcp/index.ts
  git commit -m "feat(mcp): add setEnabled and setToolEnabled for persistent toggle without reconnect"
  ```

---

### Task 3: 在 `server/routes/mcp.ts` 中新增两条路由

**目标：** 将新函数暴露为 HTTP 接口。

**Files:**

- Modify: `packages/opencode/src/server/routes/mcp.ts`

**背景知识：**

- 文件使用 Hono + `hono-openapi` 的 `describeRoute` + `validator` 模式
- 现有路由 `POST /:name/connect` 和 `POST /:name/disconnect` 可作为参考模板
- 新路由使用 `PATCH` 方法，语义更准确（部分更新资源状态）

- [ ] **Step 1: 新增 `PATCH /:name/enabled` 路由**

  在 `POST /:name/disconnect` 路由之后添加：

  ```typescript
  .patch(
    "/:name/enabled",
    describeRoute({
      description: "Set MCP server enabled state with persistence",
      operationId: "mcp.setEnabled",
      responses: {
        200: {
          description: "MCP server enabled state updated",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
        ...errors(404),
      },
    }),
    validator("param", z.object({ name: z.string() })),
    validator("json", z.object({ enabled: z.boolean() })),
    async (c) => {
      const { name } = c.req.valid("param")
      const { enabled } = c.req.valid("json")
      // Guard: verify server exists in config before acting
      const mcpStatus = await MCP.status()
      if (!(name in mcpStatus)) {
        return c.json({ error: `MCP server not found: ${name}` }, 404)
      }
      await MCP.setEnabled(name, enabled)
      return c.json(true)
    },
  )
  ```

- [ ] **Step 2: 新增 `PATCH /:name/tools/:toolId` 路由**

  注意：`toolId` 是形如 `serverName_toolName` 的完整 ID（由 `canon()` 生成）。路由中保留 `:name` 用于语义清晰（表示该工具属于哪个 server），但验证时通过 `toolId` 前缀确认其归属。

  > **已确认：** `MCP.toolsByServer(name)` 函数已存在于 `packages/opencode/src/mcp/index.ts`（line ~655），返回 `{ connected: boolean, tools: Array<{ id: string; name: string }> }`，可直接使用，无需新增。

  紧接其后添加：

  ```typescript
  .patch(
    "/:name/tools/:toolId",
    describeRoute({
      description: "Set a single MCP tool enabled state with persistence",
      operationId: "mcp.setToolEnabled",
      responses: {
        200: {
          description: "MCP tool enabled state updated",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
        ...errors(404),
      },
    }),
    validator("param", z.object({ name: z.string(), toolId: z.string() })),
    validator("json", z.object({ enabled: z.boolean() })),
    async (c) => {
      const { name, toolId } = c.req.valid("param")
      const { enabled } = c.req.valid("json")
      // Guard: verify the toolId belongs to the named server
      // tool IDs are formatted as `serverName_toolName` by canon()
      const serverTools = await MCP.toolsByServer(name)
      if (!serverTools.connected) {
        return c.json({ error: `MCP server not connected: ${name}` }, 404)
      }
      const toolExists = serverTools.tools.some((t) => t.id === toolId)
      if (!toolExists) {
        return c.json({ error: `Tool ${toolId} not found on server ${name}` }, 404)
      }
      await MCP.setToolEnabled(toolId, enabled)
      return c.json(true)
    },
  )
  ```

- [ ] **Step 3: 验证 TypeScript 编译通过**

  ```bash
  # packages/opencode 目录下
  bun run typecheck
  ```

  预期结果：无编译错误。

- [ ] **Step 4: Commit**

  ```bash
  git add packages/opencode/src/server/routes/mcp.ts
  git commit -m "feat(server): expose PATCH /mcp/:name/enabled and PATCH /mcp/:name/tools/:toolId routes"
  ```

---

## Chunk 2: 前端切换逻辑

### Task 4: 更新前端的 MCP server 开关逻辑

**目标：** 让 `dialog-select-mcp.tsx` 和 `status-popover.tsx` 中的 toggle 调用新路由，而不是 `connect`/`disconnect`。

**Files:**

- Modify: `packages/app/src/components/dialog-select-mcp.tsx`
- Modify: `packages/app/src/components/status-popover.tsx`

**背景知识：**

SDK 客户端由 OpenAPI spec 自动生成，新路由上线后需重新生成。但在生成流程未走完之前，可以用以下临时方案：通过 `sdk.client` 的底层 fetch 方法调用新路由，或者等 SDK 重新生成后使用 `sdk.client.mcp.setEnabled()`。

本计划**优先走 SDK regeneration**，步骤如下：

- [ ] **Step 1: 重新生成 SDK 类型**

  ```bash
  # 从项目根目录执行
  bun run build:sdk
  # 或者按项目实际命令，查看 package.json 的 scripts
  ```

  如果没有单独的 SDK 生成命令，检查 `packages/sdk/` 目录的 README 或 `package.json`。

  > **备选方案（如果 SDK regeneration 不可用）：** 在 `packages/app/src/utils/server.ts` 或行内直接用 `fetch` 调用 `PATCH /mcp/:name/enabled`，参考现有的 `sdk.client.mcp.connect` 调用方式构造请求。

- [ ] **Step 2: 修改 `dialog-select-mcp.tsx` 的 `toggle` 函数**

  找到当前实现：

  ```typescript
  const toggle = async (name: string) => {
    if (loading()) return
    setLoading(name)
    try {
      const status = sync.data.mcp[name]
      if (status?.status === "connected") {
        await sdk.client.mcp.disconnect({ name })
      } else {
        await sdk.client.mcp.connect({ name })
      }
      const result = await sdk.client.mcp.status()
      if (result.data) sync.set("mcp", result.data)
    } finally {
      setLoading(null)
    }
  }
  ```

  替换为（使用新路由，不再根据当前状态判断，而是直接切换）：

  ```typescript
  const toggle = async (name: string) => {
    if (loading()) return
    setLoading(name)
    try {
      const currentStatus = sync.data.mcp[name]
      const enabled = currentStatus?.status !== "connected"
      await sdk.client.mcp.setEnabled({ name, enabled })
      const result = await sdk.client.mcp.status()
      if (result.data) sync.set("mcp", result.data)
    } finally {
      setLoading(null)
    }
  }
  ```

  > 如 SDK 未重新生成，临时用：
  >
  > ```typescript
  > await fetch(`${sdk.url}/mcp/${encodeURIComponent(name)}/enabled`, {
  >   method: "PATCH",
  >   headers: { "Content-Type": "application/json" },
  >   body: JSON.stringify({ enabled }),
  > })
  > ```

- [ ] **Step 3: 修改 `status-popover.tsx` 的 `useMcpToggle`**

  找到：

  ```typescript
  const toggle = async (name: string) => {
    if (loading()) return
    setLoading(name)
    try {
      const status = input.sync.data.mcp[name]
      await (status?.status === "connected"
        ? input.sdk.client.mcp.disconnect({ name })
        : input.sdk.client.mcp.connect({ name }))
      const result = await input.sdk.client.mcp.status()
      if (result.data) input.sync.set("mcp", result.data)
    } catch (err) {
      showToast({ ... })
    } finally {
      setLoading(null)
    }
  }
  ```

  替换 `await (status?.status === "connected" ? ... : ...)` 那一行为：

  ```typescript
  const enabled = status?.status !== "connected"
  await input.sdk.client.mcp.setEnabled({ name, enabled })
  ```

  （`try/catch/finally` 结构保持不变）

- [ ] **Step 4: Commit**

  ```bash
  git add packages/app/src/components/dialog-select-mcp.tsx
  git add packages/app/src/components/status-popover.tsx
  git commit -m "feat(app): use persistent setEnabled for MCP server toggle, no SSE disconnect"
  ```

---

## Chunk 3: overlay 失效 & 重启同步

### Task 5: 确保 instance 重启后 overlay 被清理

**目标：** 当 `Instance.dispose()` 被调用时（例如通过其他路径触发重启），overlay 应被清除，以免与新加载的 config 文件内容冲突（文件已持久化，overlay 中的值已无必要保留）。

**Files:**

- Modify: `packages/opencode/src/config/config.ts`

**背景知识：**

- `Config.state = Instance.state(async () => {...}, async (state) => {...})` 第二个参数是 dispose 回调
- 在 dispose 回调中清理 overlay 即可

- [ ] **Step 1: 给 `Config.state` 增加 dispose 回调**

  找到：

  ```typescript
  export const state = Instance.state(async () => {
    // ...
    return {
      config: result,
      directories,
      deps,
    }
  })
  ```

  修改为（增加第二个参数 dispose 回调）：

  ```typescript
  export const state = Instance.state(
    async () => {
      // ... (原有初始化逻辑不变)
      return {
        config: result,
        directories,
        deps,
      }
    },
    async () => {
      // Clean up overlay when instance is disposed so stale in-memory
      // values don't shadow the freshly loaded config after restart.
      clearToolsOverlay(Instance.directory)
    },
  )
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add packages/opencode/src/config/config.ts
  git commit -m "fix(config): clear tools overlay on instance dispose to prevent stale state after restart"
  ```

---

## Chunk 4: 端到端验证

### Task 6: 手动验证完整流程

**目标：** 确认切换操作不再断开 SSE 连接，且重启后状态正确恢复。

**验证步骤：**

- [ ] **Step 1: 启动后端**

  ```bash
  # packages/opencode 目录下
  bun run --conditions=browser ./src/index.ts serve --port 4096
  ```

- [ ] **Step 2: 启动前端**

  ```bash
  # packages/app 目录下
  bun dev -- --port 4444
  ```

- [ ] **Step 3: 验证 MCP server 开关不断线**
  1. 打开 `http://localhost:4444`，打开浏览器 DevTools → Network → Filter "EventStream"
  2. 找到 `/event` 的 SSE 连接，确认其处于 "Pending"（持续接收数据）状态
  3. 在 status-popover 或 MCP dialog 中切换任意一个 MCP server 的开关
  4. **预期结果：** `/event` SSE 连接的状态栏不出现 "Cancelled" 或重新建立连接的记录

- [ ] **Step 4: 验证 MCP server 开关持久化**
  1. 切换某个 MCP server 为 disabled
  2. 查看项目目录下的 `opencode.json`，确认 `mcp.<serverName>.enabled` 字段已写入 `false`
  3. 重启后端进程（`Ctrl+C` 再重启）
  4. 重新打开前端，确认该 MCP server 仍处于 disabled 状态

- [ ] **Step 5: 验证工具级开关（如 UI 已实现）**
  1. 如果 webgui 中有工具级开关入口，切换某个工具
  2. 确认 SSE 连接不断开
  3. 查看 `opencode.json` 的 `tools.<toolId>` 字段已写入
  4. 重启后确认工具状态正确恢复

- [ ] **Step 6: 最终 commit（如有遗漏文件）**

  ```bash
  git status
  # 确认所有修改都已 commit
  ```

---

## 注意事项 & 边界情况

### overlay 与 config 文件内容一致性

`patchProjectField()` 写文件后，**下一次 `Instance.dispose()` + 重启时**，`Config.state` 会重新从文件加载，`clearToolsOverlay()` 已在 dispose 回调中调用，故重启后完全依赖文件内容，overlay 不会造成干扰。

### overlay 只覆盖 `tools` 字段

`Config.get()` 的 merge 逻辑是：

```typescript
tools: { ...(cfg.tools ?? {}), ...overlay }
```

overlay 中的 key 精确覆盖 config 文件中的同名 key，其他 config 字段完全不受影响。

### MCP server `enabled` 字段的语义

`Config.Mcp` 中 `enabled` 字段是 `z.boolean().optional()`，`undefined` 表示启用（默认值）。`setEnabled(name, true)` 写入 `true`，`setEnabled(name, false)` 写入 `false`。若需恢复默认（undefined），可扩展为 `setEnabled(name, undefined)` 删除该字段——当前计划暂不实现此 case，保持简单。

### patchJsonc 对不存在的嵌套路径的处理

`jsonc-parser` 的 `modify()` 函数在 `path` 中的中间节点不存在时会自动创建。例如 `patchJsonc(before, false, ["mcp", "myServer", "enabled"])` 在 `mcp.myServer` 不存在时会创建它。但 **此情况不应发生**，因为 `setEnabled()` 只在 config 中已有该 MCP server 定义时才会被调用（路由层读取 config 来确认 server 存在）。

### 工具 ID 格式

工具 ID 的格式是 `canon(clientName, toolName)` = `clientName_toolName`（非字母数字字符替换为 `_`）。前端在调用 `PATCH /mcp/:name/tools/:toolId` 时需传入完整的 tool ID（即 `clientName_toolName` 格式），而不是仅 `toolName`。路由参数中的 `:name` 是 server name，`:toolId` 是完整 tool ID，二者可能有重复信息，但保持一致性。
