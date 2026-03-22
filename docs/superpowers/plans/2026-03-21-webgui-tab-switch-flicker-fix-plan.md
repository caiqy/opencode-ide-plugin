# WebGUI 标签切换闪动修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 WebGUI 在切换标签或会话后，消息区顶部 trim spacer 与底部自动滚动互相抢写布局而产生的短时闪动。

**Architecture:** 在 `MessageList` 引入一次性的会话切换 settling 稳定期，作为 `useTopTrim` 与 `useMessageScroll` 的共享闸门。稳定期内暂停顶部 trim / loadOlder 与底部 ResizeObserver / 消息签名驱动的自动滚动，待稳定结束后只执行一次 auto 校正，再恢复 trim 与常规滚动联动。

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, MessageList hooks

---

> **执行目录约束：** 下文所有 `Run:` 命令都在 `packages/opencode/webgui` 目录下执行，不能从仓库 root 直接跑测试或构建。

---

## 文件结构 / 变更地图

- `packages/opencode/webgui/src/components/MessageList/index.tsx`  
  负责在会话切换时创建 settling 状态，并把稳定期开关传给滚动与 trim hooks。

- `packages/opencode/webgui/src/components/MessageList/hooks/useTopTrim.ts`  
  负责在稳定期内暂停顶部 trim 计算与 `loadOlder` 触发，稳定结束后再恢复顶部占位与历史加载。

- `packages/opencode/webgui/src/components/MessageList/hooks/useMessageScroll.ts`  
  负责在稳定期内暂停 ResizeObserver 与消息签名驱动的自动滚动，并在稳定结束时只做一次 `auto` 校正。

- `packages/opencode/webgui/src/components/MessageList/index.test.tsx`  
  覆盖 `MessageList` 对 settling 状态的接线，确认切换会话后两个 hooks 收到一致的控制信号。

- `packages/opencode/webgui/src/components/MessageList/hooks/useTopTrim.test.tsx`  
  覆盖稳定期内不 trim、不触发 `loadOlder`，以及稳定结束后恢复顶部行为。

- `packages/opencode/webgui/src/components/MessageList/hooks/useMessageScroll.test.tsx`  
  覆盖稳定期内不因 ResizeObserver 或消息签名变化滚动到底部，以及稳定结束后只做一次 auto 校正。

---

## 任务 1：接入稳定期状态

**Files:**

- Modify: `packages/opencode/webgui/src/components/MessageList/index.tsx`
- Test: `packages/opencode/webgui/src/components/MessageList/index.test.tsx`

- [ ] **Step 1: 先写失败测试，锁定会话切换后的接线语义**  
       在 `index.test.tsx` 增加用例：`sessionID` 变化后，`MessageList` 会向 `useTopTrim` 和 `useMessageScroll` 传入稳定期控制参数；稳定期结束前参数为暂停态，结束后恢复。  
       Run: `bun run test:run src/components/MessageList/index.test.tsx`  
       Expected: FAIL，提示 hooks 缺少新参数或切换后参数值不符合预期。

- [ ] **Step 2: 运行失败测试，确认断言命中当前缺口**  
       只保留最小场景：首次渲染、切到新 `sessionID`、推进定时器、再次断言传参。  
       Run: `bun run test:run src/components/MessageList/index.test.tsx`  
       Expected: FAIL，且失败点集中在 settling 状态尚未接入。

- [ ] **Step 3: 写最小实现，新增会话切换 settling 状态**  
       在 `index.tsx` 用 `sessionID` 变化驱动一次稳定期，向两个 hooks 透传统一的暂停标记与稳定结束信号。不要把时序分散到两个 hooks 内部，避免各自维护独立计时器。  
       Run: `bun run test:run src/components/MessageList/index.test.tsx`  
       Expected: PASS。

