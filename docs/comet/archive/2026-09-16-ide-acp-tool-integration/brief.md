# 目标

全面打通 VS Code 与 IntelliJ IDEA 双端 IDE 宿主能力（ACP, Agent Client Protocol）的展示与 AI 运行时调用闭环：在 JetBrains 插件端适配 `getAcpCapabilities` 与 `executeAcpTool`，对齐 IDEA 核心动作、任务与诊断能力；在 VS Code 插件端实现 `executeAcpTool` 工具执行中继；采用“宿主进程环境变量自动注入 + WebGUI 前端连接自动握手兜底”双保险机制实现通信凭据对用户完全无感的无缝传递，并在 OpenCode 核心执行循环（`SessionTools`）中动态装配启用的 ACP 工具供大模型感知与调用，实现“前端可视化开关 + 配置统一持久化 + 大模型双端直接调用执行”的全流程闭环。

# 范围

- **JetBrains 宿主端能力适配（hosts/jetbrains-plugin）**：
  - 在 `IdeBridge.kt` 中新增 `getAcpCapabilities` 处理：上报 `intellij`（Action 触发、终端、文件操作）与 `tasks_and_problems`（Run Configuration 任务、代码问题检查）等大类及子工具定义，补齐参数 Schema。
  - 在 `IdeBridge.kt` 中新增 `executeAcpTool` 处理：通过 `ActionManager`、`RunManager`、`WolfTheProblemSolver` 等调度真实执行并返回序列化结果。
  - 在 `BackendLauncher.kt` 启动 `opencode serve` 时自动注入 `OPENCODE_IDE_BRIDGE_URL` 与 `OPENCODE_IDE_BRIDGE_TOKEN` 环境变量。
- **VS Code 宿主端执行中继（hosts/vscode-plugin）**：
  - 在 `getAcpCapabilities` 中补充核心工具及扩展工具（`vscode.lm.tools`）的输入参数 Schema（`parametersSchema`）。
  - 在 `IdeBridgeServer.ts` 与 `WebviewController.ts` 中新增 `executeAcpTool` 处理：调度 `vscode.commands.executeCommand`、`vscode.languages.getDiagnostics`、`vscode.tasks.executeTask` 以及 `vscode.lm.invokeTool`，将执行结果返回。
  - 在 `BackendLauncher.ts` 的 `buildEnvironment` 中自动注入 `OPENCODE_IDE_BRIDGE_URL` 与 `OPENCODE_IDE_BRIDGE_TOKEN`。
- **双保险通信凭据传递（零用户配置）**：
  - 首选通道：宿主拉起 `opencode serve` 时通过进程 options 自动注入环境变量。
  - 兜底通道：WebGUI 初始化时若检测到 `window.location.search` 中的 `ideBridge` 与 `ideBridgeToken`，通过轻量 API 向当前 OpenCode 后端注册宿主地址，支持外部命令启动等边缘场景。
- **OpenCode 核心层运行时工具装配（packages/opencode）**：
  - 封装轻量级宿主 Bridge 通信客户端（统一消费注入的环境变量或前端握手注册的凭据）。
  - 在 `src/session/tools.ts` 中感知宿主 Bridge 能力与 `opencode.json` 中的 `acp` 开关配置：仅将已启用的子工具包装为标准大模型 Tool，挂载其参数 Schema 与描述。
  - 大模型触发 Tool Call 时，通过 Bridge 派发 `executeAcpTool` 到宿主执行，捕获结果与超时异常，回填给模型执行流。
- **安全降级与无缝兼容**：
  - 在未设置凭据或未连接宿主（外部独立浏览器、纯 CLI）时静默降级，不挂载 ACP 工具，不影响现有任何内建工具（如 bash、read、edit 等）。
- **自动化测试**：
  - 单元测试覆盖 JetBrains `IdeBridge.kt` 的 `getAcpCapabilities` 与 `executeAcpTool` 消息路由。
  - 单元测试覆盖 VS Code `IdeBridgeServer.ts` 与 `WebviewController.ts` 的 `executeAcpTool` 分发。
  - 单元测试覆盖 OpenCode 核心层 ACP 工具动态过滤、装配与执行转发逻辑。

# 非目标

- 本期不修改已有 MCP（Model Context Protocol）协议实现与数据结构，ACP 作为 IDE 宿主专有协同层独立运行。
- 本期不在没有宿主 IDE 的纯 headless 服务器环境下模拟 VS Code 或 IDEA 内部私有 API。

