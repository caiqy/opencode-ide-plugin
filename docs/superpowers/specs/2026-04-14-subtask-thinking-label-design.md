# 委派子任务状态文案统一为“思考中”

> 日期：2026-04-14
> 状态：待审阅

## 问题

当前“委派子任务”相关 UI 在没有进行中的工具调用时，会显示“空闲”。

这个文案出现在至少两个地方：

- `packages/opencode/webgui/src/components/parts/ToolPart/index.tsx`
- `packages/opencode/webgui/src/components/SubtaskDrawer/SubtaskDrawer.tsx`

从用户视角看，子任务并不是真的“空闲”，而更像是在等待下一步调度或内部推理，因此“空闲”容易让人误以为流程停住或已经没有后续动作。产品期望改成“思考中”，让状态语义更贴近真实感知。

## 范围

本次只调整“委派子任务”链路中的状态文案，不扩散到 WebGUI 其他模块中出现的“空闲”文案。

包含：

- 主消息流中的 task 工具卡片标题摘要
- SubtaskDrawer 头部摘要
- 上述两处对应测试
- 新增一个子任务专用状态文案 helper，并让两处共用

不包含：

- 其他组件或页面里的“空闲”状态
- 后端、SSE、消息结构、状态存储逻辑
- 阻塞态（等待授权 / 等待回答）的现有文案和行为

## 方案

采用一个“子任务专用状态文案 helper”统一生成 task 摘要中的当前状态文本，避免 `ToolPart` 与 `SubtaskDrawer` 分别维护一套近似但容易漂移的回退逻辑。

### 规则

helper 输出规则如下：

1. 如果存在 `running` 或 `pending` 的工具调用：返回当前工具名称，例如“执行命令”“读取文件”
2. 如果不存在进行中的工具调用，且父 task 已完成：返回“已完成”
3. 如果不存在进行中的工具调用，且父 task 未完成：返回“思考中”

换句话说，“空闲”在委派子任务语义下被彻底替换为“思考中”。

## 为什么选择这个方案

- 只改展示层，不改数据流，风险低
- 将文案规则集中到一个 helper，避免主卡片与抽屉头部以后再次不一致
- 保持“已完成”分支不变，不影响现有完成态语义
- 与用户确认的范围一致：只改委派子任务相关文案，不做全局统一替换

## 设计细节

### helper 的职责

新增一个小型纯函数，专门负责“委派子任务当前状态文案”的计算。它不是全局通用状态工具，而是服务 task 子任务摘要的局部能力。

输入概念上包括：

- 是否存在当前进行中的工具调用
- 当前工具名（如有）
- 父 task 是否已完成

输出为一个字符串：

- 当前工具名
- `思考中`
- `已完成`

### `ToolPart/index.tsx`

当前这里在子任务没有活动工具时，会直接退回：

- 已完成 → `已完成`
- 未完成 → `空闲`

改动后：

- 保留已有的 `toolParts` 搜集逻辑
- 保留已有的 `currentTool` 识别逻辑
- 不再直接写死 `空闲`
- 改为调用新 helper 生成摘要里的当前状态文案

最终标题仍保持现有结构：

`委派子任务 (general)：Demo Task [ 2 工具调用 / 思考中 ]`

其中前半段的 agent 类型、标题、工具调用计数都不变，只替换末尾状态文本的来源。

### `SubtaskDrawer/SubtaskDrawer.tsx`

当前这里维护了独立的一套逻辑：

- 初始 `currentToolLabel` 默认 `空闲`
- 若 `isParentCompleted` 为 true，再将 `空闲` 覆盖为 `已完成`

改动后：

- 保留 `toolParts` 统计与 `isParentCompleted` 判断
- 改为调用与 `ToolPart` 相同的 helper
- 去掉“先空闲、再补丁式改成已完成”的两段式判断

这样抽屉头部与主卡片会基于完全相同的状态文案规则渲染。

## 文件改动清单

### 新增

- 一个子任务状态文案 helper 文件，或在适合的共享位置新增导出

### 修改

- `packages/opencode/webgui/src/components/parts/ToolPart/index.tsx`
- `packages/opencode/webgui/src/components/SubtaskDrawer/SubtaskDrawer.tsx`
- `packages/opencode/webgui/src/components/parts/ToolPart/index.test.tsx`
- `packages/opencode/webgui/src/components/SubtaskDrawer/SubtaskDrawer.test.tsx`
- 如 helper 独立成文件，则新增对应测试文件

## 测试

本改动适合通过小范围单元/组件测试覆盖。

### helper 测试

至少覆盖：

1. 有进行中工具时，返回工具名
2. 无进行中工具且父 task 未完成时，返回 `思考中`
3. 无进行中工具且父 task 已完成时，返回 `已完成`

### `ToolPart/index.test.tsx`

更新原有与“空闲”相关的断言：

- `工具调用 / 空闲` → `工具调用 / 思考中`

并保留现有“已完成”断言，确认完成态未被影响。

### `SubtaskDrawer/SubtaskDrawer.test.tsx`

更新与“空闲”相关的测试意图：

- “没有进行中的工具调用时，显示当前为空闲”
  改为
- “没有进行中的工具调用且父 task 未完成时，显示当前为思考中”

同时保留：

- 冷启动加载文案测试
- 父 task 已完成时显示 `已完成` 的测试

## 风险与兼容性

风险较低，原因如下：

- 不改数据结构与业务事件
- 不改交互行为
- 只改局部展示文案和一小段共享判断

需要注意的是：

- 若测试中存在多处硬编码“空闲”字符串，需要同步更新，避免漏改导致误报
- helper 应保持语义专用，避免被误当成全局通用状态工具继续扩散使用

## 非目标

本次不处理以下内容：

- `UpdateBanner.tsx` 等其他地方的 `idle: "空闲"`
- TUI / 其他 host / 非 task 工具卡片的状态文案统一
- 对“思考中”增加动画、图标或新的视觉样式

## 预期结果

用户在查看“委派子任务”时：

- 如果子任务当前没有活动工具、但整体尚未结束，会看到“思考中”而不是“空闲”
- 主卡片与抽屉头部文案保持一致
- 已完成、等待授权、等待回答等其他状态保持原有行为和语义
