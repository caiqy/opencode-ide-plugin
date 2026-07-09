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
