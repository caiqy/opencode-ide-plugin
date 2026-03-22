# WebGUI 会话惰性加载 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 webgui 不再全量加载会话列表与消息历史，并通过顶部单向卸载降低长会话 DOM 成本，同时保持底部实时区稳定。

**Architecture:** 复用现有 `session.list(limit)` 与 `session.messages(limit,before)`，把列表与消息改为按需加载。消息渲染层不做双向 virtualization，而是新增顶部单向卸载与顶部占位补偿，始终保留当前视口到底部的 DOM。

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, existing SessionContext / MessagesContext / MessageList hooks

---

> **执行目录约束：** 下文所有 `Run:` 命令都在 `packages/opencode/webgui` 目录下执行，不能从仓库 root 直接跑测试或构建。

---

## 文件结构 / 变更地图

- `packages/opencode/webgui/src/state/sessionPaging.ts`  
  统一放置首屏分页常量与顶部卸载阈值，避免把分页数字散落到 context 和 UI 里。

- `packages/opencode/webgui/src/state/SessionContext.tsx`  
  把会话列表从全量拉取改成 `limit` 驱动，暴露 `hasMore` 与 `loadMoreSessions`，并在失败时保留已加载结果。

- `packages/opencode/webgui/src/components/CompactHeader/index.tsx`  
  把列表分页状态传给下拉组件，只负责 wiring，不引入新的列表数据逻辑。

- `packages/opencode/webgui/src/components/CompactHeader/SessionDropdown.tsx`  
  在 dropdown 底部接入“加载更多”按钮与加载态文案。

- `packages/opencode/webgui/src/components/CompactHeader/SessionList.tsx`  
  保持列表项渲染单一职责，只承接来自 dropdown 的分页 footer。

- `packages/opencode/webgui/src/state/MessagesContext.tsx`  
  把消息加载改成“最近页 + 向上翻页”，按会话维护 `pageMeta`、去重并发、过期响应保护和缓存复用。

- `packages/opencode/webgui/src/state/useSessionActivation.ts`  
  会话切换时只调用 `ensureSession(sessionID)`，恢复选择态时只依赖已拿到的最近页。

- `packages/opencode/webgui/src/App.tsx`  
  首屏 loading / error overlay 继续保留，但语义收敛为“最近页是否可用”。

- `packages/opencode/webgui/src/components/MessageList/hooks/useTopTrim.ts`  
  新增顶部单向卸载 hook，集中处理顶部 sentinel、占位高度和 prepend 后滚动补偿。

- `packages/opencode/webgui/src/components/MessageList/index.tsx`  
  串联 `loadOlder`、`useTopTrim` 与现有 `useMessageScroll`，保证顶部历史按需加载、底部跟随逻辑不回归。

- `packages/opencode/webgui/src/components/MessageList/hooks/useMessageScroll.ts`  
  只在需要时做最小适配，继续专注底部自动跟随与“回到底部”按钮。

- `packages/opencode/webgui/src/state/SessionContext.test.tsx`  
  覆盖列表首屏 limit、加载更多、失败保留旧数据。

- `packages/opencode/webgui/src/components/CompactHeader/SessionDropdown.test.tsx`  
  覆盖“加载更多”按钮显示、禁用和点击回调。

- `packages/opencode/webgui/src/state/MessagesContext.pagination.test.tsx`  
  新增消息分页主测试，覆盖 `loadLatest`、`ensureSession`、`loadOlder`、并发去重和过期响应。

- `packages/opencode/webgui/src/state/MessagesContext.selection-restore.test.tsx`  
  保留现有选择恢复断言，并改到新 API 名称与最新页语义。

- `packages/opencode/webgui/src/state/MessagesContext.task-result.test.tsx`  
  覆盖 task part 在最近页加载与历史分页下仍会经过同一适配逻辑。

- `packages/opencode/webgui/src/state/useSessionActivation.test.tsx`  
  覆盖会话切换只拉最近页、缓存命中不重复请求、晚到响应不串写选择态。

- `packages/opencode/webgui/src/components/SubtaskDrawer/SubtaskDrawer.tsx`  
  子任务抽屉打开时改用新消息 API，避免继续依赖旧的 `loadSessionMessages` 语义。

- `packages/opencode/webgui/src/components/SubtaskDrawer/SubtaskDrawer.test.tsx`  
  覆盖子任务抽屉在 API 迁移后的加载行为，确保 `subtask` 跳转回归可验证。

- `packages/opencode/webgui/src/components/MessageList/hooks/useTopTrim.test.tsx`  
  新增顶部卸载专项测试，覆盖顶部占位、视口补偿和靠近顶部时重新挂回 DOM。

