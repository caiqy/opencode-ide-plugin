# WebGUI 长会话滚动稳态 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 彻底消除 WebGUI 长会话在向上翻历史、trim 进出和动态高度收敛时的滚动抖动，并保持尾部实时区与会话激活语义稳定。

**Architecture:** `MessageList` 改为 history zone / tail zone 双区渲染，只对 history zone 做 top-only virtualization。历史区使用 block 级精确测量、prefix height ledger、anchor 驱动补偿和双阈值 hysteresis；`useMessageScroll` 收缩为只负责 tail 贴底，并补齐 `ResizeObserver` 缺失时的退化路径与 session 级 window / 测量缓存复用。

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, ResizeObserver, MessageList hooks

---

> **执行目录约束：** 下文所有 `Run:` 命令默认都在 `packages/opencode/webgui` 目录执行，不能从仓库 root 直接跑测试或构建。

---

## 文件结构 / 变更地图

- `packages/opencode/webgui/src/components/MessageList/index.tsx`  
  负责把当前 `visibleMessages` 拆成 history zone / tail zone，并把 `overflow-anchor: none`、history spacer、tail anchor、`permission` / `question` / `typing` 尾部元素与新 hooks 接到同一个滚动容器上。

- `packages/opencode/webgui/src/components/MessageList/hooks/useHistoryBlocks.ts`  
  负责把消息、summary separator、`RevertBanner` 前后的历史单元和尾部交互单元归并成稳定 block，输出 history blocks、tail blocks 和 tail 起点。

- `packages/opencode/webgui/src/components/MessageList/hooks/useHistoryBlocks.test.tsx`  
  覆盖 block 切分、summary 归并、history zone / tail zone 边界，以及 `permission` / `question` / `typing` 落在 tail zone。

- `packages/opencode/webgui/src/components/MessageList/hooks/useHistoryMeasure.ts`  
  负责 block 级精确测量、prefix height ledger 生成、fallback 高度、`ResizeObserver` 不可用时的退化测量和 session 级测量缓存。

- `packages/opencode/webgui/src/components/MessageList/hooks/useHistoryMeasure.test.tsx`  
  覆盖首次测量、ResizeObserver 增量更新、ledger 累积、session 复用缓存与无 ResizeObserver 退化路径。

- `packages/opencode/webgui/src/components/MessageList/hooks/useHistoryWindow.ts`  
  负责根据 `scrollTop`、视口高度和 hysteresis 管理 history window，只让 history zone 参与 trim。

- `packages/opencode/webgui/src/components/MessageList/hooks/useHistoryWindow.test.tsx`  
  覆盖进入阈值、退出阈值、边界防抖和 session 级 window 恢复。

- `packages/opencode/webgui/src/components/MessageList/hooks/useHistoryScroll.ts`  
  负责 anchor 选择、prepend 补偿、trim 进出补偿和“仅补偿 anchor 之前高度变化”的单一滚动协调逻辑。

- `packages/opencode/webgui/src/components/MessageList/hooks/useHistoryScroll.test.tsx`  
  覆盖 prepend 后保持同一 anchor、trim 进出后位置稳定、动态高度收敛只补偿 anchor 之前增量，以及无 ResizeObserver 时仍保持 prepend 稳定。

- `packages/opencode/webgui/src/components/MessageList/hooks/useTopTrim.ts`  
  负责从旧 row 估算模型迁移为薄封装或兼容层，转而组合 `useHistoryWindow` / `useHistoryScroll` 的结果，避免继续成为补丁中心。

- `packages/opencode/webgui/src/components/MessageList/hooks/useTopTrim.test.tsx`  
  覆盖旧导出形状仍可返回正确 spacer / visible rows，同时验证内部已不再依赖 `scrollHeight` 差值近似。

- `packages/opencode/webgui/src/components/MessageList/hooks/useMessageScroll.ts`  
  负责把自动滚动收缩为 tail zone 贴底语义，只响应 tail 新增、`typing` / `permission` 变化和显式 `scroll-to-bottom`，并覆盖无 ResizeObserver 时的退化行为。

