# WebGUI 工具执行标题提前显示设计

日期：2026-02-24  
状态：已评审（用户逐节确认）

## 1. 背景与问题

当前 WebGUI 的工具执行组件中，`state.title` 通常在工具完成后才由 `tool-result` 写入。以 `bash` 为例，最终标题来自工具返回的 `title`（通常对应 `description`），因此用户常见体验是：

- 运行中仅看到工具名（如“执行命令”）
- 执行结束后才出现更具体标题

这会降低长耗时命令/多工具并发时的可读性与定位效率。

## 2. 目标与范围

### 目标

在工具进入 `running` 阶段时即可显示可读标题；工具完成后仍以最终结果标题为准。

### 范围

按“全部通用工具”执行，覆盖：

- `bash`
- `task`
- `skill`
- `question`
- `batch`
- `websearch`
- `codesearch`
- `lsp`
- `plan_enter` / `plan_exit`
- 以及其他当前依赖 `state.title` 的通用工具路径

## 3. 统一标题规则

1. **running 阶段**：优先显示可从 `input` 推导的标题；若无法推导则保持现有工具名显示。
2. **completed 阶段**：若 `result.title` 非空，用其覆盖 running 标题。
3. **completed 且 `result.title` 为空**：保留 running 标题（避免回退为空）。

## 4. 架构与数据流

### 现状

- `tool-call` 将 part 置为 `running`，通常无 `state.title`
- `tool-result` 才写入 `state.title = value.output.title`

### 设计

- 不变更消息 schema
- 复用 `Tool.Context.metadata({ title, metadata })`
- 在各工具 `execute` 初期主动调用一次 `ctx.metadata({ title })`

### 数据流

1. `tool-call`（`status=running`）
2. 工具启动后立即 `ctx.metadata({ title })`
3. 前端接收 part 更新并显示运行中标题
4. `tool-result`（`status=completed`）用最终 `result.title` 覆盖（若非空）

## 5. 各工具标题推导建议

- `bash`：`description` 优先，缺省回退命令摘要
- `task`：`description`
- `skill`：`Loading skill: <name>`
- `question`：`Asked N question(s)`
- `websearch` / `codesearch`：`Web search: <query>` / `Code search: <query>`
- `batch`：`Batch execution (...)` 的 running 版本
- `plan_enter` / `plan_exit`：保持已有明确标题文案
- 其他工具：遵循“input 可推导则展示”的统一原则

## 6. 错误处理与边界条件

1. 推导失败或为空：不强制写 title，保持工具名回退路径。
2. 执行中多次 metadata 更新：标题按“首次有效写入”策略，避免抖动。
3. 错误/中断/超时：保留 running 标题，配合 error 状态与 metadata 输出定位问题。
4. 兼容性：不迁移历史数据，仅影响新会话的新 tool parts。

## 7. 测试与验收

### 测试场景

1. running 即显示标题（未 completed 前可见）
2. completed 覆盖 running 标题
3. completed 无最终标题时保留 running 标题
4. error/abort/timeout 仍保留 running 标题
5. 多工具回归（至少覆盖 `bash/skill/question/websearch/codesearch/batch`）

### 验收标准

- 工具开始执行时即可看到可读标题
- 标题规则稳定：running 推导、completed 覆盖
- 无明显抖动与空标题退化
- 旧会话兼容，消息结构不变

## 8. 非目标（YAGNI）

- 不在本设计中改造前端标题生成主逻辑
- 不引入历史数据回填/迁移
- 不扩展与本问题无关的 UI 交互改动
