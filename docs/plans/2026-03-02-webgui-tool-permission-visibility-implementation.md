# WebGUI 工具授权可见性与绑定一致性 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复 header-only 工具授权不可见与后端部分权限事件缺少 tool 绑定的问题，确保授权可交互且可定位。

**Architecture:** 前端将 PermissionBanner 从展开区依赖中解耦，改为 ToolHeader 后独立渲染；后端新增会话层统一权限请求构造函数，集中注入 `tool.messageID/callID`，并替换 prompt/processor 调用点。通过前端交互测试与会话层单测形成回归保护。

**Tech Stack:** React + Vitest（webgui），Bun Test（opencode），TypeScript。

---

### Task 1: 修复 ToolPart 权限展示位置（前端）

**Files:**

- Modify: `packages/opencode/webgui/src/components/parts/ToolPart/index.tsx`
- Test: `packages/opencode/webgui/src/components/parts/ToolPart/index.test.tsx`

**Step 1: 写失败测试（header-only 也能显示权限）**

在 `index.test.tsx` 新增用例：`glob` + `getPermissionForCall` 返回 permission 时，页面出现 `Permission required to run this tool`。

**Step 2: 运行测试，确认失败**

Run（在 `packages/opencode/webgui`）：
`bun run test:run src/components/parts/ToolPart/index.test.tsx`

Expected: FAIL（当前 header-only 工具看不到 PermissionBanner）。

**Step 3: 最小实现**

在 `index.tsx` 中将 `PermissionBanner` 从 expanded content 内移到 ToolHeader 下方独立区域，保留现有 `onRespond` 逻辑。

**Step 4: 运行测试，确认通过**

Run（在 `packages/opencode/webgui`）：
`bun run test:run src/components/parts/ToolPart/index.test.tsx`

Expected: PASS。

**Step 5: 增加交互测试（按钮 -> respondPermission）**

新增用例验证点击 `Accept once/Always/Reject` 分别触发：

- `respondPermission(permission.id, "once")`
- `respondPermission(permission.id, "always")`
- `respondPermission(permission.id, "reject")`

### Task 2: 统一会话层工具权限请求绑定（后端）

**Files:**

- Create: `packages/opencode/src/session/tool-permission.ts`
- Modify: `packages/opencode/src/session/prompt.ts`
- Modify: `packages/opencode/src/session/processor.ts`
- Test: `packages/opencode/test/session/tool-permission.test.ts`

**Step 1: 写失败测试（构造函数必须包含 tool 绑定）**

在新测试文件中先定义期望：构造输出必须含 `tool.messageID` 与 `tool.callID`，并保持原请求字段透传。

**Step 2: 运行测试，确认失败**

Run（在 `packages/opencode`）：
`bun test test/session/tool-permission.test.ts`

Expected: FAIL（helper 尚不存在）。

**Step 3: 实现统一构造函数**

在 `tool-permission.ts` 增加纯函数，输入 `req/sessionID/messageID/callID/ruleset`，输出 `PermissionNext.ask` 入参对象。

**Step 4: 替换调用点**

- `prompt.ts`：`context.ask`、`taskCtx.ask` 改为通过 helper 构造 payload。
- `processor.ts`：`doom_loop` 的 `PermissionNext.ask` 改为 helper，并使用当前 tool 的 `callID`。

**Step 5: 运行测试，确认通过**

Run（在 `packages/opencode`）：
`bun test test/session/tool-permission.test.ts`

Expected: PASS。

### Task 3: 端到端回归检查

**Files:**

- Test: `packages/opencode/webgui/src/components/parts/ToolPart/index.test.tsx`
- Test: `packages/opencode/test/session/tool-permission.test.ts`

**Step 1: 运行前端相关测试**

Run（在 `packages/opencode/webgui`）：
`bun run test:run src/components/parts/ToolPart/index.test.tsx`

Expected: PASS。

**Step 2: 运行后端相关测试**

Run（在 `packages/opencode`）：
`bun test test/session/tool-permission.test.ts`

Expected: PASS。

**Step 3: 运行跨层最小回归**

Run（在 `packages/opencode/webgui`）：
`bun run test:run src/state/MessagesContext.reasoning.test.tsx src/components/parts/ToolPart/index.test.tsx`

Expected: PASS（消息上下文权限能力未回归）。
