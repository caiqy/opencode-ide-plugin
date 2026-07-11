# webgui-upstream-compatibility Specification

## Purpose
TBD - created by archiving change sync-opencode-webgui. Update Purpose after archive.
## Requirements
### Requirement: Preserve WebGUI behavior through upstream sync

After merging upstream opencode updates, the system SHALL keep the IDE-hosted WebGUI usable across core session, message, provider, project, permission, question, and tool-result workflows.

#### Scenario: Core WebGUI session workflow still works

- **WHEN** the merged build runs the WebGUI and connects to the opencode server
- **THEN** users can load project/path data, list sessions, create, switch, update, or delete a session, submit prompts, receive streamed message updates, and observe idle/status transitions without API shape errors

#### Scenario: Permission and question flows still work

- **WHEN** the server issues a permission or question request for a session
- **THEN** the WebGUI displays the pending request and can reply or reject through the expected API route

#### Scenario: Provider and model selection still works

- **WHEN** users load or change provider, model, agent, or variant selection
- **THEN** the WebGUI restores available selections, falls back from unavailable selections, and persists the final selection without breaking prompt submission

#### Scenario: Reasoning variant labels remain understandable

- **WHEN** a reasoning model provides variant selection including `minimal`
- **THEN** the WebGUI shows every available variant in the reasoning effort list, displays the original English name to the right of its Chinese label, and still submits the original variant value

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