- [ ] **Step 4: 运行通过，确认空态与普通消息渲染不回归**  
       保留现有空态、中文文案与 `loadOlder` 接线断言，确保只是新增稳定期 wiring。  
       Run: `bun run test:run src/components/MessageList/index.test.tsx`  
       Expected: PASS。

---

## 任务 2：暂停顶部 trim 与历史加载

**Files:**

- Modify: `packages/opencode/webgui/src/components/MessageList/hooks/useTopTrim.ts`
- Test: `packages/opencode/webgui/src/components/MessageList/hooks/useTopTrim.test.tsx`

- [ ] **Step 1: 先写失败测试，锁定稳定期内的顶部行为**  
       在 `useTopTrim.test.tsx` 增加用例：稳定期内触顶滚动不会调用 `loadOlder`，远离顶部时也不会更新 `top-space`；稳定结束后再次滚动，`loadOlder` 与 trim 都会恢复。  
       Run: `bun run test:run src/components/MessageList/hooks/useTopTrim.test.tsx`  
       Expected: FAIL，提示稳定期内仍触发 `loadOlder` 或仍更新顶部占位。

- [ ] **Step 2: 运行失败测试，确认 trim 与 loadOlder 都被覆盖**  
       分开断言“暂停期间无副作用”和“恢复后有副作用”，避免单条测试同时掩盖两个问题。  
       Run: `bun run test:run src/components/MessageList/hooks/useTopTrim.test.tsx`  
       Expected: FAIL，且两个失败点都能直接指向 hook 内现有 `sync` / `load` 路径。

- [ ] **Step 3: 写最小实现，在稳定期内短路 trim / loadOlder**  
       给 `useTopTrim` 增加稳定期输入，暂停 scroll 事件里的 `sync()` 与 `load()` 副作用，并保证 session 切换重置状态时不会留下旧会话的 `pending` 补偿。恢复后仍沿用现有顶部占位与 prepend 补偿逻辑。  
       Run: `bun run test:run src/components/MessageList/hooks/useTopTrim.test.tsx`  
       Expected: PASS。

- [ ] **Step 4: 运行通过，确认旧有 trim 能力未回归**  
       回归现有 prepend 补偿、靠近顶部重新挂回、远离顶部裁剪等既有用例。  
       Run: `bun run test:run src/components/MessageList/hooks/useTopTrim.test.tsx`  
       Expected: PASS。

---

## 任务 3：暂停自动滚动并在稳定结束后只校正一次

**Files:**

- Modify: `packages/opencode/webgui/src/components/MessageList/hooks/useMessageScroll.ts`
- Test: `packages/opencode/webgui/src/components/MessageList/hooks/useMessageScroll.test.tsx`

- [ ] **Step 1: 先写失败测试，锁定稳定期内的滚动闸门**  
       在 `useMessageScroll.test.tsx` 增加用例：会话切换进入稳定期后，ResizeObserver 触发不会滚到底部，消息签名变化也不会触发 `scrollIntoView`；稳定结束时只触发一次 `scrollIntoView({ behavior: "auto", block: "end" })`。  
       Run: `bun run test:run src/components/MessageList/hooks/useMessageScroll.test.tsx`  
       Expected: FAIL，提示稳定期内仍发生自动滚动，或结束后触发次数大于一次。

- [ ] **Step 2: 运行失败测试，确认一次性 auto 校正的计数口径**  
       用 fake timers 和现有 `scrollIntoView` mock 区分“稳定期内禁止滚动”和“稳定结束单次校正”两个阶段。  
       Run: `bun run test:run src/components/MessageList/hooks/useMessageScroll.test.tsx`  
       Expected: FAIL，且失败点能区分 ResizeObserver 路径与消息签名路径。

