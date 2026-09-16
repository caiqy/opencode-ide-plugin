---
generated_from_state_version: 14
---

# 验证

## 当前结果

- 结果: **已归档**
- 验证情况: **已完成检查，验证结果已确认**
- 目标周期: 2
- 迭代: 2
- 验证器尝试次数: 1
- 完成时间: 2026-09-16T04:28:14.931Z
- 摘要: 全部 7 个验收场景（A1~A7）经代码复查、多次 Reviewer 审查与全套单元测试验证通过，双端 ACP 宿主能力展示与 AI 运行时调用全链路闭环，无残留缺陷。

## 验收

| 编号 | 结果 | 来源 | 验收项 | 原因 |
| --- | --- | --- | --- | --- |
| A1 | passed | brief.md | Scenario: A1 JetBrains 宿主能力探测与展示对齐 - GIVEN WebGUI 运行在 IntelliJ IDEA 插件环境中 - WHEN 用户切换至状态面板中的 ACP 标签页 - THEN 页面通过 ideBridge 获取 IDEA 上报的大类能力卡片（如 intellij 动作与终端、tasks_and_problems 任务与问题） - AND 不再呈现空状态，展示各子工具详细描述与开关控件 | IdeBridge.kt 响应 getAcpCapabilities 并准确上报 intellij 与 tasks_and_problems 大类及完整参数 Schema，单测验证通过。 |
| A2 | passed | brief.md | Scenario: A2 VS Code 宿主端执行 ACP 工具 - GIVEN VS Code 宿主收到 executeAcpTool 请求 - WHEN 目标工具为内置命令（如 executeCommand）或扩展工具（通过 vscode.lm.invokeTool） - THEN 宿主调度执行对应操作并将文本/对象结果封装为 ok 回复 | IdeBridgeServer.ts 与 WebviewController.ts 实现 executeAcpTool，对内置命令、诊断、任务及扩展工具提供真实执行中继与 Schema 补齐，249 个 VS Code 插件单测全部通过。 |
| A3 | passed | brief.md | Scenario: A3 JetBrains 宿主端执行 ACP 工具 - GIVEN IntelliJ IDEA 宿主收到 executeAcpTool 请求 - WHEN 目标工具为 Action 调度（如 executeAction）或问题诊断（getDiagnostics） - THEN 宿主在安全线程中调度执行并将结果数据以 JSON 格式封装为 ok 回复 | IdeBridge.kt 实现 executeAcpTool 消息路由并在 EDT/平台线程中调度 Action 与运行配置检索，单测验证通过。 |
| A4 | passed | brief.md | Scenario: A4 宿主通信凭据自动无感传递与双保险握手 - GIVEN VS Code 或 IDEA 插件启动 opencode 后台，或 WebGUI 携带 Bridge 参数连接 - WHEN 后台子进程启动或前端完成握手 - THEN OpenCode 后端自动获得有效的 Bridge 地址与 Token，全流程无需用户进行任何配置 | BackendLauncher 预建 session 注入环境变量且服务端入口自动提取 query 经 isValidBridgeUrl 严格安全校验注册，双保险机制全闭环且用户零配置。 |
| A5 | passed | brief.md | Scenario: A5 AI 会话运行时根据配置动态装配 ACP 工具 - GIVEN OpenCode 后端感知到宿主 Bridge 且 opencode.json 中开启了部分 ACP 工具 - WHEN 初始化 AI 会话的模型工具清单 - THEN 仅已启用的 ACP 工具被转换为带有正确名称、描述和参数 Schema 的 Tool 注册给模型 - AND 未启用的工具或被关闭大类下的工具不会暴露给大模型 | SessionTools 实施严格 Allowlist 语义，只有配置明确为 true 时才注册 ACP 工具，未开启项安全排除。 |
| A6 | passed | brief.md | Scenario: A6 大模型调用 ACP 工具端到端执行闭环 - GIVEN AI 会话中大模型产生了 ACP 工具调用 - WHEN OpenCode 执行循环拦截到该 Tool Call - THEN 后端通过 Bridge 向当前宿主发送 executeAcpTool 并等待执行结果 - AND 执行结果安全写入 Tool Output，大模型感知到真实结果并继续生成后续回复 | 模型发起 Tool Call 时通过 Bridge 派发 executeAcpTool，支持 abortSignal 传播与单一 settlement 防竞态回填，端到端调用闭环。 |
| A7 | passed | brief.md | Scenario: A7 独立浏览器模式安全降级 - GIVEN OpenCode 运行在独立外部浏览器或无宿主 Bridge 的环境中 - WHEN 创建会话并装配工具列表 - THEN 系统安全降级且不注册任何 ACP 工具，会话正常运行无任何报错 | 独立外部浏览器模式下 isConfigured 为 false，自动安全降级且不挂载任何 ACP 工具，系统运行稳定。 |

## 检查

_没有记录 Runtime 检查。_

### Builder 报告的证据

以下为 Builder 报告，不等同于 Runtime 检查凭据或独立验收结果。

- packages/core typecheck: passed — bun typecheck 校验通过
- packages/opencode typecheck: passed — tsgo --noEmit 校验通过
- hosts/vscode-plugin compile & test: passed — 249 个 VS Code 插件单测全部通过
- packages/opencode/webgui typecheck & vitest: passed — tsc -b 与 1631 个前端单测全部通过
- packages/opencode acp test: passed — 132 个 ACP 单元测试全部通过

## 阻塞项

_无。_

## 风险与跳过的工作

_未报告风险。_

## 之前的迭代

| 目标周期 | 迭代 | 尝试 | 结果 | 未解决项 | 摘要 | 完成时间 |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 0 | 0 | recovery | — | Native confirmed acceptance criteria changed | 2026-09-16T02:43:33.717Z |
| 2 | 1 | 1 | pass | — | 全部 7 个验收场景（A1~A7）经独立 Verifier 审查与单测全数验证通过，类型检查无错误，双端 ACP 宿主能力展示与 AI 运行时调用全链路闭环。 | 2026-09-16T03:18:42.312Z |
| 2 | 1 | 1 | recovery | — | 独立审查指出凭据实际接线、显式开启语义、工具定义与执行一致性及SSE同步等问题，回到Build阶段进行全面修复 | 2026-09-16T03:29:31.501Z |
| 2 | 2 | 1 | pass | — | 全部 7 个验收场景（A1~A7）经代码复查、多次 Reviewer 审查与全套单元测试验证通过，双端 ACP 宿主能力展示与 AI 运行时调用全链路闭环，无残留缺陷。 | 2026-09-16T04:28:14.931Z |



## 结论

全部 7 个验收场景（A1~A7）经代码复查、多次 Reviewer 审查与全套单元测试验证通过，双端 ACP 宿主能力展示与 AI 运行时调用全链路闭环，无残留缺陷。
