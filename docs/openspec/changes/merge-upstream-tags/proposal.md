## Why

当前 `ide-plugin` 分支仅同步到上游 `v1.18.6`，而官方已发布后续 tag；继续积累差异会提高冲突、回归定位和下游补丁失效的风险。需要沿用已验证的逐 tag 合并方式，在每个发布边界完成冲突处理与验证后再推进。

## What Changes

- 从 `v1.18.7` 开始，按版本顺序逐个合并 `anomalyco/opencode` 的官方 release tag，每个 tag 保留独立 merge commit。
- 完成当前版本前沿后重新查询远端；若出现新 tag，则继续按顺序合并，直到一次查询确认没有更新 tag。
- 对冲突和重叠实现优先保持现有 IDE 插件行为；发现可能由上游等价替换的下游功能时，提供证据和建议并由用户决定。
- 每个 tag 合并后对全部受影响 owning package 执行完整测试、typecheck 和必要 build，再进入下一个 tag。
- 当公共 Protocol 或 Server `HttpApi` 变化时，通过仓库生成命令更新 Client/SDK 产物，不直接编辑 generated 文件。
- 不合并上游 `dev`，不压缩逐 tag 历史，不夹带无关重构或产品功能。

## Capabilities

### New Capabilities

- `upstream-release-integration`: 规定上游 release tag 的顺序合并、冲突决策、生成物更新和逐 tag 验证要求。

### Modified Capabilities

无。

## Impact

- 可能影响上游 release tag 覆盖的整个 monorepo，重点风险位于 `packages/opencode`、Provider、Session、Workspace routing、TUI、SDK/OpenAPI 生成物及版本/锁文件。
- `v1.18.6..v1.18.16` 与当前下游分支已有 28 个重叠文件，需要逐项确认上游改动与 IDE 插件定制是否兼容。
- 合并和验证成本随执行期间新增的官方 tag 增长；目标只追踪 release tag，不追踪 `dev` 分支。
