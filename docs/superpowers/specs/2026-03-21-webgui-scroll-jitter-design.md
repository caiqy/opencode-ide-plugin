---
title: 滚动稳态
description: 重做长会话历史区滚动架构
---

# 滚动稳态

## 理解背景

当前 WebGUI 已完成长会话基础分层。`packages/opencode/webgui/src/state/MessagesContext.tsx` 已支持 session lazy load、latest-page-first 和 `loadOlder(sessionID)` 向上补历史。

当前渲染层位于 `packages/opencode/webgui/src/components/MessageList/index.tsx`。它通过 `hooks/useTopTrim.ts` 做 top-only trim，通过 `hooks/useMessageScroll.ts` 处理贴底自动滚动与 `scroll-to-bottom`。

现象发生在长会话向上滚动时。用户会看到短暂停顿，以及 2-4px 级别的上下反复位移。

---

## 界定问题

现有 `useTopTrim` 用 row 高度近似整个已裁剪历史区的高度。这个近似没有可靠覆盖 `space-y-2`、summary separator、局部 margin、条件插入块等真实垂直占用。

当前补偿还依赖 `scrollHeight` 前后差值。这个值会把浏览器 scroll anchoring、trim 边界重算和异步高度收敛混在一起，导致补偿量在边界附近来回抖动。

`useMessageScroll` 现在还会对整个内容高度变化做响应。历史区 prepend、trim、测量修正与尾部自动贴底因此共享一个滚动面，职责发生耦合。

问题本质不是阈值过小，也不是单个样式误差。问题本质是当前 trim 架构缺少精确历史高度模型和单一滚动协调器。

---

## 明确边界

### 目标

- 彻底替换现有 `useTopTrim` 补丁式思路，改为锚点驱动、精确测量、单一滚动协调器
- 保持 top-only trim，不把方案扩展成完整双向 virtualization
- 明确拆分历史区与尾部区，历史区可裁剪，尾部区永久保留
- 让向上翻历史、trim 进入与退出、动态高度收敛都以锚点补偿为准
- 让 `useMessageScroll` 只对 tail 区负责，不再对整个内容高度变化做 auto-scroll 反应
- 在 session 维度保留 window 与测量缓存，避免切换会话后重新抖动

### 非目标

- 不改变 `MessagesContext.tsx` 中 SSE、`question`、`permission`、`typing` 的产品语义
- 不改变 `scroll-to-bottom` 的交互定义，只改变其观测范围
- 不引入完整双向 virtualizer，也不把底部实时区做成可卸载区
- 不在本 spec 中展开实施排期、任务拆分或提交流程

---

## 比较方案

### 延续补丁

继续在 `useTopTrim.ts` 上补测 gap、separator 和 margin，并微调阈值。优点是改动最小，缺点是高度模型仍然是不完整近似，scroll anchoring 与 trim 边界竞争仍会持续存在。

### 双向虚拟化

把整个 `MessageList` 改为完整双向 virtualization。优点是理论上 DOM 最省，缺点是会把底部实时区、流式消息、`question`、`permission` 和贴底语义一起卷入复杂协调。

### 锚点驱动 top-only virtualization

把历史区和尾部区拆开，只对历史区做 top-only virtualization。优点是保留现有产品语义，同时用精确测量和锚点补偿消除抖动根因。

### 采纳结论

推荐第三种。它直接针对当前根因重做架构，又避免把系统带入完整双向 virtualizer 的高复杂度区间。

---

## 采用方案

新方案定义为“锚点驱动的 top-only virtualization”。它不是在 `useTopTrim` 上继续修补，而是以历史 block 为单位重建测量、窗口和补偿模型。

渲染树拆成两段。上半段是可裁剪的 history zone，下半段是永久保留的 tail zone。

history zone 只负责已完成历史内容。tail zone 始终保留当前视口附近到会话末尾的真实 DOM，用于承接 SSE 追加、`question`、`permission`、`typing`、`revert` 相关尾部交互和 `scroll-to-bottom`。

滚动补偿不再依赖 `scrollHeight` 差值猜测。系统改为在 trim 前后维持同一个视口锚点，并根据 prefix ledger 的精确变化量做一次性补偿。

浏览器 `overflow-anchor` 在消息滚动容器上显式关闭。滚动位置只允许由应用侧协调器控制。

---

## 设计架构

核心结构由四层组成。它们分别是 block 归并层、测量层、窗口层和滚动协调层。

block 归并层把 `visibleMessages` 转成稳定的 history blocks 与 tail blocks。block 是测量和 trim 的最小单位，不再把单条 row 视为完整高度真相。

测量层为每个 block 记录真实高度。高度来自 DOM `ResizeObserver` 和首次挂载测量，不使用纯样本估算来代表整个历史区。

