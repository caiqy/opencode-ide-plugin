# V1 Approval Tree Sync

## Overview

V1 Session 审批由 durable permission marker 与 process-local runtime mode 共同决定。父 Session 的审批变更必须覆盖整个现存 subagent 树，并在 Session 创建、Task 恢复、Guardian 结算和工具过滤路径中保持同一权限语义。

## Approval sources

- durable marker 表示可跨进程恢复的审批模式。
- runtime mode 表示当前进程内已应用的模式，可独立于 durable marker 存在。
- runtime-only 父模式可以传播为 child runtime mode，但不得自动生成 durable child marker。
- durable 父模式需要同步到 child durable marker，除非调用明确要求仅更新 runtime。
- 显式清除 runtime mode 后，不得从 stale durable `full` marker 重新激活 full access。

## Tree synchronization

- 父 Session 的 `manual`、`automatic`、`full` 更新递归覆盖全部现存后代。
- 锁按 root 到 descendant 顺序获取，不允许 descendant 到 ancestor 的反向获取。
- `full` 在 runtime 生效前结算当前 Session 的 pending 请求。
- 限制性更新在 root 建立 process-local restriction fence，并先持久化 durable transition marker。
- ancestor 的 runtime fence 或 durable transition marker 对所有后代生效；后代的非 `manual` 请求在 fence 内按 `manual` 处理。
- 全部后代更新成功后，root 写入不含 transition marker 的最终 target ruleset。
- 后代更新失败时保留 root durable transition marker；重试必须继续遍历后代并仅在成功后清除 marker。
- 首次 durable transition marker 写入失败时，更新请求失败且旧审批策略保持不变。

## Session and Task admission

- parented Session 创建必须在父锁内读取最新审批来源，并在创建时应用正确 runtime/durable provenance。
- Task 新建 child 使用父 Session 最新 permission 和 approval 来源。
- `task_id` 仅可恢复同一 parent、同一 agent 的直接 child；其他 parent、其他 agent、root 或 ancestor ID 必须拒绝。
- Task 恢复在 parent 锁后获取 child 锁，并同步最新审批模式。
- 切换为 `automatic` 后，受影响 Session 的 pending 请求进入 Guardian 复审。

## Permission and Guardian settlement

- 每次 permission admission 记录 Session revision 和 lifecycle。
- `full` 快路径仅在 lifecycle 与 revision 均未变化时放行。
- Guardian 结果返回后以及 pending 终端结算前，必须复核 mode、revision、lifecycle 和 ancestor restriction。
- 同一 Session、revision 和 lifecycle 的并发 review 共享一个 owner 结果；不同 revision 或 lifecycle 可以创建新的 review。
- joiner 接收 owner 的完整 Exit，包括成功、typed failure、defect 和 interruption。
- `Asked` 必须先于对应 `Replied`；`Replied` 发布失败时 waiter fail-closed。

## Tool restrictions

- 用户消息上的 `tools:false` 过滤当前 provider turn 的工具目录，即使审批模式为 `full`。
- subtask summary 和后台 completion continuation 保留原始用户消息的 tools overlay。
- Task child 的新建、恢复、前台和后台执行均接收父 turn 的 tools overlay。
- Task child overlay 只写入 child user message，不替换 child durable permission rules。

## Lifecycle

- Session dispose 增加 lifecycle，清理 runtime mode、revision、restriction、drain 和 review claim。
- 同 ID Session 重建后，旧 lifecycle 的请求和 review 不得影响新 Session。
- missing 或已删除 Session 的树同步安全跳过，不产生反向锁或恢复 stale 状态。
