# WebGUI 历史手动加载 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 WebGUI 顶部历史分页改成显式手动加载条，并让 older load 的 loading/error/complete 状态对用户稳定可见。

**Architecture:** `MessagesContext` 继续持有 session 级分页游标与请求去重，但要把 older load 的状态补齐到可消费的分页元数据里，而不是只覆盖 latest load。`MessageList` 负责把顶部加载条挂到 history trim spacer 之后、history rows 之前，并在点击时先调用 `useTopTrim` 的 prepend 准备能力，再触发 `loadOlder(sessionID)`。`useTopTrim` 收缩为 trim 与锚点恢复协调层，彻底移除 scroll 自动触发 `loadOlder(sessionID)` 的职责。

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, MessagesContext, MessageList hooks

---

> **执行目录约束：** 下文所有 `Run:` 命令默认都在 `packages/opencode/webgui` 目录执行，不能从仓库 root 直接跑测试或构建。

---

## 文件结构 / 变更地图

- `packages/opencode/webgui/src/state/MessagesContext.tsx`  
  继续负责 session 级分页状态、游标推进、older/latest 请求去重与落地时序，并补齐 older load 的 `loading` / `error` / `complete` 可见性，让渲染层能区分“最近页初始化”和“向上翻历史”。

- `packages/opencode/webgui/src/state/MessagesContext.pagination.test.tsx`  
  覆盖 latest load 与 older load 的状态分离、older 失败后可重试、并发去重仍成立，以及 latest page 未 ready 时不会误暴露历史翻页可用态。

- `packages/opencode/webgui/src/components/MessageList/index.tsx`  
  负责消费分页状态、渲染顶部显式加载条、在手动点击前调用 `useTopTrim` 的 prepend 准备能力，并把加载条固定挂在 history trim spacer 之后、history rows 之前，且不参与 trim。

- `packages/opencode/webgui/src/components/MessageList/index.test.tsx`  
  改写现有“触顶自动 loadOlder”相关测试，替换为“点击顶部加载条”测试，并覆盖四类条状态、latest page 未 ready 时隐藏、失败重试、完成终态、挂载顺序与不参与 trim。

- `packages/opencode/webgui/src/components/MessageList/hooks/useTopTrim.ts`  
  继续负责 history trim、prepend 后锚点恢复与容器尺寸变更处理，但不再从 scroll 事件调用 `loadOlder(sessionID)`；新增或显式暴露 `prepare/capture for prepend` 能力，供 `MessageList` 在手动加载前调用。

- `packages/opencode/webgui/src/components/MessageList/hooks/useTopTrim.test.tsx`  
  移除或改写现有 sentinel/near-top 自动翻页断言，改为验证手动 prepare 后 prepend 仍能恢复锚点、trim 不裁掉顶部加载条、暂停期与尺寸变化回归仍成立。

---

## 任务 1：补齐分页状态模型

**Files:**

- Modify: `packages/opencode/webgui/src/state/MessagesContext.tsx`
- Test: `packages/opencode/webgui/src/state/MessagesContext.pagination.test.tsx`

- [ ] **Step 1: 先写失败测试**  
       在 `MessagesContext.pagination.test.tsx` 增加用例，锁定 `loadLatest` 与 `loadOlder` 的状态分离：latest 首屏加载时是主 ready 门禁，older 加载时也会单独暴露 `loading`，older 失败时会保留当前消息并暴露可重试 `error`。  
       再加一条用例，确认 older request pending 期间重复调用仍复用同一 Promise，且重试成功后 error 会被清掉。

      ```tsx
      it("older load 失败后保留已有消息并暴露重试态", async () => {
        await api.loadLatest("s1")
        await api.loadOlder("s1")
        expect(api.getSessionPagination("s1")).toMatchObject({
          ready: true,
          olderLoading: false,
          olderError: true,
        })
      })
      ```

      Run: `bun run test:run src/state/MessagesContext.pagination.test.tsx`
      Expected: FAIL，提示当前 context 没有 older 专属状态读取口径，或 `loadOlder` 失败后状态没有更新。