- `packages/opencode/webgui/src/components/MessageList/hooks/useMessageScroll.test.tsx`  
  覆盖历史区 prepend / trim / 测量修正不再触发滚底，tail 区追加仍保持贴底，以及无 ResizeObserver 时不做动态补齐但不破坏尾部语义。

- `packages/opencode/webgui/src/components/MessageList/index.test.tsx`  
  覆盖 `MessageList` 双区渲染、`overflow-anchor: none` 接线、`permission` / `QuestionPart` / `TypingIndicator` 保留和跨 hooks 联调回归。

- `packages/opencode/webgui/src/state/useSessionActivation.ts`  
  不计划修改实现，但必须作为回归验证对象，确认最近页激活语义在新架构下不变。

---

## 任务 1：拆出双区与 block 边界

**Files:**

- Modify: `packages/opencode/webgui/src/components/MessageList/index.tsx`
- Create: `packages/opencode/webgui/src/components/MessageList/hooks/useHistoryBlocks.ts`
- Test: `packages/opencode/webgui/src/components/MessageList/index.test.tsx`
- Test: `packages/opencode/webgui/src/components/MessageList/hooks/useHistoryBlocks.test.tsx`

- [ ] **Step 1: 先写失败测试**  
       在 `useHistoryBlocks.test.tsx` 锁定 history zone / tail zone 的拆分规则、summary separator 与历史消息的 block 归并，以及 `permission` / `question` / `typing` 必须落在 tail zone。  
       在 `index.test.tsx` 锁定滚动容器启用 `overflow-anchor: none`，且渲染树存在 history spacer、history rows、tail rows 和 tail anchor。

      ```tsx
      it("把 permission 与 typing 固定在 tail zone", () => {
        const state = buildBlocks(seed)
        expect(state.history.map((x) => x.kind)).toEqual(["history-summary", "history-message"])
        expect(state.tail.map((x) => x.kind)).toContain("tail-permission")
        expect(state.tail.map((x) => x.kind)).toContain("tail-typing")
      })
      ```

      Run: `bun run test:run src/components/MessageList/index.test.tsx src/components/MessageList/hooks/useHistoryBlocks.test.tsx`
      Expected: FAIL，提示当前没有 block 切分能力或容器接线仍是单区结构。

- [ ] **Step 2: 运行测试确认失败**  
       逐条确认失败点集中在 block 归并和双区渲染，而不是无关文案或空态断言。  
       Run: `bun run test:run src/components/MessageList/index.test.tsx src/components/MessageList/hooks/useHistoryBlocks.test.tsx`  
       Expected: FAIL，且失败信息明确指向 history / tail 边界尚未建立。

- [ ] **Step 3: 写最小实现**  
       新增 `useHistoryBlocks.ts`，让它从 `visibleMessages` 派生稳定 block，并在 `index.tsx` 中改为先渲染 history zone，再渲染永久保留的 tail zone。  
       同时把实际滚动容器显式标成 `overflow-anchor: none`，并确保 `permission`、`QuestionPart`、`TypingIndicator` 都固定在 tail zone。

- [ ] **Step 4: 运行测试确认通过**  
       确认 block 划分、双区渲染和尾部交互保留都通过。  
       Run: `bun run test:run src/components/MessageList/index.test.tsx src/components/MessageList/hooks/useHistoryBlocks.test.tsx`  
       Expected: PASS。

- [ ] **Step 5: 执行固定联调回归**  
       补跑 `MessageList` 集成测试，确认 `RevertBanner`、`RevertSummary`、`QuestionPart`、`permission` 和 `TypingIndicator` 在双区切分后仍可见且顺序稳定。  
       Run: `bun run test:run src/components/MessageList/index.test.tsx`  
       Expected: PASS，且用例明确断言 tail 区仍保留上述元素。

- [ ] **Step 6: Commit（仅在用户已明确要求提交时执行，否则跳过）**

      ```bash
      git add src/components/MessageList/index.tsx src/components/MessageList/index.test.tsx src/components/MessageList/hooks/useHistoryBlocks.ts src/components/MessageList/hooks/useHistoryBlocks.test.tsx && git commit -m "docs: fill later during execution"
      ```

---

## 任务 2：建立测量账本与 session 缓存

