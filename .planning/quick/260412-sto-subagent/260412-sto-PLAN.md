# Quick Task 260412-sto: 展示委派子任务的subagent类型信息

## Task 1: Add subagentType to SubtaskDrawer context and display

**Files:**

- `packages/opencode/webgui/src/state/SubtaskDrawerContext.tsx`
- `packages/opencode/webgui/src/components/parts/ToolPart/index.tsx`
- `packages/opencode/webgui/src/components/SubtaskDrawer/SubtaskDrawer.tsx`

**Action:**

1. Add `subagentType` field to `OpenSubtaskDrawerInput` and `SubtaskDrawerState` in context
2. Extract `subagent_type` from `part.state.input` in ToolPart, pass to openSubtaskDrawer calls
3. Include subagent type in ToolPart progress text (e.g., "委派子任务 (explore)：title")
4. Include subagent type in SubtaskDrawer header title

**Verify:** `bun run test` in webgui directory
**Done:** Subagent type visible in both subtask list items and drawer title
