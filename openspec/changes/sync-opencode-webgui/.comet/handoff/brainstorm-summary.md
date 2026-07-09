# Brainstorm Summary

- Change: sync-opencode-webgui
- Date: 2026-07-08

## 确认的技术方案

采用“先差异热点分析，再普通 merge，再做 WebGUI compatibility audit，最后尽量全量验证”。

执行顺序：先 fetch `opencode`，分析 `ide-plugin..opencode/dev` 的差异热点，重点标记 `packages/opencode` 的 server/API/SDK/schema/event 变动、`packages/opencode/webgui` 的 SDK wrapper/state/event bridge，以及 VSCode/JetBrains host bridge 和 packaging。随后执行普通 `git merge opencode/dev`，保留真实 merge 历史。

冲突处理默认同时保留上游 opencode 行为和下游 WebGUI/IDE 插件行为。若上游引入更好的通用结构，则将下游 WebGUI/IDE 适配挂到新结构上；若 adapter 或结构合并仍无法同时保留双方行为，则停止并向用户提供取舍选项。

合并后对 WebGUI 调用面做显式审计：`sdk.session.*`、`sdk.config.*`、`sdk.project.*`、`sdk.path.*`、permission/question routes、`/event` SSE、`message.*`/`session.*` events、provider/model/agent/variant selection、`ideBridge` 的 storage/reloadPath/reconnect。

## 关键取舍与风险

- 选择普通 merge 而非 rebase：保留上游同步历史，便于后续继续跟进 upstream。
- 选择先做差异热点分析而非直接 merge：多一步分析，但能减少 WebGUI 回归漏判。
- 不先建设完整兼容测试矩阵：避免把本次同步扩展成测试平台建设；验证仍尽量全量，但测试资产只在实际破损或高风险点需要时补充。
- 风险：上游 SDK/API 或 event payload 变化可能让 WebGUI 类型通过但运行失败；控制方式是合并后做显式 compatibility audit。
- 风险：IDE bridge 行为纯浏览器测试覆盖不到；控制方式是保留 host bridge/package 验证。

## 测试策略

采用用户确认的“尽量全量”验证策略。优先覆盖 opencode typecheck/test/build、WebGUI test/build、VSCode compile/package、JetBrains test/buildPlugin。具体命令以 merge 后仓库脚本和依赖状态为准；若上游改变脚本或生成产物，使用仓库现有约定调整命令，但不降级为只测失败点。

## Spec Patch

无。
