# IntelliJ IDEA 宿主 ACP 能力补齐

## 需求与交互目标

在 JetBrains 插件中补齐 ACP（Agent Client Protocol）宿主能力，使 IDEA 端在 WebGUI 状态面板展示与 AI 运行时调用上具备完整的宿主能力：

1. **终端**：在 IDEA 终端中执行命令（`sendToTerminal`），并支持后台执行并捕获输出（`runCommand`，返回 stdout/stderr 与退出码）。
2. **代码问题诊断**：返回工程或指定路径的 inspections 问题。
3. **运行配置执行/停止**：执行与停止 Run/Debug Configuration（现有实现只能列举）。
4. **调试**：按 IDEA 调试模型提供会话状态、调用栈、变量、断点、执行控制与表达式求值能力。

所有能力通过现有 IDE Bridge 协议（`getAcpCapabilities` / `executeAcpTool`）上报与执行，由 WebGUI 状态面板展示并通过 `acp.platform_intellij` 配置命名空间控制启停。

## 详细行为规范

### 1. 通信协议（沿用现有 IDE Bridge，不改变）

- 请求 `getAcpCapabilities` → 响应 `{ categories: [{ id, name, description, status, tools: [{ id, name, description, parametersSchema }] }] }`。
- 请求 `executeAcpTool` payload `{ category, toolId, parameters }` → 成功 `{ ok: true, result: { output } }`；失败 `{ ok: false, error }`。
- 宿主未连接或能力不可用时，工具不注册给大模型；调用返回明确错误。
- 单个调用须在 60 秒内返回；耗时能力必须有范围限制或默认收窄。

### 2. 设计原则

工具 id、参数与返回语义按 IDEA 平台模型设计（用户确认），不追求与 VS Code 同名同参。借鉴点仅限通用语义（如变量嵌套展开、明确的错误返回）。

### 3. 大类与工具清单（IDEA 目标态）

- `intellij`（既有，保持不变）：
  - `executeAction`、`listActions`、`editor`。
- `tasks_and_problems`：
  - `listRunConfigurations`（既有）：列出工程 Run/Debug Configuration 名称。
  - `getProblems`（新增）：返回 inspections 问题；无 `path` 时扫描当前活动文件，传 `path` 时扫描指定文件或目录，传项目根为全量扫描（可能触达 60 秒上限并返回部分结果）；结果遵守数量上限。截断（truncated）仅由结果上限、文件数量上限或 30 秒预算到点后停止启动新文件产生；任何 inspection 执行异常（含扫描被取消）返回明确错误，不尝试归因取消来源。
  - `runConfiguration`（新增）：按名称以 Run 模式执行运行配置。
  - `debugConfiguration`（新增）：按名称以 Debug 模式启动运行配置。
  - `stopRunConfiguration`（新增）：停止运行配置的进程；无匹配时返回明确错误。
- `debug`（新增）：
  - `getDebugState`：返回当前调试会话与暂停状态。
  - `getCallStack`：返回会话的栈帧列表（文件、行号、帧标识）。
  - `getVariables`：按栈帧/变量引用读取变量值，支持嵌套展开。
  - `listBreakpoints`：列出断点（行断点与异常断点及启用状态）。
  - `addLineBreakpoint`：在指定文件行添加行断点，支持条件、命中次数、日志消息。
  - `addExceptionBreakpoint`：添加异常断点（异常类与捕获/未捕获过滤）。
  - `removeBreakpoint`：按断点标识删除断点。
  - `controlExecution`：resume / pause / stepOver / stepInto / stepOut。
  - `evaluateExpression`：在暂停会话的指定栈帧上下文中求值表达式。
- `terminal`（新增）：
  - `sendToTerminal`：在 IDEA 终端中执行命令（人可见、可交互、不返回输出）。
  - `runCommand`：后台执行命令并返回 stdout/stderr 与退出码；非零退出码不作为错误；命令为空、无法启动或执行超时返回明确错误；输出超过上限时截断并标注；执行超时上限不超过桥接 60 秒防御性超时。

### 4. 调试语义（IDEA 模型）

