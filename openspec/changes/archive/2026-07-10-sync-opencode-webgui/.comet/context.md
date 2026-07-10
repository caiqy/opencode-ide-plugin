# Comet Design Handoff

- Change: sync-opencode-webgui
- Phase: design
- Mode: compact
- Context hash: 759a4f55b93f07f4baebc396905a534524b0f37c2291b8801e915c4f1fa820ac

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/sync-opencode-webgui/proposal.md

- Source: openspec/changes/sync-opencode-webgui/proposal.md
- Lines: 1-27
- SHA256: 68ef666e5f0a134f868fb9068087537c2623748f417578bcb0b556078f5b9e6d

```md
## Why

本 fork 需要持续跟进上游 opencode，同时保留 WebGUI 和 IDE 插件集成能力。本次同步的目的，是在合并上游 server、SDK、schema 和事件变化时，避免 WebGUI 核心流程静默退化。

## What Changes

- 将当前上游 opencode 目标 ref 合并到 `ide-plugin` 分支，默认目标为 `opencode/dev`。
- 解决冲突时优先同时保留上游 opencode 行为和下游 WebGUI/IDE 插件行为。
- 如果必须删除或削弱任一侧行为，先停下来让用户决定。
- 对照上游变化审计 WebGUI 调用路径，重点覆盖 SDK 方法、REST endpoints、SSE events、permission/question flows、session state、provider/model selection 和 IDE bridge 操作。
- 仅在上游变化确实需要时更新兼容代码和测试。

## Capabilities

### New Capabilities

- `webgui-upstream-compatibility`: 合并上游 opencode 更新后，WebGUI 与 IDE host bridge 仍保持可用。

### Modified Capabilities

无。

## Impact

- `packages/opencode`: server APIs、SDK 使用、event schemas、session/provider/config/project/path 集成和构建输出。
- `packages/opencode/webgui`: React state providers、SDK wrapper、SSE 处理、message/session 渲染、permission/question 处理和 IDE bridge helpers。
- `hosts/vscode-plugin` 和 `hosts/jetbrains-plugin`: 嵌入式 WebGUI hosting、bridge transport、storage、reload 行为和打包假设。
- 如果上游改变依赖或生成产物，Bun、VSCode packaging 和 JetBrains Gradle packaging 的构建/验证命令可能需要调整。
```

## openspec/changes/sync-opencode-webgui/design.md

- Source: openspec/changes/sync-opencode-webgui/design.md
- Lines: 1-67
- SHA256: 71e824d64b6a9de4b7fbdfbe3a54789392e1f35ffe23250cb08d541f16c9d627