**Files:**

- Create: `packages/opencode/webgui/src/components/MessageList/hooks/useHistoryMeasure.ts`
- Test: `packages/opencode/webgui/src/components/MessageList/hooks/useHistoryMeasure.test.tsx`
- Modify: `packages/opencode/webgui/src/components/MessageList/index.tsx`

- [ ] **Step 1: 先写失败测试**  
       在 `useHistoryMeasure.test.tsx` 锁定 block 首次挂载测量、ResizeObserver 更新、prefix height ledger 的累计值，以及切回同一 session 时直接命中缓存。  
       再写一个无 ResizeObserver 的退化用例，确认仍会记录首次挂载高度并生成 ledger，但不会依赖后续动态更新。

      ```tsx
      it("按 block 生成 prefix ledger", () => {
        const state = renderHook(() => useHistoryMeasure(seedBlocks, { sessionID: "s1" }))
        state.result.current.onMeasure("b1", 120)
        state.result.current.onMeasure("b2", 80)
        expect(state.result.current.ledger("b1")).toBe(0)
        expect(state.result.current.ledger("b2")).toBe(120)
        expect(state.result.current.prefix).toEqual([0, 120])
      })
      ```

      Run: `bun run test:run src/components/MessageList/hooks/useHistoryMeasure.test.tsx`
      Expected: FAIL，提示 ledger、测量缓存或 ResizeObserver 路径尚不存在。

- [ ] **Step 2: 运行测试确认失败**  
       核对失败点覆盖“首次测量”“缓存复用”“ResizeObserver 缺失退化”三个阶段。  
       Run: `bun run test:run src/components/MessageList/hooks/useHistoryMeasure.test.tsx`  
       Expected: FAIL，且失败信息能指向 ledger 或 session cache 缺口。

- [ ] **Step 3: 写最小实现**  
       新增 `useHistoryMeasure.ts`，为每个 history block 记录 `measuredHeight`、版本信息和 prefix ledger，并在 session 维度保留测量缓存。  
       在 `index.tsx` 接入 block ref 注册，让 history spacer 完全由 ledger 读取。若 `ResizeObserver` 不可用，则退化为首次挂载测量 + prepend 稳定，不承诺动态高度修正补偿。

- [ ] **Step 4: 运行测试确认通过**  
       确认测量、ledger、fallback、session 复用和无 ResizeObserver 退化行为都正确。  
       Run: `bun run test:run src/components/MessageList/hooks/useHistoryMeasure.test.tsx`  
       Expected: PASS。

- [ ] **Step 5: 执行固定联调回归**  
       运行 `MessageList` 相关集成测试，确认 history spacer 高度直接反映 ledger，而不是 DOM 总高度差，且切回旧 session 时不会重新抖动。  
       Run: `bun run test:run src/components/MessageList/index.test.tsx src/components/MessageList/hooks/useHistoryMeasure.test.tsx`  
       Expected: PASS，且集成测试断言 session 切换后复用测量结果。

- [ ] **Step 6: Commit（仅在用户已明确要求提交时执行，否则跳过）**

      ```bash
      git add src/components/MessageList/index.tsx src/components/MessageList/index.test.tsx src/components/MessageList/hooks/useHistoryMeasure.ts src/components/MessageList/hooks/useHistoryMeasure.test.tsx && git commit -m "docs: fill later during execution"
      ```

---

## 任务 3：重写窗口推进与 useTopTrim 兼容层

**Files:**

- Create: `packages/opencode/webgui/src/components/MessageList/hooks/useHistoryWindow.ts`
- Test: `packages/opencode/webgui/src/components/MessageList/hooks/useHistoryWindow.test.tsx`
- Modify: `packages/opencode/webgui/src/components/MessageList/hooks/useTopTrim.ts`
- Test: `packages/opencode/webgui/src/components/MessageList/hooks/useTopTrim.test.tsx`
- Modify: `packages/opencode/webgui/src/components/MessageList/index.tsx`