# 验收示例

- Scenario: A1 JetBrains 宿主能力探测与展示对齐
  - GIVEN WebGUI 运行在 IntelliJ IDEA 插件环境中
  - WHEN 用户切换至状态面板中的 ACP 标签页
  - THEN 页面通过 ideBridge 获取 IDEA 上报的大类能力卡片（如 intellij 动作与终端、tasks_and_problems 任务与问题）
  - AND 不再呈现空状态，展示各子工具详细描述与开关控件

- Scenario: A2 VS Code 宿主端执行 ACP 工具
  - GIVEN VS Code 宿主收到 executeAcpTool 请求
  - WHEN 目标工具为内置命令（如 executeCommand）或扩展工具（通过 vscode.lm.invokeTool）
  - THEN 宿主调度执行对应操作并将文本/对象结果封装为 ok 回复

- Scenario: A3 JetBrains 宿主端执行 ACP 工具
  - GIVEN IntelliJ IDEA 宿主收到 executeAcpTool 请求
  - WHEN 目标工具为 Action 调度（如 executeAction）或问题诊断（getDiagnostics）
  - THEN 宿主在安全线程中调度执行并将结果数据以 JSON 格式封装为 ok 回复

- Scenario: A4 宿主通信凭据自动无感传递与双保险握手
  - GIVEN VS Code 或 IDEA 插件启动 opencode 后台，或 WebGUI 携带 Bridge 参数连接
  - WHEN 后台子进程启动或前端完成握手
  - THEN OpenCode 后端自动获得有效的 Bridge 地址与 Token，全流程无需用户进行任何配置

- Scenario: A5 AI 会话运行时根据配置动态装配 ACP 工具
  - GIVEN OpenCode 后端感知到宿主 Bridge 且 opencode.json 中开启了部分 ACP 工具
  - WHEN 初始化 AI 会话的模型工具清单
  - THEN 仅已启用的 ACP 工具被转换为带有正确名称、描述和参数 Schema 的 Tool 注册给模型
  - AND 未启用的工具或被关闭大类下的工具不会暴露给大模型

- Scenario: A6 大模型调用 ACP 工具端到端执行闭环
  - GIVEN AI 会话中大模型产生了 ACP 工具调用
  - WHEN OpenCode 执行循环拦截到该 Tool Call
  - THEN 后端通过 Bridge 向当前宿主发送 executeAcpTool 并等待执行结果
  - AND 执行结果安全写入 Tool Output，大模型感知到真实结果并继续生成后续回复

- Scenario: A7 独立浏览器模式安全降级
  - GIVEN OpenCode 运行在独立外部浏览器或无宿主 Bridge 的环境中
  - WHEN 创建会话并装配工具列表
  - THEN 系统安全降级且不注册任何 ACP 工具，会话正常运行无任何报错

# 约束与不变量

- 遵循已有的 ideBridge HTTP + SSE 通信规范（Token 鉴权、JSON 格式、id/replyTo RPC 模型）。
- 工具调用具有防御性超时与异常捕获，宿主未响应或出错时返回清晰的错误描述，不中断主对话流。
- 只有用户在 `opencode.json` 或 WebGUI 界面中显式开启的 ACP 工具才允许提供给大模型调用。
- 双端（VS Code 与 IDEA）的 `executeAcpTool` 请求与返回数据契约必须严格一致。

# 决策

- 已确认：凭据传递采用“宿主进程环境变量自动注入 + 前端加载自动握手注册”双保险机制，用户完全无感、零配置。
- 已确认：JetBrains 端通过 `ActionManager` 与 `RunManager` 提供对等的宿主能力。
- 已确认：VS Code 端利用 `vscode.lm.invokeTool` 与 `vscode.commands.executeCommand` 承接工具执行。
- 已确认：工具命名采用规整的前缀（如 `acp_<category>_<toolId>`）以避免与内建工具冲突。
- 已确认：权限控制复用现有配置状态，关闭的工具直接对模型不可见。

# 待解决问题

# 验证预期

- 执行 `bun typecheck` 验证 core 与 opencode 类型正确。
- 运行 VS Code 插件测试确保 Bridge 路由及新工具执行单测通过。
- 运行 JetBrains 插件测试或 `./gradlew.bat test` 确保 `IdeBridge.kt` 单测通过。
- 运行 OpenCode 单元测试验证 ACP 工具装配与调用逻辑。
