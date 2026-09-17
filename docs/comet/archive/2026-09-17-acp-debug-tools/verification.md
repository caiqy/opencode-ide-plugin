---
generated_from_state_version: 27
---

# 验证

## 当前结果

- 结果: **已归档**
- 验证情况: **已完成检查，验证结果已确认**
- 目标周期: 1
- 迭代: 6
- 验证器尝试次数: 1
- 完成时间: 2026-09-17T04:49:43.784Z
- 摘要: 已只读检查 brief.md、spec.md、comet-state.yaml、DebugState.ts、DebugTracking.ts、DebugTools.ts、DebugState.test.ts、WebviewController.ts、extension.ts、webviewController.test.ts，并核对 session/tools.ts、useStatusPopoverData.ts、host-bridge.test.ts 和插件 package.json。通过调用链、工作树差异、官方 DAP Initialize/Stopped/Continued 语义及测试断言逐项核验；候选身份与 iteration 6 / attempt 1 一致，源码中确有 DebugState 11 个和 WebviewController 调试测试 16 个。

## 验收

| 编号 | 结果 | 来源 | 验收项 | 原因 |
| --- | --- | --- | --- | --- |
| A1 | passed | brief.md | Scenario: A1 新增「运行和调试」大类且默认全量禁用 - GIVEN WebGUI 连接 VS Code 宿主且项目未配置过「运行和调试」大类 - WHEN 用户打开 ACP 状态面板，或 AI 会话初始化 - THEN 「运行和调试」大类展示为 0/N 启用 - AND 模型工具清单不包含任何未开启的调试工具 | debug 大类及 13 个子工具已上报；WebGUI 未配置时大类和工具均为 false，matchAcpTools 仅注册 acp.platform_vscode 下显式开启的工具。 |
| A2 | passed | brief.md | Scenario: A2 配置枚举与启动 / 停止调试 - GIVEN 已开启配置与启停类子工具，工作区存在 `.vscode/launch.json` 静态配置 - WHEN 模型调用列出配置并以名称启动，或停止当前调试会话 - THEN 返回静态配置列表，且对存在的名称真实发起 / 停止调试会话 - AND 名称不存在或无活动会话时返回明确错误 | 静态 launch 配置枚举、按名称启动、停止及重启均已接入 VS Code API；启动失败、参数错误和无活动会话均返回明确错误。 |
| A3 | passed | brief.md | Scenario: A3 暂停时读取状态、调用堆栈与变量 - GIVEN 已开启状态读取类子工具，调试会话在断点处暂停 - WHEN 模型查询调试状态、调用堆栈与变量 - THEN 返回活动会话、暂停原因与线程、栈帧列表及变量值（支持嵌套展开） | 暂停门禁、状态/线程/调用栈/嵌套变量链路完整；无 threadId 全局暂停后的 continued(false) 会从 threads 响应或 thread 事件物化其余线程并保持可读。 |
| A4 | passed | brief.md | Scenario: A4 断点管理与执行控制 - GIVEN 已开启断点与执行控制子工具 - WHEN 模型添加 / 删除源断点（可含条件），或执行继续、单步、暂停 - THEN VS Code 断点列表相应更新，执行控制透传至活动会话 - AND 无活动会话时返回明确错误 | 断点增删和 continue/step/pause 均已透传；标准 InitializeResponse.body 能力形状下，单线程 step 只失效目标线程；控制成功后 threads 查询失败仍返回成功并保守清空缓存。 |
| A5 | passed | brief.md | Scenario: A5 表达式求值与异常断点 - GIVEN 已开启求值与异常断点子工具，调试会话处于暂停 - WHEN 模型在指定栈帧求值表达式，或设置异常断点过滤器 - THEN 返回求值结果，异常断点按调试适配器能力透传 - AND 适配器不支持时返回明确错误 | evaluate 受暂停状态门禁并返回结果；异常断点请求直接透传，适配器拒绝会作为明确错误传播。 |
| A6 | passed | brief.md | Scenario: A6 安全降级与既有功能不回归 - GIVEN 宿主未连接、无活动会话或 `vscode.debug` 不可用 - WHEN 调用调试工具或查看 ACP 面板 - THEN 返回明确错误 / 未连接提示，不影响 WebGUI 运行 - AND 其它 ACP 大类与 MCP 功能行为保持不变 | 无会话、未暂停和 vscode.debug 不可用均有明确错误；状态查询的 threads 失败会降级为空列表；既有授权、ACP 与 MCP 链路未被改写。 |

