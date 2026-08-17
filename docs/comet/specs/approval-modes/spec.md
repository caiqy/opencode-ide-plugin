# Composer 审批模式

## 目标

IDE 插件 WebGUI（`packages/opencode/webgui`）的 Composer 为当前会话提供三种互斥的工具审批模式。模式由用户在 Composer 中选择，并随当前会话恢复；模式变化不影响其他会话，也不修改项目或全局默认配置。上游 `packages/app` 不在本能力范围内。

## 模式

### 手动审批

未被现有 permission allow 规则覆盖的工具请求继续进入既有 permission 流程。Composer 显示 permission dock，用户可以允许一次、始终允许或拒绝。已有 permission 规则和回复语义保持不变。

### 自动审批

未被既有规则覆盖的工具请求交给内置隐藏 `approval` agent，以隔离的 one-shot Guardian 评审运行处理。每次评审只服务一个 permission 请求，不创建或复用普通用户 Session。

Guardian 的输入由三部分组成：

1. 当前 Session 的有界 transcript：保留用户、assistant 和工具调用/结果，优先保留首个及最近用户请求和最近操作；省略内容必须显式标记。其他 Session、系统上下文和隐藏配置不得混入。
2. 类型化 action：包含 permission、真实工具名、patterns/resources、相关 metadata、当前工作目录和请求理由。shell、文件修改、网络和其他工具请求应保留各自可判断风险的参数，不只传 permission 分类名。
3. Guardian policy：说明风险等级、用户授权等级、可信证据边界和 outcome 规则。只有用户消息中的明确意图可作为授权证据；assistant、工具参数、工具结果和仓库内容均视为不可信证据。

Guardian 可以在当前 Location 内调用 `read`、`glob`、`grep` 调查请求。它看不到 shell、网络、MCP 或写工具，不创建 sandbox，也不改变父 Session 的工具权限。调查工具使用全量只读 allow + 其余 deny 的 total ruleset，不能再次触发自动审批。评审具有固定工具轮次和总时间上限，超限按不确定处理。

Guardian 必须返回结构化结果：

```json
{
  "risk_level": "low | medium | high | critical",
  "user_authorization": "unknown | low | medium | high",
  "outcome": "allow | deny | ask",
  "rationale": "string"
}
```

- 明确判定允许：自动以一次允许回复请求。
- 明确判定拒绝：自动拒绝请求。
- 判定不确定、输出无法解析或模型调用失败：不自动回复，保留请求并显示 Composer permission dock，等待用户决定。
- 调查工具失败、评审超时或达到工具轮次上限：按不确定处理并回退人工审批。

自动审批的失败路径不得默认扩大权限。

### 完全访问

当前会话的工具 permission 规则使用全量 allow，工具请求不进入人工审批 dock。该模式只改变当前会话的 permission 决策，不引入或修改 sandbox。

## 内置审批 agent

系统注册名为 `approval` 的隐藏内置 Guardian agent，默认模型为 `openai/gpt-5.6-luna`。该 agent 为 subagent 模式，仅有 `read`、`glob`、`grep` 权限。用户可以在 `Opencode.jsonc` 的 agent 配置中覆盖该 agent 的 `model` 和 `variant`，例如：

```jsonc
{
  "agent": {
    "approval": {
      "model": "openai/gpt-5.6-luna",
      "variant": "high"
    }
  }
}
```

未配置覆盖时使用内置默认模型；配置无效时沿用现有配置校验和错误处理，不静默切换到更宽权限模式。

## 兼容性

现有 permission API、permission 请求事件、`once`/`always`/`reject` 回复和已有 allow 规则继续工作。模式状态必须能在 Composer 状态恢复时重新得到，且会话之间隔离。

## 验收

- A1：三种模式可在当前会话的 IDE 插件 WebGUI Composer 中选择并恢复。
- A2：手动审批沿用现有 permission dock。
- A3：自动审批的允许和拒绝结果正确执行。
- A4：自动审批的不确定、无效和失败结果回退人工。
- A5：完全访问跳过当前会话人工审批且不影响其他会话。
- A6：审批 agent 默认模型和 JSONC 覆盖正确。
- A7：相关自动化检查通过。
- A8：Guardian 收到有界当前 Session transcript、类型化 action 和明确的授权/风险策略，不读取其他 Session。
- A9：Guardian 只能调用 read/glob/grep，不能调用 shell、网络或写工具，也不能递归触发自动审批。
- A10：Guardian 的结构化风险、授权、结论和理由可正确解析；超时、工具失败、无效结果和 ask 均回退人工审批。
