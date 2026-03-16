# WebGUI MCP 工具级开关 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 WebGUI 的状态弹层 MCP tab 支持“单个 MCP 下工具级开关”，并补齐 Switch 交互与加载态，同时确保项目级配置可正确落盘并在下一轮回复生效。

**Architecture:** 后端先补齐“按 server 枚举 MCP 工具”的路由能力，并修正项目配置更新写入目标文件（与读取链路保持一致）。前端在 `CompactHeader` 内继续维持数据适配层 + 视图映射层 + 渲染层分离：`useStatusPopoverData` 负责请求与提交态、`status.ts` 负责 view model、`StatusPopover.tsx` 只做交互渲染。工具开关最终写入 `config.tools[toolId]`，沿用现有 `session/llm.ts` 的工具过滤链路实现动态生效（下一轮）。

**Tech Stack:** Bun、Hono、Zod、TypeScript、React、Vitest、Testing Library、OpenAPI 生成 SDK（`./packages/sdk/js/script/build.ts`）。

---

### Task 1: 修复项目级 `Config.update` 写入目标文件

**Files:**

- Modify: `packages/opencode/src/config/config.ts`
- Modify: `packages/opencode/test/config/config.test.ts`

**Step 1: Write the failing test**

在 `config.test.ts` 新增/改造两个用例：

1. `Config.update()` 应写入项目 `opencode.json`（不存在时创建），而不是 `config.json`。
2. 当项目同时存在 `opencode.json` 与 `opencode.jsonc` 时，`Config.update()` 应优先写入 `opencode.json`，确保与读取优先级一致。

示例断言片段：

```ts
await Config.update({ model: "updated/model" } as any)
const text = await Filesystem.readText(path.join(tmp.path, "opencode.json"))
expect(text).toContain("updated/model")
```

**Step 2: Run test to verify it fails**

Run (workdir=`packages/opencode`):

```bash
bun test test/config/config.test.ts -t "updates config and writes opencode.json by default|updates existing opencode.json when jsonc is absent|updates existing opencode.json when json and jsonc both exist"
```

Expected: FAIL（当前实现仍写 `config.json`）。

**Step 3: Write minimal implementation**

在 `config.ts` 为 `Config.update()` 增加项目配置文件解析逻辑，优先已有 `opencode.json` / `opencode.jsonc`，否则创建 `opencode.json`。

示例实现片段：

```ts
function projectConfigFile() {
  const list = ["opencode.json", "opencode.jsonc"].map((x) => path.join(Instance.directory, x))
  for (const file of list) {
    if (existsSync(file)) return file
  }
  return list[0]
}

export async function update(config: Info) {
  const filepath = projectConfigFile()
  const existing = await loadFile(filepath)
  await Filesystem.writeJson(filepath, mergeDeep(existing, config))
  await Instance.dispose()
}
```

**Step 4: Run test to verify it passes**

Run (workdir=`packages/opencode`):

```bash
bun test test/config/config.test.ts -t "updates config and writes opencode.json by default|updates existing opencode.json when jsonc is absent|updates existing opencode.json when json and jsonc both exist"
```

Expected: PASS。

**Step 5: Commit**

```bash
git add packages/opencode/src/config/config.ts packages/opencode/test/config/config.test.ts
git commit -m "fix(config): write project updates to opencode config file"
```

---

### Task 2: 增加 MCP 工具枚举能力与路由契约

**Files:**

- Modify: `packages/opencode/src/mcp/index.ts`
- Modify: `packages/opencode/src/server/routes/mcp.ts`
- Create: `packages/opencode/test/server/mcp-tools-route.test.ts`

**Step 1: Write the failing test**

在 `mcp-tools-route.test.ts` 定义路由契约测试（建议先 mock MCP 层返回）：

1. `GET /mcp/:name/tools` 返回 `server/connected/tools[]`。
2. `connected=false` 时返回空 tools 而不是 4xx。
3. `tools[].enabled` 与 `config.tools[toolId]` 一致。

示例期望：

```ts
expect(body).toEqual({
  server: "playwright",
  connected: true,
  tools: [{ id: "playwright_browser_navigate", name: "browser_navigate", enabled: true }],
})
```

