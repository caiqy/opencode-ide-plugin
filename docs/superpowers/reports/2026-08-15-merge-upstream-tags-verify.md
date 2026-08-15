# merge-upstream-tags 验证报告

- Change: `merge-upstream-tags`
- Base ref: `baf0674fd108ac43785cb4f4622c6f58e7c645f6`
- Verified HEAD: `2efd076118`
- Verify mode: `full`
- Date: `2026-08-15`

## 结论

| 维度 | 状态 |
| --- | --- |
| 完整性 | PASS：OpenSpec 28/28，Superpowers plan 75/75，8/8 requirements |
| 正确性 | PASS：17/17 scenarios 具备 Git、报告或测试证据 |
| 一致性 | PASS：proposal、OpenSpec design、技术 Design Doc 与实现/历史一致 |
| 阻塞发现 | Critical 0，Important 0 |

该 change 满足归档条件。最终产品矩阵的 canonical evidence 为 `69/69` applicable gates exit `0`，数值汇总 `8838 pass / 0 fail / 0 error / 97 skip / 1 todo`。从最终矩阵关闭提交 `aa33afa967` 到当前 HEAD 没有 `docs/**` 之外的文件变化。

## 完整性

- `comet classic openspec -- status --change merge-upstream-tags --json`：planning complete，change complete。
- `comet classic openspec -- instructions apply --change merge-upstream-tags --json`：28 complete、0 remaining。
- `comet classic openspec -- validate merge-upstream-tags --strict --json`：1 item passed、0 failed。
- OpenSpec tasks 为 28/28；Superpowers plan 为 75/75，无 `- [ ]`。
- proposal、OpenSpec design、delta spec、技术 Design Doc 均存在且可定位。

## 正确性

### 1. 按发布顺序推进

- first-parent 历史包含且仅包含 `v1.18.7` 至 `v1.18.18` 的 12 个目标 merge，顺序严格递增。
- fresh Git audit：12/12 merge 恰有两个父提交，第二父精确等于对应本地 tag peeled commit。
- 没有使用 `dev`、squash 或单次最新 tag merge 替代逐 tag 边界。

### 2. 持续追踪发布前沿

- `v1.18.17`、`v1.18.18` 由动态前沿查询追加并分别完成独立 merge/验证。
- 最后一次远端查询记录 pending queue 为空，最新 verified tag 为 `v1.18.18`。

### 3. 保留可审计边界

- 12/12 双父提交可由 Git 对象独立重建；提交 subject 与 tag 一致。
- 聚焦修复均位于对应 tag 与下一 tag 之间；未重写既有 merge 历史。

### 4. 下游行为受保护

- 最终 thorough review 为 PASS，Critical 0、Important 0。
- xAI loopback OAuth、MCP recovery/cancellation、retry 永久错误优先级、多 Server notification 路由和宿主版本均保留。
- 未发现未经用户选择执行的等价替换。

### 5. 生成物与协议一致

- 最终矩阵包含 Client generate、精确 `check:generated`、legacy SDK build 与 HttpApi gate。
- Client generated 净漂移为 0；SDK 生成物由规定命令产生；HttpApi 为 `648/0/0`。

### 6. 合并前基线零失败

- 首个 tag 前 baseline defaults 为 `67 passed / 0 failed / 0 error / 0 pending`。
- 条件 gate 为 2 passed、3 not-applicable；skip/todo 已固定并在后续轮次未增加。

### 7. Windows 串行矩阵调度

- Core 使用 pinned `--only-failures --max-concurrency=1` 完整命令。
- SDK-next 使用 pinned `--timeout 5000 --max-concurrency=1` 完整命令。
- 对应 package scripts 未被改写；超时、skip/todo 或加大 timeout 未被当作通过条件。

### 8. 每个 tag 完整验证

- 每轮 canonical marker 均记录 owning-package test/typecheck/build、原生退出码和计数。
- 最终 union closure 为 69 个 applicable gates，全部 exit `0`；没有未解决失败或活动 `MERGE_HEAD`。

## 一致性

- 实现遵循逐 tag 串行状态机、精确 tag fetch、语义冲突处理、命令生成物和 package owning gate 决策。
- Runtime 依赖方向符合仓库约束：Schema → Core/Protocol → Server；Client runtime 不依赖 Core/Server；`sdk-next` 负责组合。
- delta spec 与两份 design 未发现矛盾，无 Implementation Divergence 决策点。

## Fresh 验证

| 检查 | 结果 |
| --- | --- |
| OpenSpec strict validate | PASS：1/1 |
| 12 个 tag 双父/peeled audit | PASS：12/12 |
| plan/tasks/product-tree/diff audit | PASS |
| App test | PASS：728 unit + 41 browser，0 fail |
| App typecheck | PASS |
| OpenCode typecheck | PASS |
| MCP lifecycle focused | PASS：21/0 |

补充运行的 OpenCode 全量 `bun run test` 在外层 900 秒 harness 上限内未结束，期间未输出测试失败；该命令未完成，因此不记为 fresh PASS。此前直接运行的 `bun test` 绕过 package script 的 `--timeout 30000`，使 MCP 用例落回 Bun 默认 5 秒并在 5011ms 超时；正式 focused 命令已以 21/0 排除该假失败。完整套件的通过依据仍是 canonical 69-gate evidence，加上 fresh product-tree 等价审计；没有用未完成命令替代通过证据。

## 非阻塞残余

- Minor：计划三处下一 tag 文字与实际 `$merge` 对象不一致；Git 对象、提交 subject 和父链正确。
- Minor：正式报告一条汇总句称 `v1.18.11` 运行 Client generate，而该轮 marker 为 `PublicApi=false`；最终 generated checks 已通过。
- Minor：继承的 xAI 注释与 listener 实际动作不一致；不由本 change 引入或放大。

以上残余不影响正确性、安全、tag 边界、生成物或 sealed evidence，不扩大当前 change 修复范围。
