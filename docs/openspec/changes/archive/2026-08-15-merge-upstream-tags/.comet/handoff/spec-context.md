# Comet Spec Context

- Change: merge-upstream-tags
- Phase: design
- Mode: beta
- Context hash: 7aa77432146d975e866ec5d44eb3c67511ec0abf68637f3c1c15b8a03789cfef

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This beta context pack verbatim-projects spec files and references supporting artifacts by hash, not an agent-authored summary.

## Source References

- Source: docs/openspec/changes/merge-upstream-tags/proposal.md
- SHA256: 2f4e4dbbff29953960e332d51b883248c64540a91f11fc73602600f2bd4ff0d1
- Source: docs/openspec/changes/merge-upstream-tags/design.md
- SHA256: 6de8aebd34ba79584adcf0b22e1d55f3c0c497a73b85891f20c4fac62796c3ae
- Source: docs/openspec/changes/merge-upstream-tags/tasks.md
- SHA256: 4890cff924564a7a45d478e4a2d121a269a2fe712436e690e9a76387bfa7e0f6
- Source: docs/openspec/changes/merge-upstream-tags/specs/upstream-release-integration/spec.md
- SHA256: 9dd4869c2a46b0c15351a1313d702146e91740683189e643e575babb573a0c9d

## Acceptance Projection

## docs/openspec/changes/merge-upstream-tags/specs/upstream-release-integration/spec.md

- Source: docs/openspec/changes/merge-upstream-tags/specs/upstream-release-integration/spec.md
- Lines: 1-78
- SHA256: 9dd4869c2a46b0c15351a1313d702146e91740683189e643e575babb573a0c9d

```md
## Purpose

建立可重复、可审计的上游发布同步能力，使下游 IDE 插件能够持续吸收官方 release tag，同时保留本地行为并把回归限制在单个发布边界内。

## ADDED Requirements

### Requirement: 按发布顺序推进
系统 SHALL 从当前已集成的最高官方 release tag 之后开始，按版本顺序逐个处理所有后续官方 release tag，且 MUST NOT 以 `dev` 分支替代 release tag。

#### Scenario: 存在多个待合并 tag
- **WHEN** 远端存在多个高于当前基线的官方 release tag
- **THEN** 系统按版本升序一次处理一个 tag

#### Scenario: tag 彼此不是祖先
- **WHEN** 相邻 release tag 在 Git 图中不是祖先关系
- **THEN** 系统仍按发布版本顺序分别建立合并边界，不把多个 tag 压缩成一次同步

### Requirement: 持续追踪发布前沿
系统 SHALL 在完成已发现的最高 tag 后重新查询官方远端，并持续追加新发现的 release tag，直到一次查询确认不存在更高版本。

#### Scenario: 执行期间发布新 tag
- **WHEN** 完成原最高 tag 后发现官方又发布了更高 tag
- **THEN** 系统将新 tag 按版本顺序加入同一同步流程

#### Scenario: 发布前沿稳定
- **WHEN** 完成当前最高 tag 后重新查询且没有发现更高 tag
- **THEN** 系统结束 tag 合并阶段并进入最终验证

### Requirement: 保留可审计的 tag 边界
每个 release tag SHALL 对应一个独立的双父 merge commit，其上游父提交 MUST 精确指向该 tag；验证后发现的问题 MAY 使用紧随其后的聚焦修复提交处理。

#### Scenario: tag 合并成功
- **WHEN** 一个 release tag 的冲突已经解决
- **THEN** 仓库历史包含该 tag 的独立 merge commit，并可从第二父提交追溯到准确 tag

#### Scenario: 合并后验证发现回归
- **WHEN** tag 的完整验证发现不能安全放入 merge commit 的后续修复
- **THEN** 系统在推进下一个 tag 前创建范围明确的修复提交并重新验证

### Requirement: 下游行为受保护
系统 SHALL 保留 IDE 插件已有行为和下游扩展；当上游实现可能等价替换下游实现时，系统 MUST 提供等价性证据、风险和建议，并在用户选择后才执行替换。

#### Scenario: 无法证明等价
- **WHEN** 上游实现与下游补丁重叠但缺少覆盖全部下游场景的证据
- **THEN** 系统保留下游行为并记录未完成的等价替换判断

#### Scenario: 存在等价替换候选
- **WHEN** 测试和代码路径表明上游实现可能完整覆盖下游需求
- **THEN** 系统暂停该替换，向用户提供建议并等待明确选择

### Requirement: 生成物与协议保持一致
当合并改变公共 Protocol 或 Server `HttpApi` 时，系统 SHALL 使用仓库规定的生成流程刷新 Client 和 SDK 产物，并 MUST NOT 直接编辑 generated 输出。

#### Scenario: 公共 API 发生变化
- **WHEN** 某个 tag 修改公共 Protocol 或 Server `HttpApi`
- **THEN** 对应 Client 和 SDK 生成物由仓库生成命令更新并通过一致性检查

### Requirement: 合并前基线零失败
系统 MUST 在合并第一个待处理 release tag 前，使当前 HEAD 对已知队列影响闭包的全部默认 package 门禁达到零失败；历史残余或允许失败清单 MUST NOT 替代当前验证。

#### Scenario: 当前基线通过
- **WHEN** 已知队列影响闭包的默认测试、typecheck、build 和生成物检查全部成功
- **THEN** 系统可以开始合并第一个待处理 release tag

#### Scenario: 当前基线失败
- **WHEN** 当前 HEAD 的任一适用默认门禁失败
- **THEN** 系统先修复该失败并重新完成全部基线门禁，不开始 release tag 合并

### Requirement: 每个 tag 通过完整验证
系统 MUST 在每个 tag 后对全部受影响 owning package 完成适用的测试、typecheck 和 build；任何未解决失败 SHALL 阻止下一个 tag 的合并。

#### Scenario: tag 验证通过
- **WHEN** 当前 tag 的冲突已解决且全部适用验证成功
- **THEN** 系统可以开始合并下一个 tag

#### Scenario: tag 验证失败
- **WHEN** 任一受影响 owning package 的测试、typecheck 或 build 失败
- **THEN** 系统停留在当前 tag，修复或明确处理失败后重新完成该 tag 的验证

```

Full source files remain canonical. If a required heading or scenario is missing here, regenerate the handoff or read the source spec directly. Supporting files (proposal, design, tasks) are referenced by hash only.