- [ ] **Step 2: 运行测试确认失败**  
       逐条确认失败点集中在“older loading/error 不可见”和“重试后状态未清理”，避免把失败归因到消息排序或 mock 数据本身。  
       Run: `bun run test:run src/state/MessagesContext.pagination.test.tsx`  
       Expected: FAIL，且失败信息直接指向分页状态模型缺口。

- [ ] **Step 3: 写最小实现**  
       在 `MessagesContext.tsx` 里保留现有 session page 主体，但把 latest 与 older 的可见状态拆成稳定字段或稳定 getter，例如 `ready` / `latestLoading` / `olderLoading` / `olderError` / `complete`。  
       `loadLatest` 仍负责最近页初始化门禁；`loadOlder` 在请求开始时清掉旧 `olderError` 并置为 loading，失败时只更新 older error，不清空已显示消息，成功时推进 cursor 与 complete。

- [ ] **Step 4: 运行测试确认通过**  
       确认 older loading/error、失败重试、并发去重和 complete 更新都通过。  
       Run: `bun run test:run src/state/MessagesContext.pagination.test.tsx`  
       Expected: PASS。

- [ ] **Step 5: 执行固定回归验证**  
       补跑现有 pagination 全集，确认 `ensureSession`、SSE 晚到保护、`loadLatest` 并发复用和最后一页完成态都没有回归。  
       Run: `bun run test:run src/state/MessagesContext.pagination.test.tsx`  
       Expected: PASS，且新增断言明确区分 latest ready 与 older 翻页状态。

- [ ] **Step 6: Commit（仅在用户已明确要求提交时执行，否则跳过）**

      ```bash
      git add src/state/MessagesContext.tsx src/state/MessagesContext.pagination.test.tsx && git commit -m "docs: fill later during execution"
      ```

---

## 任务 2：接入顶部显式加载条

**Files:**

- Modify: `packages/opencode/webgui/src/components/MessageList/index.tsx`
- Test: `packages/opencode/webgui/src/components/MessageList/index.test.tsx`

- [ ] **Step 1: 先写失败测试**  
       先删掉或改写现有 `index.test.tsx` 中所有“触顶 scroll 自动调用 `loadOlder`”相关测试，替换成“点击顶部加载条”场景。  
       新增用例覆盖四类状态：可加载、正在加载、加载失败可重试、已加载全部消息；再补一条 latest page 未 ready 时顶部条隐藏，以及顶部条必须出现在 history spacer 之后、history rows 之前且自身不带 `trim-row` 标记。

      ```tsx
      it("点击顶部条才会触发 loadOlder", async () => {
        render(<MessageList sessionID="s1" onUndoToInput={vi.fn()} />)
        fireEvent.click(screen.getByRole("button", { name: "加载更早消息" }))
        await waitFor(() => expect(loadOlder).toHaveBeenCalledWith("s1"))
      })
      ```

      Run: `bun run test:run src/components/MessageList/index.test.tsx`
      Expected: FAIL，提示当前没有顶部条，或 scroll 仍是唯一触发入口。

- [ ] **Step 2: 运行测试确认失败**  
       确认失败点覆盖“顶部条缺失”“latest 未 ready 时未隐藏”“自动 scroll 旧断言已移除”三类，不让无关空态或中文文案掩盖主缺口。  
       Run: `bun run test:run src/components/MessageList/index.test.tsx`  
       Expected: FAIL，且失败信息直接落在顶部加载条 wiring。

- [ ] **Step 3: 写最小实现**  
       在 `MessageList/index.tsx` 消费 `MessagesContext` 的新分页读取口径，派生顶部条展示模型：`latest ready` 为假时隐藏；否则按 `complete > error > olderLoading > 可加载` 决定文案与可点状态。  
       顶部条点击时只走手动入口，并固定挂在 history trim spacer 之后、history rows 之前；不要把它塞进 `trim.visible`，避免它被当成 history row 裁掉。

- [ ] **Step 4: 运行测试确认通过**  
       确认顶部条显示、点击、失败重试、完成终态、隐藏规则和 DOM 顺序都通过。  
       Run: `bun run test:run src/components/MessageList/index.test.tsx`  
       Expected: PASS。

