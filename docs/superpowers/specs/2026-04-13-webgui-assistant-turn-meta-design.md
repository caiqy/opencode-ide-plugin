# WebGUI Assistant Turn Meta 信息展示

**日期**: 2026-04-13
**状态**: 设计已确认

## 概述

在 WebGUI 中复刻 opencode 官方桌面 App 的 assistant turn 完成态 meta 信息展示，并额外增加 reasoning level (variant) 的显示。当一轮 AI 对话结束时，在最后一条 assistant 消息底部显示 agent、模型名称、推理级别和整轮耗时。

## 参照

opencode 官方桌面 App (`packages/ui/src/components/message-part.tsx:1361-1370`) 在 assistant 文本 part 底部渲染 meta：

```
Agent · ModelName · Duration [· Interrupted]
```

本设计在此基础上增加 variant 展示：

```
Agent · ModelName · Variant · Duration [· Interrupted]
```

## 需求

1. **主会话消息列表**：在最后一条 assistant 消息底部显示 meta 行
2. **子任务弹层 (SubtaskDrawer)**：在子任务 session 的最后一条 assistant 消息底部显示相同的 meta 行
3. 两处共用同一套渲染逻辑

### Meta 信息内容

| 字段        | 来源                                                            | 展示规则                            |
| ----------- | --------------------------------------------------------------- | ----------------------------------- |
| Agent       | `assistantMessage.agent`                                        | 首字母大写，始终显示                |
| ModelName   | `providers.find(p => p.id === providerID).models[modelID].name` | 始终显示，fallback 到 raw modelID   |
| Variant     | `assistantMessage.variant`                                      | 仅非默认值（如 low/high/max）时显示 |
| Duration    | `lastAssistantCompleted - userMessageCreated`                   | 始终显示（turn 级别）               |
| Interrupted | `assistantMessage.error?.name === "MessageAbortedError"`        | 仅中断时显示                        |

### 展示格式

- 完整：`Code · Claude Sonnet 4 · high · 23s`
- 无 variant：`Code · Claude Sonnet 4 · 23s`
- 被中断：`Code · Claude Sonnet 4 · high · 23s · interrupted`
- 分钟级：`Code · Claude Sonnet 4 · 2m 13s`

### 展示位置

仅在本轮对话的**最后一条 assistant 消息**底部显示。一轮可能产生多条 assistant 消息（多步工具调用），只有最后一条显示 meta。

## 技术设计

### 方案选择：轻量适配（方案 A）

不引入新的全局 store 或 Context，在现有组件层按需获取数据，通过 props 传递 turn duration。与 WebGUI 现有"各组件自行调 SDK"的模式保持一致。

### 改动清单

#### 1. 新增 `useProviderStore` hook

**文件**: `packages/opencode/webgui/src/hooks/useProviderStore.ts`

**职责**: 调用 `sdk.config.providers()` 并缓存结果，暴露 model 名称解析能力。

```ts
// 接口
function useProviderStore(): {
  resolveModelName(providerID: string, modelID: string): string
}
```

**实现要点**:

- 使用模块级变量缓存 provider 列表，避免每个组件实例独立请求
- 组件挂载时如果缓存为空则触发一次 `sdk.config.providers()` 调用
- `resolveModelName` 从缓存中查找：`providers.find(p => p.id === providerID)?.models?.[modelID]?.name ?? modelID`
- 与现有 `useSessionUsage.ts` 里按需调 SDK 的模式一致

#### 2. 新增 `AssistantMeta` 组件

**文件**: `packages/opencode/webgui/src/components/MessageList/AssistantMeta.tsx`

**职责**: 纯展示组件，渲染 meta 行。

```tsx
interface AssistantMetaProps {
  agent: string
  modelName: string
  variant?: string // 仅非默认时传入
  durationMs?: number // turn 级别耗时
  interrupted?: boolean
}
```

**渲染规则**:

- 将各字段拼接为 `items.filter(Boolean).join(" · ")`
- Duration 格式化：< 60s 显示 `Xs`，≥ 60s 显示 `Xm Ys`
- 样式：`text-xs text-gray-400 dark:text-gray-500`，与现有 `TypingIndicator`、tool duration 的灰色文字风格一致

#### 3. 修改 `MessageRow` 组件

**文件**: `packages/opencode/webgui/src/components/MessageList/MessageRow.tsx`

**Props 新增**:

```ts
interface MessageRowProps {
  // ... 现有 props
  turnDurationMs?: number // turn 级别耗时
  showMeta?: boolean // 是否显示 meta（仅最后一条 assistant 为 true）
}
```

**渲染逻辑**:

- 当 `showMeta && isAssistant && assistantInfo?.time?.completed` 时，在消息 parts 下方渲染 `<AssistantMeta />`
- 从 `assistantInfo` 读取 `agent`、`providerID`、`modelID`、`variant`
- 通过 `useProviderStore().resolveModelName()` 获取 model 显示名
- `interrupted` 判断：`assistantInfo.error?.name === "MessageAbortedError"`