- 操作对象为 `XDebuggerManager` 管理的调试会话；工具以会话标识（或当前活动会话）为入口，不使用 DAP 线程语义。
- 状态/调用栈/变量：暂停时通过 `XDebugSession` / `XStackFrame` / `XValue` 读取；变量支持嵌套展开。
- 断点：`XBreakpointManager` 管理行断点（条件、命中次数、日志消息）与异常断点（`JavaExceptionBreakpointType` 过滤）。
- 执行控制：映射到 `XDebugSession` 的 resume / pause / stepOver / stepInto / stepOut。
- 求值：`XDebuggerEvaluator`，要求暂停状态且存在可求值栈帧。
- 无活动会话、未暂停等场景返回明确错误。

## 验收场景

- Scenario: A1 新增能力上报与面板展示
  - GIVEN IntelliJ IDEA 插件运行且 WebGUI 已连接该宿主
  - WHEN 用户打开 ACP 状态面板（等价于宿主响应 `getAcpCapabilities`）
  - THEN 响应包含 `terminal`（sendToTerminal、runCommand）与 `debug`（getDebugState、getCallStack、getVariables、listBreakpoints、addLineBreakpoint、addExceptionBreakpoint、removeBreakpoint、controlExecution、evaluateExpression）大类，以及 `tasks_and_problems` 新增的 getProblems、runConfiguration、debugConfiguration、stopRunConfiguration
  - AND 每个工具带有可校验的 parametersSchema；既有 intellij/tasks_and_problems 的 4 个工具名称与 Schema 保持不变
  - AND 未开启的工具不会注册给模型（沿用默认全量禁用与按配置启用的现有机制）

- Scenario: A2 终端执行能力
  - GIVEN 已开启 `terminal` 类工具
  - WHEN 模型调用 `sendToTerminal` 执行命令
  - THEN 命令在 IDEA 终端中执行，调用返回成功但不包含命令输出
  - AND 模型调用 `runCommand` 执行命令时，返回 stdout/stderr 与退出码；非零退出码不作为错误；命令为空、无法启动或执行超时返回明确错误

- Scenario: A3 代码问题诊断
  - GIVEN 已开启 `getProblems` 且编辑器中有活动文件
  - WHEN 模型调用 `getProblems`
  - THEN 返回活动文件的 inspections 问题（文件、行列、严重级别、描述），并遵守结果上限
  - AND 传入 `path` 时返回该文件或目录范围的问题；无活动文件且未传 path 时返回明确错误
  - AND 结果截断（truncated）仅由结果上限、文件数量上限或 30 秒预算到点后停止启动新文件产生；任何 inspection 执行异常（含扫描被取消）都返回明确错误，不尝试归因取消来源

- Scenario: A4 运行配置执行与停止
  - GIVEN 工程存在已配置的运行配置，相关工具已开启
  - WHEN 模型以名称调用 `runConfiguration` / `debugConfiguration`
  - THEN 分别以 Run / Debug 模式启动对应运行配置
  - AND 名称不存在时返回明确错误；`stopRunConfiguration` 停止正在运行的配置，无匹配进程时返回明确错误

- Scenario: A5 调试状态读取
  - GIVEN 调试会话在断点处暂停，debug 类工具已开启
  - WHEN 模型调用 `getDebugState`、`getCallStack`、`getVariables`
  - THEN 分别返回会话与暂停状态、栈帧列表（文件、行号、帧标识）、变量值（支持按引用嵌套展开）
  - AND 无活动会话或未暂停时返回明确错误

- Scenario: A6 断点管理
  - GIVEN debug 类工具已开启
  - WHEN 模型调用 `listBreakpoints`、`addLineBreakpoint`（可含条件、命中次数、日志消息）、`addExceptionBreakpoint`、`removeBreakpoint`
  - THEN 断点列表与 IDEA 断点管理器状态一致地更新
  - AND 文件或行无效、断点标识不存在、异常断点参数不合法时返回明确错误

- Scenario: A7 执行控制与表达式求值
  - GIVEN 存在暂停的调试会话
  - WHEN 模型调用 `controlExecution`（resume/pause/stepOver/stepInto/stepOut）或 `evaluateExpression`
  - THEN 动作透传到对应调试会话，求值返回结果值与类型
  - AND 无会话、未暂停或栈帧不可求值时返回明确错误

- Scenario: A8 安全降级与既有功能不回归
  - GIVEN 宿主未连接、无对应能力或工具未启用
  - WHEN 调用任意新增工具或查看状态面板
  - THEN 返回明确错误或按现有机制不注册工具，WebGUI 运行不受影响
  - AND 既有 intellij、tasks_and_problems（含 listRunConfigurations）与桥接协议行为保持不变
