# WebGUI 状态点弹层对齐 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 CompactHeader 的状态点升级为可交互状态弹层入口，在 WebGUI 中对齐 app 端的状态信息浏览体验。

**Architecture:** 方案继续在 `packages/opencode/webgui/src/components/CompactHeader` 内局部闭环，但首版先收紧为仓库现有 API 真能支撑的能力。新增一个本地状态适配层（例如 `useStatusPopoverData.ts`）统一聚合 `connectionState`、`ideBridge`、`sdk.mcp.status()`、`sdk.lsp.status()`、`sdk.config.get()`、`sdk.project.current()`、`sdk.path.get()`，并明确拆成两层语义：SSE 传输状态继续沿用 `connectionState`，分区级 / 弹层级数据状态单独表达 `ready/empty/failed/stale`；`status.ts` 只做 tab 顺序与 view model 映射，`StatusPopover.tsx` 负责自身交互语义（含 Escape、外部点击、focus restore）并通过 hook 暴露的 action 触发 MCP 操作，其中 `Esc` 与再次点击触发器关闭后回到状态点按钮，外部点击关闭时保持焦点落在用户点击目标；`CompactHeader/index.tsx` 只负责 open 状态接线与右侧浮层互斥。

**Tech Stack:** React、TypeScript、Vitest、Testing Library、`sdk.mcp.status/connect/disconnect`、`sdk.lsp.status()`、`sdk.config.get()`、`sdk.project.current()`、`sdk.path.get()`。

---

### Task 1: 让状态点成为可交互触发器

**Files:**

- Modify: `packages/opencode/webgui/src/components/CompactHeader/StatusIndicator.tsx`
- Test: `packages/opencode/webgui/src/components/CompactHeader/StatusIndicator.test.tsx`

**Step 1: 写失败测试**

在 `StatusIndicator.test.tsx` 先把当前只校验 tooltip 的用例扩成触发器契约测试：状态点应渲染为可点击 `button`，保留中文 tooltip，暴露 `aria-haspopup="dialog"`、`aria-expanded`、`aria-controls`，并通过稳定 id 关联到弹层；同时覆盖点击和键盘触发都会调用 `onToggle`。

**Step 2: 运行测试确认失败**

Run (workdir=`packages/opencode/webgui`):

```bash
bun run test:run src/components/CompactHeader/StatusIndicator.test.tsx -t "状态点作为弹层触发器"
```

Expected: FAIL（当前组件还是纯 `div`，没有交互语义，也没有 `onToggle`）。

**Step 3: 写最小实现**

把 `StatusIndicator.tsx` 改成 button 触发器组件，只先支持最小能力：接收 `connectionState`、`open`、`onToggle`，保留原有颜色和 pulse 逻辑，不引入弹层内容本身。

**Step 4: 再跑测试确认通过**

Run (workdir=`packages/opencode/webgui`):

```bash
bun run test:run src/components/CompactHeader/StatusIndicator.test.tsx
```

Expected: PASS。

**Step 5: Commit**

```bash
git add packages/opencode/webgui/src/components/CompactHeader/StatusIndicator.tsx packages/opencode/webgui/src/components/CompactHeader/StatusIndicator.test.tsx
git commit -m "feat(webgui): make status indicator interactive"
```

---

### Task 2: 收敛本地状态适配层

**Files:**

- Create: `packages/opencode/webgui/src/components/CompactHeader/useStatusPopoverData.ts`
- Create: `packages/opencode/webgui/src/components/CompactHeader/useStatusPopoverData.test.tsx`

**Step 1: 写失败测试**

在 `useStatusPopoverData.test.tsx` 先定义状态聚合契约，覆盖这些首版能力：