- [ ] **Step 5: 执行固定回归验证**  
       回归现有中文文案、空态、`QuestionPart`、`TypingIndicator`、`RevertSummary` 和 history/tail 双区渲染，确认顶部条接入后不影响尾部区语义。  
       Run: `bun run test:run src/components/MessageList/index.test.tsx`  
       Expected: PASS，且测试里明确断言顶部条不是 trim row。

- [ ] **Step 6: Commit（仅在用户已明确要求提交时执行，否则跳过）**

      ```bash
      git add src/components/MessageList/index.tsx src/components/MessageList/index.test.tsx && git commit -m "docs: fill later during execution"
      ```

---

## 任务 3：收缩 useTopTrim 为手动 prepend 协调器

**Files:**

- Modify: `packages/opencode/webgui/src/components/MessageList/hooks/useTopTrim.ts`
- Test: `packages/opencode/webgui/src/components/MessageList/hooks/useTopTrim.test.tsx`
- Modify: `packages/opencode/webgui/src/components/MessageList/index.tsx`
- Test: `packages/opencode/webgui/src/components/MessageList/index.test.tsx`

- [ ] **Step 1: 先写失败测试**  
       在 `useTopTrim.test.tsx` 移除或改写现有 sentinel / near-top 自动翻页测试，改成“手动调用 prepare 后，再 prepend 历史，仍按锚点恢复”的测试。  
       再加一条用例，确认 scroll 事件只推进 trim 与测量，不会直接调用 `loadOlder(sessionID)`；以及顶部加载条节点位于 spacer 后、history rows 前时不会被 trim 裁掉。

      ```tsx
      it("preparePrepend 后由消息更新阶段恢复锚点", () => {
        const top = result.current
        act(() => top.preparePrepend())
        rerender({ ids: ["m1", "m2", "m3", "m4"] })
        expect(parent.scrollTop).toBe(220)
      })
      ```

      Run: `bun run test:run src/components/MessageList/hooks/useTopTrim.test.tsx src/components/MessageList/index.test.tsx`
      Expected: FAIL，提示 hook 仍在 scroll 中自动 `loadOlder`，或没有显式 prepare 接口。

- [ ] **Step 2: 运行测试确认失败**  
       检查失败点分别命中“scroll 不再触发 loadOlder”“手动 prepare 存在”“prepend 后恢复锚点”三条主链，避免只剩单条集成断言。  
       Run: `bun run test:run src/components/MessageList/hooks/useTopTrim.test.tsx src/components/MessageList/index.test.tsx`  
       Expected: FAIL，且失败信息集中在手动 prepend 协调缺口。

- [ ] **Step 3: 写最小实现**  
       在 `useTopTrim.ts` 移除 `loadOlder` 输入和 scroll 内自动加载逻辑，改为返回类似 `preparePrepend()` 的显式能力，让 `MessageList` 在点击顶部条前调用。  
       prepend 之后仍沿用现有消息更新阶段的 `restore` 路径恢复锚点，scroll 监听只负责 trim window、snap 与容器尺寸同步，不再承担翻页入口。

- [ ] **Step 4: 运行测试确认通过**  
       确认 hook 的 trim、尺寸变化回归、prepare/restore 链路和“scroll 不自动翻页”都通过。  
       Run: `bun run test:run src/components/MessageList/hooks/useTopTrim.test.tsx src/components/MessageList/index.test.tsx`  
       Expected: PASS。

- [ ] **Step 5: 执行固定回归验证**  
       补跑手动加载条集成回归，确认点击顶部条时调用顺序固定为 `preparePrepend -> loadOlder(sessionID) -> prepend 后 restore`，且 loading 期间重复点击不会并发加载。  
       Run: `bun run test:run src/components/MessageList/index.test.tsx src/components/MessageList/hooks/useTopTrim.test.tsx`  
       Expected: PASS，且集成用例明确覆盖失败重试与完成终态。

- [ ] **Step 6: Commit（仅在用户已明确要求提交时执行，否则跳过）**

      ```bash
      git add src/components/MessageList/index.tsx src/components/MessageList/index.test.tsx src/components/MessageList/hooks/useTopTrim.ts src/components/MessageList/hooks/useTopTrim.test.tsx && git commit -m "docs: fill later during execution"
      ```

