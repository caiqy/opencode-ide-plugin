# WebGUI Skill 独立开关 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 webgui 状态面板新增 Skills tab，每个 skill 支持独立启用/禁用开关，持久化到 opencode.json。

**Architecture:** 后端新增 skill permission overlay（类似 MCP 的 toolsOverlay），`Skill.available()` 读取 overlay 作为额外 ruleset；新增 `PATCH /skill/:name/enabled` 路由；前端在状态面板新增 Skills tab，每个 skill 一行 + Switch 开关。

**Tech Stack:** TypeScript, Effect, Hono, React, Vitest

---

### Task 1: 后端 — Config 层新增 skillPermissionOverlay

**Files:**

- Modify: `packages/opencode/src/config/config.ts:1106-1127` (在 toolsOverlay 区域之后新增)

- [ ] **Step 1: 写测试 — 验证 overlay get/set/clear 基本行为**

在 `packages/opencode/test/config/` 下找到或创建合适的测试文件。如果没有现成的 config overlay 测试，可以在已有测试文件中新增 describe block。测试 `setSkillPermissionOverlay` 设置值后 `getSkillPermissionOverlay` 能读到，`clearSkillPermissionOverlay` 后读到空对象。

Run: `bun test config` from `packages/opencode`
Expected: FAIL — 函数不存在

- [ ] **Step 2: 实现 skillPermissionOverlay**

在 `packages/opencode/src/config/config.ts` 中，紧跟 `clearToolsOverlay` 函数之后（约行 1127），新增：

```ts
// In-memory overlay for skill permission states.
// Allows toggling individual skill visibility without Instance.dispose().
// Values are "allow" | "deny" (string, not boolean — matches Permission.Action).
const skillPermissionOverlayByDir = new Map<string, Record<string, string>>()

export function getSkillPermissionOverlay(dir: string): Record<string, string> {
  return skillPermissionOverlayByDir.get(dir) ?? {}
}

export function setSkillPermissionOverlay(dir: string, name: string, action: string) {
  const prev = skillPermissionOverlayByDir.get(dir) ?? {}
  skillPermissionOverlayByDir.set(dir, { ...prev, [name]: action })
}

export function clearSkillPermissionOverlay(dir: string) {
  skillPermissionOverlayByDir.delete(dir)
}
```

然后在 Effect `Config.state` 的 finalizer（约行 1509）中，添加清理调用。将：

```ts
yield * Effect.addFinalizer(() => Effect.sync(() => clearToolsOverlay(ctx.directory)))
```

改为：

```ts
yield *
  Effect.addFinalizer(() =>
    Effect.sync(() => {
      clearToolsOverlay(ctx.directory)
      clearSkillPermissionOverlay(ctx.directory)
    }),
  )
```

Run: `bun test config` from `packages/opencode`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add packages/opencode/src/config/config.ts packages/opencode/test/config/
git commit -m "feat(config): add skillPermissionOverlay for in-memory skill toggle"
```

---

### Task 2: 后端 — Skill.available() 读取 overlay

**Files:**

- Modify: `packages/opencode/src/skill/index.ts:230-235`
- Test: `packages/opencode/test/skill/skill.test.ts`

- [ ] **Step 1: 写测试 — 验证 overlay deny 的 skill 被过滤**

在 `packages/opencode/test/skill/skill.test.ts` 中新增测试：设置 `Config.setSkillPermissionOverlay` 后调用 `Skill.available(agent)`，验证被 deny 的 skill 不在结果中。

注意：这个测试可能需要 mock 或使用临时目录设置 skill + overlay。参照已有测试模式。

Run: `bun test skill` from `packages/opencode`
Expected: FAIL — available 还没读 overlay

- [ ] **Step 2: 修改 available() 读取 overlay**

在 `packages/opencode/src/skill/index.ts` 中：

1. 确认 `Config` 已导入（行 15，已有）
2. 新增导入 `Instance`：`import { Instance } from "@/project/instance"`
3. 修改 `available` 函数（行 230-235）：

```ts
const available = Effect.fn("Skill.available")(function* (agent?: Agent.Info) {
  const s = yield* InstanceState.get(state)
  const list = Object.values(s.skills).toSorted((a, b) => a.name.localeCompare(b.name))
  if (!agent) return list
  const overlay = Config.getSkillPermissionOverlay(Instance.directory)
  const extra = Object.entries(overlay).map(([pattern, action]) => ({
    permission: "skill",
    pattern,
    action: action as "allow" | "deny" | "ask",
  }))
  return list.filter((skill) => Permission.evaluate("skill", skill.name, agent.permission, extra).action !== "deny")
})
```

Run: `bun test skill` from `packages/opencode`
Expected: PASS

- [ ] **Step 3: 运行 typecheck**

Run: `bun typecheck` from `packages/opencode`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add packages/opencode/src/skill/index.ts packages/opencode/test/skill/
git commit -m "feat(skill): read permission overlay in available() for runtime toggle"
```