1. `refreshAll()` 只在弹层从关闭变打开时触发一次，同一轮里会聚合 `connectionState`、`ideBridge` 已安装/是否 ready、`sdk.mcp.status()`、`sdk.lsp.status()`、`sdk.config.get()`、`sdk.project.current()`、`sdk.path.get()`；tab 切换本身不自动重拉。
2. `servers` 数据只产出 OpenCode SSE 连接状态、IDE bridge 状态、project/path 摘要，不出现多 server 管理字段。
3. `useStatusPopoverData` 要同时产出两层状态：SSE 传输层继续暴露 `connectionState`，`servers/mcp/lsp/plugins` 四个分区再各自暴露 `ready/empty/failed/stale` 之类的数据状态，不能把局部请求失败、旧快照陈旧和 SSE 连接错误混成一个字段。
4. 同一次刷新里各数据源独立结算：单个 tab 失败不会阻塞其它 tab 成功落地，hook 要分别保留 `servers/mcp/lsp/plugins` 的最近成功快照与各自错误，而不是一次整体失败。
5. 首次成功后再次刷新失败时，只把对应分区标成 `stale` 并保留旧快照，供 UI 显示“数据可能不是最新”；只有 SSE 传输本身异常时，才通过 `connectionState.error` 反映连接问题。
6. MCP 提供单独 `refreshMcp()` 与 `toggleMcp(name)` action，不会顺手重拉 `servers/lsp/plugins`，也不让 `StatusPopover` 直接调用 `sdk.mcp.connect/disconnect`。

**Step 2: 运行测试确认失败**

Run (workdir=`packages/opencode/webgui`):

```bash
bun run test:run src/components/CompactHeader/useStatusPopoverData.test.tsx
```

Expected: FAIL（`useStatusPopoverData.ts` 尚不存在）。

**Step 3: 写最小实现**

新增 `useStatusPopoverData.ts`，把状态拉取和本地快照都收敛在这里：统一装配 `connectionState`、IDE bridge 摘要、`mcp/lsp/plugins`、`project/path`，并暴露 `refreshAll()`、`refreshMcp()`、`toggleMcp(name)`、SSE 传输状态以及分区级 `ready/empty/failed/stale/error/updatedAt`。这里不要引入 UI JSX，也不要让各 tab 直接各自发请求；实现上用独立 settle 流保住单分区失败不拖垮整轮结果，并给 MCP 结果补统一时序保护，避免 `refreshAll()` 覆盖更晚完成的 `refreshMcp()` / `toggleMcp(name)` 结果。

**Step 4: 再跑测试确认通过**

Run (workdir=`packages/opencode/webgui`):

```bash
bun run test:run src/components/CompactHeader/useStatusPopoverData.test.tsx
```

Expected: PASS。

**Step 5: Commit**

```bash
git add packages/opencode/webgui/src/components/CompactHeader/useStatusPopoverData.ts packages/opencode/webgui/src/components/CompactHeader/useStatusPopoverData.test.tsx
git commit -m "feat(webgui): add status popover data adapter"
```

---

### Task 3: 收敛四个 tab 的视图模型

**Files:**

- Create: `packages/opencode/webgui/src/components/CompactHeader/status.ts`
- Create: `packages/opencode/webgui/src/components/CompactHeader/status.test.ts`

**Step 1: 写失败测试**

在 `status.test.ts` 先定义纯函数规则，覆盖这些边界：

1. tab 顺序固定为 `servers -> mcp -> lsp -> plugins`，默认 tab 是 `servers`。
2. `buildServerView()` 只映射 OpenCode SSE 连接状态、IDE bridge 状态、project/path 摘要，不出现 server 列表、切换、增删管理文案。
3. `buildPluginView()` 只基于 `sdk.config.get()` 里的 `config.plugin[]` 产出“已配置插件”列表，空态与失败态可见，但不承诺运行态或异常态。
4. `buildLspView()` 只基于 `sdk.lsp.status()` 产出“已连接 LSP”列表，空态与失败态可见，但不承诺更细状态。
5. `buildMcpView()` 保留开关和局部刷新需要的 view model，但文案明确是“手动刷新”而不是实时推送。

**Step 2: 运行测试确认失败**

Run (workdir=`packages/opencode/webgui`):

```bash
bun run test:run src/components/CompactHeader/status.test.ts
```

Expected: FAIL（`status.ts` 尚不存在）。

**Step 3: 写最小实现**

