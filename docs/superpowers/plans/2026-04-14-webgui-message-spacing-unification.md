# WebGUI Message Spacing Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一 WebGUI 主消息列表与子任务消息列表的纵向间距控制，消除连续 tool 卡片视觉粘连。

**Architecture:** 用父容器 `flex flex-col gap-*` 统一控制兄弟节点间距，移除各 part 根节点对外 margin，让组件只负责自身内部 padding 与局部排版。同时给 `ToolPart` 增加圆角强化视觉分隔。

**Tech Stack:** React 19、TypeScript、Vitest、Testing Library、Tailwind CSS 4

---

### Task 1: 用测试锁定外层列表与消息行间距策略

**Files:**

- Modify: `packages/opencode/webgui/src/components/MessageList/index.test.tsx`
- Modify: `packages/opencode/webgui/src/components/SubtaskDrawer/SubtaskMessageList.test.tsx`
- Create: `packages/opencode/webgui/src/components/MessageList/MessageRow.test.tsx`

- [ ] **Step 1: 写失败测试，断言列表层使用 `flex flex-col gap-4`，消息行内部使用 `flex flex-col gap-3`，且用户消息外层不再带 `pb-2`。**
- [ ] **Step 2: 运行这些测试并确认它们因现有 `space-y-*` / `pb-2` 失败。**

### Task 2: 实现统一间距策略

**Files:**

- Modify: `packages/opencode/webgui/src/components/MessageList/index.tsx`
- Modify: `packages/opencode/webgui/src/components/SubtaskDrawer/SubtaskMessageList.tsx`
- Modify: `packages/opencode/webgui/src/components/MessageList/MessageRow.tsx`
- Modify: `packages/opencode/webgui/src/components/MessageList/AssistantMeta.tsx`
- Modify: `packages/opencode/webgui/src/components/MessageList/CollapsiblePart.tsx`
- Modify: `packages/opencode/webgui/src/components/MessageList/ReasoningPart.tsx`
- Modify: `packages/opencode/webgui/src/components/MessageList/Parts/QuestionPart/index.tsx`
- Modify: `packages/opencode/webgui/src/components/parts/ToolPart/index.tsx`
- Modify: `packages/opencode/webgui/src/components/parts/RetryPart.tsx`
- Modify: `packages/opencode/webgui/src/components/parts/SnapshotPart.tsx`
- Modify: `packages/opencode/webgui/src/components/parts/PatchPart.tsx`

- [ ] **Step 1: 将列表容器从 `space-y-4` 改为 `flex flex-col gap-4`。**
- [ ] **Step 2: 将 `MessageRow` 的 part 容器从 `space-y-1` 改为 `flex flex-col gap-3`，并移除用户消息外层 `pb-2`。**
- [ ] **Step 3: 移除各 part 根节点对外 margin，仅保留组件内部 spacing。**
- [ ] **Step 4: 为 `ToolPart` 根节点添加 `rounded-lg`，并去掉 `my-1`。**

### Task 3: 验证回归

**Files:**

- Modify: `packages/opencode/webgui/src/components/parts/ToolPart/index.test.tsx`

- [ ] **Step 1: 运行聚焦测试，确认新增断言全部通过。**
- [ ] **Step 2: 如有必要补充 `ToolPart` 根节点圆角与无外边距断言。**
- [ ] **Step 3: 运行完整相关测试集，确认没有引入回归。**