---

### Task 3: 后端 — PATCH /skill/:name/enabled 路由

**Files:**

- Modify: `packages/opencode/src/server/instance.ts:208` (在 GET /skill 之后插入)

- [ ] **Step 1: 写测试 — 验证路由返回 true 或 404**

如果项目中有 server 路由的集成测试模式，在对应位置新增。否则此 step 可跳过，通过手动或 curl 验证。

- [ ] **Step 2: 新增 PATCH 路由**

在 `packages/opencode/src/server/instance.ts` 中：

1. 新增导入 `Config`：`import { Config } from "../config/config"` 和 `validator`：`import { validator } from "hono-openapi"`
2. 在 GET `/skill` 路由之后（行 208），插入新增导入 `errors`：`import { errors } from "./error"`
3. 在 GET `/skill` 路由之后，GET `/lsp` 之前，插入：

```ts
.patch(
  "/skill/:name/enabled",
  describeRoute({
    description: "Set skill enabled state with persistence",
    operationId: "skill.setEnabled",
    responses: {
      200: {
        description: "Skill enabled state updated",
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
    const skills = await Skill.all()
    if (!skills.some((s) => s.name === name)) {
      return c.json({ error: `Skill not found: ${name}` }, 404)
    }
    const action = enabled ? "allow" : "deny"
    Config.setSkillPermissionOverlay(Instance.directory, name, action)
    await Config.patchProjectField(["permission", "skill", name], action)
    return c.json(true)
  },
)
```

需要在 `instance.ts` 顶部补充以下导入（当前文件没有这些）：

- 在现有的 `import { describeRoute, resolver } from "hono-openapi"` 中加入 `validator`：`import { describeRoute, resolver, validator } from "hono-openapi"`
- 新增：`import { Config } from "../config/config"`
- 新增：`import { errors } from "./error"`

Run: `bun typecheck` from `packages/opencode`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add packages/opencode/src/server/instance.ts
git commit -m "feat(server): add PATCH /skill/:name/enabled route"
```

---

### Task 4: 前端 — sdkClient 新增 setSkillEnabled

**Files:**

- Modify: `packages/opencode/webgui/src/lib/api/sdkClient.ts`

- [ ] **Step 1: 新增 setSkillEnabled 函数**

在 `sdkClient.ts` 中，在 `sdk.app` 的 `Object.assign` 内（约行 482-503），在 `skills` 方法之后新增 `setSkillEnabled`：

```ts
setSkillEnabled: async (options: {
  path: { name: string }
  body: { enabled: boolean }
}): Promise<ApiResult<unknown>> => {
  try {
    const response = await fetch(`/skill/${encodeURIComponent(options.path.name)}/enabled`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options.body),
    })
    if (!response.ok) {
      return { error: { message: "Failed to update skill state" }, data: null }
    }
    const data = await response.json()
    return { data, error: null }
  } catch (error) {
    return { error: { message: error instanceof Error ? error.message : "Unknown error" }, data: null }
  }
},
```

同时更新类型断言部分，在 `skills:` 类型后面加上 `setSkillEnabled` 的类型。

- [ ] **Step 2: 运行 typecheck**

Run: `bun typecheck` from `packages/opencode` (webgui 子目录)
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add packages/opencode/webgui/src/lib/api/sdkClient.ts
git commit -m "feat(webgui): add sdk.app.setSkillEnabled API"
```

---

### Task 5: 前端 — status.ts 新增 Skills tab 和 buildSkillView

**Files:**

- Modify: `packages/opencode/webgui/src/components/CompactHeader/status.ts`
- Test: `packages/opencode/webgui/src/components/CompactHeader/status.test.ts`

- [ ] **Step 1: 写测试 — buildSkillView**

在 `status.test.ts` 中新增测试：

```ts
describe("buildSkillView", () => {
  it("ready 状态下返回按 name 排序的 items", () => {
    const input = {
      state: "ready" as const,
      data: {
        beta: { enabled: true },
        alpha: { enabled: false },
      },
      error: null,
      updatedAt: 1000,
    }
    const view = buildSkillView(input)
    expect(view.state).toBe("ready")
    expect(view.items).toEqual([
      { name: "alpha", enabled: false },
      { name: "beta", enabled: true },
    ])
  })

  it("empty 状态返回空列表", () => {
    const input = {
      state: "empty" as const,
      data: {},
      error: null,
      updatedAt: null,
    }
    const view = buildSkillView(input)
    expect(view.state).toBe("empty")
    expect(view.items).toEqual([])
  })
})
```

