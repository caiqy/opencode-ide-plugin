# WebGUI 状态面板 Skill 独立开关设计

## 背景

OpenCode 的 Skills 系统允许 agent 按需加载专业化的指令和工作流。目前 skills 的可见性通过 `opencode.json` 中的 `permission.skill` 字段控制，但用户没有图形界面来快捷地启用/禁用单个 skill。WebGUI 的状态面板已有 Server、MCP、LSP、Plugins 四个 tab，其中 MCP tab 已经实现了服务器和工具的独立开关。

## 目标

1. 在 webgui 状态面板新增 Skills tab，展示所有已发现的 skill。
2. 每个 skill 提供独立开关（Switch），切换后立即生效且持久化。
3. 下次发送对话时，agent 能拿到最新的 skill 可见性状态。
4. 架构与 MCP 开关对齐，保持一致的 overlay + patchProjectField 模式。

## 非目标

1. 不处理 skill 文件的增删/编辑/创建。
2. 不处理按 agent 粒度的 skill 权限覆盖（本次只处理全局 permission.skill）。
3. 不改变 TUI 中的 skill 管理方式。
4. 不重构现有 MCP 开关的实现。

## 设计

### 1. 后端：Skill Permission Overlay（Config 层）

**问题**：`agent.permission` 是 `Permission.Ruleset`（`Rule[]`），在 `Agent.layer` 的 `InstanceState.make` 初始化时由 `Config.get().permission` 经 `Permission.fromConfig()` 转换后缓存。后续对 Config 的修改不会传播到已缓存的 agent 对象。

**方案**：不依赖 Config.get().permission 的合并来传播，而是在 `Skill.available()` 中直接读取独立的 skill permission overlay，作为额外的 ruleset 传入 `Permission.evaluate()`。同时，WebGUI 展示用的 `enabled` 状态也由后端统一计算，前端不复刻 wildcard 或平台大小写规则。

具体实现：

在 `Config` 模块中新增 `skillPermissionOverlayByDir: Map<string, Record<string, string>>`，结构为 `directory → { skillName → action }`。类似现有的 `toolsOverlayByDir`。

新增函数：

- `Config.setSkillPermissionOverlay(directory, name, action)` — 设置内存 overlay
- `Config.getSkillPermissionOverlay(directory)` — 读取 overlay
- `Config.clearSkillPermissionOverlay(directory)` — 清理（在 Effect finalizer 中调用）

在 `Skill.available(agent)` 中修改过滤逻辑：

```
const overlay = Config.getSkillPermissionOverlay(Instance.directory)
// 将 overlay 转为 ruleset 追加到 evaluate 调用中
const extra = Object.entries(overlay).map(([pattern, action]) => ({
  permission: "skill", pattern, action
}))
return list.filter(skill =>
  Permission.evaluate("skill", skill.name, agent.permission, extra).action !== "deny"
)
```

由于 `Permission.evaluate` 使用 `findLast` 匹配，`extra` 放在最后意味着 overlay 优先级最高，这正是我们期望的行为。

同时调用 `Config.patchProjectField(["permission", "skill", name], action)` 落盘到 `opencode.json`，确保重启后（Instance 重建时 agent 重新从 config 构建 ruleset）持久化。若原始 `permission.skill` 是 shorthand（例如 `"deny"`），写入单个 skill 前必须保留为 `{ "*": "deny" }` fallback，避免打开某个 skill 时丢失默认关闭语义。

不触发 `Instance.dispose()`，SSE 连接不会中断。

### 2. 后端：API 路由

在 `packages/opencode/src/server/routes/instance/index.ts` 中（与现有 `GET /skill` 同处）调整/新增路由；experimental HttpApi 的 `packages/opencode/src/server/routes/instance/httpapi/instance.ts` 也必须提供同等契约：

- `GET /skill`
  - 返回所有已发现 skill，并附带 `enabled: boolean`。
  - `enabled` 使用后端 `Permission.evaluate("skill", skill.name, ruleset)` 计算，ruleset 来自当前 effective config + runtime skill overlay。
  - 这是 WebGUI Skills 开关状态的唯一权威来源；前端不得自行解释 `permission.skill`、wildcard、`?` 或平台大小写规则。

- `PATCH /skill/:name/enabled`
  - param: `{ name: string }`
  - body: `{ enabled: boolean }`
  - 逻辑：
    1. 调 `Skill.get(name)` 验证 skill name 存在
    2. `action = enabled ? "allow" : "deny"`
    3. 如当前 effective `permission.skill` 是 shorthand，先将其转换为 `{ "*": existing }`
    4. `Config.patchProjectField(["permission", "skill", name], action)`
    5. `Config.setSkillPermissionOverlay(directory, name, action)`
    6. 返回 `true`
  - 错误：skill 不存在返回 404

与 `PATCH /mcp/:name/enabled`（位于 `routes/mcp.ts`）模式对齐。

### 3. 前端：SDK 客户端

