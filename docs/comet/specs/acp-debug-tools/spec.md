# VS Code「运行和调试」ACP 宿主能力

## 需求与交互目标

在 VS Code 宿主端为 ACP（Agent Client Protocol）新增「运行和调试」能力大类（id：`debug`），把 VS Code「运行和调试」面板的核心能力通过 IDE Bridge 暴露给大模型，形成完整驱动闭环：

1. **配置与启停**：枚举工作区 `.vscode/launch.json` 静态配置并按名称启动调试；停止与重启当前调试会话。
2. **断点管理**：列出、添加、删除源断点（支持条件、命中次数与日志消息）；异常断点按适配器能力透传设置。
3. **运行时状态读取**：查询活动会话与暂停状态（线程、暂停原因），在暂停时读取调用堆栈与变量（含嵌套结构）。
4. **执行控制**：继续、单步（跳过 / 进入 / 跳出）、暂停。
5. **表达式求值**：在暂停栈帧上下文中求值表达式（等价「监视 / REPL」）。
6. **安全模型**：全部新工具默认禁用，按子工具粒度授权，仅显式开启的工具注册给大模型；沿用 `acp.platform_vscode` 命名空间持久化。

## 详细行为规范

### 1. 能力上报与工具目录

- 新增大类 `debug`（名称「运行和调试」），随 `getAcpCapabilities` 上报；`status` 依据 `vscode.debug` API 可用性为 `connected` / `unavailable`。
- 子工具目录：

| 工具 id | 名称 | 主要参数 | 行为 |
| --- | --- | --- | --- |
| listLaunchConfigs | 列出启动配置 | — | 返回 `.vscode/launch.json` 静态配置名称列表（动态 provider 项不可枚举，为已知限制） |
| startDebugging | 启动调试 | name | 按名称调用 `vscode.debug.startDebugging`；名称不存在或无工作区时返回明确错误 |
| stopDebugging | 停止调试 | — | 停止当前活动调试会话；无会话时返回明确错误 |
| restartDebugging | 重启调试 | — | 以原配置停止并重新启动当前调试会话 |
| getDebugState | 查询调试状态 | — | 返回活动会话（名称 / 类型）与暂停状态（是否暂停、线程、暂停原因、命中断点） |
| getCallStack | 读取调用堆栈 | threadId? | 返回暂停线程的栈帧列表（名称、源文件、行、frameId） |
| getVariables | 读取变量 | frameId / variablesReference? | 返回作用域或变量引用下的变量（支持嵌套展开；防御性截断并注明） |
| listBreakpoints | 列出断点 | — | 返回全部断点（类型、文件、行、条件） |
| addBreakpoints | 添加断点 | file, line, condition?, hitCondition?, logMessage? | 新增源断点 |
| removeBreakpoints | 删除断点 | file, line? | 删除匹配的源断点；无匹配时返回明确说明 |
| controlExecution | 执行控制 | action: continue / stepOver / stepIn / stepOut / pause | 透传 DAP 请求至活动会话；无会话或未暂停时返回明确错误 |
| evaluate | 表达式求值 | expression, frameId? | 在栈帧上下文执行 DAP `evaluate`，返回结果文本与类型 |
| setExceptionBreakpoints | 异常断点 | filters | 透传 DAP `setExceptionBreakpoints`；适配器不支持时返回明确错误 |

### 2. 默认禁用与授权

- 未配置时大类与全部子工具默认 `false`（沿用既有策略）。
- 仅 `acp.platform_vscode.debug` 下显式开启的工具注册给模型；工具命名遵循 `acp_{category}_{toolId}` 规则（即 `acp_debug_<toolId>`）。
- 高权限工具（`evaluate`、`controlExecution`）与其它工具同等遵守默认禁用与逐工具授权。

### 3. 启动与配置

- 静态配置来源：`vscode.workspace.getConfiguration("launch", folder).get("configurations")`。
- 启动：`vscode.debug.startDebugging(folder, name)` 按名称解析；配置不存在、无活动工作区或启动被拒绝时返回明确错误。
- 动态配置项（如 `Node.js…`、`Python Debugger…`）无法通过公开 API 枚举，不承诺支持。
- 重启：停止当前会话后按原配置名称重新启动。

### 4. 断点管理