Run: `bun test status.test` from `packages/opencode/webgui`
Expected: FAIL — buildSkillView 不存在

- [ ] **Step 2: 实现 buildSkillView 并扩展 Tab/TABS**

在 `status.ts` 中：

1. 修改 `Tab` 类型（行 1）：

```ts
type Tab = "servers" | "mcp" | "lsp" | "plugins" | "skills"
```

2. 在 `STATUS_TABS` 数组（行 44-49）末尾新增：

```ts
{ id: "skills", label: "Skills" },
```

3. 新增类型和函数：

```ts
type SkillState = {
  enabled: boolean
}

export function buildSkillView(input: Box<Record<string, SkillState>>) {
  return {
    state: input.state,
    error: input.error,
    updatedAt: input.updatedAt,
    items: Object.entries(input.data)
      .map(([name, item]) => ({ name, enabled: item.enabled }))
      .toSorted((a, b) => a.name.localeCompare(b.name)),
  }
}
```

Run: `bun test status.test` from `packages/opencode/webgui`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add packages/opencode/webgui/src/components/CompactHeader/status.ts packages/opencode/webgui/src/components/CompactHeader/status.test.ts
git commit -m "feat(webgui): add Skills tab and buildSkillView to status module"
```

---

### Task 6: 前端 — useStatusPopoverData 新增 skills 数据和 toggleSkill

**Files:**

- Modify: `packages/opencode/webgui/src/components/CompactHeader/useStatusPopoverData.ts`
- Test: `packages/opencode/webgui/src/components/CompactHeader/useStatusPopoverData.test.tsx`

- [ ] **Step 1: 写测试 — skills 加载和 toggle**

在 `useStatusPopoverData.test.tsx` 中：

1. 在 `mocks` 对象中新增 `appSkills: vi.fn()` 和 `appSetSkillEnabled: vi.fn()`
2. 在 `vi.mock` 的 sdk 中新增 `app: { skills: (...args) => mocks.appSkills(...args), setSkillEnabled: (...args) => mocks.appSetSkillEnabled(...args) }`
3. 新增测试：mock `appSkills` 返回 skill 列表、mock `configGet` 返回含 permission.skill 的配置，验证 hook 返回的 `skills` 字段包含正确的 enabled 状态

Run: `bun test useStatusPopoverData` from `packages/opencode/webgui`
Expected: FAIL — hook 还没有 skills 字段

- [ ] **Step 2: 实现 skills 数据加载**

在 `useStatusPopoverData.ts` 中：

1. `Data` 类型新增 `skills: Box<Record<string, { enabled: boolean }>>`
2. 初始状态新增 `skills: box({}, "empty", null, null)`
3. 新增 `loadSkills` 函数（参照 `loadMcp` 模式）：
   - 并发调 `sdk.app.skills()` 和 `sdk.config.get()`
   - 从 config 的 `permission?.skill` 中读取每个 skill 的状态
   - 构建 `Record<string, { enabled: boolean }>`，permission 为 `"deny"` 的设为 `false`，其余为 `true`
4. 在 `refreshAll` 的 `Promise.allSettled` 中加入 `loadSkills()`（新增第 6 项）
5. 在 `setData` 回调中新增 skills 处理 IIFE：

```ts
const skills = (() => {
  if (skillsRes.status === "rejected") {
    const err = text(skillsRes.reason, "Failed to load skills")
    return failed(prev.skills, {}, err)
  }
  if (skillsRes.value.error || !skillsRes.value.data) {
    const err = text(skillsRes.value.error, "Failed to load skills")
    return failed(prev.skills, {}, err)
  }
  const next = skillsRes.value.data as Record<string, { enabled: boolean }>
  return box(next, Object.keys(next).length > 0 ? "ready" : "empty", null, stamp)
})()
```

6. 在 return 语句中加上 `skills`：`return { servers, mcp, lsp, plugins, skills }`
7. hook 返回值中新增 `skills: data.skills`、`toggleSkill`、`skillBusy: sbusy`

- [ ] **Step 3: 实现 toggleSkill**

新增状态和独立的 sequence ref：

```ts
const slock = useRef<Record<string, boolean>>({})
const [sbusy, setSBusy] = useState<Record<string, boolean>>({})
const sseq = useRef(0)
```

新增 `toggleSkill` 函数（参照 `toggleMcp` 模式）：

```ts
const toggleSkill = useCallback(
  async (name: string) => {
    if (slock.current[name]) return
    slock.current[name] = true
    setSBusy({ ...slock.current })
    try {
      const enabled = data.skills.data[name]?.enabled
      const res = await sdk.app.setSkillEnabled({
        path: { name },
        body: { enabled: !enabled },
      })
      if (res.error) throw res.error
      const id = ++sseq.current
      const fresh = await loadSkills()
      setData((prev) => {
        if (id !== sseq.current) return prev
        if (fresh.error || !fresh.data) {
          return { ...prev, skills: failed(prev.skills, prev.skills.data, text(fresh.error, "Failed to load skills")) }
        }
        const state = Object.keys(fresh.data).length > 0 ? "ready" : "empty"
        return { ...prev, skills: box(fresh.data, state, null, now()) }
      })
    } catch (err) {
      setData((prev) => ({
        ...prev,
        skills: failed(prev.skills, prev.skills.data, text(err, "Failed to toggle skill")),
      }))
    } finally {
      delete slock.current[name]
      setSBusy({ ...slock.current })
    }
  },
  [data.skills.data, loadSkills],
)
```

返回值新增 `toggleSkill`、`skillBusy: sbusy`。

Run: `bun test useStatusPopoverData` from `packages/opencode/webgui`
Expected: PASS

- [ ] **Step 4: 运行 typecheck**

Run: `bun typecheck` from `packages/opencode`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/opencode/webgui/src/components/CompactHeader/useStatusPopoverData.ts packages/opencode/webgui/src/components/CompactHeader/useStatusPopoverData.test.tsx
git commit -m "feat(webgui): add skills data loading and toggleSkill to status popover"
```