**Step 2: Run test to verify it fails**

Run (workdir=`packages/opencode`):

```bash
bun test test/server/mcp-tools-route.test.ts
```

Expected: FAIL（路由与返回 schema 尚不存在）。

**Step 3: Write minimal implementation**

1. 在 `MCP` 命名空间新增按 server 枚举工具的方法，返回 canonical tool id + raw tool name。
2. 在 `routes/mcp.ts` 新增 `GET /:name/tools`，并读取 `Config.get().tools` 计算 `enabled`。

示例返回 schema 片段：

```ts
resolver(
  z.object({
    server: z.string(),
    connected: z.boolean(),
    tools: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        enabled: z.boolean(),
      }),
    ),
  }),
)
```

**Step 4: Run test to verify it passes**

Run (workdir=`packages/opencode`):

```bash
bun test test/server/mcp-tools-route.test.ts
```

Expected: PASS。

**Step 5: Commit**

```bash
git add packages/opencode/src/mcp/index.ts packages/opencode/src/server/routes/mcp.ts packages/opencode/test/server/mcp-tools-route.test.ts
git commit -m "feat(mcp): expose per-server tool list endpoint"
```

---

### Task 3: 重新生成 JavaScript SDK 并验证新接口可调用

**Files:**

- Modify: `packages/sdk/js/src/gen/sdk.gen.ts`
- Modify: `packages/sdk/js/src/gen/types.gen.ts`
- Modify: `packages/sdk/js/src/gen/client.gen.ts`
- Modify: `packages/sdk/js/src/gen/client/client.gen.ts`

**Step 1: Write the failing test**

在 WebGUI 侧先写一个编译层失败断言（例如在 `useStatusPopoverData.test.tsx` 中先调用 `sdk.mcp.tools`，预期当前类型不存在）。

**Step 2: Run test to verify it fails**

Run (workdir=`packages/opencode/webgui`):

```bash
bun run test:run src/components/CompactHeader/useStatusPopoverData.test.tsx -t "加载 MCP 工具列表"
```

Expected: FAIL（`sdk.mcp.tools` 未生成）。

**Step 3: Write minimal implementation**

按仓库约定执行 SDK 生成命令：

```bash
./packages/sdk/js/script/build.ts
```

如果本地需要显式 runtime，可改用：

```bash
bun ./packages/sdk/js/script/build.ts
```

**Step 4: Run test to verify it passes**

Run (workdir=`packages/opencode/webgui`):

```bash
bun run test:run src/components/CompactHeader/useStatusPopoverData.test.tsx -t "加载 MCP 工具列表"
```

Expected: PASS（类型和运行时调用可用）。

**Step 5: Commit**

```bash
git add packages/sdk/js/src/gen
git commit -m "chore(sdk): regenerate client for mcp tools endpoint"
```

---

### Task 4: 扩展 `useStatusPopoverData` 支持工具级开关与提交态

**Files:**

- Modify: `packages/opencode/webgui/src/components/CompactHeader/useStatusPopoverData.ts`
- Modify: `packages/opencode/webgui/src/components/CompactHeader/status.ts`
- Modify: `packages/opencode/webgui/src/components/CompactHeader/useStatusPopoverData.test.tsx`

**Step 1: Write the failing test**

在 `useStatusPopoverData.test.tsx` 增加以下失败用例：

1. `refreshMcp()` 后可拿到 `server -> tools[]`。
2. `toggleTool(server, toolId)` 仅锁定当前工具 busy。
3. `toggleTool` 成功后写入 `sdk.config.update({ tools })` 并触发 MCP 工具局部刷新。
4. 提交失败时仅当前工具回滚并标记 `stale`。
5. `mcpRefreshing` 只用于手动刷新按钮 loading。

**Step 2: Run test to verify it fails**

Run (workdir=`packages/opencode/webgui`):

```bash
bun run test:run src/components/CompactHeader/useStatusPopoverData.test.tsx
```

Expected: FAIL（新字段与新 action 尚不存在）。

**Step 3: Write minimal implementation**

在 hook 中新增工具数据和动作：

