---
generated_from_state_version: 60
---

# 验证

## 当前结果

- 结果: **已归档**
- 验证情况: **已完成检查，验证结果已确认**
- 目标周期: 4
- 迭代: 4
- 验证器尝试次数: 1
- 完成时间: 2026-09-18T06:07:08.233Z
- 摘要: 候选实现满足修订后的 A1-A8。上一轮 A3 阻断点已消除：列号读取异常不再被静默转换为 column=null，任何 inspection 路径异常均由统一包装返回明确错误。采信给定 unitTest 通过回执后，总体判定为 pass。

## 验收

| 编号 | 结果 | 来源 | 验收项 | 原因 |
| --- | --- | --- | --- | --- |
| A1 | passed | brief.md | Scenario: A1 新增能力上报与面板展示 - GIVEN IntelliJ IDEA 插件运行且 WebGUI 已连接该宿主 - WHEN 用户打开 ACP 状态面板（等价于宿主响应 `getAcpCapabilities`） - THEN 响应包含 `terminal`（sendToTerminal、runCommand）与 `debug`（getDebugState、getCallStack、getVariables、listBreakpoints、addLineBreakpoint、addExceptionBreakpoint、removeBreakpoint、controlExecution、evaluateExpression）大类，以及 `tasks_and_problems` 新增的 getProblems、runConfiguration、debugConfiguration、stopRunConfiguration - AND 每个工具带有可校验的 parametersSchema；既有 intellij/tasks_and_problems 的 4 个工具名称与 Schema 保持不变 - AND 未开启的工具不会注册给模型（沿用默认全量禁用与按配置启用的现有机制） | AcpCapabilities.kt:11-282 上报四个目标类别及规定工具，并为每个工具提供 object parametersSchema；既有 intellij 三工具及 listRunConfigurations 的名称和 Schema 保持不变。测试 `getAcpCapabilities returns default categories and tools`（IdeBridgeUpdateTest.kt:998-1057）验证完整清单和 Schema。session/tools.ts:72-87 继续以 platform_intellij 严格 allowlist，仅注册类别 enabled=true 且工具配置为 true 的工具。 |
| A2 | passed | brief.md | Scenario: A2 终端执行能力 - GIVEN 已开启 `terminal` 类工具 - WHEN 模型调用 `sendToTerminal` 执行命令 - THEN 命令在 IDEA 终端中执行，调用返回成功但不包含命令输出 - AND 模型调用 `runCommand` 执行命令时，返回 stdout/stderr 与退出码；非零退出码不作为错误；命令为空、无法启动或执行超时返回明确错误 | AcpTerminalTools.kt:19-76 实现可见终端执行和后台命令捕获；runCommand 返回 exitCode/stdout/stderr，非零退出码仍成功，启动异常和超时均转为明确错误，超时上限为 55 秒。测试覆盖主要成功及错误分支（含终端标签正向调用与真实进程 0/3 退出码）。 |
| A3 | passed | brief.md | Scenario: A3 代码问题诊断 - GIVEN 已开启 `getProblems` 且编辑器中有活动文件 - WHEN 模型调用 `getProblems` - THEN 返回活动文件的 inspections 问题（文件、行列、严重级别、描述），并遵守结果上限 - AND 传入 `path` 时返回该文件或目录范围的问题；无活动文件且未传 path 时返回明确错误 - AND 结果截断（truncated）仅由结果上限、文件数量上限或 30 秒预算到点后停止启动新文件产生；任何 inspection 执行异常（含扫描被取消）都返回明确错误，不尝试归因取消来源 | AcpProblemTools.kt:23-77 实现活动文件/显式路径扫描、300 条结果上限及 30 秒预算；89-130 实现目录递归、100 文件上限以及 build/hidden 目录显式上报；132-188 返回文件、行列、严重级别和描述。扫描及 describeProblem 全部位于统一 Throwable 包装范围，列号计算不再捕获异常；文件内唯一 catch 即该显式失败包装，不存在 runCatching 或将 inspection 异常转为空值/成功的路径。测试覆盖文件收集、跳过目录部分结果和无目标错误。 |
| A4 | passed | brief.md | Scenario: A4 运行配置执行与停止 - GIVEN 工程存在已配置的运行配置，相关工具已开启 - WHEN 模型以名称调用 `runConfiguration` / `debugConfiguration` - THEN 分别以 Run / Debug 模式启动对应运行配置 - AND 名称不存在时返回明确错误；`stopRunConfiguration` 停止正在运行的配置，无匹配进程时返回明确错误 | AcpRunConfigurationTools.kt:30-66 按名称解析配置并分别通过 Run/Debug executor 启动；44-62 选择匹配的活动进程并停止，无配置或无进程时明确报错。测试覆盖启动、停止与错误分支。 |
| A5 | passed | brief.md | Scenario: A5 调试状态读取 - GIVEN 调试会话在断点处暂停，debug 类工具已开启 - WHEN 模型调用 `getDebugState`、`getCallStack`、`getVariables` - THEN 分别返回会话与暂停状态、栈帧列表（文件、行号、帧标识）、变量值（支持按引用嵌套展开） - AND 无活动会话或未暂停时返回明确错误 | AcpDebugTools.kt:107-160 返回会话暂停状态、带 frameId 的栈帧和变量；472-529 通过 reference 注册表支持嵌套展开。无会话、未暂停、无栈帧和无效引用均有明确错误。测试验证状态、栈帧和变量主路径。 |
| A6 | passed | brief.md | Scenario: A6 断点管理 - GIVEN debug 类工具已开启 - WHEN 模型调用 `listBreakpoints`、`addLineBreakpoint`（可含条件、命中次数、日志消息）、`addExceptionBreakpoint`、`removeBreakpoint` - THEN 断点列表与 IDEA 断点管理器状态一致地更新 - AND 文件或行无效、断点标识不存在、异常断点参数不合法时返回明确错误 | AcpDebugTools.kt:162-313 实现断点列举、行断点条件/命中次数/日志消息、Java 异常断点和按稳定标识删除；参数、文件、行、断点类型、标识和异常过滤均有显式校验。测试覆盖列表、异常断点创建、删除、无效命中次数和异常参数；断点标识在集合变化下保持稳定。 |
| A7 | passed | brief.md | Scenario: A7 执行控制与表达式求值 - GIVEN 存在暂停的调试会话 - WHEN 模型调用 `controlExecution`（resume/pause/stepOver/stepInto/stepOut）或 `evaluateExpression` - THEN 动作透传到对应调试会话，求值返回结果值与类型 - AND 无会话、未暂停或栈帧不可求值时返回明确错误 | AcpDebugTools.kt:315-381 将 resume/pause/stepOver/stepInto/stepOut 透传到目标会话，并通过 XDebuggerEvaluator 返回值和类型；无会话、状态不符、无帧、无 evaluator、求值错误或超时均明确失败。测试验证 resume 与求值、非法动作。 |
| A8 | passed | brief.md | Scenario: A8 安全降级与既有功能不回归 - GIVEN 宿主未连接、无对应能力或工具未启用 - WHEN 调用任意新增工具或查看状态面板 - THEN 返回明确错误或按现有机制不注册工具，WebGUI 运行不受影响 - AND 既有 intellij、tasks_and_problems（含 listRunConfigurations）与桥接协议行为保持不变 | IdeBridge.kt:685-716 保持既有桥接成功/失败协议，并将新增工具异常转换为明确 error；AcpToolExecutors.kt:20-38 对未知类别/工具及非 Exception Throwable 安全失败。host-bridge.ts:313-317 保留 60 秒防御性超时。既有工具路由保持不变，完整 unitTest 回执 passed、exit 0。 |

