# Brainstorm Summary

- Change: merge-upstream-tags
- Date: 2026-08-10

## 确认的技术方案

在单一隔离分支严格串行执行上游同步。先把当前 HEAD 的默认 package 门禁修到零失败，再从 `v1.18.7` 起逐 tag 执行精确发现/fetch、`--no-ff --no-commit` merge、语义解冲突、命令生成、独立 merge commit、完整门禁和第二父提交校验。当前队列清空后重新查询远端；发现新 tag 则继续，直到一次查询无新增。

版本文件按上游/下游所有权处理，`bun.lock` 和 generated 产物只由仓库命令重建。语义冲突禁止整文件 `ours/theirs`。上游可能等价替换下游功能时，先提供覆盖证据、差异、风险和建议，再由用户决定。

## 关键取舍与风险

- 选择单分支串行而非双遍预演或每 tag 独立分支，以保持最短、最清晰的双父历史；代价是冲突只能按顺序暴露。
- 相邻 release tag 彼此不是祖先，可能重复触发版本、锁文件和语义冲突；每轮以 merge 第一父提交的实际 diff 和第二父 tag 身份审计。
- 严格零失败会先扩大到当前基线修复，并使每 tag 验证耗时增加；不接受历史残余和重试掩盖。
- 动态追踪最新 tag 可能扩大范围；只在完成当前发布前沿后查询，一次无新增即收敛。

## 测试策略

- 依据第一父提交到验证后 HEAD 的实际 diff 计算直接 owning packages，并加入对 IDE 插件有运行时影响的下游依赖闭包。
- 每个相关 package 运行默认 `test`、`typecheck`、适用 `build` 和生成物检查；不运行可选 App E2E、benchmark 或 Desktop 平台打包。
- Protocol/HttpApi/SDK 变化追加 `packages/client` 生成物检查、`packages/opencode` HttpApi 门禁以及 WebGUI/VS Code 默认门禁。
- 合并任何 tag 前先完成当前 HEAD 零失败基线。每 tag 任何失败均阻止推进；修复后从该 tag 完整矩阵重新执行。
- 每 tag 记录命令、退出码、通过数量、merge/修复提交，最终审计父链、生成物和工作区。

## Spec Patch

- 新增“合并前基线必须零失败”需求及成功/失败场景。
- 在 tasks 基线组增加“修复当前 HEAD 默认门禁至零失败并形成聚焦提交”任务。
