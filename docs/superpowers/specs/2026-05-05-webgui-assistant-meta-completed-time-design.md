# WebGUI AssistantMeta 相对日期结束时间展示

**日期**: 2026-05-05
**状态**: 设计已确认

## 概述

在 WebGUI 聊天消息列表中，当前 assistant 回复完成后会在消息底部显示一行 meta 信息，例如 `Build · GPT-5.4 · high · 1m 11s`。本次改动希望在该标签末尾追加这轮回复的**结束时间**，并按用户本地日期显示更自然的相对日期文案：今天、昨天、前天，其余日期再回退到完整中文日期，便于用户快速判断回复完成时刻。

本次仅修改 WebGUI 聊天气泡底部标签这一处，不改 transcript、导出文本或其他元信息展示位置。

## 需求

1. 仅修改 WebGUI 主消息区 assistant 气泡底部的 meta 标签
2. 追加展示 assistant 回复结束时间
3. 时间文案按用户本地时间判断日期边界
4. 结束时间直接拼接到现有同一行标签末尾
5. 中断结束的回复若存在结束时间，也应一并显示
6. 时间显示规则为：今天/昨天/前天显示相对日期，其余显示 `YYYY年MM月DD日 HH:mm:ss`

### 展示格式

- 今天：`Build · GPT-5.4 · high · 1m 11s · 今天 14:23:18`
- 昨天：`Build · GPT-5.4 · high · 1m 11s · 昨天 09:10:11`
- 前天：`Build · GPT-5.4 · high · 1m 11s · 前天 22:08:30`
- 其他日期：`Build · GPT-5.4 · 1m 11s · 2026年05月01日 08:00:00`
- 中断：`Build · GPT-5.4 · high · 1m 11s · 今天 14:23:18 · interrupted`
- 无结束时间：保持原有格式，不补伪造时间

## 技术设计

### 方案选择：局部增强 + 可测试 formatter（方案 B）

保持当前 `AssistantMeta` 作为元信息拼接组件的职责不变，在现有 props 基础上新增 `completedAt`，由 `MessageRow` 读取 assistant message 上已有的完成时间并传入。时间展示能力收敛到一个可传入 `now` 的公共 formatter 中，这样既能按用户本地时间判断今天/昨天/前天，也能在测试中稳定构造时间边界场景。

这样做的好处是：

- 改动范围严格收敛在当前 WebGUI 标签展示链路
- 不引入新的状态、接口或跨组件依赖
- 与现有 `items.filter(Boolean).join(" · ")` 的拼接方式一致

### 改动清单

#### 1. 扩展相对日期时间格式化工具

**文件**: `packages/opencode/webgui/src/utils/formatting.ts`

新增一个相对日期时间格式化函数：

```ts
formatRelativeDateTimeLabel(timestamp: number, now?: number): string
```

**职责**:

- 输入毫秒时间戳，以及可选的 `now`
- 按用户本地时间比较日期边界
- 输出规则：
  - 今天：`今天 HH:mm:ss`
  - 昨天：`昨天 HH:mm:ss`
  - 前天：`前天 HH:mm:ss`
  - 其他：`YYYY年MM月DD日 HH:mm:ss`
- 不依赖 `toLocaleString()`，避免不同环境下格式不稳定

#### 2. 扩展 `AssistantMeta` 组件

**文件**: `packages/opencode/webgui/src/components/MessageList/AssistantMeta.tsx`

在现有 props 基础上新增：

```tsx
interface AssistantMetaProps {
  agent: string
  modelName: string
  variant?: string
  durationMs?: number
  completedAt?: number
  interrupted?: boolean
}
```

**渲染规则**:

- 继续沿用数组拼接：`items.filter(Boolean).join(" · ")`
- `completedAt` 为有效时间戳时，追加格式化后的结束时间文案
- `completedAt` 缺失或非法时，不显示结束时间
- `interrupted` 继续保持现有显示逻辑，并排在结束时间之后

#### 3. 修改 `MessageRow` 传参与渲染

**文件**: `packages/opencode/webgui/src/components/MessageList/MessageRow.tsx`

在当前渲染 `AssistantMeta` 的位置，从 assistant message 读取：

- `assistantInfo.time.completed` → `completedAt`
- `assistantInfo.agent` → `agent`
- `assistantInfo.providerID / modelID` → `modelName`
- `assistantInfo.variant` → `variant`
- 既有 `turnDurationMs` → `durationMs`
- 既有中断判断 → `interrupted`

渲染条件保持当前思路：

- 正常完成时显示 meta
- `MessageAbortedError` 场景也允许显示 meta
- 若中断消息没有 `completedAt`，则只缺少时间片段，不额外伪造当前时间

### 数据来源

| 字段        | 来源                                    | 是否已有 |
| ----------- | --------------------------------------- | -------- |
| Agent       | `assistantInfo.agent`                   | ✅       |
| ModelName   | `resolveModelName(providerID, modelID)` | ✅       |
| Variant     | `assistantInfo.variant`                 | ✅       |
| Duration    | 现有 `turnDurationMs`                   | ✅       |
| CompletedAt | `assistantInfo.time.completed`          | ✅       |
| Interrupted | `error?.name === "MessageAbortedError"` | ✅       |

**无需后端改动。** 本次所需数据都已在现有消息结构中提供。

## 组件数据流

```
MessageRow
  └─ AssistantMeta {
       agent,
       modelName,
       variant,
       durationMs,
       completedAt,
       interrupted,
     }
```

`AssistantMeta` 只负责拼接和展示；`MessageRow` 负责从消息对象提取对应字段。

## 异常与边界规则

1. **缺少完成时间**：不显示结束时间，其他字段照常显示
2. **中断完成**：若有 `completedAt`，显示结束时间和 `interrupted`
3. **非法时间戳**：按缺少完成时间处理，不显示该片段
4. **日期边界**：今天/昨天/前天按用户本地时间的自然日边界判断，不按 UTC 或固定时区判断
5. **无 meta 可显示**：保持当前 `items.length === 0` 时不渲染

## 不涉及范围

- 不改 transcript / CLI 导出文本
- 不改其他列表、popover 或详情页
- 不修改 turn duration 计算逻辑
- 不增加 hover tooltip 或换行展示
- 不引入新的 Context、store 或服务端字段

## 测试策略

1. **`AssistantMeta.test.tsx`**
   - 有 `completedAt` 且是今天时正确显示 `今天 HH:mm:ss`
   - 无 `completedAt` 时保持原有格式
   - `interrupted + completedAt` 时两者同时显示
   - 非法 `completedAt` 时不显示时间
2. **`formatting.test.ts`**
   - 覆盖今天、昨天、前天、其他日期四类输出
   - 通过显式传入 `now` 保证测试稳定

## 影响分析

- **改动范围**: 小，主要集中在 3 个文件（`AssistantMeta.tsx`、`MessageRow.tsx`、`formatting.ts`）及对应测试
- **风险**: 低，纯展示层改动，不影响消息流、状态管理和后端协议
- **兼容性**: 高，缺少完成时间时自动回退到当前展示效果
