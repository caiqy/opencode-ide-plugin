# WebGUI MCP 工具级开关设计

## 背景

当前 WebGUI 的 `StatusPopover` 在 MCP tab 仅支持 server 级状态展示与 server 级 connect/disconnect。一个 MCP server 下往往包含多个工具，但界面无法逐个工具开关。

同时，现有交互使用 `checkbox`，且仅对 server 刷新有基础禁用状态，缺少明确的提交态反馈。

## 目标

1. 在 `StatusPopover` 的 MCP tab 支持 **MCP 工具级开关**。
2. 将当前 MCP 勾选框交互统一替换为 **Switch** 组件语义。
3. 为工具开关与“手动刷新”按钮增加明确加载态（提交态）。
4. 开关写入 **项目级配置**，并在 **下一轮回复** 生效（不打断当前轮）。

## 非目标

1. 不新增独立设置页入口。
2. 不展示未连接 MCP 的工具占位。
3. 不引入会话级临时 override 存储。
4. 不重构权限系统，仅复用已有 `config.tools` 过滤链路。

## 已确认需求

1. 入口位置：`StatusPopover` MCP tab。
2. 配置作用域：项目级。
3. 展示范围：仅已连接 MCP server 的工具。
4. 动态生效：保存后下一轮回复生效。
5. 开关提交态：仅禁用当前点击的工具开关。
6. “手动刷新”按钮：需要加载态。

## 现状审计结论

### 前端

- `useStatusPopoverData.ts` 仅聚合 `sdk.mcp.status()`，没有工具清单接口。
- `StatusPopover.tsx` 的 MCP 开关使用 `input[type="checkbox"]`。
- 已存在 `mcpBusy` 与 `mcpRefreshing`，但粒度只覆盖 server 级切换和 MCP 状态刷新。

### 后端

- `routes/mcp.ts` 当前仅有 `status/add/auth/connect/disconnect`，无 `mcp tools` 查询路由。
- `MCP.tools()` 内部已存在可枚举工具与 canonical tool id（`<sanitized_server>_<sanitized_tool>`）。
- 工具可用性最终由 `session/llm.ts` 中 `input.user.tools?.[tool] === false` 过滤。

### 配置链路风险

- 项目配置读取链路以 `opencode.json/jsonc` 为主。
- `Config.update` 目前固定写 `config.json`，存在项目级落盘不一致风险。

## 方案选择

采用“**最小可行闭环**”方案：

1. 新增 MCP 工具枚举 API（按 server 维度）。
2. 修正项目级配置写入目标文件与读取链路一致。
3. WebGUI MCP tab 新增工具列表与工具级 Switch 开关。
4. 提交成功后提示“下一轮回复生效”，不打断当前轮。

不采用“纯前端猜测工具列表”或“另建运行时临时存储”方案，避免不可控与过度设计。

## 详细设计

### 1) 后端 API 设计

在 `packages/opencode/src/server/routes/mcp.ts` 新增：

- `GET /mcp/:name/tools`（`operationId: mcp.tools`）

返回结构（建议）：

```json
{
  "server": "playwright",
  "connected": true,
  "tools": [
    {
      "id": "playwright_browser_navigate",
      "name": "browser_navigate",
      "enabled": true
    }
  ]
}
```

规则：

1. server 未连接：`connected=false, tools=[]`（不抛 4xx，便于前端稳定渲染）。
2. `enabled` 由项目配置 `config.tools[id] !== false` 计算。

### 2) 项目级配置更新

在 `Config.update` 中修正写入行为：

1. 写入项目内当前优先级更高且生效的配置文件（`opencode.json` 优先，其次 `opencode.jsonc`）。
2. 若都不存在，再按既定默认策略创建（建议 `opencode.json`）。
3. 写入后保持现有实例失效逻辑（`Instance.dispose()`），确保下一轮请求加载新配置。

### 3) 前端状态与交互

在 `useStatusPopoverData.ts` 增加：

1. MCP server 对应工具数据结构：`Record<server, ToolItem[]>`。
2. 工具级提交态：`toolBusy: Record<"server/tool", boolean>`。
3. 动作：
   - `refreshMcpTools(server?)`
   - `toggleTool(server, toolId, enabled)`

并保留：

1. `mcpRefreshing`（仅控制“手动刷新”按钮加载态）。
2. `mcpBusy`（server connect/disconnect 可逐步迁移到统一 busy map）。

### 4) MCP tab UI 设计

在 `StatusPopover.tsx`：

1. server 行与 tool 行均使用 Switch 表达开/关，不再使用 checkbox。
2. 每个连接中 server 可展开工具列表；未连接 server 不展示工具列表。
3. 工具开关提交中仅禁用当前 tool 的 Switch。
4. “手动刷新”按钮进入 loading + disabled，结束后恢复。

### 5) 动态生效语义

1. 保存配置成功后，显示提示：`已保存，将在下一轮回复生效`。
2. 不中断当前进行中的回复。

## 错误处理

1. 工具开关失败：仅回滚当前工具状态并提示错误。
2. MCP 刷新失败：保持旧快照并标记 `stale`。
3. server 断连：工具区域自动收起并显示“连接后可查看工具”。

## 测试策略

### 前端

1. `useStatusPopoverData.test.tsx`
   - 新增工具列表拉取、工具级 busy 粒度、刷新按钮 loading 行为。
2. `StatusPopover.test.tsx`
   - 断言 MCP 行与工具行为 Switch 语义。
   - 断言工具提交态仅影响当前项。
   - 断言“手动刷新”按钮 loading/disabled。

### 后端

1. MCP 路由测试：`mcp.tools` 在 connected/disconnected 的返回契约，以及 `enabled` 映射正确性。
2. Config 测试：项目级 `Config.update` 写入目标文件正确，且不会落到无效路径。

## 验收标准

1. MCP tab 内所有开关均为 Switch 交互。
2. 已连接 MCP 能展示工具并逐个启用/禁用。
3. 工具开关加载态粒度为“仅当前工具”。
4. “手动刷新”按钮具备加载态。
5. 项目级配置写入正确，下一轮回复按新开关生效。