在 `sdkClient.ts` 中为 `sdk.app` 扩展：

- `sdk.app.setSkillEnabled({ path: { name }, body: { enabled } })` — 调 `PATCH /skill/:name/enabled`

`sdk.app.skills()` 读取 `GET /skill`，返回项包含 `{ name, description, enabled }`。

### 4. 前端：数据层（useStatusPopoverData）

在 `useStatusPopoverData` hook 中新增：

- `skills: Box<Record<string, SkillState>>` 状态，其中 `SkillState = { enabled: boolean }`。
- `loadSkills()` 函数：只调 `sdk.app.skills()`，直接使用后端返回的 effective `enabled`。config 失败不应让 Skills 分区失败。
- `toggleSkill(name)` 函数：调 `sdk.app.setSkillEnabled`，成功后 `refreshSkills()`。
- `skillBusy: Record<string, boolean>` 锁，防止快速连点。
- `refreshAll()` 分段提交：Server/MCP/LSP 先提交；Plugins 依赖 `sdk.config.get()`；Skills 独立依赖 `sdk.app.skills()`。Skills 使用独立版本号防旧请求覆盖 toggle 后状态，不能取消并发 refreshAll 的非 Skills 分区提交。

返回值新增 `skills`、`toggleSkill`、`skillBusy`。

### 5. 前端：视图构建（status.ts）

`STATUS_TABS` 新增 `{ id: "skills", label: "Skills" }`。

Tab 类型扩展为 `"servers" | "mcp" | "lsp" | "plugins" | "skills"`。

新增 `buildSkillView(input: Box<Record<string, SkillState>>)` 纯函数，返回：

```ts
{
  state: State,
  error: string | null,
  updatedAt: number | null,
  items: Array<{ name: string, enabled: boolean }>
}
```

### 6. 前端：UI 渲染（StatusPopover）

StatusPopover 中新增 Skills Panel：

```tsx
<Panel tab={tab} id="skills">
  <div className="space-y-2 px-3 py-3 pr-4 text-xs text-gray-700 dark:text-gray-200">
    <StateBox state={skills.state} error={skills.error} updatedAt={skills.updatedAt} />
    {skills.items.map((item) => (
      <div key={item.name} className="flex items-center justify-between ...">
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

每行展示 skill 名称 + Switch 开关，与 MCP 面板风格一致。

## 数据流

```
用户点击 Switch
  → toggleSkill(name)
  → PATCH /skill/:name/enabled { enabled: false }
  → 后端: patchProjectField(["permission","skill",name], "deny")
  → 后端: setSkillPermissionOverlay(dir, name, "deny")
  → 返回 200
  → refreshSkills() 调 GET /skill，读取后端 effective enabled
  → UI 更新

下次发送消息
  → SystemPrompt.skills(agent)
  → Skill.available(agent)
  → 读取 skillPermissionOverlay 作为 extra ruleset
  → Permission.evaluate("skill", skillName, agent.permission, extra)
  → extra 中 deny 的 skill 被过滤掉
  → 被 deny 的 skill 不会出现在 <available_skills> 中
```

权限执行时同样必须保持一致：`Permission.ask()` 的有效顺序为 persisted approvals、当前 config/session ruleset、runtime override ruleset。因为 `Permission.evaluate()` 使用最后匹配生效，所以当前 config 中的 `permission.skill` deny 必须能压过历史 “always allow”，runtime overlay 又必须压过二者。这样即使实例重建导致 overlay 消失，已持久化的 `permission.skill` 仍能阻止旧 approval 绕过禁用状态。

## 影响范围

- `packages/opencode/src/config/config.ts` — 新增 skillPermissionOverlay
- `packages/opencode/src/skill/index.ts` — `available()` 中读取 overlay 作为额外 ruleset
- `packages/opencode/src/server/routes/instance/index.ts` — `GET /skill` 返回 effective enabled；新增 PATCH /skill/:name/enabled 路由
- `packages/opencode/src/server/routes/instance/httpapi/instance.ts` — experimental HttpApi 下同步提供相同 skill enabled 契约
- `packages/sdk/openapi.json`、`packages/sdk/js/src/v2/gen/**` — 同步生成的 v2 API 契约；legacy `packages/sdk/js/src/gen/**` 仍服务旧客户端形状，除非进行 SDK 迁移，否则不在本功能中重生成
- `packages/opencode/webgui/src/lib/api/sdkClient.ts` — 新增 setSkillEnabled
- `packages/opencode/webgui/src/components/CompactHeader/status.ts` — 新增 skills tab 和 buildSkillView
- `packages/opencode/webgui/src/components/CompactHeader/useStatusPopoverData.ts` — 新增 skills 数据和 toggleSkill
- `packages/opencode/webgui/src/components/CompactHeader/StatusPopover.tsx` — 新增 Skills Panel
- 相关测试文件（skill.test.ts、useStatusPopoverData.test.tsx、StatusPopover.test.tsx、status.test.ts）