#### 4. 修改 `MessageList` 组件

**文件**: `packages/opencode/webgui/src/components/MessageList/index.tsx`

**改动**:

- 计算 turn duration：在 `visibleMessages` 中找到最后一组 user → assistant(s)，计算 `turnDurationMs = lastAssistantCompleted - userCreated`
- 识别最后一条 assistant 消息的 ID
- 在 `renderRow` 中给最后一条 assistant 的 `MessageRow` 传入 `turnDurationMs` 和 `showMeta={true}`

**计算逻辑**（参照官方 App `session-turn.tsx:329-343`）:

```ts
// 找到最后一条 user message
const lastUser = visibleMessages.findLast((m) => m.info.role === "user")
if (!lastUser) return { turnDurationMs: undefined, lastAssistantID: undefined }

// 找到其后所有 assistant messages
const turnAssistants = visibleMessages.filter(
  (m) => m.info.role === "assistant" && m.info.time.created >= lastUser.info.time.created,
)
if (turnAssistants.length === 0) return { turnDurationMs: undefined, lastAssistantID: undefined }

// turn duration = 最晚的 assistant completed - user created
const completedTimes = turnAssistants
  .map((m) => (m.info as { time: { completed?: number } }).time.completed)
  .filter((t): t is number => typeof t === "number" && t > 0)
const lastCompleted = completedTimes.length > 0 ? Math.max(...completedTimes) : undefined
const turnDurationMs = lastCompleted !== undefined ? lastCompleted - lastUser.info.time.created : undefined

// 最后一条 assistant 的 ID
const lastAssistantID = turnAssistants.at(-1)?.info.id
```

#### 5. 修改 `SubtaskMessageList` 组件

**文件**: `packages/opencode/webgui/src/components/SubtaskDrawer/SubtaskMessageList.tsx`

**改动**: 与 `MessageList` 相同的 turn duration 计算和 `showMeta` 逻辑，应用到子任务消息列表的 `MessageRow` 上。

### 数据依赖

| 数据                               | 来源                     | 是否已有                      |
| ---------------------------------- | ------------------------ | ----------------------------- |
| `assistant.agent`                  | assistant message info   | ✅ 已有                       |
| `assistant.providerID`             | assistant message info   | ✅ 已有                       |
| `assistant.modelID`                | assistant message info   | ✅ 已有                       |
| `assistant.variant`                | assistant message info   | ✅ 已有                       |
| `assistant.time.created/completed` | assistant message info   | ✅ 已有                       |
| `assistant.error`                  | assistant message info   | ✅ 已有                       |
| Model display name                 | `sdk.config.providers()` | ✅ 已有 API，需新增 hook 封装 |
| User message time.created          | user message info        | ✅ 已有                       |

**无需后端改动。** 所有数据已从现有 API 可获取。

### 组件树（改动后）

```
MessageList
  └─ renderRow(message)
       └─ MessageRow { showMeta, turnDurationMs }
            ├─ MessagePart × N
            └─ AssistantMeta  ← 新增（仅 showMeta=true 时渲染）

SubtaskDrawer
  └─ SubtaskMessageList
       └─ MessageRow { showMeta, turnDurationMs }  ← 同上
            ├─ MessagePart × N
            └─ AssistantMeta  ← 同上
```

### 样式

- 字体大小：`text-xs`（12px），与现有工具调用耗时标签一致
- 颜色：`text-gray-400 dark:text-gray-500`，低调的辅助文字
- 间距：`pt-1 pb-2`，在消息 parts 和下一条消息之间
- 无背景、无边框，纯文字行

### 不涉及的范围

- 不改动 Context 层或引入新 Context
- 不改动 SSE 事件处理
- 不改动后端 API
- 不显示 token/cost（已有 `UsageDisplay` 和 `MessageStats` 覆盖）
- 不重构消息为 turn 概念（保持现有逐条消息结构）

## 测试策略

1. **`AssistantMeta` 单元测试**：验证各组合情况的拼接格式（有/无 variant、有/无 duration、interrupted）
2. **`MessageRow` 测试**：验证 `showMeta=true` 时渲染 meta，`showMeta=false` 时不渲染
3. **turn duration 计算测试**：提取为纯函数，验证 user→assistant 耗时计算逻辑
4. **`useProviderStore` 测试**：验证缓存行为和 model 名称解析 fallback

## 影响分析

- **改动范围**: 5 个文件（1 新增 hook、1 新增组件、3 修改现有组件）
- **风险**: 低。纯 UI 展示功能，不影响消息发送/接收/状态管理
- **性能**: provider 列表通过模块级缓存，不会增加重复请求