```md
## Context

本 fork 在 VSCode 和 JetBrains host 内嵌 React WebGUI，同时持续跟进上游 opencode。当前分支是 `ide-plugin`；上游 opencode remote HEAD 解析为 `opencode/dev`。项目约束要求上游合并后构建通过，并避免 WebGUI 或 IDE 插件回归。

WebGUI 依赖以下集成点：

- SDK/HTTP calls: `session`、`config`、`provider`、`project`、`path`、`permission`、`question`、`mcp`、`skill` 和 global config endpoints。
- SSE events: `message.*`、`session.*`、`permission.*`、`question.*`、`todo.updated`、file/edit events 和连接生命周期事件。
- IDE bridge: `storageGet`、`storageSet`、`reloadPath`、bridge SSE reconnect 和 host restart/update requests。
- Host packaging: WebGUI build embedding、VSCode extension packaging 和 JetBrains Gradle plugin packaging。

## Goals / Non-Goals

**Goals:**

- 默认合并上游 `opencode/dev`，除非用户在 build 开始前指定其他 ref。
- 解决冲突时保留上游 opencode 行为和下游 WebGUI/IDE 插件行为。
- 在接受合并前识别由上游 API、SDK、schema、event 或 build 变化引起的 WebGUI 回归。
- 如果冲突要求删除或削弱任一侧功能，暂停并等待用户决定。
- 留下能覆盖主要 WebGUI 集成风险的聚焦验证。

**Non-Goals:**

- 不重建 WebGUI 架构，也不将其替换为上游 UI。
- 不在合并上游时加入无关产品功能。
- 除非上游变化强制要求，否则不重写 SDK generation 或 IDE bridge protocols。

## Decisions

1. 使用 `opencode/dev` 作为默认合并来源。

   理由：`refs/remotes/opencode/HEAD` 指向 `opencode/dev`，这是最符合 remote 配置的上游目标。备选方案是合并 `opencode/v2`；除非用户要求，否则不采用，因为它不是 remote HEAD。

2. 将 WebGUI 兼容性作为合并合同。

   理由：本 fork 的价值是 IDE-hosted WebGUI，因此合并成功不等于仅仅没有冲突。备选方案是只跑上游通用测试；不采用，因为它可能漏掉 fork-specific bridge 回归。

3. 上游合同变化时，优先使用小型 adapter，而不是大范围重写。

   理由：现有 WebGUI 已有本地 SDK wrappers，用于 fork-specific endpoints 和兼容空缺。扩展 wrapper 比重写 state providers 更小、更低风险。备选方案是让所有 WebGUI 调用直接适配重新生成的上游 SDK；除非 wrapper 兼容成本高于直接使用，否则不采用。

4. 遇到无法避免的产品取舍时停止。

   理由：用户明确要求尽量同时保留上下游行为。若无法做到，这是产品决策，不是实现细节。

## Risks / Trade-offs

- 上游 SDK 或 endpoint shape 变化导致 WebGUI 调用失败 -> 在最终确定冲突解法前，对比 WebGUI SDK wrapper 使用和生成后的 SDK/API 变化。
- SSE event 名称或 payload 变化 -> 对照 server event definitions 审计 `events.ts`、`SessionContext` 和 `MessagesContext`，只在需要时加入兼容映射。
- Provider/model schema 变化导致 selection restore 失败 -> 验证 `config.providers`、model variants、agent selection 和 persisted selection 行为。
- IDE bridge 行为在纯浏览器测试之外回归 -> 覆盖 storage、reloadPath 和 reconnect 路径的 host bridge 检查。
- Build 依赖变化让旧验证命令失效 -> 优先使用仓库脚本，仅在上游改变 build system 时调整命令。

## Migration Plan

1. Fetch 上游 refs，并将 `opencode/dev` 合并到 `ide-plugin`。
2. 解决冲突并保留双方行为；如果冲突迫使产品取舍，立即暂停。
3. 对照上游变化审计 WebGUI 集成点。
4. 应用审计所需的最小兼容修复。
5. 运行聚焦的 WebGUI、opencode、VSCode 和 JetBrains 验证。

回滚策略：在验证完成前把 merge 工作保留在当前分支；如果合并无法在可接受取舍内完成，最终化前停止并让用户选择路径。

## Open Questions

- build 开始时 `opencode/dev` 是否仍是目标？当前确认的默认答案是是。
- 最终验证命令集取决于合并过程中遇到的上游依赖/build 变化。
```

## openspec/changes/sync-opencode-webgui/tasks.md

- Source: openspec/changes/sync-opencode-webgui/tasks.md
- Lines: 1-31
- SHA256: 16299b4bdc743a4b83f75f86f39f2ba20d46f52e33478d92eb05dadf46d5f349