---

## 任务 4：联调历史加载条与分页状态

**Files:**

- Modify: `packages/opencode/webgui/src/state/MessagesContext.tsx`
- Test: `packages/opencode/webgui/src/state/MessagesContext.pagination.test.tsx`
- Modify: `packages/opencode/webgui/src/components/MessageList/index.tsx`
- Test: `packages/opencode/webgui/src/components/MessageList/index.test.tsx`
- Modify: `packages/opencode/webgui/src/components/MessageList/hooks/useTopTrim.ts`
- Test: `packages/opencode/webgui/src/components/MessageList/hooks/useTopTrim.test.tsx`

- [ ] **Step 1: 先写失败测试**  
       在 `index.test.tsx` 增加跨层联调用例：latest page 未 ready 时顶部条隐藏；ready 后显示“加载更早消息”；点击后立即切到 loading；失败时显示“加载失败，点击重试”；complete 时显示终态且不再触发 `loadOlder`。  
       在 `MessagesContext.pagination.test.tsx` 补一条 session 切换场景，确认不同 session 的 older loading/error/complete 不串写。

      Run: `bun run test:run src/state/MessagesContext.pagination.test.tsx src/components/MessageList/index.test.tsx src/components/MessageList/hooks/useTopTrim.test.tsx`
      Expected: FAIL，提示跨层状态时序仍不同步，或 session 级状态隔离不完整。

- [ ] **Step 2: 运行测试确认失败**  
       确认失败点只剩状态联调、session 切换隔离和顶部条终态去重，不再回退到基础 hook 缺口。  
       Run: `bun run test:run src/state/MessagesContext.pagination.test.tsx src/components/MessageList/index.test.tsx src/components/MessageList/hooks/useTopTrim.test.tsx`  
       Expected: FAIL，且失败信息能区分 context 状态与 UI 展示不同步。

- [ ] **Step 3: 写最小实现**  
       收敛 `MessageList` 的顶部条状态派生，只读 `MessagesContext` 的 session 分页元数据，不在组件内再复制一套 older error/loading 状态。  
       复查 `MessagesContext` 的 older request 清理逻辑，确保成功、失败、session 切换与并发复用后，顶部条始终按 `complete > error > olderLoading > 可加载` 落状态，且 latest 未 ready 时整条隐藏。

- [ ] **Step 4: 运行测试确认通过**  
       确认跨层联调、session 状态隔离、失败重试与完成终态全部通过。  
       Run: `bun run test:run src/state/MessagesContext.pagination.test.tsx src/components/MessageList/index.test.tsx src/components/MessageList/hooks/useTopTrim.test.tsx`  
       Expected: PASS。

- [ ] **Step 5: 执行固定回归验证**  
       跑合并回归与构建，确认手动加载条没有破坏现有 trim、尾部交互和构建产物。  
       Run: `bun run test:run src/state/MessagesContext.pagination.test.tsx src/components/MessageList/index.test.tsx src/components/MessageList/hooks/useTopTrim.test.tsx && bun run build`  
       Expected: PASS。

- [ ] **Step 6: Commit（仅在用户已明确要求提交时执行，否则跳过）**

      ```bash
      git add src/state/MessagesContext.tsx src/state/MessagesContext.pagination.test.tsx src/components/MessageList/index.tsx src/components/MessageList/index.test.tsx src/components/MessageList/hooks/useTopTrim.ts src/components/MessageList/hooks/useTopTrim.test.tsx && git commit -m "docs: fill later during execution"
      ```

---

## 验证命令

- `bun run test:run src/state/MessagesContext.pagination.test.tsx`
- `bun run test:run src/components/MessageList/index.test.tsx`
- `bun run test:run src/components/MessageList/hooks/useTopTrim.test.tsx`
- `bun run test:run src/state/MessagesContext.pagination.test.tsx src/components/MessageList/index.test.tsx src/components/MessageList/hooks/useTopTrim.test.tsx`
- `bun run build`