新增 `status.ts`，只放纯映射逻辑，不放 React 组件。这里统一定义 tab 元数据、badge/文案、servers/lsp/plugins/mcp 的 view model helper，保证 `StatusPopover.tsx` 后续只做渲染和事件处理，并把 SSE 连接语义与分区数据状态文案分开映射。

**Step 4: 再跑测试确认通过**

Run (workdir=`packages/opencode/webgui`):

```bash
bun run test:run src/components/CompactHeader/status.test.ts
```

Expected: PASS。

**Step 5: Commit**

```bash
git add packages/opencode/webgui/src/components/CompactHeader/status.ts packages/opencode/webgui/src/components/CompactHeader/status.test.ts
git commit -m "feat(webgui): add status popover view models"
```

---

### Task 4: 搭出弹层与只读面板

**Files:**

- Create: `packages/opencode/webgui/src/components/CompactHeader/StatusPopover.tsx`
- Create: `packages/opencode/webgui/src/components/CompactHeader/StatusPopover.test.tsx`
- Modify: `packages/opencode/webgui/src/components/CompactHeader/useStatusPopoverData.ts`
- Modify: `packages/opencode/webgui/src/components/CompactHeader/status.ts`

**Step 1: 写失败测试**

在 `StatusPopover.test.tsx` 先写结构和可访问性测试，不碰 MCP 写操作：

1. 默认展示四个 tab，顺序严格是 `servers`、`mcp`、`lsp`、`plugins`，默认选中 `servers`。
2. `servers` 面板展示 SSE 连接状态、IDE bridge 状态、project/path 摘要。
3. `plugins` 面板只展示已配置插件列表，`lsp` 面板只展示已连接 LSP 列表。
4. 打开弹层时触发一次 `refreshAll()`，tab 切换只切 view 不自动重拉。
5. 旧快照存在且新请求失败时，按分区显示陈旧提示或数据失败，而不是把局部失败描述成“连接错误”或整窗清空。
6. 支持 tab 键聚焦、方向键切 tab、Escape 关闭，关键节点有 `dialog` / `tablist` / `tabpanel` 语义，`tab` 与 `tabpanel` 之间有稳定 id / `aria-controls` / `aria-labelledby` 关联。
7. 通过 `Esc`、再次点击触发器关闭后，焦点回到状态点按钮；外部点击关闭时不强制回焦，保持在用户点击目标，且这些关闭语义由 `StatusPopover` 自身负责，不依赖 header 重复实现。

**Step 2: 运行测试确认失败**

Run (workdir=`packages/opencode/webgui`):

```bash
bun run test:run src/components/CompactHeader/StatusPopover.test.tsx -t "渲染四个状态 tab"
```

Expected: FAIL（`StatusPopover.tsx` 尚不存在）。

**Step 3: 写最小实现**

新增 `StatusPopover.tsx`，先只实现最小可读版本：使用本地 state 控制当前 tab，打开时触发一次 `refreshAll()`，切 tab 不重拉；调用 `useStatusPopoverData` 和 `status.ts` 渲染四个面板，把 SSE 连接状态与分区 stale/empty/failed 提示分别接出来，并由组件自身处理 `Esc`、外部点击、再次点击触发器关闭后的 focus restore，其中 `Esc` 与再次点击触发器关闭后把焦点送回状态点按钮，外部点击关闭时不改写用户当前点击目标，但先不接 MCP 开关与刷新。

**Step 4: 再跑测试确认通过**

Run (workdir=`packages/opencode/webgui`):

```bash
bun run test:run src/components/CompactHeader/StatusPopover.test.tsx
```

Expected: PASS（至少通过四 tab、默认 servers、陈旧提示、键盘交互基础用例）。

**Step 5: Commit**

```bash
git add packages/opencode/webgui/src/components/CompactHeader/StatusPopover.tsx packages/opencode/webgui/src/components/CompactHeader/StatusPopover.test.tsx packages/opencode/webgui/src/components/CompactHeader/useStatusPopoverData.ts packages/opencode/webgui/src/components/CompactHeader/status.ts
git commit -m "feat(webgui): add status popover shell"
```