窗口层维护当前 session 的 history window。它只决定哪些 history blocks 挂载到 DOM，tail zone 不参与裁剪。

滚动协调层在三类事件上工作。它们是向上翻页 prepend、trim 进入与退出、已挂载 block 高度变化。

---

## 拆分模块

### 定义 `useHistoryBlocks`

该模块从 `packages/opencode/webgui/src/components/MessageList/index.tsx` 当前的 `visibleMessages` 派生出 block 列表。它负责把消息 row、summary separator、`RevertBanner` 上方历史元素等真实垂直占用组织成稳定 block。

block 必须有稳定 `id`、所属 `sessionID`、包含的消息范围和 `kind`。建议至少区分 `history-message`、`history-summary`、`tail-message`、`tail-question`、`tail-typing` 这类用途，以保证测量边界稳定。

### 定义 `useHistoryMeasure`

该模块负责 block 级精确测量。它为每个 history block 建立 `measuredHeight`、`version` 和 `measuredAt`，并在 session 级缓存中保留结果。

它还负责生成 prefix height ledger。ledger 表示“从历史起点到某个 block 前的精确累计高度”，用于 O(1) 读取 trim spacer 高度和锚点补偿基线。

### 定义 `useHistoryWindow`

该模块只管理 history zone 的裁剪窗口。它根据 `scrollTop`、视口高度、双阈值 hysteresis 和已测量 ledger 计算 `startBlock`。

窗口推进只发生在历史区，tail zone 永远不参与 trim。窗口回退也必须经过退出阈值，避免在边界附近频繁抖动。

### 重定义 `useMessageScroll`

该模块保留在 `packages/opencode/webgui/src/components/MessageList/hooks/useMessageScroll.ts`。但它的观测对象从“整个内容高度变化”收缩为“tail zone 的贴底语义”。

它只在 tail 区新增消息、typing 变化和用户显式点击 `scroll-to-bottom` 时工作。history prepend、history trim 和 history 高度修正不再触发它的自动滚动分支。

### 引入滚动协调器

建议在 `MessageList` 内新增单一协调模块，例如 `useHistoryScroll`。它统一接管 history sentinel、anchor 选择、trim 补偿、prepend 补偿和高度修正补偿。

旧 `useTopTrim.ts` 的职责整体下沉到这里或被其拆分吸收。最终不再保留基于 row 累加和 `scrollHeight` 差值的旧模型。

---

## 描述数据流

### 生成数据

`MessagesContext.tsx` 继续负责最近页加载、向上翻页和 SSE 合流。`MessageList/index.tsx` 拿到按时间排序后的消息，再交给 `useHistoryBlocks` 划分 history zone 与 tail zone。

history zone 只包含可裁剪历史。tail zone 包含最近保留区、pending questions、typing indicator、底部 anchor，以及所有不允许被 trim 打断的尾部交互。

### 记录测量

history block 首次挂载后由 `useHistoryMeasure` 记录真实高度。高度变化时增量更新 block 缓存，并同步更新 prefix ledger。

session 切换后若 block key 未失效，缓存可直接复用。这样能避免每次回到长会话时重新经历一轮 trim 边界震荡。

### 推进窗口

滚动协调器在 scroll 事件中读取当前锚点和 ledger。若历史区超出进入阈值，窗口才前移并把更早 block 挂出 DOM。

若用户回滚接近顶部已裁剪边界，只有跨过退出阈值才回退窗口。进入阈值与退出阈值分离后，边界附近不会一上一下反复切换。

### 触发翻页

顶部 sentinel 仍用于触发 `loadOlder(sessionID)`。但翻页后的补偿方式改为“记录 prepend 前锚点 block + offset，DOM 更新后恢复锚点”，而不是用 `scrollHeight` 差值整体平移。

这保证新旧页插入后，用户看到的是同一块历史内容停在原位置。翻页本身不会把尾部自动滚动链路误触发。

---

## 描述补偿

补偿流程统一以 anchor 为核心。anchor 定义为“当前视口顶部附近第一个稳定可见的 history block，以及该 block 内的相对偏移”。

在 trim 进入前，协调器先读取 anchor。窗口变化后，通过新 ledger 计算该 anchor 的理论文档坐标，再一次性写回 `scrollTop`。

在 trim 退出前，流程相同。因为退出只是把之前裁掉的 block 重新挂回，补偿量由 ledger 精确给出，不再需要猜测 gap 或 separator 的贡献。

在 block 高度变化时，只有位于 anchor 之前的高度增量才参与补偿。anchor 之后的变化不应推动当前视口整体位移。

