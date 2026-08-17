---
generated_from_state_version: 34
---

# Verification

## Current result

- Result: **Passed**
- Assurance: **skill-coordinated**
- Goal cycle: 3
- Iteration: 2
- Verifier attempt: 1
- Completed: 2026-08-17T08:11:38.830Z
- Summary: 候选通过；Agent 缓存失效修复准确覆盖 Skills 开关启用后仍命中旧 deny 的核心回归。

## Acceptance

| ID | Result | Source | Criterion | Reason |
| --- | --- | --- | --- | --- |
| A1 | passed | brief.md | A1：当前会话可在 IDE 插件 WebGUI 的 Composer 中选择三级模式，刷新或重新打开该会话后模式保持一致，其他会话不受影响。 | Composer 提供三级会话模式并从当前 Session permission marker 恢复。 |
| A2 | passed | brief.md | A2：手动审批模式下，未命中既有 allow 规则的请求显示现有 permission dock，并可完成允许一次、始终允许或拒绝。 | manual 沿用现有 permission dock 与 once/always/reject。 |
| A3 | passed | brief.md | A3：自动审批模式下，审批 agent 明确返回允许时请求自动放行，明确返回拒绝时请求被拒绝。 | automatic 的 allow 与 deny 分支实现及测试完整。 |
| A4 | passed | brief.md | A4：自动审批模式下，审批 agent 返回不确定、无效结果或调用失败时，请求回到 Composer 人工审批，不会默认放行。 | ask、无效输出、模型异常和超时均回退人工。 |
| A5 | passed | brief.md | A5：完全访问模式下，当前会话的工具请求不会产生人工 permission 请求；其他会话仍按自身模式处理。 | full 按 Session 隔离并清理本会话 pending 请求。 |
| A6 | passed | brief.md | A6：未配置时内置 `approval` agent 使用 `openai/gpt-5.6-luna`；`Opencode.jsonc` 可覆盖其 `model` 和 `variant`。 | approval 默认模型及 model/variant 覆盖符合规格。 |
| A7 | passed | brief.md | A7：相关策略、配置解析、模式切换和回退行为的测试及类型检查通过。 | Runtime 定向测试、typecheck 与 diff check 均通过。 |
| A8 | passed | brief.md | A8：Guardian 输入包含经过裁剪的当前 Session user/assistant/tool transcript，以及含真实工具名、请求参数、工作目录和理由的 action；提示明确区分用户授权证据与不可信工具内容。 | Guardian 收到有界 transcript、类型化 action 和证据边界。 |
| A9 | passed | brief.md | A9：Guardian 可以调用 `read`、`glob`、`grep` 调查当前 Location，但看不到 shell、网络或写工具；调查达到轮次或时间上限时回退人工审批。 | Guardian 仅有 read/glob/grep 且有轮次与时间上限。 |
| A10 | passed | brief.md | A10：Guardian 结构化返回风险等级、用户授权等级、`allow`/`deny`/`ask` 结论和理由；格式错误时回退人工审批。 | 严格 Schema 校验风险、授权、outcome 和理由。 |
| A11 | passed | specs/approval-modes/spec.md | IDE 插件 WebGUI（`packages/opencode/webgui`）的 Composer 为当前会话提供三种互斥的工具审批模式。模式由用户在 Composer 中选择，并随当前会话恢复；模式变化不影响其他会话，也不修改项目或全局默认配置。上游 `packages/app` 不在本能力范围内。 | 选择器只修改当前 Session，未改 packages/app。 |
| A12 | passed | specs/approval-modes/spec.md | 未被现有 permission allow 规则覆盖的工具请求继续进入既有 permission 流程。Composer 显示 permission dock，用户可以允许一次、始终允许或拒绝。已有 permission 规则和回复语义保持不变。 | manual 请求继续进入原 Permission 服务流程。 |
| A13 | passed | specs/approval-modes/spec.md | 未被既有规则覆盖的工具请求交给内置隐藏 `approval` agent，以隔离的 one-shot Guardian 评审运行处理。每次评审只服务一个 permission 请求，不创建或复用普通用户 Session。 | 每个请求独立 one-shot 评审，不复用用户 Session。 |
| A14 | passed | specs/approval-modes/spec.md | Guardian 的输入由三部分组成： | 评审输入由 transcript、action 与 policy 组成。 |
| A15 | passed | specs/approval-modes/spec.md | 当前 Session 的有界 transcript：保留用户、assistant 和工具调用/结果，优先保留首个及最近用户请求和最近操作；省略内容必须显式标记。其他 Session、系统上下文和隐藏配置不得混入。 | 历史裁剪保留关键用户证据并显式标记省略。 |
| A16 | passed | specs/approval-modes/spec.md | 类型化 action：包含 permission、真实工具名、patterns/resources、相关 metadata、当前工作目录和请求理由。shell、文件修改、网络和其他工具请求应保留各自可判断风险的参数，不只传 permission 分类名。 | action 保留真实工具、patterns、metadata、cwd 与理由。 |
| A17 | passed | specs/approval-modes/spec.md | Guardian policy：说明风险等级、用户授权等级、可信证据边界和 outcome 规则。只有用户消息中的明确意图可作为授权证据；assistant、工具参数、工具结果和仓库内容均视为不可信证据。 | policy 只把用户消息作为授权证据。 |
| A18 | passed | specs/approval-modes/spec.md | Guardian 可以在当前 Location 内调用 `read`、`glob`、`grep` 调查请求。它看不到 shell、网络、MCP 或写工具，不创建 sandbox，也不改变父 Session 的工具权限。调查工具使用全量只读 allow + 其余 deny 的 total ruleset，不能再次触发自动审批。评审具有固定工具轮次和总时间上限，超限按不确定处理。 | 调查工具固定只读且不能递归触发审批。 |
| A19 | passed | specs/approval-modes/spec.md | Guardian 必须返回结构化结果： | Guardian 结果字段和枚举由严格 Schema 解码。 |
| A20 | passed | specs/approval-modes/spec.md | 明确判定允许：自动以一次允许回复请求。 | allow 仅放行当前请求。 |
| A21 | passed | specs/approval-modes/spec.md | 明确判定拒绝：自动拒绝请求。 | deny 产生拒绝且不扩大权限。 |
| A22 | passed | specs/approval-modes/spec.md | 判定不确定、输出无法解析或模型调用失败：不自动回复，保留请求并显示 Composer permission dock，等待用户决定。 | 不确定和失败保留人工 permission 请求。 |
| A23 | passed | specs/approval-modes/spec.md | 调查工具失败、评审超时或达到工具轮次上限：按不确定处理并回退人工审批。 | 调查失败、轮次耗尽和超时均回退人工。 |
| A24 | passed | specs/approval-modes/spec.md | 自动审批的失败路径不得默认扩大权限。 | 所有异常路径 fail-closed。 |
| A25 | passed | specs/approval-modes/spec.md | 当前会话的工具 permission 规则使用全量 allow，工具请求不进入人工审批 dock。该模式只改变当前会话的 permission 决策，不引入或修改 sandbox。 | full 只影响当前 Session permission，不修改 sandbox。 |
| A26 | passed | specs/approval-modes/spec.md | 系统注册名为 `approval` 的隐藏内置 Guardian agent，默认模型为 `openai/gpt-5.6-luna`。该 agent 为 subagent 模式，仅有 `read`、`glob`、`grep` 权限。用户可以在 `Opencode.jsonc` 的 agent 配置中覆盖该 agent 的 `model` 和 `variant`，例如： | approval agent 强制 hidden subagent 与只读权限。 |
| A27 | passed | specs/approval-modes/spec.md | 未配置覆盖时使用内置默认模型；配置无效时沿用现有配置校验和错误处理，不静默切换到更宽权限模式。 | 无效覆盖走既有配置错误，不降级为宽权限。 |
| A28 | passed | specs/approval-modes/spec.md | 现有 permission API、permission 请求事件、`once`/`always`/`reject` 回复和已有 allow 规则继续工作。模式状态必须能在 Composer 状态恢复时重新得到，且会话之间隔离。 | 原 permission API 保持；Skill overlay 写入后会失效已加载 Agent 缓存。 |
| A29 | passed | specs/approval-modes/spec.md | A1：三种模式可在当前会话的 IDE 插件 WebGUI Composer 中选择并恢复。 | 三级模式选择与 Session 恢复链路完整。 |
| A30 | passed | specs/approval-modes/spec.md | A2：手动审批沿用现有 permission dock。 | manual 沿用原 permission dock。 |
| A31 | passed | specs/approval-modes/spec.md | A3：自动审批的允许和拒绝结果正确执行。 | automatic allow/deny 正确执行。 |
| A32 | passed | specs/approval-modes/spec.md | A4：自动审批的不确定、无效和失败结果回退人工。 | automatic 的不确定、无效和失败均回退人工。 |
| A33 | passed | specs/approval-modes/spec.md | A5：完全访问跳过当前会话人工审批且不影响其他会话。 | full 的切换竞态处理与 Session 隔离成立。 |
| A34 | passed | specs/approval-modes/spec.md | A6：审批 agent 默认模型和 JSONC 覆盖正确。 | 默认模型、variant 覆盖和安全属性测试完整。 |
| A35 | passed | specs/approval-modes/spec.md | A7：相关自动化检查通过。 | Runtime 记录 13 项测试、typecheck 和 diff check 通过。 |
| A36 | passed | specs/approval-modes/spec.md | A8：Guardian 收到有界当前 Session transcript、类型化 action 和明确的授权/风险策略，不读取其他 Session。 | 只读取当前 Session 的有界历史与具体 action。 |
| A37 | passed | specs/approval-modes/spec.md | A9：Guardian 只能调用 read/glob/grep，不能调用 shell、网络或写工具，也不能递归触发自动审批。 | 调查工具集排除 shell、网络、MCP 和写工具。 |
| A38 | passed | specs/approval-modes/spec.md | A10：Guardian 的结构化风险、授权、结论和理由可正确解析；超时、工具失败、无效结果和 ask 均回退人工审批。 | 结构化结果及全部失败回退路径正确。 |