- 读取：`vscode.debug.breakpoints`；新增 / 删除：`addBreakpoints` / `removeBreakpoints`。
- 源断点支持 `condition`、`hitCondition`、`logMessage`；删除按文件与行号匹配，无匹配时返回明确说明。
- 不修改用户源码，仅操作断点集合。

### 5. 运行时状态读取

- 经 `DebugSession.customRequest` 发送 DAP：`threads` → `stackTrace` → `scopes` → `variables`。
- 仅在会话暂停（收到 `stopped` 事件）时有数据；无活动会话或未暂停时返回明确错误。
- 变量读取自管理 `variablesReference`，默认限制递归深度与条目数，超限时注明截断。

### 6. 执行控制

- DAP `continue` / `next` / `stepIn` / `stepOut` / `pause` 透传至活动会话。
- 无活动会话时返回明确错误。

### 7. 表达式求值

- DAP `evaluate`（expression，可选 frameId / context）。
- 在被调试进程内执行代码，属最高权限工具：默认禁用；错误信息透传适配器返回。

### 8. 异常断点

- DAP `setExceptionBreakpoints`，过滤器 id 由调试适配器提供，宿主透传。
- 适配器不支持或拒绝时返回明确错误，不影响当前会话。

### 9. 事件与状态缓存

- 注册 `DebugAdapterTrackerFactory("*")` 与 `onDidStartDebugSession` / `onDidTerminateDebugSession`，维护当前会话与最近一次 `stopped` 状态（原因、线程、命中断点），供 `getDebugState` 合并输出。
- 仅观察，不改变 VS Code 调试行为。

### 10. 错误处理与降级

- 所有工具在无活动会话、未暂停、配置不存在、适配器不支持、宿主未连接等情况下返回明确错误，不导致 WebGUI 异常或崩溃。
- 未连接宿主时 ACP 面板保持既有未连接提示行为。

### 11. 兼容性

- Bridge 消息结构不变（复用 `getAcpCapabilities` / `executeAcpTool`）。
- IntelliJ 端不新增调试能力；其它大类与 MCP 行为不变。

## 验收场景

- Scenario: A1 新增「运行和调试」大类且默认全量禁用
  - GIVEN WebGUI 连接 VS Code 宿主且项目未配置过「运行和调试」大类
  - WHEN 用户打开 ACP 状态面板，或 AI 会话初始化
  - THEN 「运行和调试」大类展示为 0/N 启用
  - AND 模型工具清单不包含任何未开启的调试工具

- Scenario: A2 配置枚举与启动 / 停止调试
  - GIVEN 已开启配置与启停类子工具，工作区存在 `.vscode/launch.json` 静态配置
  - WHEN 模型调用列出配置并以名称启动，或停止当前调试会话
  - THEN 返回静态配置列表，且对存在的名称真实发起 / 停止调试会话
  - AND 名称不存在或无活动会话时返回明确错误

- Scenario: A3 暂停时读取状态、调用堆栈与变量
  - GIVEN 已开启状态读取类子工具，调试会话在断点处暂停
  - WHEN 模型查询调试状态、调用堆栈与变量
  - THEN 返回活动会话、暂停原因与线程、栈帧列表及变量值（支持嵌套展开）

- Scenario: A4 断点管理与执行控制
  - GIVEN 已开启断点与执行控制子工具
  - WHEN 模型添加 / 删除源断点（可含条件），或执行继续、单步、暂停
  - THEN VS Code 断点列表相应更新，执行控制透传至活动会话
  - AND 无活动会话时返回明确错误

- Scenario: A5 表达式求值与异常断点
  - GIVEN 已开启求值与异常断点子工具，调试会话处于暂停
  - WHEN 模型在指定栈帧求值表达式，或设置异常断点过滤器
  - THEN 返回求值结果，异常断点按调试适配器能力透传
  - AND 适配器不支持时返回明确错误

- Scenario: A6 安全降级与既有功能不回归
  - GIVEN 宿主未连接、无活动会话或 `vscode.debug` 不可用
  - WHEN 调用调试工具或查看 ACP 面板
  - THEN 返回明确错误 / 未连接提示，不影响 WebGUI 运行
  - AND 其它 ACP 大类与 MCP 功能行为保持不变