在 prepend 历史页时，协调器保存旧 anchor。新页插入后，若旧 anchor 仍存在，则恢复到旧 anchor；若旧 anchor 被结构变化替换，则退化到其后继稳定 block。

---

## 约束布局

消息滚动容器需要显式设置 `overflow-anchor: none`。该规则应落在承载 `messagesContainerRef.current?.parentElement` 的实际滚动容器上，而不是任意内层节点。

history spacer 只由 prefix ledger 驱动。它代表“当前已裁剪 history blocks 的精确累计高度”，不能再由近似 row 高度累加得到。

history block 的测量必须包含真实垂直占用。实现口径需要覆盖元素本体、上下 margin、列表 gap、条件 separator 和 block 间固定间距。

为了保证测量稳定，history zone 内应尽量避免把一个视觉块拆成多个独立补偿单元。summary separator 与对应消息若总是共同出现，应优先归并到同一 block。

tail zone 不允许被 spacer 穿插。它必须始终是真实 DOM，从而保持 `QuestionPart`、`TypingIndicator`、`ScrollToBottomButton` 和尾部消息语义稳定。

---

## 处理边界

会话切换时，需要同时恢复两类缓存。其一是 `MessagesContext.tsx` 里的消息页缓存，其二是 session 级 history window 与测量缓存。

若会话内容因 `revert`、summary 重算或服务端修正发生结构变化，旧 block key 失效部分应局部丢弃。缓存失效不能扩大成整个 session 全量清空。

若某个 block 尚未测得高度，系统可暂用保守 fallback。该 fallback 只用于尚未测量的单个 block，不能再拿来代表整段历史区。

若浏览器未提供 `ResizeObserver`，系统仍可退化运行。此时只保证首次挂载测量和 prepend 锚点稳定，不承诺动态高度修正达到最佳表现。

若顶部连续触发 `loadOlder`，仍沿用 `MessagesContext.tsx` 已有的同会话去重语义。滚动协调器只能消费最终落地页，不能自己并发发请求。

若用户正在 tail 区贴底，history zone 的 trim 或测量修正不应改变贴底判定。贴底判定只基于 tail 区末端与滚动容器的距离。

---

## 设定验收

### 功能验收

- 长会话向上滚动时，不再出现可感知的短暂停顿
- trim 边界附近不再出现 2-4px 级上下反复位移
- `loadOlder(sessionID)` prepend 后，原视口锚点保持稳定
- 底部实时区始终保留，SSE、`question`、`permission`、`typing` 语义不变
- `scroll-to-bottom` 只响应 tail 区需要，不再被历史区高度变化误触发
- 方案明确保持 top-only trim，并明确不采用完整双向 virtualization

### 技术验收

- `useTopTrim.ts` 不再作为补丁中心，历史裁剪职责迁移到新架构
- history spacer 来自 block 级 prefix height ledger，而不是 row 近似求和
- 消息滚动容器已关闭 `overflow-anchor`
- trim 进入与退出采用双阈值 hysteresis，边界切换无抖动翻转
- session 切换后可复用 window 与测量缓存，避免重复收敛

### 回归验收

- `packages/opencode/webgui/src/components/MessageList/index.tsx` 中 `RevertBanner` 与 `RevertSummary` 继续正常工作
- `packages/opencode/webgui/src/components/MessageList/Parts/QuestionPart` 保持可见与可交互
- `packages/opencode/webgui/src/components/TypingIndicator` 在 tail 区保持稳定
- `packages/opencode/webgui/src/state/useSessionActivation.ts` 的最近页激活语义不变

---

## 控制风险

最大风险是 block 切分过细，导致测量缓存和补偿逻辑复杂化。缓解方式是让 block 贴近视觉稳定单元，而不是机械按单条消息最小化拆分。

第二类风险是 tail 边界定义不清，导致某些实时元素被误归入 history zone。缓解方式是先把“不允许被 trim 打断”的 UI 语义固定下来，再决定 tail 起点。

第三类风险是缓存失效策略过粗，导致 session 切换时窗口跳变。缓解方式是用 block key 和 session version 做局部失效，而不是整会话重置。

---

## 说明迁移

迁移原则是替换架构，不改变产品语义。现有 `MessagesContext.tsx` 分页与 SSE 合流继续保留，改造重点集中在 `MessageList/index.tsx`、`hooks/useTopTrim.ts` 和 `hooks/useMessageScroll.ts` 所在渲染层。

迁移完成后，历史裁剪链路会从“row 估算 + `scrollHeight` 差值补偿”切换为“block 精测 + ledger + anchor 补偿”。这也是本方案明确批准的重做方向。

本设计明确排除完整双向 virtualization。原因不是它做不到，而是它会用更高系统复杂度换取当前并不需要的能力，并破坏尾部实时区的稳定语义。
