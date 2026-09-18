# 目标

补齐 IntelliJ IDEA（JetBrains）宿主端 ACP 能力：在 JetBrains 插件的 `IdeBridge` 中新增终端、代码问题诊断、运行配置执行/停止、调试等大类与子工具的上报（`getAcpCapabilities`）与执行（`executeAcpTool`），使 WebGUI 状态面板与 AI 运行时在 IDEA 中获得完整可用的宿主能力。

工具契约以 IDEA 平台模型为准（用户确认的设计原则），不追求与 VS Code 同名同参；能借用 VS Code 已验证的语义处（如嵌套变量展开）借鉴其设计，但命名与参数按 IDEA 概念定义。

# 范围

本期范围（用户确认：全量对齐，IDEA 原生设计）：

- `intellij`（既有，保持不变）：executeAction、listActions、editor。
- `tasks_and_problems`：
  - `listRunConfigurations`（既有，保持不变）
  - `getProblems`（新增）：返回工程/指定路径的 inspections 问题
  - `runConfiguration`（新增）：按名称以 Run 模式执行运行配置
  - `debugConfiguration`（新增）：按名称以 Debug 模式启动运行配置
  - `stopRunConfiguration`（新增）：停止运行配置的进程
- `debug`（新增，按 IDEA 调试模型设计，功能覆盖 VS Code 的 13 项）：
  - 读取：`getDebugState`、`getCallStack`、`getVariables`
  - 断点：`listBreakpoints`、`addLineBreakpoint`、`addExceptionBreakpoint`、`removeBreakpoint`
  - 控制与求值：`controlExecution`（resume/pause/stepOver/stepInto/stepOut）、`evaluateExpression`
- `terminal`（新增）：`sendToTerminal`（在 IDEA 终端执行，人可见可交互、不返回输出）+ `runCommand`（后台执行并返回 stdout/stderr 与退出码）。
- 单测覆盖新增能力，沿用 `src/unitTest/kotlin/paviko/opencode/ui/IdeBridgeUpdateTest.kt` 现有模式。

已查明的可用事实（Agent 调查结论）：

- 平台：IntelliJ Platform 2026.1.1（sinceBuild 261），Java 21；已声明依赖 `com.intellij.java`、`org.jetbrains.plugins.terminal`。
- 诊断：平台公开 API `InspectionManager.getProblemDescriptors`（Analyze Code 同源）。
- 运行配置：`RunManager` + `ProgramRunnerUtil` / `ExecutionManager`（现仅实现列举）。
- 调试：平台公开扩展点 `com.intellij.xdebugger.*`（`XDebuggerManager` / `XBreakpointManager` / `XDebugSession` / `XStackFrame` / `XValue` / `XDebuggerEvaluator`）；会话模型，无 DAP 线程语义。
- 命令执行：平台 `CapturingProcessHandler`（`GeneralCommandLine`）可后台执行并获取输出与退出码；终端发送依赖 `org.jetbrains.plugins.terminal` API（Build 期核实，若发送 API 不可用则以 Run 控制台展示作为降级）。
- 后端与 WebGUI 无需改动：`packages/opencode/src/session/tools.ts` 按宿主上报动态装配工具，`detectAcpPlatform` 已识别 `intellij` 并提供 `acp.platform_intellij` 配置命名空间。
- IDEA 端现状：2 大类 / 4 工具（executeAction、listActions、editor、listRunConfigurations）。

# 非目标

- 不改动 VS Code 宿主端实现。
- 不改动 opencode 核心层工具装配、平台隔离与 WebGUI 前端逻辑（现有机制已通用）。
- 不实现 VS Code 专有的 `extensions` 动态 LM 工具大类（IDEA 无对应运行时能力）。
- 不追求与 VS Code 工具同名同参（用户已确认 IDEA 原生优先）。

# 验收示例

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

# 约束与不变量

- 仅使用平台公开 API 与已声明依赖；不引入新的第三方依赖。
- `getAcpCapabilities` / `executeAcpTool` 数据契约保持现有 IDE Bridge 约定：成功 `{ok: true, result: {output}}`，失败 `{ok: false, error}`。
- 无活动调试会话、调试器不支持等场景必须返回明确错误，不影响插件其余功能与 WebGUI 运行。
- 现有 4 个工具的行为与参数 Schema 不得回归。
- 安全降级：宿主未连接或无能力时，工具不注册给大模型、调用返回明确错误。
- 单个工具调用须在 IDE Bridge 的 60 秒防御性超时内可返回；耗时能力（如全量 inspections）必须有范围限制或默认收窄。
- `getProblems` 的 30 秒预算只限制「是否继续启动下一个文件的扫描」；已启动的单次 inspection 无法被强制中断，其超时由桥接 60 秒兜底。

# 决策

- D1 change 名称与隔离：`idea-acp-capabilities`；工作区 `current`（沿用当前分支 `ide-plugin`，工作区干净、无其他 active change）。
- D2 本期范围（用户确认，2026-09-17 修订）：能力补齐 —— 终端 + 诊断 + 运行配置执行/停止 + 调试（不含内置浏览器）。
- D3 设计原则（用户确认）：**IDEA 原生优先** —— 工具 id、参数与返回语义按 IDEA 平台模型设计，不追求与 VS Code 同名同参；VS Code 已验证的细节语义（如变量嵌套展开）可借鉴。
- D4 调试工具契约（原生设计）：以调试会话（`sessionId`）为操作对象，不使用 `threadId`；返回结构按 IDEA 的会话/栈帧/变量引用模型设计。
- D5 诊断工具（原生设计）：`getProblems`，默认范围与限量策略见 Q3。
- D8 终端工具（用户确认）：两者都要 —— `sendToTerminal`（终端 tab 执行、不返回输出）与 `runCommand`（后台执行、返回输出与退出码）。
- D9 诊断默认范围（用户确认）：无 `path` 时扫描当前活动文件；显式传 `path`（文件或目录）时扫描该范围；传项目根为全量扫描，可能触达 60 秒上限并返回部分结果。
- D10 内置浏览器能力移除（用户决定，2026-09-17）：调研结论为 JetBrains 官方无成熟实现可复用（Air 的 Web Preview 仅截图 + 控制台，官方 issue AIR-6720 承认缺少交互/快照能力；Junie/AI Assistant 与内置 MCP Server 均无浏览器自动化工具；VS Code 的同类能力为平台原生 Playwright 实现）。用户决定不保留「仅打开页面」的半量能力：`integrated_browser` 类别与 `openPage` 工具整体移除，原 A8 场景作废，相关代码、单测与文档同步删除；后续如需浏览器自动化由独立 change 评估（自研注入式精简子集或 JCEF CDP 路线）。
- D11 getProblems 预算与取消语义（用户确认，2026-09-18）：截断（truncated）仅来自结果上限、文件数量上限或 30 秒预算到点后停止启动新文件；任何 inspection 执行异常（含扫描被取消）一律返回明确错误；不尝试判断取消来源（平台无法从异常反推是哪次取消触发，归因无法验证）。

# 待解决问题

（无：Q1–Q3 已全部确认。）

# 验证预期

- JetBrains 插件单测：`./gradlew.bat unitTest`（`hosts/jetbrains-plugin`）全部通过，且新增能力有对应单测。
- Kotlin 编译通过（`./gradlew.bat compileKotlin` 或 build）。
- 新增 ACP 能力可被 WebGUI 状态面板展示、并可经 `executeAcpTool` 路由执行（自动化覆盖路由与错误分支；真实 IDE 交互留人工验收）。
