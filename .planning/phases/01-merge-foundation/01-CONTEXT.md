# Phase 1: Merge Foundation - Context

**Gathered:** 2026-04-12
**Status:** Ready for planning

<domain>
## Phase Boundary

在隔离的 sync 分支上建立安全、有文档、可重复的上游合并流程。包含分支隔离策略、回滚路径、书面检查单，并通过至少一次端到端实际合并验证。

</domain>

<decisions>
## Implementation Decisions

### 用户偏好

- **D-01:** 所有具体实施决策在实际合并执行时再确定，不预先锁定——保持最大灵活性

### Agent's Discretion

以下区域由 Agent 在规划和执行时自行决定最佳方案：

- **Sync 分支生命周期：** 命名规则、保留策略、自动删除时机（研究建议 `sync/YYYYMMDD` 模式）
- **检查单格式与节奏：** 语言、自动化程度、更新频率（研究建议每周合并为佳）
- **冲突解决策略：** git rerere 配置、冲突分层处理、高风险文件策略（研究识别了 12 个冲突文件，其中 5 个高风险）
- **合并后恢复步骤：** bun.lock 重新生成流程、4 个依赖 patch 验证步骤、测试范围

</decisions>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 研究文档

- `.planning/phases/01-merge-foundation/01-RESEARCH.md` — Phase 1 技术研究，包含冲突分析、分支策略、git rerere 指引、补丁验证方案

### 项目规范

- `.planning/REQUIREMENTS.md` — SYNC-01（隔离分支合并）、SYNC-05（回滚路径）、SYNC-06（书面检查单）
- `.planning/ROADMAP.md` — Phase 1 成功标准和依赖关系

### 现有代码参考

- `packages/opencode/webgui/` — WebGUI 前端（下游核心，合并时需保护）
- `hosts/vscode-plugin/` — VSCode 插件（下游代码，合并时需保护）
- `hosts/jetbrains-plugin/` — JetBrains 插件（下游代码，合并时需保护）

</canonical_refs>

<code_context>

## Existing Code Insights

### 现有基础

- 远程 `opencode` 已配置，指向 `anomalyco/opencode.git`（上游真正仓库）
- 远程 `upstream` 指向 `paviko/opencode-ide-plugin.git`（另一个 fork）
- 远程 `origin` 指向 `caiqy/opencode-ide-plugin.git`（当前仓库）
- 当前主开发分支: `ide-plugin`

### 合并历史

- 上次合并: 2026-03-30（commit `41ce0564a`，合并 355 个上游 commit）
- 曾有临时合并分支 `merge-opencode-dev-20260306`
- 上游跟踪: `opencode/dev` 分支

### 已知风险区域

- `bun.lock` — 每次合并必定冲突，需通过 `bun install` 重新生成
- 4 个依赖 patch — 上游升级依赖版本时补丁可能失效
- 12 个文件在当前状态下会冲突（详见 01-RESEARCH.md）

</code_context>

<specifics>
## Specific Ideas

用户明确希望在实际合并操作中根据具体情况做决策，而非预先规定。规划应提供灵活的框架和清晰的检查单，让合并操作者能在执行时根据实际冲突情况做出判断。

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

_Phase: 01-merge-foundation_
_Context gathered: 2026-04-12_