## 检查

| 检查 | 命令 | 工作目录 | 状态 | 退出码 | 耗时 |
| --- | --- | --- | --- | ---: | ---: |
| JetBrains plugin unitTest | unitTest --console=plain --no-daemon | hosts/jetbrains-plugin | passed | 0 | 711538 ms |

### Builder 报告的证据

以下为 Builder 报告，不等同于 Runtime 检查凭据或独立验收结果。

- hosts/jetbrains-plugin compileKotlin（本轮实现验证）: passed — ./gradlew.bat compileKotlin --console=plain --no-daemon：BUILD SUCCESSFUL。正式检查计划提交完整 unitTest 全量套件（含编译与资源打包）。
- 已知限制: 真实 IDEA 中的 inspection 扫描、终端组件、运行配置进程、暂停调试器与断点管理器落地仍未端到端验证；自动化以 mock 平台服务、测试缝与源码分支为主，建议人工验收真机交互
- 已知限制: getProblems 会跳过 build/out/node_modules/.gradle/.git/target 与点目录（现在会在 skippedDirectories 中列出并置 truncated=true）；若目标范围全部由被跳过目录组成，则返回空 problems + truncated 的部分结果
- 已知限制: 预算只限制是否继续启动下一个文件；已启动的单次 inspection 无法中断，超时由桥接 60 秒兜底并明确报错
- 已知限制: describeProblem 的列号计算现已不做任何吞错，但仍无直接单测触发该路径（需真实 PSI 文档环境）
- 已知限制: addLineBreakpoint 的正向路径（XDebuggerUtil 断点类型解析 + 虚拟文件）与命中次数/日志消息落地未在单测覆盖；成功添加行断点尚无直接测试
- 已知限制: Java 调试能力（异常断点、命中次数）在未安装 Java 插件的 IDE 中不可用：异常断点工具不出现在能力清单中，hitCount 返回明确错误；无 Java 插件环境未做运行时烟测
- 已知限制: runCommand 在 Windows 使用 cmd.exe /c、其他平台使用 /bin/sh -c，不支持交互式命令；测试覆盖 echo/exit 两类命令
- 已知限制: sendToTerminal 使用已弃用的 createLocalShellWidget API（当前平台版本可用入口）
- 已知限制: 断点标识由 BreakpointIdAllocator 在会话内分配并存储在断点对象上；插件重启后标识会重新编号（标识仅在当前会话内有效）
- 已知限制: 调试 sessionId 以当前会话列表下标表达，会话增删后同一编号可能指向另一会话
- 已知限制: build.gradle.kts 将 IDE 兼容上限扩至 262.*，单测在 2026.1.1 SDK 下运行，未在 262 平台上验证
- 已知限制: 内置浏览器能力已按用户决定移除：调用 integrated_browser 按未知类别返回明确错误，能力清单与单测中均无该类别

