# MCP 开关 HttpApi 路由补齐设计

## 背景

在 `packages/opencode/webgui` 的状态弹层里，点击 MCP server 开关后，UI 会显示“数据可能不是最新”，并且开关状态不会变化。浏览器抓包显示：

- 前端会发出 `PATCH /mcp/:name/enabled`
- 请求体形如 `{ "enabled": true }`
- 响应状态是 `200`
- 但响应体实际是整页 HTML，而不是 JSON

这表明请求没有命中真实 API handler，而是落入了 `/app` 的 fallback 页面。

进一步对照代码可以确认：

- 前端 `sdkClient.ts` 已实现：
  - `PATCH /mcp/:name/enabled`
  - `PATCH /mcp/:name/tools/:toolId`
- 后端 `McpApi` / `mcpHandlers` 当前只注册了：
  - `GET /mcp`
  - `POST /mcp`
  - `POST /mcp/:name/auth`
  - `POST /mcp/:name/auth/callback`
  - `POST /mcp/:name/auth/authenticate`
  - `DELETE /mcp/:name/auth`
  - `POST /mcp/:name/connect`
  - `POST /mcp/:name/disconnect`

缺失的正是：

- `PATCH /mcp/:name/enabled`
- `PATCH /mcp/:name/tools/:toolId`

因此当前问题的根因不是前端状态逻辑，而是 **后端 HttpApi 路由缺口**。

## 目标

1. 在 HttpApi 中补齐 MCP server enable/disable 路由。
2. 在 HttpApi 中补齐 MCP tool enable/disable 路由。
3. 让前端现有 `toggleMcp` / `toggleTool` 调用能够命中真实 JSON API，而不是落到 app fallback。
4. 补足自动化测试，把这组接口锁死，降低后续继续合并上游时的回归风险。

## 非目标

- 不调整 MCP 状态弹层的 UI 结构或文案。
- 不修改前端 `toggleMcp` / `toggleTool` 的业务流程，除非测试证明现有前端调用面与后端契约仍有错位。
- 不扩展 MCP 的 OAuth / connect / disconnect 语义；本次仅补齐 enable/disable 路由缺口。

## 方案对比

### 方案 A：只补 `PATCH /mcp/:name/enabled`

优点：

- 改动最小
- 直接修当前截图里的 server 开关问题

缺点：

- `PATCH /mcp/:name/tools/:toolId` 仍然缺失
- tool 开关将继续以相同方式坏掉

### 方案 B：同时补 server 开关与 tool 开关（采用）

优点：

- 一次补齐同组缺口
- 前端现有 MCP 开关能力整体闭环
- 测试也能把这两个接口一起锁住

缺点：

- 比只补 server 开关多两个 schema/handler 接线点，但复杂度仍然很低

### 方案 C：前端改回旧接口或走 connect/disconnect 替代

优点：

- 可以绕开当前路由缺口

缺点：

- 不是根因修复
- 会让前后端契约继续分叉
- 容易掩盖生成 SDK / HttpApi surface 已经声明了 PATCH 能力这一事实

## 选型结论

采用 **方案 B**：同时补齐：

- `PATCH /mcp/:name/enabled`
- `PATCH /mcp/:name/tools/:toolId`

并为这两个接口补齐后端测试与必要的前端调用回归。

## 根因分析

### 前端现状

`packages/opencode/webgui/src/lib/api/sdkClient.ts` 中已经存在：

- `mcpSetEnabled(...)` → `PATCH /mcp/:name/enabled`
- `mcpSetToolEnabled(...)` → `PATCH /mcp/:name/tools/:toolId`

`useStatusPopoverData.ts` 里也已经调用：

- `api.setEnabled(...)`
- `api.setToolEnabled(...)`

说明前端调用面是完整的。

### 后端现状

`packages/opencode/src/server/routes/instance/httpapi/groups/mcp.ts` 没有声明这两个 PATCH endpoint。`
packages/opencode/src/server/routes/instance/httpapi/handlers/mcp.ts` 也没有对应 `.handle(...)`。

因此：

1. 浏览器发出 PATCH 请求
2. HttpApi 路由树没有命中
3. 请求落入 `/app` fallback
4. 返回 HTML 200
5. 前端把这次操作视为失败并标记 stale

### 影响范围

不仅 server 开关受影响，tool 开关也存在同样缺口，只是当前截图先暴露了 server 开关问题。