- `packages/opencode/webgui/src/components/MessageList/index.test.tsx`  
  覆盖 `MessageList` 对历史加载和顶部占位的接线。

- `packages/opencode/webgui/src/components/MessageList/hooks/useMessageScroll.test.tsx`  
  回归底部自动跟随，确保顶部卸载后底部行为不变。

- `packages/opencode/webgui/src/App.newSession.test.ts`  
  只做回归验证，不改 `prepareSession` 行为。

---

## 任务 1：收敛列表分页状态

**Files:**

- Create: `packages/opencode/webgui/src/state/sessionPaging.ts`
- Modify: `packages/opencode/webgui/src/state/SessionContext.tsx`
- Test: `packages/opencode/webgui/src/state/SessionContext.test.tsx`

- [ ] **Step 1: 先写失败测试，锁定列表分页边界**  
       在 `SessionContext.test.tsx` 增加用例：初始化调用带 `limit` 的 `sdk.session.list(...)`、`loadMoreSessions()` 会扩大 limit 并重取、失败时保留已显示 sessions、`hasMore` 只在返回量达到当前 limit 时为 true。  
       Run: `bun run test:run src/state/SessionContext.test.tsx`  
       Expected: FAIL，提示缺少 `hasMore` / `loadMoreSessions` 或 `sdk.session.list` 调用参数不匹配。

- [ ] **Step 2: 提取小型共享常量文件**  
       在 `sessionPaging.ts` 放入列表首屏大小、消息页大小、顶部单向卸载阈值与顶部 sentinel 触发阈值，只保留本次 spec 需要的最小集合。  
       Run: `bun run test:run src/state/SessionContext.test.tsx`  
       Expected: 仍然 FAIL，但失败点已收敛到 `SessionContext` 实现。

- [ ] **Step 3: 最小实现 SessionContext 列表分页**  
       给 `SessionContextState` 增加 `hasMore`、`loadMoreSessions`，内部用 `limit` 驱动 `loadSessions()`，初始只拉首屏，“更多”时扩大 limit 后重新请求并替换列表。  
       同时保留现有排序、过滤 subagent session、SSE 更新行为，不引入 cursor 协议。  
       Run: `bun run test:run src/state/SessionContext.test.tsx`  
       Expected: PASS。

- [ ] **Step 4: 手动提交一个小 checkpoint**  
       不在本计划里执行 git。  
       Suggested commit: `feat: paginate webgui session list`

---

## 任务 2：接入会话下拉里的“加载更多”

**Files:**

- Modify: `packages/opencode/webgui/src/components/CompactHeader/index.tsx`
- Modify: `packages/opencode/webgui/src/components/CompactHeader/SessionDropdown.tsx`
- Modify: `packages/opencode/webgui/src/components/CompactHeader/SessionList.tsx`
- Test: `packages/opencode/webgui/src/components/CompactHeader/SessionDropdown.test.tsx`
- Test: `packages/opencode/webgui/src/components/CompactHeader/index.integration.test.tsx`

- [ ] **Step 1: 先写 UI 失败测试**  
       在 `SessionDropdown.test.tsx` 增加用例：`hasMore` 为 true 时显示底部按钮、loading 时禁用按钮、点击后触发 `onLoadMore`。  
       在 `index.integration.test.tsx` 增加一条接线用例，确认 `useSession()` 暴露的新分页状态被传到 dropdown。  
       Run: `bun run test:run src/components/CompactHeader/SessionDropdown.test.tsx src/components/CompactHeader/index.integration.test.tsx`  
       Expected: FAIL，提示缺少新 props 或按钮未渲染。

- [ ] **Step 2: 最小实现 dropdown footer**  
       给 `SessionDropdown` 增加 `hasMore`、`isLoadingMore`、`onLoadMore`，按钮放在列表底部，不改变现有搜索、多选和批量删除交互。  
       `SessionList` 继续只负责列表项渲染，footer 由 dropdown 统一控制。  
       Run: `bun run test:run src/components/CompactHeader/SessionDropdown.test.tsx`  
       Expected: PASS。

- [ ] **Step 3: 从 CompactHeader 透传分页状态**  
       在 `index.tsx` 从 `useSession()` 读取 `hasMore` 与 `loadMoreSessions`，把“加载更多”接到当前 dropdown 底部按钮。  
       不新增自动预取，不在搜索时改变后端请求策略。  
       Run: `bun run test:run src/components/CompactHeader/SessionDropdown.test.tsx src/components/CompactHeader/index.integration.test.tsx`  
       Expected: PASS。

