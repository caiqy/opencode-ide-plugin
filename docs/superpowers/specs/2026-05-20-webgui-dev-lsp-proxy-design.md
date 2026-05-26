# WebGUI 开发环境 LSP 代理修复设计

## 背景

在 `packages/opencode/webgui` 的开发环境中，状态弹层会请求多个同源接口，包括 `/mcp`、`/skill`、`/path`、`/project/current`、`/lsp` 等。当前浏览器实测表明：

- `/mcp` 返回 `200`
- `/skill` 返回 `200`
- `/path` 返回 `200`
- `/project/current` 返回 `200`
- `/lsp` 返回 `404`

其中 `/lsp` 的响应正文提示：

> The server is configured with a public base URL of /app - did you mean to visit /app/lsp instead?

这说明前端 `fetch("/lsp")` 时，请求没有像 `/mcp`、`/skill` 一样被 Vite dev server 代理到后端，而是落到了错误的目标。当前任务只修复这一层 **dev 代理漏配**，不处理状态弹层的 UI 呈现逻辑。

## 目标

1. 修复 WebGUI 开发环境中 `/lsp` 请求未被代理的问题。
2. 一并检查并补齐同类并列接口 `/formatter`，避免留下相同的 dev-only 漏配。
3. 补充自动化测试，把这两个代理根锁死，降低后续继续合并上游时的回归风险。
4. 保持现有 UI 逻辑与状态聚合逻辑不变，只消除开发环境代理问题。

## 非目标

- 不调整 `StatusPopover` 或 `useStatusPopoverData` 的状态聚合逻辑。
- 不修改 MCP、Skills、LSP tab 的错误展示文案。
- 不处理生产构建或后端路由行为，只修复 `vite serve` 下的开发代理。

## 方案对比

### 方案 A：只补 `/lsp`

优点：

- 改动最小
- 直接修当前已观测到的 404

缺点：

- `/formatter` 与 `/lsp` 属于同组接口，如果当前未触发，将来仍可能踩到同类问题

### 方案 B：补 `/lsp`，并同步补 `/formatter`（采用）

优点：

- 仍然是最小改动
- 同时覆盖同组并列接口，避免留下对称漏洞

缺点：

- 比只补 `/lsp` 多一个代理 root，但复杂度几乎不变

### 方案 C：改前端请求地址，显式请求 `/app/lsp`

优点：

- 可以绕开代理配置问题

缺点：

- 会让 dev 调用面与其他同类接口不一致
- 不是根因修复
- 更容易把“代理职责”错误地下沉到业务代码

## 选型结论

采用 **方案 B**：在 `vite.config.ts` 的开发代理白名单中补上 `/lsp`，并同步补上 `/formatter`。

## 根因分析

`packages/opencode/webgui/vite.config.ts` 通过 `proxyRoots` 定义需要代理到后端的路径。当前列表中包含：

- `/mcp`
- `/skill`
- `/path`
- `/project`
- `/provider`
- `/session`
- 其他若干根路径

但缺少：

- `/lsp`
- `/formatter`

因此在 `vite serve` 下：

- `fetch("/mcp")` 被代理，正常返回
- `fetch("/skill")` 被代理，正常返回
- `fetch("/lsp")` 未被代理，命中错误目标并返回 `404`

这属于典型的 **dev proxy 漏配**，不是后端 `LSP` handler 缺失，也不是 SDK/前端业务逻辑本身错误。

## 设计

### 修改文件

- `packages/opencode/webgui/vite.config.ts`
- `packages/opencode/webgui/vite.config.test.ts`

### 修改内容

在 `proxyRoots` 中加入：

- `/lsp`
- `/formatter`

并在 `vite.config.test.ts` 中补充两类断言：

1. **存在性断言**
   - `proxy["/lsp"]` 存在
   - `proxy["/formatter"]` 存在
   - 它们的 `target` 与 backend discovery 结果一致

2. **语义化断言**
   - `/lsp`、`/formatter` 与 `/mcp`、`/skill` 一样，统一来自 `proxyRoots.map((root) => proxyEntry(...))` 生成的代理表
   - 不允许通过单独分支、临时对象 merge、后置手工补丁等方式拼进去
   - 这样能把“代理根白名单”作为一个集中契约锁住，而不是只锁住某两个键碰巧存在

保持以下内容不变：

- `proxyEntry(...)` 的代理行为
- `directoryOverride` 注入逻辑
- `ws` 规则
- 其他已存在代理根路径

### 设计原则

1. 修根因，不改业务请求代码。
2. 保持同组接口代理策略一致。
3. 不把 dev-only 问题扩散到前端状态逻辑层。

## 数据流影响

修复前：

- 前端状态弹层请求 `/lsp`
- Vite 未代理
- 请求打到错误目标，返回 `404`

修复后：

- 前端状态弹层请求 `/lsp`
- Vite 将其代理到后端地址
- 后端 `HttpApi` 正常返回 `LSP` 状态数据

`/formatter` 同理。

## 风险与控制

### 风险 1：只修代理后，页面仍有误导性 UI 提示

这是可接受风险，因为本次任务明确 **不处理 UI 呈现层**。如果修完代理后仍有误导性提示，再作为第二阶段问题单独处理。

### 风险 2：补 `/formatter` 后暴露后端其他问题

这也属于可接受范围，因为它能尽早暴露真实后端状态，而不是继续被代理缺失掩盖。

### 风险 3：只修配置、不补测试，后续合并上游再次漏掉代理根

这是本次明确要避免的问题，因此必须通过 `vite.config.test.ts` 增加回归测试，把：

- `/lsp`
- `/formatter`
- 以及“它们与 `/mcp`、`/skill` 同样来自统一代理表”

一起锁住。

## 验证策略

修复后验证：

1. 浏览器网络面：
   - `GET /lsp` 不再 `404`
   - `GET /formatter` 如被触发，应正常代理

2. 页面行为：
   - 打开状态弹层后，不再因为 `/lsp` dev 代理漏配而报错

3. 自动化回归：
   - 运行 `packages/opencode/webgui/vite.config.test.ts`
   - 确认 `/lsp`、`/formatter` 代理根存在
   - 确认它们与 `/mcp`、`/skill` 同样进入统一代理表

4. 必要时补局部检查：
   - 以浏览器实测和最小构建/类型检查作为补充证据

## 完成标准

满足以下条件即可视为完成：

1. `packages/opencode/webgui/vite.config.ts` 已补上 `/lsp` 代理根。
2. `/formatter` 也已同步补齐，避免同类漏配。
3. `packages/opencode/webgui/vite.config.test.ts` 已新增回归断言，锁定 `/lsp` 与 `/formatter`。
4. 测试还需证明这两个路径与 `/mcp`、`/skill` 一样进入统一代理表，而不是临时分支拼接。
5. 浏览器实测下 `GET /lsp` 不再返回 `404`。
6. 本次改动未扩散到状态弹层 UI 逻辑。
