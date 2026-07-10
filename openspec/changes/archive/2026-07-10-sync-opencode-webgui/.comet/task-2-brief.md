## Task 2: 普通 merge 与冲突处理

你在 `D:\Caiqy\Projects\Github\opencode-ide-plugin` 工作。

### 目标

执行普通 `git merge opencode/dev`，解决冲突时同时保留上游 opencode 行为和下游 WebGUI/IDE bridge 行为。不要 rebase，不要 squash，不要提交 commit。

### 关键背景

Task 1 证据在 `openspec/changes/sync-opencode-webgui/.comet/build/merge-evidence.md`：

- `packages/opencode/webgui` 在上游目标中表现为全目录删除，必须保留。
- `hosts/vscode-plugin` 在上游目标中表现为全目录删除，必须保留。
- `hosts/jetbrains-plugin` 在上游目标中表现为全目录删除，必须保留。
- `packages/opencode` 有大规模 server/session/SDK/event/schema 改动，后续 audit 会处理 API 兼容；本 task 只负责 merge 和冲突决策。

### 必做步骤

1. 执行：`git merge opencode/dev`
2. 如果进入冲突状态，运行：`git diff --name-only --diff-filter=U`
3. 按规则解决冲突：
   - 能同时保留上游 opencode 行为和下游 WebGUI/IDE bridge 行为：直接解决。
   - 上游提供更好的共享结构：把 WebGUI/IDE bridge 适配挂到新结构。
   - 小型 adapter 能保留旧 WebGUI 合同：放在现有 SDK wrapper 或 event translation 附近。
   - 必须删除或削弱任一侧行为：返回 `BLOCKED`，不要自行取舍。
4. 解决后运行：
   - `git diff --name-only --diff-filter=U`，应为空。
   - `git status --short --untracked-files=all`，记录 merge 后状态。
5. 追加更新 `openspec/changes/sync-opencode-webgui/.comet/build/merge-evidence.md`：
   - `## Merge result`
   - command、conflicted files、resolution summary、user decision required

### 约束

- Language: zh-CN
- 使用普通 merge，保留真实 ancestry。
- 禁止 rebase、reset、checkout 丢弃已有改动。
- 禁止勾选 plan 或 OpenSpec tasks。
- 禁止提交 commit。
- 不做无关格式化或 fork 清理。
- 任何需要产品取舍的冲突都返回 `BLOCKED`。

### TDD/检查说明

本 task 是 merge 操作，不新增生产逻辑。最小 RED/GREEN 证据：

- RED/前置：merge 前记录 `git diff --name-only --diff-filter=U` 为空，并记录 Task 1 evidence 指出的待 merge 风险。
- GREEN：merge 后 `git diff --name-only --diff-filter=U` 为空，且 evidence 记录 merge result。

### 报告契约

把完整报告写到 `openspec/changes/sync-opencode-webgui/.comet/task-2-report.md`。

最终回复只包含：

- `DONE` | `DONE_WITH_CONCERNS` | `BLOCKED` | `NEEDS_CONTEXT`
- 变更文件概要
- 是否发生冲突与冲突文件列表
- RED/GREEN 命令摘要
- 风险信号
- 顾虑