- [ ] **Step 4: 手动提交一个小 checkpoint**  
       不在本计划里执行 git。  
       Suggested commit: `feat: add load more control to session dropdown`

---

## 任务 3：把消息状态改成最近页优先

**Files:**

- Modify: `packages/opencode/webgui/src/state/MessagesContext.tsx`
- Create: `packages/opencode/webgui/src/state/MessagesContext.pagination.test.tsx`
- Modify: `packages/opencode/webgui/src/state/MessagesContext.selection-restore.test.tsx`
- Modify: `packages/opencode/webgui/src/state/MessagesContext.task-result.test.tsx`
- Modify: `packages/opencode/webgui/src/components/SubtaskDrawer/SubtaskDrawer.tsx`
- Modify: `packages/opencode/webgui/src/components/SubtaskDrawer/SubtaskDrawer.test.tsx`

- [ ] **Step 1: 先写分页主测试**  
       新增 `MessagesContext.pagination.test.tsx`，覆盖这些场景：
  1. `loadLatest(sessionID)` 只请求最近一页并写入 `cursor`
  2. `ensureSession(sessionID)` 已缓存时不重复请求
  3. `loadOlder(sessionID)` 用 `before + limit` prepend 旧页
  4. 同会话 `loadOlder` 并发去重
  5. 晚到旧响应不能覆盖新状态
  6. 历史页失败不清空当前最新内容。  
     Run: `bun run test:run src/state/MessagesContext.pagination.test.tsx src/state/MessagesContext.selection-restore.test.tsx`  
     Expected: FAIL，提示缺少 `loadLatest` / `loadOlder` / `ensureSession` 或分页状态不正确。

- [ ] **Step 2: 最小实现分页元数据模型**  
       在 `MessagesContext.tsx` 引入按 session 维度的 `pageMeta`，至少包含 `cursor`、`complete`、`loading`、`loaded`、`error`。  
       保留现有 `messages` 主存储和 SSE merge 行为，不做冷页淘汰。  
       Run: `bun run test:run src/state/MessagesContext.pagination.test.tsx src/state/MessagesContext.selection-restore.test.tsx`  
       Expected: 仍然 FAIL，但失败点变成具体分页行为。

- [ ] **Step 3: 实现 `loadLatest` 与 `ensureSession`**  
       `loadLatest(sessionID)` 只拉最近一页，并从响应头记录 `X-Next-Cursor`；`ensureSession(sessionID)` 只保证最近页可用，不再假设全历史已到齐。  
       `isSessionLoading` / `isSessionLoaded` / `isSessionLoadError` 继续保留，但只代表最近页首屏状态。  
       Run: `bun run test:run src/state/MessagesContext.pagination.test.tsx src/state/MessagesContext.selection-restore.test.tsx src/state/MessagesContext.task-result.test.tsx`  
       Expected: 部分 PASS，`loadOlder` 相关仍 FAIL。

- [ ] **Step 4: 实现 `loadOlder`、prepend 和并发保护**  
       `loadOlder(sessionID)` 使用当前 cursor 发起 `session.messages(limit, before)`，把旧页 prepend 到现有列表前面，重复请求同一 session 时直接复用进行中的 promise。  
       所有异步落地都校验 session/token，过期响应只丢弃不覆盖。  
       Run: `bun run test:run src/state/MessagesContext.pagination.test.tsx src/state/MessagesContext.selection-restore.test.tsx src/state/MessagesContext.task-result.test.tsx`  
       Expected: PASS。

- [ ] **Step 5: 迁移剩余调用方到新 API 语义**  
       把 `SubtaskDrawer.tsx` 从 `loadSessionMessages(sessionID)` 切到 `ensureSession(sessionID)` 或等价的新入口，并同步更新 `SubtaskDrawer.test.tsx` 与 `MessagesContext.task-result.test.tsx` 的 API 断言。  
       不保留长期兼容别名，避免后续代码继续写回旧语义。  
       Run: `bun run test:run src/state/MessagesContext.pagination.test.tsx src/state/MessagesContext.selection-restore.test.tsx src/state/MessagesContext.task-result.test.tsx src/components/SubtaskDrawer/SubtaskDrawer.test.tsx`  
       Expected: PASS。

- [ ] **Step 6: 手动提交一个小 checkpoint**  
       不在本计划里执行 git。  
       Suggested commit: `feat: page webgui session messages by latest and older chunks`

---

## 任务 4：把激活流程切到 ensureSession 语义

**Files:**