```ts
const [toolBusy, setToolBusy] = useState<Record<string, boolean>>({})

async function toggleTool(server: string, id: string, enabled: boolean) {
  const key = `${server}/${id}`
  if (toolBusy[key]) return
  // 1) 读取 config
  // 2) 更新 tools[id]
  // 3) sdk.config.update(...)
  // 4) refreshMcpTools(server)
}
```

并更新 `status.ts` 的 MCP view model，新增工具数组映射字段与 `loading` 标记字段。

**Step 4: Run test to verify it passes**

Run (workdir=`packages/opencode/webgui`):

```bash
bun run test:run src/components/CompactHeader/useStatusPopoverData.test.tsx
```

Expected: PASS。

**Step 5: Commit**

```bash
git add packages/opencode/webgui/src/components/CompactHeader/useStatusPopoverData.ts packages/opencode/webgui/src/components/CompactHeader/status.ts packages/opencode/webgui/src/components/CompactHeader/useStatusPopoverData.test.tsx
git commit -m "feat(webgui): add mcp tool-level state adapter"
```

---

### Task 5: `StatusPopover` 切换为 Switch 并接入加载态

**Files:**

- Modify: `packages/opencode/webgui/src/components/CompactHeader/StatusPopover.tsx`
- Modify: `packages/opencode/webgui/src/components/CompactHeader/StatusPopover.test.tsx`

**Step 1: Write the failing test**

在 `StatusPopover.test.tsx` 新增失败用例：

1. server 与 tool 开关均为 Switch 语义（`role="switch"` + `aria-checked`）。
2. 工具提交时仅当前工具开关 disabled/loading。
3. 手动刷新按钮点击后显示 loading，并在请求完成后恢复。
4. 提交成功显示“下一轮生效”提示文案（或 toast）。

**Step 2: Run test to verify it fails**

Run (workdir=`packages/opencode/webgui`):

```bash
bun run test:run src/components/CompactHeader/StatusPopover.test.tsx
```

Expected: FAIL（当前仍为 checkbox 且无完整 loading 语义）。

**Step 3: Write minimal implementation**

把 MCP 区域 checkbox 改为 button-based Switch（或现有可复用 Switch 组件），并接入 busy 状态：

```tsx
<button
  role="switch"
  aria-checked={item.enabled}
  aria-label={`切换 ${item.name}`}
  disabled={item.disabled || data.toolBusy[key]}
  onClick={() => void data.toggleTool(item.server, item.id, !item.enabled)}
/>
```

刷新按钮文案改为条件态（如 `刷新中...`），并绑定 `data.mcpRefreshing`。

**Step 4: Run test to verify it passes**

Run (workdir=`packages/opencode/webgui`):

```bash
bun run test:run src/components/CompactHeader/StatusPopover.test.tsx
```

Expected: PASS。

**Step 5: Commit**

```bash
git add packages/opencode/webgui/src/components/CompactHeader/StatusPopover.tsx packages/opencode/webgui/src/components/CompactHeader/StatusPopover.test.tsx
git commit -m "feat(webgui): switch mcp toggles to switch with loading states"
```

---

### Task 6: 端到端回归与收尾验证

**Files:**

- Modify: `docs/plans/2026-03-08-webgui-mcp-tool-toggle-design.md`（如实现中有命名或契约微调）

**Step 1: Run backend tests**

Run (workdir=`packages/opencode`):

```bash
bun test test/config/config.test.ts -t "updates config and writes opencode.json by default|updates existing opencode.json when jsonc is absent|updates existing opencode.json when json and jsonc both exist"
bun test test/server/mcp-tools-route.test.ts
```

Expected: PASS。

**Step 2: Run webgui tests**

Run (workdir=`packages/opencode/webgui`):

```bash
bun run test:run src/components/CompactHeader/useStatusPopoverData.test.tsx src/components/CompactHeader/StatusPopover.test.tsx
```

Expected: PASS。

**Step 3: Run type/build checks**

Run (workdir=`packages/opencode/webgui`):

```bash
bun run build
```

Run (workdir=`packages/opencode`):

```bash
bun run typecheck
```

Expected: PASS。

**Step 4: Commit**

```bash
git add docs/plans/2026-03-08-webgui-mcp-tool-toggle-design.md
git commit -m "docs: align mcp tool toggle design with implementation details"
```
