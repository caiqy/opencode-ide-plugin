# webgui-upstream-compatibility Specification

## Purpose
TBD - created by archiving change sync-opencode-webgui. Update Purpose after archive.
## Requirements
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