- [ ] **Step 1: 先写失败测试**  
       在 `useHistoryWindow.test.tsx` 写用例，锁定 history zone 只在进入阈值跨线时前移窗口、只在退出阈值跨线时回退窗口，并验证边界附近不会来回抖动。  
       在 `useTopTrim.test.tsx` 改写用例，锁定旧 hook 仍能给出 `top` 和 `visible`，但其内部结果来自 block window 和 ledger，而不是 `scrollHeight` 差值补偿。

      ```tsx
      it("用 hysteresis 避免 trim 边界来回翻转", () => {
        const win = renderHook(() => useHistoryWindow(cfg))
        act(() => win.result.current.onScroll(920))
        expect(win.result.current.start).toBe(3)
        act(() => win.result.current.onScroll(905))
        expect(win.result.current.start).toBe(3)
        act(() => win.result.current.onScroll(640))
        expect(win.result.current.start).toBe(2)
      })
      ```

      Run: `bun run test:run src/components/MessageList/hooks/useHistoryWindow.test.tsx src/components/MessageList/hooks/useTopTrim.test.tsx`
      Expected: FAIL，提示当前仍是 row 级估算或没有 hysteresis。

- [ ] **Step 2: 运行测试确认失败**  
       检查失败覆盖“进入 trim”“退出 trim”“session 切换恢复 window”三类场景。  
       Run: `bun run test:run src/components/MessageList/hooks/useHistoryWindow.test.tsx src/components/MessageList/hooks/useTopTrim.test.tsx`  
       Expected: FAIL，且失败点集中在窗口推进和兼容层旧模型。

- [ ] **Step 3: 写最小实现**  
       新增 `useHistoryWindow.ts`，让 history window 只由 ledger、视口高度和 hysteresis 决定，并按 session 保存 `startBlock`。  
       把 `useTopTrim.ts` 改成兼容封装，组合 window 结果输出旧形状，彻底移除基于 row 高度和 `scrollHeight` 差值的核心判断。

- [ ] **Step 4: 运行测试确认通过**  
       确认窗口推进、回退防抖和旧导出兼容都通过。  
       Run: `bun run test:run src/components/MessageList/hooks/useHistoryWindow.test.tsx src/components/MessageList/hooks/useTopTrim.test.tsx`  
       Expected: PASS。

- [ ] **Step 5: 执行固定联调回归**  
       跑 `MessageList` 与 `useTopTrim` 回归，确认 history zone trim 不会裁进 tail zone，且 session 切换后 window 能从缓存恢复。  
       Run: `bun run test:run src/components/MessageList/index.test.tsx src/components/MessageList/hooks/useHistoryWindow.test.tsx src/components/MessageList/hooks/useTopTrim.test.tsx`  
       Expected: PASS，且集成测试断言 tail 区 DOM 数量与顺序不受 trim 影响。

- [ ] **Step 6: Commit（仅在用户已明确要求提交时执行，否则跳过）**

      ```bash
      git add src/components/MessageList/index.tsx src/components/MessageList/index.test.tsx src/components/MessageList/hooks/useHistoryWindow.ts src/components/MessageList/hooks/useHistoryWindow.test.tsx src/components/MessageList/hooks/useTopTrim.ts src/components/MessageList/hooks/useTopTrim.test.tsx && git commit -m "docs: fill later during execution"
      ```

---

## 任务 4：落地 anchor 补偿协调器

**Files:**

- Create: `packages/opencode/webgui/src/components/MessageList/hooks/useHistoryScroll.ts`
- Test: `packages/opencode/webgui/src/components/MessageList/hooks/useHistoryScroll.test.tsx`
- Modify: `packages/opencode/webgui/src/components/MessageList/index.tsx`
- Modify: `packages/opencode/webgui/src/components/MessageList/hooks/useTopTrim.ts`
- Test: `packages/opencode/webgui/src/components/MessageList/hooks/useTopTrim.test.tsx`