---

### Task 5: 补齐 MCP 开关与局部刷新

**Files:**

- Modify: `packages/opencode/webgui/src/components/CompactHeader/StatusPopover.tsx`
- Modify: `packages/opencode/webgui/src/components/CompactHeader/StatusPopover.test.tsx`
- Modify: `packages/opencode/webgui/src/components/CompactHeader/useStatusPopoverData.ts`
- Modify: `packages/opencode/webgui/src/components/CompactHeader/status.ts`

**Step 1: 写失败测试**

继续在 `StatusPopover.test.tsx` 增加 MCP 交互测试，粒度尽量小：

1. 初次打开后的 `refreshAll()` 会拉一次 `sdk.mcp.status()` 并显示连接态。
2. 点击某个 MCP switch 时，`StatusPopover` 只调用 `useStatusPopoverData` 暴露的 `toggleMcp(name)`，不直接碰 `sdk.mcp.connect/disconnect`。
3. 操作成功后只局部刷新 MCP 区域，再次调用 `refreshMcp()` / `sdk.mcp.status()`，不重新拉取 `lsp/plugins/servers`。
4. 被配置或上下文限制的 MCP 项仍显示，但 switch 禁用，并附原因说明。
5. refresh button 明确表示手动刷新，不暗示实时推送。

**Step 2: 运行测试确认失败**

Run (workdir=`packages/opencode/webgui`):

```bash
bun run test:run src/components/CompactHeader/StatusPopover.test.tsx -t "MCP 开关"
```

Expected: FAIL（当前 `mcp` tab 还没有开关与局部 refresh）。

**Step 3: 写最小实现**

在 `StatusPopover.tsx` 里补 `mcp` 专用数据流：每个 MCP 行增加 switch，tab 内增加局部 refresh button，switch 只调用 `toggleMcp(name)`，refresh button 只调用 `refreshMcp()`，并继续通过 `status.ts` 统一 connected/disconnected/disabled/error 文案；SDK 细节留在 `useStatusPopoverData.ts` 内部。

**Step 4: 再跑测试确认通过**

Run (workdir=`packages/opencode/webgui`):

```bash
bun run test:run src/components/CompactHeader/StatusPopover.test.tsx
```

Expected: PASS（MCP 开关、局部刷新、禁用说明全部通过）。

**Step 5: Commit**

```bash
git add packages/opencode/webgui/src/components/CompactHeader/StatusPopover.tsx packages/opencode/webgui/src/components/CompactHeader/StatusPopover.test.tsx packages/opencode/webgui/src/components/CompactHeader/useStatusPopoverData.ts packages/opencode/webgui/src/components/CompactHeader/status.ts
git commit -m "feat(webgui): add mcp controls to status popover"
```

---

### Task 6: 在 CompactHeader 接线并守住回归面

**Files:**

- Modify: `packages/opencode/webgui/src/components/CompactHeader/index.tsx`
- Modify: `packages/opencode/webgui/src/components/CompactHeader/index.test.tsx`
- Modify: `packages/opencode/webgui/src/components/CompactHeader/index.integration.test.tsx`
- Modify: `packages/opencode/webgui/src/components/CompactHeader/ActionButtons.tsx`
- Modify: `packages/opencode/webgui/src/components/CompactHeader/ActionButtons.test.tsx`
- Modify: `packages/opencode/webgui/src/components/CompactHeader/StatusIndicator.tsx`
- Modify: `packages/opencode/webgui/src/components/CompactHeader/StatusIndicator.test.tsx`
- Modify: `packages/opencode/webgui/src/components/CompactHeader/StatusPopover.test.tsx`
- Modify: `packages/opencode/webgui/src/components/OfflineBanner.test.tsx`

**Step 1: 写失败测试**

在 `index.test.tsx` 和 `index.integration.test.tsx` 增加 header 接线回归测试，确保：

