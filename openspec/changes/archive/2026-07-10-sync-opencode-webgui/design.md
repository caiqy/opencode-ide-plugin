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
