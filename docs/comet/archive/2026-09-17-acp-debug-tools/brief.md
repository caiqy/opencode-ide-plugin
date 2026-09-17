# 目标

在 VS Code 宿主端为 ACP（Agent Client Protocol）新增「运行和调试」能力大类，把 VS Code「运行和调试」面板的核心能力通过 IDE Bridge 暴露给大模型，形成完整驱动闭环：枚举与启动 / 停止 / 重启 launch 配置、管理断点与异常断点、读取暂停时的调用堆栈与变量、执行控制（继续 / 单步 / 暂停）、表达式求值。

# 范围

- 在 `hosts/vscode-plugin` 新增 VS Code 宿主 ACP 大类（id：`debug`），随现有 `getAcpCapabilities` 上报子工具与参数 Schema，并实现 `executeAcpTool` 分发执行。
- 已确认的子工具集（完整驱动）：
  - 列出 `.vscode/launch.json` 静态启动配置；按名称启动调试；停止 / 重启当前调试会话；
  - 断点管理：列出、添加、删除源断点（支持条件、命中次数与日志消息）；
  - 调试状态查询：活动会话、暂停原因、线程；
  - 调用堆栈与变量读取（DAP `threads` / `stackTrace` / `scopes` / `variables`，支持嵌套展开）；
  - 执行控制：继续 / 单步（跳过、进入、跳出）/ 暂停；
  - 异常断点设置（DAP `setExceptionBreakpoints`，按调试适配器能力透传）；
  - 表达式求值（DAP `evaluate`，等价「监视 / REPL」）。
- 复用既有 ACP 控制体系：状态面板卡片、默认全量禁用、子工具独立开关与智能级联、`acp.platform_vscode` 命名空间持久化、Strict Allowlist 工具注册。
- 宿主注册 `DebugAdapterTrackerFactory("*")` 与调试会话生命周期事件，维护当前会话与最近暂停状态供状态查询合并输出（不改变 VS Code 调试行为）。
- 自动化测试覆盖新增工具的分发、错误路径与关键交互。

## Source coverage

| 来源条目与位置 | 读取状态 | 需要保留的内容 | Spec 位置 | 验收 ID | 覆盖状态 | 理由或替代关系 |
| --- | --- | --- | --- | --- | --- | --- |
| S1 图1：启动配置下拉与运行入口 | complete | 枚举并启动工作区 launch 配置 | specs/acp-debug-tools/spec.md §3 启动与配置 | A2 | covered | — |
| S2 图2：变量视图 | complete | 读取暂停时的变量值（含嵌套） | specs/acp-debug-tools/spec.md §5 运行时状态读取 | A3 | covered | — |
| S3 图2：监视视图 | complete | 表达式求值（evaluate） | specs/acp-debug-tools/spec.md §7 表达式求值 | A5 | covered | — |
| S4 图2：调用堆栈视图 | complete | 读取栈帧与源码定位 | specs/acp-debug-tools/spec.md §5 运行时状态读取 | A3 | covered | — |
| S5 图2：断点视图（捕获的异常 / 未捕获的异常） | complete | 断点管理与异常断点开关 | specs/acp-debug-tools/spec.md §4 断点管理、§8 异常断点 | A4、A5 | covered | 异常断点实际能力取决于调试适配器支持度 |
| S6 图1：动态配置项（Node.js… / C#… / Python Debugger…） | complete | 动态 provider 配置的枚举 | — | — | background | 公开 API 无法枚举动态项，按 launch.json 静态配置处理 |
| S7 图1：“添加配置…”入口 | complete | 生成 / 写入 launch 配置 | — | — | non-goal | 本期不修改用户 launch.json |

# 非目标

- IntelliJ IDEA 宿主端的调试能力（用户请求明确限定 VS Code）。
- 不引入新的 Bridge 消息类型或协议字段，沿用 `getAcpCapabilities` / `executeAcpTool`。
- 不改变既有 ACP / MCP 的默认禁用策略与状态面板交互范式。
- 不修改用户 `.vscode/launch.json`。
- 不实现复合启动（compound）、批量调试与调试控制台输出订阅。

# 验收示例

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

# 约束与不变量

- 遵循项目既有 ACP 安全模型：默认全量禁用、Strict Allowlist（仅显式开启的工具注册给模型）、平台命名空间持久化（`acp.platform_vscode`）。
- 高权限工具（表达式求值、执行控制）必须默认禁用并按子工具粒度授权。
- 调试数据仅在会话暂停时读取；无活动会话或未暂停时返回明确错误。
- 保持既有 ACP 工具注册与状态面板行为不回归（含 MCP 与其它大类）。
- Bridge 消息结构保持不变（`getAcpCapabilities` / `executeAcpTool`）。
- 不修改用户 `.vscode/launch.json` 内容。

# 决策

- 已确认（2026-09-17）：以独立 change 立项 `acp-debug-tools`，在 VS Code 宿主端封装运行和调试能力为 ACP 宿主工具；工作区隔离方式为新分支（`comet/acp-debug-tools` → `ide-plugin`）。
- 已确认（2026-09-17）：能力范围采用「完整驱动」——包含执行控制（继续 / 单步 / 暂停）与表达式求值（evaluate）、异常断点；全部工具默认禁用、按子工具粒度授权。

# 待解决问题

无未决问题。

# 验证预期

- `hosts/vscode-plugin` 单元测试通过（覆盖新增工具的分发与错误路径）。
- 全仓类型检查通过。
- 涉及 WebGUI 面板 / 配置的既有回归测试保持通过。