- [ ] **Step 1: 先写失败测试**  
       在 `useHistoryScroll.test.tsx` 锁定 prepend 历史页后恢复同一 anchor、trim 进入与退出后保持同一视口位置，以及高度变化时只补偿 anchor 之前的增量。  
       再写一个无 ResizeObserver 的退化用例，确认仍能保持 prepend anchor 稳定，但不做动态高度收敛补偿。

      ```tsx
      it("只补偿 anchor 之前的高度变化", () => {
        const scroll = renderHook(() => useHistoryScroll(cfg))
        act(() => scroll.result.current.capture({ id: "b3", offset: 12 }))
        act(() => scroll.result.current.onHeightChange({ id: "b1", delta: 40 }))
        expect(scroll.result.current.nextTop()).toBe(40)
        act(() => scroll.result.current.onHeightChange({ id: "b4", delta: 60 }))
        expect(scroll.result.current.nextTop()).toBe(40)
      })
      ```

      Run: `bun run test:run src/components/MessageList/hooks/useHistoryScroll.test.tsx src/components/MessageList/hooks/useTopTrim.test.tsx`
      Expected: FAIL，提示当前补偿仍依赖整体高度差或没有 anchor 模型。

- [ ] **Step 2: 运行测试确认失败**  
       分别确认 prepend、trim、动态高度收敛和无 ResizeObserver 退化四个断言都能单独失败。  
       Run: `bun run test:run src/components/MessageList/hooks/useHistoryScroll.test.tsx src/components/MessageList/hooks/useTopTrim.test.tsx`  
       Expected: FAIL，且失败点清楚落在 anchor 驱动补偿链路。

- [ ] **Step 3: 写最小实现**  
       新增 `useHistoryScroll.ts`，让它统一接管 anchor 选择、prepend 恢复、trim 进出补偿和测量修正补偿。  
       若 `ResizeObserver` 不可用，则只保留 prepend / trim anchor 补偿，不对动态高度变化做持续修正；`index.tsx` 与 `useTopTrim.ts` 只消费协调器结果。

- [ ] **Step 4: 运行测试确认通过**  
       确认三类补偿与退化路径都稳定，且历史区滚动链路只剩一个协调器负责写入滚动位置。  
       Run: `bun run test:run src/components/MessageList/hooks/useHistoryScroll.test.tsx src/components/MessageList/hooks/useTopTrim.test.tsx`  
       Expected: PASS。

- [ ] **Step 5: 执行固定联调回归**  
       跑 `MessageList` 集成回归，锁定“loadOlder 完成后立刻进入 trim”也不会出现 2-4px 抖动，且 `useSessionActivation` 对最近页激活语义不变。  
       Run: `bun run test:run src/components/MessageList/index.test.tsx src/components/MessageList/hooks/useHistoryScroll.test.tsx`  
       Expected: PASS，且相关集成用例明确包含会话切换 / 最近页恢复场景。

- [ ] **Step 6: Commit（仅在用户已明确要求提交时执行，否则跳过）**

      ```bash
      git add src/components/MessageList/index.tsx src/components/MessageList/index.test.tsx src/components/MessageList/hooks/useHistoryScroll.ts src/components/MessageList/hooks/useHistoryScroll.test.tsx src/components/MessageList/hooks/useTopTrim.ts src/components/MessageList/hooks/useTopTrim.test.tsx && git commit -m "docs: fill later during execution"
      ```

---

## 任务 5：收缩 tail 贴底并做整体验收

**Files:**

- Modify: `packages/opencode/webgui/src/components/MessageList/hooks/useMessageScroll.ts`
- Test: `packages/opencode/webgui/src/components/MessageList/hooks/useMessageScroll.test.tsx`
- Modify: `packages/opencode/webgui/src/components/MessageList/index.tsx`
- Test: `packages/opencode/webgui/src/components/MessageList/index.test.tsx`

- [ ] **Step 1: 先写失败测试**  
       在 `useMessageScroll.test.tsx` 锁定 `useMessageScroll` 只根据 tail zone 末端距离决定贴底，不再因为 history prepend、history trim 或测量修正触发滚底。  
       同时补上无 ResizeObserver 的退化用例，确认不会做布局变化自动补齐，但 tail 新增、`typing`、`permission` 与按钮点击仍按语义工作。  
       在 `index.test.tsx` 补集成用例，锁定长会话向上滚动、`loadOlder`、trim 进出和 tail 区 `typing` / `permission` / `question` 共存时，`scroll-to-bottom` 只响应 tail 区需要。

      ```tsx
      it("历史区变化不触发 tail-only 自动滚动", () => {
        const hook = renderHook(() => useMessageScroll(cfg))
        act(() => hook.result.current.onHistoryMutate())
        expect(scrollIntoView).toHaveBeenCalledTimes(0)
        act(() => hook.result.current.onTailAppend())
        expect(scrollIntoView).toHaveBeenCalledTimes(1)
      })
      ```

      Run: `bun run test:run src/components/MessageList/hooks/useMessageScroll.test.tsx src/components/MessageList/index.test.tsx`
      Expected: FAIL，提示当前自动滚动仍监听整个内容高度。

