# Quick Task 260412-sto: 展示委派子任务的subagent类型信息 - Summary

## Changes

### SubtaskDrawerContext (`packages/opencode/webgui/src/state/SubtaskDrawerContext.tsx`)

- 新增 `subagentType` 字段到 `OpenSubtaskDrawerInput` 和 `SubtaskDrawerState`
- Provider 中增加对应的 state 和 setter

### ToolPart (`packages/opencode/webgui/src/components/parts/ToolPart/index.tsx`)

- 新增 `subagentType` memo，从 `part.state.input.subagent_type` 提取
- `progress` 文本增加 agent tag：`委派子任务 (explore)：标题 [...]`
- 所有 `openSubtaskDrawer` 调用传入 `subagentType`

### SubtaskDrawer (`packages/opencode/webgui/src/components/SubtaskDrawer/SubtaskDrawer.tsx`)

- `headerSummary` 增加 agent tag 展示

### Tests

- 更新 ToolPart 测试断言以匹配新的 progress 格式和 drawer 调用参数

## Commit

- `ded98d653` feat(webgui): 在委派子任务中展示 subagent 类型信息
