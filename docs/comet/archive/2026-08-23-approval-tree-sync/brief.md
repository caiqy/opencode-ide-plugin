# Outcome

WebGUI V1 中，父 Session 的审批模式及其限制在整个 subagent Session 树上保持一致。审批模式切换、Task 新建与恢复、Guardian 复审以及逐回合工具禁用在并发和失败场景下不得产生权限绕过。

# Scope

- V1 `manual`、`automatic`、`full` 审批模式从父 Session 递归同步到全部现存 subagent。
- 新建 parented Session、Task 创建和 `task_id` 恢复采用父 Session 的最新审批来源，并校验恢复目标归属。
- 限制性切换使用进程内 restriction fence 与 durable transition marker；中途失败和重启后保持 fail-closed，并可安全重试完成。
- Guardian 对 pending 请求的自动复审、并发复审、revision/lifecycle 变化和发布失败均安全结算。
- `tools:false` 在普通 prompt、subtask continuation、Task child turn 和后台 completion continuation 中持续生效。

# Non-goals

- V2 Session 审批同步。
- 为 clustered Session execution 设计跨进程协调协议。
- 运行中 Session 删除的完整生命周期重构。
- 在首次 durable transition marker 写入自身失败时，将失败的更新请求跨重启重放。

# Acceptance examples

- A1：通过 V1 Session HTTP 更新把父 Session 切换为 `manual`、`automatic` 或 `full` 后，所有现存后代的 runtime mode 与应持久化的 approval marker 一致；`automatic` 会复审已有 pending 请求，`full` 会按预期清空或结算 pending 请求。
- A2：从 `full` 或 `automatic` 降权时，在任何后代写入前 root 已进入 restriction；后代写入失败时 root durable transition marker 保留，进程重启后旧 `full` 后代仍按人工审批处理，成功重试后 marker 被移除。
- A3：新建 parented Session、Task child 和合法 `task_id` 恢复采用父级最新审批模式；错误 parent、错误 agent 或祖先 Session ID 必须拒绝，且并发锁保持 parent-to-child 顺序。
- A4：Guardian 结果只有在 Session revision、lifecycle 和 ancestor restriction 均未失效时才能结算；并发 review 共享同一结果，owner 的成功、失败或中断完整传播，`Replied` 发布失败不得放行 waiter。
- A5：父 turn 的 `tools:false` 在 prompt、subtask、Task 新建/恢复/后台执行和 completion continuation 中禁用对应工具；Task child 的逐回合 overlay 不覆盖其 durable permission rules。
- A6：Core 与 opencode 的相关回归测试、两包 `bun typecheck` 和 `git diff --check` 全部通过。

# Constraints and invariants

- durable approval marker 与 process-local runtime mode 是不同来源，不得把 runtime-only 状态误写为 durable 状态。
- 限制性树同步必须 fail-closed；Guardian 不得在有效 restriction fence 内结算 allow。
- Session 树锁按 parent-to-child 获取；不得因 `task_id` 指向祖先而反向取锁。
- `SessionExecution`、模型解析、工具目录和文件系统位置边界保持不变。
- 不直接编辑 generated SDK 文件。

# Decisions

- 使用现有 Effect、Session Service 和 Approval runtime，不引入新依赖或跨进程协调层。
- 普通 target ruleset 不持有 transition marker；marker 仅在限制性同步开始到全部后代成功更新之间存在。
- Guardian `Replied` 的线性化点是事件发布调用；发布已经开始后才启动的审批切换不追溯撤销该决定。
- 首次 marker 持久化失败表示审批更新未提交并向调用方失败，旧策略保持有效。
- Task child 的工具限制使用用户消息上的逐回合 overlay，并禁止该 overlay 重写 child durable permission。

# Open questions

无。

# Verification expectations

- Verifier 必须逐项检查 A1-A6 对应实现、调用路径和测试，不能只依据 Builder 摘要。
- 必须运行 Core approval、opencode permission/task/prompt/session/HTTP 相关测试。
- 必须分别从 `packages/core` 和 `packages/opencode` 运行 `bun typecheck`，并在仓库根运行 `git diff --check`。
- 只报告本 change 引入或改变的可复现 P0/P1/P2；V2 与既有无关问题作为非目标处理。