- [ ] **Step 2: 运行测试确认失败**  
       重点确认失败点分别命中“历史区变化不应滚底”“tail 区追加仍应滚底”“无 ResizeObserver 时只保留基础贴底语义”三面。  
       Run: `bun run test:run src/components/MessageList/hooks/useMessageScroll.test.tsx src/components/MessageList/index.test.tsx`  
       Expected: FAIL，且失败信息能区分 history 和 tail 的职责混叠。

- [ ] **Step 3: 写最小实现**  
       收缩 `useMessageScroll.ts`，让它只观察 tail anchor、tail 新增消息、`typing` / `permission` 变化和用户显式点击按钮。  
       若 `ResizeObserver` 不可用，则跳过布局变化自动补齐，只保留 tail 追加、按钮点击和首次进入时的基础贴底。

- [ ] **Step 4: 运行测试确认通过**  
       确认 tail 贴底、按钮显示、用户离底锁定、历史区免干扰和退化路径全部通过。  
       Run: `bun run test:run src/components/MessageList/hooks/useMessageScroll.test.tsx src/components/MessageList/index.test.tsx`  
       Expected: PASS。

- [ ] **Step 5: 执行固定联调回归**  
       跑完整相关测试集与会话激活回归，确认长会话抖动修复没有破坏中文文案、空态、`RevertSummary`、`QuestionPart`、`permission`、`TypingIndicator` 和 `useSessionActivation` 的最近页激活语义。  
       Run: `bun run test:run src/components/MessageList/index.test.tsx src/components/MessageList/hooks/useHistoryBlocks.test.tsx src/components/MessageList/hooks/useHistoryMeasure.test.tsx src/components/MessageList/hooks/useHistoryWindow.test.tsx src/components/MessageList/hooks/useHistoryScroll.test.tsx src/components/MessageList/hooks/useTopTrim.test.tsx src/components/MessageList/hooks/useMessageScroll.test.tsx`  
       Expected: PASS，且集成回归包含 `permission` 与会话切换场景。

- [ ] **Step 6: Commit（仅在用户已明确要求提交时执行，否则跳过）**

      ```bash
      git add src/components/MessageList/index.tsx src/components/MessageList/index.test.tsx src/components/MessageList/hooks/useMessageScroll.ts src/components/MessageList/hooks/useMessageScroll.test.tsx && git commit -m "docs: fill later during execution"
      ```

---

## 验证命令

- `bun run test:run src/components/MessageList/index.test.tsx`
- `bun run test:run src/components/MessageList/hooks/useHistoryBlocks.test.tsx`
- `bun run test:run src/components/MessageList/hooks/useHistoryMeasure.test.tsx`
- `bun run test:run src/components/MessageList/hooks/useHistoryWindow.test.tsx`
- `bun run test:run src/components/MessageList/hooks/useHistoryScroll.test.tsx`
- `bun run test:run src/components/MessageList/hooks/useTopTrim.test.tsx`
- `bun run test:run src/components/MessageList/hooks/useMessageScroll.test.tsx`
- `bun run test:run src/components/MessageList/index.test.tsx src/components/MessageList/hooks/useHistoryBlocks.test.tsx src/components/MessageList/hooks/useHistoryMeasure.test.tsx src/components/MessageList/hooks/useHistoryWindow.test.tsx src/components/MessageList/hooks/useHistoryScroll.test.tsx src/components/MessageList/hooks/useTopTrim.test.tsx src/components/MessageList/hooks/useMessageScroll.test.tsx`
- `bun run build`
