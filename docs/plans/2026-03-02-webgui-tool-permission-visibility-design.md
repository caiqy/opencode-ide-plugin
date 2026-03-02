# WebGUI 工具授权可见性与绑定一致性设计

## 背景

当前 WebGUI 在 ToolPart 中将 `read/glob/list/grep/webfetch` 归类为 header-only（不可展开）。
同时，授权入口 `PermissionBanner` 仅在展开内容区渲染，导致这些工具一旦触发权限询问，UI 只显示黄色边框但无法点击授权按钮，形成“卡住”体验。

此外，后端存在部分 `PermissionNext.ask(...)` 调用未携带 `tool.callID` 的情况，前端按 `sessionID + callID` 关联权限请求时会出现无法精准挂载到对应 ToolPart 的风险。

## 目标

1. 修复 header-only 工具的授权可见性问题，确保用户可直接完成授权。
2. 统一工具权限请求的事件绑定语义：所有工具触发的 permission.asked 均携带 `tool.messageID/callID`。
3. 通过测试建立回归防线，避免未来同类退化。

## 非目标

1. 不引入全局“权限中心”新交互模块。
2. 不重构 ToolPart 的整体展示架构（仅做最小必要改动）。
3. 不调整权限策略本身（allow/ask/deny 规则不变）。

## 方案比较

### 方案 A：最小热修

- 将 header-only 工具改为可展开，从而复用现有展开区中的 PermissionBanner。
- 优点：改动小。
- 缺点：授权展示耦合到展开机制，长期可维护性弱。

### 方案 B：职责解耦 + 绑定补全（采纳）

- 前端：将 PermissionBanner 从“展开区依赖”中解耦，存在权限请求时独立展示。
- 后端：补齐 `doom_loop` 与 `task` 路径的 `tool.callID` 绑定。
- 优点：修复根因、边界清晰、兼容现有 UI 结构。

### 方案 C：全局权限中心

- 新建全局待授权面板，统一管理全部 pending permission。
- 优点：长期扩展好。
- 缺点：实现与迁移成本高，超出本次问题范围。

## 采纳方案设计（B）

### 前端设计

文件：`packages/opencode/webgui/src/components/parts/ToolPart/index.tsx`

1. 保持 header-only 定义不变（`read/glob/list/grep/webfetch` 仍不可展开）。
2. `permission && <PermissionBanner ... />` 不再放在 `shouldShowExpandedContent` 内。
3. 改为放置在 ToolHeader 之后的独立区域，确保是否可展开不影响授权交互。
4. 保持 `respondPermission` 行为不变，避免影响已有授权提交逻辑。

### 后端设计

目标：降低遗漏风险，统一“工具权限请求绑定”构造方式。

新增：`packages/opencode/src/session/tool-permission.ts`

- 提供统一构造函数，将 `sessionID + messageID + callID + ruleset + req` 组装为 `PermissionNext.ask` 入参。
- 使用强类型约束，避免后续调用点手写漏字段。

改造：

1. `packages/opencode/src/session/prompt.ts`
   - `context.ask` 与 `taskCtx.ask` 都改为通过统一构造函数调用。
2. `packages/opencode/src/session/processor.ts`
   - `doom_loop` 分支改为统一构造函数，并显式绑定当前工具 `callID`。

## 测试策略

### WebGUI 回归

文件：`packages/opencode/webgui/src/components/parts/ToolPart/index.test.tsx`

新增用例：

1. header-only 工具（例如 `glob`）在存在权限请求时展示 `PermissionBanner`。
2. 点击 `Accept once/Always/Reject` 会调用 `respondPermission(permission.id, reply)`。

### 会话层回归

新增文件：`packages/opencode/test/session/tool-permission.test.ts`

新增用例：

1. 统一构造函数会输出包含 `tool.messageID/callID` 的 ask payload。
2. 保留原 `permission/patterns/metadata/always/ruleset`，不改变业务语义。

## 风险与缓解

1. **风险：** 权限 Banner 提前显示影响视觉层级。
   - **缓解：** 仅在 `permission` 存在时展示，样式沿用现有 Banner。
2. **风险：** 后端绑定补齐引发类型不兼容。
   - **缓解：** 通过统一 helper + 测试收敛调用格式。
3. **风险：** 改动点跨前后端导致回归面增加。
   - **缓解：** 前端交互回归 + 会话层构造函数单测双重覆盖。

## 验收标准

1. `read/glob/list/grep/webfetch` 触发权限时，可直接看到并操作授权按钮，不再卡住。
2. `doom_loop` 与 `task` 路径发出的 permission 请求可稳定关联至具体工具调用。
3. 新增测试通过，现有相关测试不回归。
