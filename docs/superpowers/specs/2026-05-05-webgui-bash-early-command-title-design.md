# WebGUI bash 工具卡片在运行开始时提前显示命令标题

> 日期：2026-05-05
> 状态：待审阅

## 问题

当前 WebGUI 中的 bash 工具卡片，在命令真正执行完成前，头部通常只显示通用文案 `执行命令`，而不会立即显示模型已经提供的命令说明，例如：

- `执行命令：查看工作区变更`
- `执行命令：查看变更摘要与差异`

从用户感知看，这会造成一个不自然的延迟：

- AI 在发起 bash 工具调用时其实已经给出了 `description`
- 但 UI 要等到 `tool-result` 写回 `state.title` 后才展示完整标题
- 在命令执行耗时稍长时，用户会先看到一个信息量较低的占位标题，直到命令结束才看到真正标题

这会弱化工具执行过程的可读性，也让“命令已经被规划出来”这一时刻没有及时反馈到界面上。

## 范围

本次只修复 WebGUI 中 **bash 工具卡片标题的提前展示**，不扩展到其他工具，也不改后端事件流。

包含：

- `packages/opencode/webgui/src/components/parts/ToolPart/utils.tsx` 中 bash 标题展示兜底逻辑
- 对应单元测试

不包含：

- `task` 以外其他工具的 `description` 展示策略统一
- 后端在 running 阶段提前写入 `state.title`
- 工具卡片视觉样式、图标、动画调整
- Bash 输出区域的渲染逻辑修改

## 方案

采用 **前端展示层兜底** 方案：当 bash 工具卡片尚未拿到 `state.title` 时，如果 `state.input.description` 已存在，则直接用它生成标题展示。

### 规则

`getToolDisplayName(tool, input, title, output)` 对 bash 的处理调整为：

1. 如果 `title` 已存在，继续优先使用 `title`
2. 如果 `tool === "bash"` 且 `title` 不存在，但 `input.description` 是非空字符串，则显示：
   - `执行命令：${input.description}`
3. 其余情况保持现有回退逻辑不变

这样可以保证：

- 运行中：尽早显示模型给出的命令说明
- 完成后：仍以后端最终写回的 `title` 为准

## 为什么选择这个方案

- 改动最小，只触达 WebGUI 展示层
- 不需要调整后端 `tool-call` / `tool-result` 事件语义
- 与用户确认的范围一致：只修 bash，不做全局扩散
- 风险低，不会影响工具执行、SSE、消息存储与已有结果结构

相比“后端在 running 时提前写 `state.title`”的方案，这里不需要改动更深层的数据流；相比“所有带 description 的工具统一提前显示”的方案，这里避免了把未验证的展示规则扩散到其他工具。

## 设计细节

### 现状

当前 `ToolPart` 的标题展示依赖：

- `part.state.title`：如果后端已经写回标题，则显示 `工具名：标题`
- 否则退回到基于 `input` 的工具特定展示

对 bash 来说，现有回退路径没有使用 `input.description`，所以在命令运行中通常只显示：

- `执行命令`

而后端 `bash` 工具在完成时会返回：

- `title: input.description`

因此完整标题只会在 completed 阶段出现。

### 调整点：`utils.tsx`

在 `getToolDisplayName(...)` 中，为 bash 增加一个局部兜底分支：

- 放在“无 `title` 时根据 `input` 构造标题”的逻辑内
- 仅对 `tool === "bash"` 生效
- 仅在 `input.description` 为非空字符串时生效

这样不会改变其他工具的展示行为，也不会覆盖 completed 阶段已经存在的 `title`。

### 行为示例

#### 调整前

- 运行中：`执行命令`
- 完成后：`执行命令：查看工作区变更`

#### 调整后

- 运行中：`执行命令：查看工作区变更`
- 完成后：`执行命令：查看工作区变更`

也就是说，这次改动的核心不是改变最终标题内容，而是**把展示时机提前到命令开始运行时**。

## 文件改动清单

### 修改

- `packages/opencode/webgui/src/components/parts/ToolPart/utils.tsx`
- `packages/opencode/webgui/src/components/parts/ToolPart/utils.test.ts`

## 测试

本次适合通过小范围 TDD 覆盖一个新增展示规则。

### `utils.test.ts`

至少新增以下用例：

1. 当工具为 `bash`、`title` 缺失、`input.description` 存在时，应显示：
   - `执行命令：<description>`
2. 当 `title` 已存在时，应继续优先使用 `title`，避免被 `input.description` 覆盖
3. 非 bash 工具在无 `title` 时，继续保持原有展示规则，不因本次改动发生行为漂移

其中第 1 条是本次 bug 的直接回归测试，必须先失败再补实现。

## 风险与兼容性

风险较低，主要注意点如下：

- 需要确保新分支只影响 bash，避免误伤 read / write / grep 等工具的现有标题规则
- 需要确保 `title` 的优先级高于 `input.description`，避免 completed 后标题被兜底值抢占
- 若未来后端开始在 running 阶段正式写入 bash `state.title`，本次兜底逻辑仍然兼容，因为优先级仍是 `title` 在前

## 非目标

本次不处理以下内容：

- 所有工具的“运行中标题提前显示”统一策略
- `task`、`question`、`skill` 等工具的标题来源统一
- 后端消息结构或 session processor 行为调整
- 工具执行完成前的耗时显示、状态图标或展开面板优化

## 预期结果

用户在 WebGUI 中看到 bash 工具调用时：

- 不必等命令执行结束，卡片头部就能立即显示命令说明
- 运行中与完成后的标题文案保持一致
- 其余工具卡片与后端数据流行为保持不变
