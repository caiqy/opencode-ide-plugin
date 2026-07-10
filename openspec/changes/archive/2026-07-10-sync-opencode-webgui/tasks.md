## 1. Merge Preparation

- [x] 1.1 确认上游 merge target ref，默认使用 `opencode/dev`。
- [x] 1.2 Fetch 上游 refs，并记录 merge 前 baseline commit。
- [x] 1.3 识别 WebGUI、SDK/API、event schemas 和 IDE bridge 文件中的高概率冲突与回归热点。

## 2. Upstream Merge

- [x] 2.1 将确认后的上游 ref merge 到 `ide-plugin`。
- [x] 2.2 解决冲突，同时保留上游 opencode 行为和下游 WebGUI/IDE 插件行为。
- [x] 2.3 在应用任何必须二选一的冲突解法前，停止并询问用户。

## 3. WebGUI Compatibility Audit

- [x] 3.1 对照 merge 后的 SDK/API surface 审计 WebGUI SDK calls。
- [x] 3.2 审计 `message.*`、`session.*`、`permission.*` 和 `question.*` 的 SSE event handling 回归。
- [x] 3.3 对照上游 schema 变化审计 provider/model/agent/variant selection 和 project/path loading。
- [x] 3.4 审计 VSCode 和 JetBrains hosts 的 IDE bridge storage、reconnect 和 `reloadPath` 行为。

## 4. Compatibility Fixes

- [x] 4.1 对破损的 WebGUI 或 IDE bridge call paths 应用最小必要兼容修复。
- [x] 4.2 仅在 merge 确实需要时更新或重新生成受影响的 SDK/build artifacts。
- [x] 4.3 将无关上游清理或 fork 清理排除在本 change 外。

## 5. Verification

- [x] 5.1 运行相关 opencode typecheck/test/build 验证。
- [x] 5.2 运行覆盖 session、message streaming、provider/model selection、permission/question 和 IDE bridge flows 的 WebGUI 验证。
- [x] 5.3 运行相关 VSCode 和 JetBrains packaging 或 bridge 验证。
- [x] 5.4 进入 verify 阶段前记录任何剩余上游兼容风险。