## 设计

### 修改文件

- `packages/opencode/src/server/routes/instance/httpapi/groups/mcp.ts`
- `packages/opencode/src/server/routes/instance/httpapi/handlers/mcp.ts`
- `packages/opencode/test/server/httpapi-exercise/index.ts`（如当前 route coverage 需要覆盖）
- `packages/opencode/test/server/httpapi-provider.test.ts` 或更合适的 MCP HttpApi 测试文件
- `packages/opencode/webgui/src/components/CompactHeader/useStatusPopoverData.test.tsx`（如需要补前端回归）

### 路由设计

补充两个 endpoint：

1. `PATCH /mcp/:name/enabled`
   - params: `{ name: string }`
   - payload: `{ enabled: boolean }`
   - success: `boolean`

2. `PATCH /mcp/:name/tools/:toolId`
   - params: `{ name: string; toolId: string }`
   - payload: `{ enabled: boolean }`
   - success: `boolean`

### handler 设计

#### server 开关

直接接到：

- `mcp.setEnabled(name, enabled)`

返回 `true`。

#### tool 开关

直接接到：

- `mcp.setToolEnabled(toolId, enabled)`

返回 `true`。

这里优先保持最小实现，不引入额外业务语义扩展。

### 前端兼容性

由于前端已经在使用这两个 PATCH 接口，因此这次理论上**不需要改前端业务代码**。修复后前端已有逻辑应自然恢复：

- PATCH 成功
- `refreshMcp()` 再次拉状态
- MCP 列表刷新
- stale 提示消失

若测试显示返回体 shape 与前端期望仍有错位，再做最小兼容调整。

## 测试设计

### 后端测试

必须至少覆盖：

1. `PATCH /mcp/:name/enabled` 命中真实 handler，而不是 fallback
2. `PATCH /mcp/:name/tools/:toolId` 命中真实 handler，而不是 fallback
3. 路由成功返回 JSON `true`
4. MCP 状态/工具状态后续刷新链路可继续工作

### 覆盖锁定

如当前 `httpapi-exercise` 使用“缺 scenario 即失败”的覆盖模型，则需要把：

- `mcp.enabled`
- `mcp.tool.enabled`

对应场景加入 exerciser，避免后续 merge 上游再次漏掉。

### 前端测试

如有必要，在 `useStatusPopoverData.test.tsx` 补充：

- `toggleMcp` 成功后会调用 `sdk.mcp.setEnabled(...)` 并刷新 MCP 状态
- `toggleTool` 成功后会调用 `sdk.mcp.setToolEnabled(...)` 并刷新 MCP 状态

重点不是重测整个 UI，而是锁定这两个调用链还连着真实 SDK surface。

## 风险与控制

### 风险 1：只补 server 开关，tool 开关继续坏

本次通过方案 B 一并解决，避免留下对称漏洞。

### 风险 2：PATCH 返回 shape 与前端期望仍不一致

这是低风险，因为前端当前只检查 `res.error`，成功分支并不依赖复杂 payload。若实测仍有问题，再做最小兼容调整。

### 风险 3：后续合并上游再次漏掉这组路由

通过：

- HttpApi 路由测试
- `httpapi-exercise` 覆盖场景
- 必要的前端 hook 测试

三层一起锁定。

## 验证策略

修复后验证：

1. 浏览器网络：
   - `PATCH /mcp/:name/enabled` 返回 JSON，不再返回 HTML
   - `PATCH /mcp/:name/tools/:toolId` 返回 JSON

2. 浏览器行为：
   - 点击 MCP server 开关后，状态应变化或进入后端真实返回的状态
   - stale 提示不再由路由缺口触发

3. 自动化测试：
   - 相关后端 HttpApi 测试通过
   - 如纳入 `httpapi-exercise`，其对应场景通过
   - 必要时前端 hook 测试通过

## 完成标准

满足以下条件即可视为完成：

1. `PATCH /mcp/:name/enabled` 已在 HttpApi 中真实注册并命中 handler。
2. `PATCH /mcp/:name/tools/:toolId` 已在 HttpApi 中真实注册并命中 handler。
3. 点击 MCP 开关后，不再返回 HTML fallback 页面。
4. 至少一层后端自动化测试锁住这两个路由。
5. 如当前 coverage 机制要求，`httpapi-exercise` 已补齐对应场景。
6. 本次改动未扩散到无关 UI 逻辑。