- Modify: `packages/opencode/webgui/src/state/useSessionActivation.ts`
- Modify: `packages/opencode/webgui/src/App.tsx`
- Test: `packages/opencode/webgui/src/state/useSessionActivation.test.tsx`
- Test: `packages/opencode/webgui/src/App.newSession.test.ts`

- [ ] **Step 1: 先写失败测试，锁定切换语义**  
       在 `useSessionActivation.test.tsx` 增加或改写用例：切换会话时只调用 `ensureSession(sessionID)`，已缓存最近页时不重复请求，晚到响应仍不能覆盖当前选择态。  
       `App.newSession.test.ts` 只保留回归执行，不修改断言目标。  
       Run: `bun run test:run src/state/useSessionActivation.test.tsx src/App.newSession.test.ts`  
       Expected: FAIL，提示还在调用旧的 `loadSessionMessages()` 或重试路径不匹配。

- [ ] **Step 2: 最小实现激活 hook 改造**  
       `useSessionActivation.ts` 改为依赖 `ensureSession`，并继续在最近页返回后执行 `selectionFromMessages()`。  
       不把“历史页失败”升级为主错误面。  
       Run: `bun run test:run src/state/useSessionActivation.test.tsx src/App.newSession.test.ts`  
       Expected: 大部分 PASS。

- [ ] **Step 3: 收敛 App loading / retry 语义**  
       `App.tsx` 改为只依赖最近页状态控制 overlay 与 retry，retry 入口重新触发 `ensureSession(currentSession.id)`。  
       不改 `prepareSession()` 内部是否全量检查草稿会话，这部分明确留作回归范围。  
       Run: `bun run test:run src/state/useSessionActivation.test.tsx src/App.newSession.test.ts`  
       Expected: PASS。

- [ ] **Step 4: 手动提交一个小 checkpoint**  
       不在本计划里执行 git。  
       Suggested commit: `feat: activate sessions from latest-page cache`

---

## 任务 5：为消息列表增加顶部历史加载与单向卸载

**Files:**

- Create: `packages/opencode/webgui/src/components/MessageList/hooks/useTopTrim.ts`
- Create: `packages/opencode/webgui/src/components/MessageList/hooks/useTopTrim.test.tsx`
- Modify: `packages/opencode/webgui/src/state/sessionPaging.ts`
- Modify: `packages/opencode/webgui/src/components/MessageList/index.tsx`
- Modify: `packages/opencode/webgui/src/components/MessageList/hooks/useMessageScroll.ts`
- Test: `packages/opencode/webgui/src/components/MessageList/index.test.tsx`
- Test: `packages/opencode/webgui/src/components/MessageList/hooks/useMessageScroll.test.tsx`

- [ ] **Step 1: 先写顶部卸载专项失败测试**  
       在 `useTopTrim.test.tsx` 覆盖这几条：
  1. 历史 prepend 后会用高度差补偿 `scrollTop`
  2. 离顶部较远时会 trim 掉顶部 DOM 并留下占位高度
  3. 靠近顶部时会重新挂回已加载的顶部消息
  4. trim 过程中不会裁掉当前视口到底部的消息。  
     同时在 `index.test.tsx` 增加接线用例，确认 `MessageList` 会触发 `loadOlder(sessionID)`，并且在长消息列表场景下渲染的消息行数显著少于输入总数。  
     Run: `bun run test:run src/components/MessageList/hooks/useTopTrim.test.tsx src/components/MessageList/index.test.tsx src/components/MessageList/hooks/useMessageScroll.test.tsx`  
     Expected: FAIL，提示缺少新 hook 或历史加载 wiring。

- [ ] **Step 2: 最小实现 `useTopTrim`**  
       hook 返回顶部 sentinel ref、占位高度、当前可见消息窗口，以及 prepend 前后滚动补偿逻辑。  
       阈值使用 `sessionPaging.ts` 的常量，不引入双向 virtualization，也不删除已加载数据。  
       Run: `bun run test:run src/components/MessageList/hooks/useTopTrim.test.tsx src/components/MessageList/index.test.tsx src/components/MessageList/hooks/useMessageScroll.test.tsx`  
       Expected: `useTopTrim` 用例部分 PASS。

- [ ] **Step 3: 在 MessageList 接入历史分页**  
       `MessageList/index.tsx` 改为从 `useMessages()` 读取 `loadOlder` 与对应 page meta，在顶部 sentinel 命中时拉旧页。  
       渲染树里加入顶部占位节点，保持底部问题卡片、权限卡片、typing indicator 和 scroll anchor 都在保留区内。  
       Run: `bun run test:run src/components/MessageList/hooks/useTopTrim.test.tsx src/components/MessageList/index.test.tsx src/components/MessageList/hooks/useMessageScroll.test.tsx`  
       Expected: 仅剩底部滚动回归问题或全部 PASS。