## 检查

| 检查 | 命令 | 工作目录 | 状态 | 退出码 | 耗时 |
| --- | --- | --- | --- | ---: | ---: |
| VS Code plugin compile (main) | node_modules/typescript/bin/tsc -p [REDACTED] | hosts/vscode-plugin | passed | 0 | 1635 ms |
| VS Code plugin compile (tests) | node_modules/typescript/bin/tsc -p [REDACTED] | hosts/vscode-plugin | passed | 0 | 2420 ms |
| VS Code plugin unit tests | scripts/run-vscode-tests.mjs | hosts/vscode-plugin | passed | 0 | 39032 ms |
| webgui CompactHeader vitest | x vitest run src/components/CompactHeader | packages/opencode/webgui | passed | 0 | 10647 ms |
| packages/core typecheck | typecheck | packages/core | passed | 0 | 4349 ms |
| packages/opencode typecheck | typecheck | packages/opencode | passed | 0 | 12460 ms |
| webgui typecheck | run typecheck | packages/opencode/webgui | passed | 0 | 7388 ms |

### Builder 报告的证据

以下为 Builder 报告，不等同于 Runtime 检查凭据或独立验收结果。

- VS Code plugin compile (main + tests): passed — tsc -p ./ && tsc -p ./tsconfig.test.json
- VS Code plugin unit tests: passed — 282 passing / 2 pending；调试相关用例 27 个（DebugState 11 + WebviewController 16）全部通过
- VS Code plugin eslint: passed — 0 errors（warnings 为仓库既有 semi/curly 风格基线）
- packages/core typecheck: passed — bun typecheck (tsgo --noEmit)；本轮未改动该包
- packages/opencode typecheck: passed — bun typecheck (tsgo --noEmit)；本轮未改动该包
- packages/opencode/webgui typecheck: passed — bun run typecheck (tsc -b --pretty false)；本轮未改动该包
- webgui CompactHeader vitest: passed — 14 个文件 / 208 个测试；本轮未改动该包
- 已知限制: 动态 provider 启动配置（Node.js…、Python Debugger… 等）无法通过公开 API 枚举，仅支持 launch.json 静态配置（已确认的范围边界）
- 已知限制: 自动化测试以 stub 与纯逻辑覆盖工具分发和行为，未在自动化环境启动真实调试适配器做端到端会话验证
- 已知限制: IntelliJ IDEA 端未实现调试能力（本期非目标）

## 阻塞项

_无。_

## 风险与跳过的工作

- 自动化验证使用纯状态测试和 VS Code stub，未以真实调试适配器执行端到端会话。
- 扩展激活前已经存在的调试会话无法回放历史 initialize/stopped 事件，可能缺少能力或暂停缓存；不影响本候选声明的正常追踪闭环。

## 之前的迭代