```md
## 1. Merge Preparation

- [ ] 1.1 确认上游 merge target ref，默认使用 `opencode/dev`。
- [ ] 1.2 Fetch 上游 refs，并记录 merge 前 baseline commit。
- [ ] 1.3 识别 WebGUI、SDK/API、event schemas 和 IDE bridge 文件中的高概率冲突与回归热点。

## 2. Upstream Merge

- [ ] 2.1 将确认后的上游 ref merge 到 `ide-plugin`。
- [ ] 2.2 解决冲突，同时保留上游 opencode 行为和下游 WebGUI/IDE 插件行为。
- [ ] 2.3 在应用任何必须二选一的冲突解法前，停止并询问用户。

## 3. WebGUI Compatibility Audit

- [ ] 3.1 对照 merge 后的 SDK/API surface 审计 WebGUI SDK calls。
- [ ] 3.2 审计 `message.*`、`session.*`、`permission.*` 和 `question.*` 的 SSE event handling 回归。
- [ ] 3.3 对照上游 schema 变化审计 provider/model/agent/variant selection 和 project/path loading。
- [ ] 3.4 审计 VSCode 和 JetBrains hosts 的 IDE bridge storage、reconnect 和 `reloadPath` 行为。

## 4. Compatibility Fixes

- [ ] 4.1 对破损的 WebGUI 或 IDE bridge call paths 应用最小必要兼容修复。
- [ ] 4.2 仅在 merge 确实需要时更新或重新生成受影响的 SDK/build artifacts。
- [ ] 4.3 将无关上游清理或 fork 清理排除在本 change 外。

## 5. Verification

- [ ] 5.1 运行相关 opencode typecheck/test/build 验证。
- [ ] 5.2 运行覆盖 session、message streaming、provider/model selection、permission/question 和 IDE bridge flows 的 WebGUI 验证。
- [ ] 5.3 运行相关 VSCode 和 JetBrains packaging 或 bridge 验证。
- [ ] 5.4 进入 verify 阶段前记录任何剩余上游兼容风险。
```

## openspec/changes/sync-opencode-webgui/specs/webgui-upstream-compatibility/spec.md

- Source: openspec/changes/sync-opencode-webgui/specs/webgui-upstream-compatibility/spec.md
- Lines: 1-41
- SHA256: fad963bb7e71bae22bdfaa05646b17775b45a6df1f831bcc9aa905bf7be85365

```md
## ADDED Requirements

### Requirement: Preserve WebGUI behavior through upstream sync

合并上游 opencode 更新后，系统 SHALL 保持 IDE-hosted WebGUI 在核心 session、message、provider、project、permission、question 和 tool-result workflows 中可用。

#### Scenario: Core WebGUI session workflow still works

- **WHEN** 合并后的构建运行 WebGUI 并连接 opencode server
- **THEN** 用户可以加载 project/path 数据、列出 sessions、创建 session、切换 session、更新或删除 session、发送 prompt、接收 streamed message updates，并观察 idle/status transitions，且不会出现 API shape 错误

#### Scenario: Permission and question flows still work

- **WHEN** server 为某个 session 发出 permission 或 question request
- **THEN** WebGUI 显示 pending request，并可通过预期 API route reply 或 reject

#### Scenario: Provider and model selection still works

- **WHEN** 用户加载或更改 provider、model、agent 或 variant selection
- **THEN** WebGUI 恢复可用 selection、从不可用 selection fallback，并持久化最终选择，且不破坏 prompt submission

### Requirement: Preserve IDE bridge behavior through upstream sync

合并上游 opencode 更新后，系统 SHALL 保持 VSCode 和 JetBrains WebGUI bridge 行为与嵌入式 WebGUI 兼容。

#### Scenario: IDE bridge storage and reconnect remain available

- **WHEN** WebGUI 在支持的 IDE host 内打开，并带有 bridge URL 和 token 参数
- **THEN** bridge connection、reconnect、`storageGet` 和 `storageSet` 继续用于 WebGUI state persistence

#### Scenario: Tool file edits notify the host

- **WHEN** `write`、`edit` 或 `apply_patch` tool part 完成并携带受影响 file paths
- **THEN** WebGUI 为受影响文件发送 `reloadPath` bridge messages，使 IDE host 可以刷新这些文件

### Requirement: Stop before unresolved tradeoffs

merge 过程 SHALL 在接受任何无法同时保留上游 opencode 行为和下游 WebGUI/IDE 插件行为的冲突解法前，停止并等待用户输入。

#### Scenario: Conflict requires choosing one side

- **WHEN** 某个冲突或上游合同变化无法通过 compatibility adapter 同时保留双方行为
- **THEN** 实施者展示选项，并等待用户决定后再继续

### Requirement: Verify fork-specific compatibility

完成的 merge SHALL 包含覆盖上游 build health 和 fork-specific WebGUI/IDE integration risk 的验证。

#### Scenario: Verification covers upstream and downstream surfaces

- **WHEN** merge 实现准备进入验证
- **THEN** 验证包含相关 opencode checks、WebGUI checks，以及捕捉受影响 surface 回归所需的 IDE host packaging 或 bridge checks
```