- [ ] **Step 4: 对 `useMessageScroll` 做最小兼容修正**  
       只处理顶部占位高度变化带来的回归，保持它继续专注底部 auto-follow 与“回到底部”按钮。  
       不把顶部 trim 逻辑塞进 `useMessageScroll`。  
       Run: `bun run test:run src/components/MessageList/hooks/useTopTrim.test.tsx src/components/MessageList/index.test.tsx src/components/MessageList/hooks/useMessageScroll.test.tsx`  
       Expected: PASS。

- [ ] **Step 5: 手动提交一个小 checkpoint**  
       不在本计划里执行 git。  
       Suggested commit: `feat: trim message list from top while preserving bottom region`

---

## 任务 6：跑完整回归并做最终验收

**Files:**

- Test: `packages/opencode/webgui/src/state/SessionContext.test.tsx`
- Test: `packages/opencode/webgui/src/state/MessagesContext.pagination.test.tsx`
- Test: `packages/opencode/webgui/src/state/MessagesContext.selection-restore.test.tsx`
- Test: `packages/opencode/webgui/src/state/useSessionActivation.test.tsx`
- Test: `packages/opencode/webgui/src/components/MessageList/hooks/useTopTrim.test.tsx`
- Test: `packages/opencode/webgui/src/components/MessageList/index.test.tsx`
- Test: `packages/opencode/webgui/src/components/MessageList/hooks/useMessageScroll.test.tsx`
- Test: `packages/opencode/webgui/src/components/CompactHeader/SessionDropdown.test.tsx`
- Test: `packages/opencode/webgui/src/App.newSession.test.ts`
- Test: `packages/opencode/webgui/src/state/MessagesContext.task-result.test.tsx`
- Test: `packages/opencode/webgui/src/components/parts/ToolPart/index.test.tsx`
- Test: `packages/opencode/webgui/src/components/SubtaskDrawer/SubtaskDrawer.test.tsx`
- Test: `packages/opencode/webgui/src/components/SubtaskDrawer/SubtaskMessageList.test.tsx`

- [ ] **Step 1: 运行本次改造的回归测试组**  
       Run: `bun run test:run src/state/SessionContext.test.tsx src/state/MessagesContext.pagination.test.tsx src/state/MessagesContext.selection-restore.test.tsx src/state/MessagesContext.task-result.test.tsx src/state/useSessionActivation.test.tsx src/components/MessageList/hooks/useTopTrim.test.tsx src/components/MessageList/index.test.tsx src/components/MessageList/hooks/useMessageScroll.test.tsx src/components/CompactHeader/SessionDropdown.test.tsx src/App.newSession.test.ts src/components/parts/ToolPart/index.test.tsx src/components/SubtaskDrawer/SubtaskDrawer.test.tsx src/components/SubtaskDrawer/SubtaskMessageList.test.tsx`  
       Expected: PASS。

- [ ] **Step 2: 做最终构建验证**  
       Run: `bun run build`  
       Expected: PASS，产物构建成功且无新的类型错误。

- [ ] **Step 3: 记录人工验收结论**  
       在实施记录中明确写下这 6 条结果：最近页首屏已生效、向上翻历史成功、底部实时区稳定、滚到极顶部时会退化且已知、长会话 DOM 节点数相对旧实现明显下降、打开或切换大会话等待时间明显改善。  
       Run: `bun run test:run src/state/useSessionActivation.test.tsx src/components/MessageList/hooks/useTopTrim.test.tsx src/components/MessageList/hooks/useMessageScroll.test.tsx src/components/MessageList/index.test.tsx`  
       Expected: PASS，且人工验收记录能同时说明交互边界与性能目标已被验证。

- [ ] **Step 4: 手动提交最终小步提交**  
       不在本计划里执行 git。  
       Suggested commit order:
  1. `feat: paginate webgui session list`
  2. `feat: page webgui session messages by latest and older chunks`
  3. `feat: trim message list from top while preserving bottom region`

---

## 约束检查

- [ ] 只实现 spec 已确认内容，不加入冷页淘汰。
- [ ] 不为 `session.list` 设计 cursor 协议。
- [ ] 不加入复杂预取。
- [ ] 不追求滚到极顶部时仍保持最小 DOM。
- [ ] 在验收记录里明确说明：靠近极顶部时，顶部单向卸载会退化，这是当前设计接受的边界。