## 阻塞项

_无。_

## 风险与跳过的工作

- 当前单测没有直接注入 inspection、取消或列号 PSI/document 读取异常；A3 修复已由代码路径确认，但缺少防止再次引入静默吞错的聚焦回归测试。
- 终端、运行配置和调试器的大部分平台交互通过 mock 验证；真实 IDEA 中异步回调、具体调试器实现及终端行为仍需按 brief 的人工验收执行。
- 候选同时把插件兼容上限扩展到 262.*，但给定回执基于 IntelliJ Platform 2026.1.1；2026.2 兼容性尚无独立验证证据。

## 之前的迭代

| 目标周期 | 迭代 | 尝试 | 结果 | 未解决项 | 摘要 | 完成时间 |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 1 | 1 | fail | A3, A4, A5, A6, A7, A8, A9 | 只读静态验收：A1、A2 通过；A3–A9 存在可定位的行为偏差。已参考 compileKotlin、unitTest 通过回执及测试 XML，未重跑命令或修改文件。 | 2026-09-17T07:43:28.103Z |
| 1 | 2 | 1 | fail | A5, A6 | 第一轮指出的七处修改均已落到相应路径，但调试暂停上下文缓存和断点标识仍存在可复现的正确性缺口，A5、A6 未通过。 | 2026-09-17T08:25:12.499Z |
| 1 | 3 | 1 | fail | A6 | A1-A5、A7-A9 通过，A5 的手动恢复后缓存失效已闭环。A6 未通过：重复断点后缀仅在单次快照内唯一，断点集合变化后会重映射到其他断点，尚不具备可靠可管理性。 | 2026-09-17T08:48:22.807Z |
| 1 | 4 | 1 | fail | A6, A9 | 第四轮的断点对象绑定与增删稳定性修复在顺序场景下正确，A1-A5、A7-A8 无回归，测试回执为 40/40 通过。当前阻断项是 Java 调试 API 仅作为 Gradle 构建依赖存在、未写入插件运行时描述符，导致 A6 的 Java/异常断点能力及 A9 的不可用能力降级不满足验收。 | 2026-09-17T09:16:34.531Z |
| 1 | 5 | 1 | fail | A1, A6 | A2-A5、A7-A9 通过且前三轮修复未见回归；A1、A6 失败。第五轮实现了无 Java 支持时的安全降级，但没有建立 Java 插件存在时的运行时可见性，因此会把真实 IDEA 中应提供的异常断点和命中次数能力永久降级掉。 | 2026-09-17T09:39:59.099Z |
| 1 | 5 | 1 | recovery | — | 用户选择继续修复：第四/五轮定位的根因（Java 调试 API 缺少运行时依赖声明，插件类加载器不可见）已修复——plugin.xml 增加可选运行时依赖 com.intellij.modules.java，Java 支持存在时异常断点与命中次数可用，缺失时优雅降级不注册该工具；单测 89 项通过。保留已确认需求，提交新候选重新验收。 | 2026-09-17T10:14:36.032Z |
| 1 | 6 | 1 | pass | — | A1-A9 全部通过。第六轮可选 Java 运行时依赖已进入处理后的 plugin.xml，修复了 IDEA 中 Java 调试类的类加载器可见性，同时保留无 Java 插件环境的加载与能力降级。现有 13 个测试 XML 共 89 项无失败，其中 IdeBridgeUpdateTest 40/40；结合提供的 compileKotlin、unitTest 成功回执，未发现 A2-A5、A7-A9 回归。 | 2026-09-17T10:28:36.273Z |
| 1 | 6 | 1 | recovery | — | 用户决定调整需求范围：移除 IDEA 内置浏览器能力（integrated_browser 类别与 openPage），改为不提供该能力。候选实现已同步移除：删除 AcpBrowserTools.kt、清理能力清单与执行器路由、更新单测（13 套件 87 项通过，无失败）。请按 revise-requirements 更新正式文件并重新确认 Shape。 | 2026-09-17T13:42:17.071Z |
| 2 | 1 | 0 | recovery | — | Native confirmed acceptance criteria changed | 2026-09-17T15:29:59.355Z |
| 3 | 1 | 1 | fail | A1, A2, A3, A4, A5, A6, A7, A8 | 依据修订后的 brief/spec 审核了 A1–A8。接受 Runtime 提供的 compileKotlin 和 unitTest 成功回执，但它们未覆盖全部验收行为。A3、A5、A7 存在可由源码定位的错误返回路径，A8 留有明确禁止的测试字面量；A1、A2、A4、A6 缺少完整的实际场景证据，整体判 fail。全程只读，未运行构建。 | 2026-09-18T00:48:30.354Z |
| 3 | 2 | 1 | fail | A2, A3, A4, A5, A6, A7 | Verdict: fail；Review stage: final。A1、A8 有源码与回执支持；A3 存在错误降级，A2、A4–A7 缺少关键正向证据。建议先修复并测试 A3 异常归因，再补齐 A2、A4–A7 的平台正向验收，重新取得与最终候选版本对应的检查回执。 | 2026-09-18T03:15:03.271Z |
| 3 | 3 | 1 | fail | A3, A6 | 候选实现已补齐 A2、A4、A5、A7 的正向证据，A1 和 A8 也满足当前修订要求。但 A3 仍存在可复现的错误归因，A6 尚缺完整断点增删正向证据，因此第 3 轮不能通过。 | 2026-09-18T03:49:10.154Z |
| 3 | 4 | 1 | fail | A3 | 第 4 轮共 7 项通过，A6 的断点新增/删除正向证据已补齐。A3 的 wall-clock 判断虽已替换为 AtomicBoolean，但该标记只表示预算任务运行过，仍不能证明捕获异常由预算取消造成，因此候选实现尚未满足全部 A1-A8，结论为 fail。 | 2026-09-18T04:10:47.893Z |
| 3 | 5 | 1 | fail | A3 | A1、A2、A4、A5、A6、A7、A8 满足验收，并采信完整 unitTest 通过回执。A3 的普通异常吞错已修复，但取消异常仍未与本次预算取消建立可验证的因果关系，上一轮指出的误判路径仍可复现，因此本轮总体判定为 fail。 | 2026-09-18T04:37:46.359Z |
| 3 | 5 | 1 | recovery | — | 用户选择调整需求：明确 getProblems 的预算与取消语义——truncated 仅由结果上限/文件上限/预算到点后停止启动新文件产生；任何 inspection 执行异常（含被取消）一律明确报错；不做取消来源归因（平台无法从异常反推取消来源）。同步更新 A3 场景、约束与决策。 | 2026-09-18T04:46:05.309Z |
| 4 | 1 | 1 | fail | A3 | 未通过：A3 的预算与取消实现符合修订后的 D11，但目录扫描会静默遗漏部分文件，未满足指定目录范围的验收。其余七项有实现证据；给定的 unitTest passed 回执可采信，本次遵照要求未运行构建或测试。 | 2026-09-18T05:07:12.377Z |
| 4 | 2 | 1 | fail | A3 | 最终审查：A1、A2、A4–A8 通过；A3 仍有可复现的纯跳过目录边界失败，且预算实现与明确约束不符。优先修正并补充对应测试后再验收。 | 2026-09-18T05:27:24.304Z |
| 4 | 3 | 1 | fail | A3 | A1、A2、A4-A8 满足验收，且本轮修复了 A3 的跳过目录空结果与预算主动取消问题；但列号解析仍可能静默吞掉 ProcessCanceledException，因此 A3 失败，候选实现当前不能判定通过。 | 2026-09-18T05:49:26.830Z |
| 4 | 4 | 1 | pass | — | 候选实现满足修订后的 A1-A8。上一轮 A3 阻断点已消除：列号读取异常不再被静默转换为 column=null，任何 inspection 路径异常均由统一包装返回明确错误。采信给定 unitTest 通过回执后，总体判定为 pass。 | 2026-09-18T06:07:08.233Z |



## 结论

候选实现满足修订后的 A1-A8。上一轮 A3 阻断点已消除：列号读取异常不再被静默转换为 column=null，任何 inspection 路径异常均由统一包装返回明确错误。采信给定 unitTest 通过回执后，总体判定为 pass。
