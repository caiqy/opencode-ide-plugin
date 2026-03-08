# WebGUI task_result Markdown 展示设计

- 日期：2026-03-08
- 状态：已评审（用户逐段确认）

---

## 背景与问题

当前 WebGUI 中，`task` 工具展开区使用通用纯文本渲染，`<task_result>...</task_result>` 内的内容不会按 Markdown 展示，导致可读性不足。

同时，`task` 工具输出通常包含标签外信息（例如 `task_id: ...`），本次需求明确要求仅展示 `task_result` 标签内内容。

---

## 目标与范围

### 目标

在 WebGUI 中实现：主会话消息列表里，`task` 工具的底部展开内容应将 `<task_result>` 标签内文本按 Markdown 渲染。

### 范围（In Scope）

- 仅作用于：主会话中 `task` 工具的展开内容。
- 仅展示 `<task_result>...</task_result>` 标签内部文本。
- 标签内部文本通过 Markdown 渲染。
- 当标签缺失或标签内容为空时，展示空状态。

### 非目标（Out of Scope / YAGNI）

- 不改动其他工具（`bash`/`read`/`glob` 等）的输出渲染规则。
- 不将标签外文本（如 `task_id: ...`）展示到展开区。
- 不扩展为“任意标签可配置解析”。
- 不改后端 `task` 工具输出协议。

---

## 方案对比与决策

### A. 在 `ToolPart` 里做 `task` 专用渲染

优点：改动最小、风险低。
缺点：协议解析逻辑落在 UI 层，复用性和长期维护性一般。

### B. 扩展 `GenericOutput` 支持标签提取

优点：通用组件可复用。
缺点：通用组件复杂化，本需求单点场景下有过度设计风险。

### C. 数据层预解析（选中）

在消息进入前端状态时预解析 `task_result`，渲染层只消费结构化字段。

优点：

- 协议细节集中在数据层；
- UI 组件更纯粹；
- 历史加载与实时流可统一规则；
- 后续协议调整只改一处。

缺点：

- 改动触达消息入库链路，初始改动面大于 A。

结论：采用方案 C（按用户确认）。

---

## 架构设计

采用“解析层 + 渲染层”分离：

1. **解析层（state/data adapter）**
   - 对 `tool === "task"` 的 part 解析 `state.output`。
   - 提取 `<task_result>...</task_result>` 内容并产出结构化字段。

2. **消息接入层（MessagesContext）**
   - 在两条接入路径统一执行解析：
     - SSE 实时更新：`message.part.updated`；
     - 历史加载：`loadSessionMessages`。

3. **渲染层（ToolPart）**
   - 只读取结构化字段决定展示：
     - 有内容：Markdown 渲染；
     - 无内容：空状态。

---

## 组件与文件影响（设计级）

- `packages/opencode/webgui/src/types/messages.ts`
  - 为 `tool` part 的前端消费增加可选结构化字段（例如 `parsed.task_result`）。

- `packages/opencode/webgui/src/lib/messagesStore.ts`（可选）
  - 若采用集中入库适配，可在 store 层或其上层统一调用适配函数。

- `packages/opencode/webgui/src/state/MessagesContext.tsx`
  - 在 `message.part.updated` 入库前适配；
  - 在 `loadSessionMessages` 批量写入前适配。

- `packages/opencode/webgui/src/components/parts/ToolPart/index.tsx`
  - `task` 分支读取结构化字段渲染 Markdown；
  - 结构化字段无内容时展示空状态；
  - 保持其它工具现有渲染行为。

---

## 数据流

### 实时流（SSE）

1. 收到 `message.part.updated`。
2. 若 `part.type === "tool" && part.tool === "task"`，解析 `part.state.output`。
3. 生成结构化字段并写入消息状态。
4. `ToolPart` 渲染读取结构化字段，输出 Markdown 或空状态。

### 历史加载流

1. 调用 `loadSessionMessages(sessionID)` 拉取消息列表。
2. 对列表中的 `task` tool part 执行同一解析器。
3. 写入状态后，UI 呈现与实时流一致。

---

## 解析与边界规则

针对 `task` 工具输出：

1. 存在 `<task_result>` 且内容非空：
   - `has_content = true`
   - `markdown = 标签内部文本`

2. 不存在 `<task_result>`：
   - `has_content = false`
   - 展示空状态

3. 存在标签但内容为空或仅空白：
   - `has_content = false`
   - 展示空状态

4. 异常格式：
   - 采用最小鲁棒策略（优先第一段合法标签内容）；
   - 无法提取时按无内容处理。

---

## 错误处理与可观测性

- 解析失败不抛出到 UI，按“无内容”处理，防止渲染链路中断。
- 保留最小必要日志（开发态）用于定位异常输出格式。
- 不引入重试机制（纯前端解析，无网络行为）。

---

## 测试与验收

### 单测最小集

1. 解析器单测
   - 标准输出：`task_id + <task_result>markdown</task_result>` 仅提取标签内文本。
   - 无标签：返回无内容。
   - 空标签：返回无内容。
   - 多标签/异常格式：验证最小鲁棒策略。

2. `ToolPart` 渲染单测
   - `task` + 有内容：验证 Markdown 渲染生效。
   - `task` + 无内容：验证空状态展示。
   - 非 `task` 工具：行为不变。

3. `MessagesContext` 接入一致性单测
   - SSE 路径与历史加载路径都执行同一适配规则。

### 验收标准

- 主会话里展开 `task` 工具时：
  - 仅展示 `task_result` 内 Markdown 内容；
  - 不展示标签外文本；
  - 标签缺失或空内容时展示空状态。

---

## 风险与回退

- 风险：消息类型扩展若处理不当，可能影响现有类型推断。
- 风险：在两条入库路径适配不一致会造成“刷新前后显示差异”。

回退策略：

- 以最小变更回退 `task` 结构化字段消费，恢复到当前纯文本展示；
- 解析器和渲染测试保留，便于后续重启方案时快速验证。