- [ ] **Step 3: 写最小实现，给自动滚动加 settling 闸门**  
       给 `useMessageScroll` 增加稳定期输入，暂停 ResizeObserver 回调里的自动跟随，以及 `scrollSignature` 驱动的滚动效果。稳定结束时只在一个集中 effect 内执行一次 `auto` 校正，并在校正后恢复常规跟随，不新增第二套长期状态机。  
       Run: `bun run test:run src/components/MessageList/hooks/useMessageScroll.test.tsx`  
       Expected: PASS。

- [ ] **Step 4: 运行通过，确认常规跟随与按钮逻辑不回归**  
       回归现有“用户离底后停止自动滚动”“回到底部按钮显示”“工具状态变化继续跟随”等既有场景。  
       Run: `bun run test:run src/components/MessageList/hooks/useMessageScroll.test.tsx`  
       Expected: PASS。

---

## 任务 4：联调并补齐闪动回归验证

**Files:**

- Modify: `packages/opencode/webgui/src/components/MessageList/index.tsx`
- Modify: `packages/opencode/webgui/src/components/MessageList/hooks/useTopTrim.ts`
- Modify: `packages/opencode/webgui/src/components/MessageList/hooks/useMessageScroll.ts`
- Test: `packages/opencode/webgui/src/components/MessageList/index.test.tsx`
- Test: `packages/opencode/webgui/src/components/MessageList/hooks/useTopTrim.test.tsx`
- Test: `packages/opencode/webgui/src/components/MessageList/hooks/useMessageScroll.test.tsx`

- [ ] **Step 1: 先写失败测试，锁定跨 hook 的闪动回归场景**  
       在 `index.test.tsx` 增加一条集成向用例：切换到新会话后，先触发顶部 scroll、再触发内容 resize、再追加消息签名变化，稳定期内都不应产生额外 trim 或滚底，稳定结束后才恢复一次性校正。  
       Run: `bun run test:run src/components/MessageList/index.test.tsx src/components/MessageList/hooks/useTopTrim.test.tsx src/components/MessageList/hooks/useMessageScroll.test.tsx`  
       Expected: FAIL，提示三个路径中至少一条仍会在稳定期抢写布局。

- [ ] **Step 2: 运行失败测试，确认问题只剩联调边界**  
       如果单 hook 测试已通过，这一步的失败应只来自参数时序、恢复顺序或“一次性校正”去重。  
       Run: `bun run test:run src/components/MessageList/index.test.tsx src/components/MessageList/hooks/useTopTrim.test.tsx src/components/MessageList/hooks/useMessageScroll.test.tsx`  
       Expected: FAIL，且失败点集中在跨 hook 协调。

- [ ] **Step 3: 写最小实现，收敛恢复顺序**  
       调整 `MessageList` 与两个 hooks 的恢复时序，确保先完成一次 `auto` 校正，再恢复 trim 参与滚动联动，避免恢复瞬间再次触发顶部 spacer 跳变。  
       Run: `bun run test:run src/components/MessageList/index.test.tsx src/components/MessageList/hooks/useTopTrim.test.tsx src/components/MessageList/hooks/useMessageScroll.test.tsx`  
       Expected: PASS。

- [ ] **Step 4: 运行通过，确认目标场景稳定**  
       以切换标签 / 会话后的消息区首帧为重点，确认没有额外滚底、没有短时 spacer 抖动，也没有阻断后续正常历史加载。  
       Run: `bun run test:run src/components/MessageList/index.test.tsx src/components/MessageList/hooks/useTopTrim.test.tsx src/components/MessageList/hooks/useMessageScroll.test.tsx`  
       Expected: PASS。

---

## 验证命令

- `bun run test:run src/components/MessageList/index.test.tsx`
- `bun run test:run src/components/MessageList/hooks/useTopTrim.test.tsx`
- `bun run test:run src/components/MessageList/hooks/useMessageScroll.test.tsx`
- `bun run test:run src/components/MessageList/index.test.tsx src/components/MessageList/hooks/useTopTrim.test.tsx src/components/MessageList/hooks/useMessageScroll.test.tsx`
- `bun run build`