---

### Task 7: 前端 — StatusPopover 新增 Skills Panel

**Files:**

- Modify: `packages/opencode/webgui/src/components/CompactHeader/StatusPopover.tsx`
- Test: `packages/opencode/webgui/src/components/CompactHeader/StatusPopover.test.tsx`

- [ ] **Step 1: 写测试 — Skills panel 渲染和开关**

在 `StatusPopover.test.tsx` 中：

1. 更新 `View` 类型：新增 `skills` 字段（Box 结构）和 `toggleSkill`、`skillBusy`
2. 更新 `data()` 工厂：新增 skills 默认数据
3. 新增测试：mock skills 数据，点击 Skills tab，验证 skill 列表和 Switch 渲染

Run: `bun test StatusPopover` from `packages/opencode/webgui`
Expected: FAIL — Skills panel 还没实现

- [ ] **Step 2: 实现 Skills Panel**

在 `StatusPopover.tsx` 中：

1. 导入 `buildSkillView` from `./status`
2. 新增 `useMemo`：

```ts
const skills = useMemo(() => buildSkillView(data.skills), [data.skills])
```

3. 在 Plugins Panel 之后新增：

```tsx
<Panel tab={tab} id="skills">
  <div className="space-y-2 px-3 py-3 pr-4 text-xs text-gray-700 dark:text-gray-200">
    <StateBox state={skills.state} error={skills.error} updatedAt={skills.updatedAt} onRetry={data.refreshAll} />
    {skills.items.map((item) => (
      <div
        key={item.name}
        className="flex items-center justify-between border-b border-gray-100 pb-2 last:border-0 last:pb-0 dark:border-gray-900"
      >
        <span>{item.name}</span>
        <Switch
          label={`切换 ${item.name}`}
          checked={item.enabled}
          disabled={data.skillBusy[item.name] === true}
          loading={data.skillBusy[item.name] === true}
          onToggle={() => void data.toggleSkill(item.name)}
        />
      </div>
    ))}
  </div>
</Panel>
```

Run: `bun test StatusPopover` from `packages/opencode/webgui`
Expected: PASS

- [ ] **Step 3: 运行全部 webgui 测试**

Run: `bun test` from `packages/opencode/webgui`
Expected: PASS

- [ ] **Step 4: 运行 typecheck**

Run: `bun typecheck` from `packages/opencode`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/opencode/webgui/src/components/CompactHeader/StatusPopover.tsx packages/opencode/webgui/src/components/CompactHeader/StatusPopover.test.tsx
git commit -m "feat(webgui): add Skills panel to StatusPopover with per-skill toggle"
```

---

### Task 8: 集成验证

- [ ] **Step 1: 运行后端全部测试**

Run: `bun test` from `packages/opencode`
Expected: PASS

- [ ] **Step 2: 运行前端全部测试**

Run: `bun test` from `packages/opencode/webgui`
Expected: PASS

- [ ] **Step 3: 运行 typecheck**

Run: `bun typecheck` from `packages/opencode`
Expected: PASS

- [ ] **Step 4: 如有失败，按照 systematic-debugging skill 排查**