## Checks

| Check | Command | Working directory | Status | Exit | Duration |
| --- | --- | --- | --- | ---: | ---: |
| Skill 权限定向测试 | test test/server/skill-enabled-route.test.ts test/config/skill-overlay.test.ts test/tool/skill.test.ts --timeout 15000 | packages/opencode | passed | 0 | 24566 ms |
| Opencode 类型检查 | typecheck | packages/opencode | passed | 0 | 13214 ms |
| Git diff 检查 | diff --check | . | passed | 0 | 202 ms |

## Blockers

_None._

## Risks and skipped work

- 已构造工具集的在途 provider turn 会闭包捕获旧 Agent.Info；切换发生在该 turn 中途时，下一 provider turn 才取得重载后的 Agent。
- skill permission overlay 是按目录键控的进程级 Map，未随 Instance dispose 清理。
- 回归测试验证同一 Server 的 effective permission，未端到端执行真实 skill tool call。

## Previous iterations

| Goal cycle | Iteration | Attempt | Outcome | Unresolved | Summary | Completed |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 1 | 1 | execution-error | — | Native Verifier response was invalid: Native verification cannot pass before every required check succeeds | 2026-08-16T15:00:41.588Z |
| 1 | 1 | 1 | recovery | — | 原 required opencode-tests 因 Bun 默认 5 秒单测试时限失败，拆分检查均已通过；返回 Build 生成新 candidate，并在下一轮 check plan 中显式使用 15 秒单测试时限。 | 2026-08-16T15:19:51.143Z |
| 1 | 2 | 1 | fail | A5, A15, A23 | 会话持久化、manual 兼容、automatic fail-closed、approval agent 配置、fork/subagent marker 隔离及 App 兼容层整体实现完整；但 full 模式切换和 pending 清理存在并发竞态，不能满足当前 session 切换后不再产生人工请求的保证，因此验收失败。 | 2026-08-16T15:31:07.833Z |
| 1 | 3 | 1 | fail | A1, A8, A18, A19 | 单协议 full 竞态修复成立，但 Composer 文案误述 automatic/full，legacy 更新重复规则，且跨协议 runtime 同步未统一，因此未通过。 | 2026-08-16T16:33:53.924Z |
| 1 | 4 | 1 | pass | — | candidate 907ea198-c180-4ad2-aa63-db459584a516 满足全部验收项。上一轮的文案、Session 恢复与隔离、marker-only 合并、跨协议共享 runtime/锁及删除清理问题均已修复；已知限制不导致失败或阻塞。 | 2026-08-16T17:27:14.042Z |
| 1 | 4 | 1 | recovery | — | 用户暂不接受 iteration 4 验收结果，返回 Build 继续修改 | 2026-08-16T17:31:05.226Z |
| 1 | 5 | 0 | recovery | — | Native confirmed acceptance criteria changed | 2026-08-16T18:28:13.732Z |
| 2 | 1 | 1 | fail | A5, A10, A15, A18, A23 | WebGUI 实现通过，但跨协议 drain、approval 输入工具名和 legacy PATCH replacement 语义仍需修复。 | 2026-08-16T19:01:59.066Z |
| 2 | 2 | 1 | pass | — | 最终独立只读验收通过；A1-A25 全部满足，Runtime required checks 全部通过。 | 2026-08-16T23:43:29.453Z |
| 2 | 2 | 1 | recovery | — | 用户认为 automatic approval 的模型上下文不足；对照 Codex CLI Guardian 后，需要重新设计审批策略提示和会话证据输入，当前验收结果不再接受。 | 2026-08-16T23:49:25.735Z |
| 2 | 3 | 0 | recovery | — | Native confirmed acceptance criteria changed | 2026-08-17T00:24:57.300Z |
| 3 | 1 | 0 | recovery | — | 用户发现 Skills 面板启用项仍被当前 Agent 的旧 permission deny；当前候选失效，退回 Build 补回归测试和运行时规则修复。 | 2026-08-17T07:49:38.843Z |
| 3 | 2 | 1 | pass | — | 候选通过；Agent 缓存失效修复准确覆盖 Skills 开关启用后仍命中旧 deny 的核心回归。 | 2026-08-17T08:11:38.830Z |

## Conclusion

候选通过；Agent 缓存失效修复准确覆盖 Skills 开关启用后仍命中旧 deny 的核心回归。