| 目标周期 | 迭代 | 尝试 | 结果 | 未解决项 | 摘要 | 完成时间 |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 1 | 1 | fail | A3, A4 | 已读取 brief.md、完整 spec.md、comet-state.yaml、DebugState.ts、DebugTracking.ts、DebugTools.ts、DebugState.test.ts、WebviewController.ts、extension.ts、webviewController.test.ts，并沿 WebGUI 默认状态、acp.platform_vscode 持久化、matchAcpTools Strict Allowlist 和 executeAcpTool 分发链核对。当前分支与 candidateId/iteration/attempt 一致，Runtime 项目及结果与交接记录基本对应，但 A3 的线程和嵌套变量行为以及 A4 的运行中 pause 不满足正式规格。 | 2026-09-17T02:10:54.031Z |
| 1 | 2 | 1 | fail | A3, A4 | 已读取 brief.md、完整规格、DebugState.ts、DebugTracking.ts、DebugTools.ts、WebviewController.ts、extension.ts、两份测试源码，以及授权链中的 useStatusPopoverData.ts、session/tools.ts 和 host-bridge.ts；通过 DAP 请求路径、状态缓存转换、暂停门禁、递归预算和 Strict Allowlist 调用链逐项核对。源码中的调试测试数量与交接一致，为 DebugState 5 个、WebviewController 8 个。 | 2026-09-17T02:25:59.523Z |
| 1 | 3 | 1 | fail | A3, A4 | 已核对 candidateId c71677f9-2808-4d00-aeff-cf726cfd94c4、iteration 3 / attempt 1，并读取 brief.md、完整 spec.md、comet-state.yaml、DebugState.ts、DebugTracking.ts、DebugTools.ts、DebugState.test.ts，以及 WebviewController.ts、extension.ts、webviewController.test.ts 的候选差异和相关源码；同时追踪了 WebGUI 默认状态、acp.platform_vscode 持久化、matchAcpTools Strict Allowlist、DAP 分发及官方 allThreadsStopped/singleThread 语义。普通线程路径和变量截断修复成立，但全局暂停状态转换仍未闭环。 | 2026-09-17T02:35:53.340Z |
| 1 | 4 | 1 | fail | A3, A4 | 只读核对了 brief.md、完整 spec.md、comet-state.yaml、DebugState.ts、DebugTracking.ts、DebugTools.ts、DebugState.test.ts、WebviewController.ts、extension.ts、webviewController.test.ts，并追踪 WebGUI 默认配置、matchAcpTools Strict Allowlist 与 DAP 官方语义。第四轮列出的四项定向路径在测试 stub 中成立，但暂停原因丢失及实际恢复范围处理仍使 A3/A4 不满足规格。 | 2026-09-17T02:44:26.046Z |
| 1 | 4 | 1 | recovery | — | 用户选择继续修复实现；Builder 将更换修复思路：由按请求意图推断改为按 DAP 规范与适配器能力建模全局暂停与恢复范围（捕获 initialize 能力、按 continue 响应决定缓存失效范围、保留暂停原因元数据、单线程恢复时保留其它线程暂停状态）。 | 2026-09-17T04:25:44.336Z |
| 1 | 5 | 1 | fail | A3, A4 | 本次只读核对了 docs/comet/changes/acp-debug-tools/brief.md、specs/acp-debug-tools/spec.md、第五轮 comet-state.yaml，以及 hosts/vscode-plugin/src/debug/DebugState.ts、DebugTracking.ts、DebugTools.ts、DebugState.test.ts、src/ui/WebviewController.ts、src/extension.ts、src/test/suite/webviewController.test.ts；还读取了 hosts/vscode-plugin/package.json、packages/opencode/src/session/tools.ts 和 packages/opencode/webgui/src/components/CompactHeader/useStatusPopoverData.ts 的相关段落。核对方式是沿 tracker、状态存储、工具分发与测试断言追踪 DAP 消息，并与官方 DAP 的 InitializeResponse、ContinuedEvent 及单线程执行语义对照。第五轮编译、插件测试 277 passing / 2 pending、WebGUI 回归及跨包类型检查的通过记录已核对，但本次没有重新运行测试，也没有真实适配器端到端证据。 | 2026-09-17T04:34:45.882Z |
| 1 | 5 | 1 | recovery | — | 用户选择继续修复实现；按第五轮独立验收给出的三个具体根因完成修复：initialize 能力字段按标准响应形状读取（body 顶层）、continued(false) 时物化保留其余已知线程、控制成功后线程列表查询失败的保守降级与错误语义，并补充回归测试。 | 2026-09-17T04:40:59.332Z |
| 1 | 6 | 1 | pass | — | 已只读检查 brief.md、spec.md、comet-state.yaml、DebugState.ts、DebugTracking.ts、DebugTools.ts、DebugState.test.ts、WebviewController.ts、extension.ts、webviewController.test.ts，并核对 session/tools.ts、useStatusPopoverData.ts、host-bridge.test.ts 和插件 package.json。通过调用链、工作树差异、官方 DAP Initialize/Stopped/Continued 语义及测试断言逐项核验；候选身份与 iteration 6 / attempt 1 一致，源码中确有 DebugState 11 个和 WebviewController 调试测试 16 个。 | 2026-09-17T04:49:43.784Z |



## 结论

已只读检查 brief.md、spec.md、comet-state.yaml、DebugState.ts、DebugTracking.ts、DebugTools.ts、DebugState.test.ts、WebviewController.ts、extension.ts、webviewController.test.ts，并核对 session/tools.ts、useStatusPopoverData.ts、host-bridge.test.ts 和插件 package.json。通过调用链、工作树差异、官方 DAP Initialize/Stopped/Continued 语义及测试断言逐项核验；候选身份与 iteration 6 / attempt 1 一致，源码中确有 DebugState 11 个和 WebviewController 调试测试 16 个。