- 点击状态点会打开/关闭 `StatusPopover`
- 默认打开后选中的是 `servers` tab
- 打开状态弹层后，不影响现有 `ActionButtons`、tab 切换和删除确认逻辑
- header 右侧浮层保持互斥：打开 `StatusPopover` 时会关闭 `SessionDropdown` 和 `ActionButtons` 的更多菜单；重新打开这些右侧浮层时也会关闭 `StatusPopover`
- header 右侧布局仍保留状态点、更多菜单、新建会话按钮

同时在 `StatusIndicator.test.tsx` 补一个“打开时 `aria-expanded=true` 且 `aria-controls` 指向弹层 id”的集成断言，避免只测 click 不测状态同步；测试文案要明确这里同步的是弹层开合与 SSE 连接状态展示，不把某个 tab 的请求失败写成连接错误。在 `StatusPopover.test.tsx` 补关闭回焦回归断言：`Esc`、再次点击触发器关闭后焦点回到触发器，外部点击关闭时保持在用户点击目标，并把局部失败描述成分区数据失败或 stale；在 `OfflineBanner.test.tsx` 补一条回归断言，确认本次改造不改变 `OfflineBanner` 现有触发条件，且局部数据失败不会误触发离线横幅。

**Step 2: 运行测试确认失败**

Run (workdir=`packages/opencode/webgui`):

```bash
bun run test:run src/components/CompactHeader/index.test.tsx src/components/CompactHeader/index.integration.test.tsx src/components/CompactHeader/ActionButtons.test.tsx src/components/CompactHeader/StatusIndicator.test.tsx src/components/CompactHeader/StatusPopover.test.tsx src/components/OfflineBanner.test.tsx
```

Expected: FAIL（`CompactHeader/index.tsx` 还没有弹层状态与挂载逻辑）。

**Step 3: 写最小实现**

在 `CompactHeader/index.tsx` 增加局部 `open` state，把 `StatusIndicator` 和 `StatusPopover` 接起来，并把弹层挂在 header 右侧区域，保证：

- 不改动现有 session / action / restart / share 逻辑
- 弹层默认关闭，点击状态点切换
- `CompactHeader/index.tsx` 只负责 open 状态接线，以及和 `SessionDropdown`、`ActionButtons` 更多菜单做互斥；不要在 header 里重复实现 popover 内部关闭后的 focus 规则：`Esc` 与再次点击触发器回到状态点按钮，外部点击则保持在用户点击目标
- 现有 header 能力不回归

如果现有 `ActionButtons` 更多菜单还不能被外部关闭，这一步要做最小改动让它可受控，或至少暴露关闭接口给 header 复用，但不要顺手重写更多菜单实现。

如果测试暴露布局或事件冒泡问题，只做最小修正，不顺手重构其它 header 代码。

**Step 4: 再跑测试确认通过**

Run (workdir=`packages/opencode/webgui`):

```bash
bun run test:run src/components/CompactHeader/index.test.tsx src/components/CompactHeader/index.integration.test.tsx src/components/CompactHeader/ActionButtons.test.tsx src/components/CompactHeader/StatusIndicator.test.tsx src/components/CompactHeader/StatusPopover.test.tsx src/components/OfflineBanner.test.tsx
```

Expected: PASS。

建议最后再补一轮回归：

```bash
bun run test:run src/components/CompactHeader
```

Expected: PASS。

**Step 5: Commit**

```bash
git add packages/opencode/webgui/src/components/CompactHeader/index.tsx packages/opencode/webgui/src/components/CompactHeader/index.test.tsx packages/opencode/webgui/src/components/CompactHeader/index.integration.test.tsx packages/opencode/webgui/src/components/CompactHeader/ActionButtons.tsx packages/opencode/webgui/src/components/CompactHeader/ActionButtons.test.tsx packages/opencode/webgui/src/components/CompactHeader/StatusIndicator.tsx packages/opencode/webgui/src/components/CompactHeader/StatusIndicator.test.tsx packages/opencode/webgui/src/components/CompactHeader/StatusPopover.test.tsx packages/opencode/webgui/src/components/OfflineBanner.test.tsx
git commit -m "feat(webgui): wire status popover into compact header"
```
