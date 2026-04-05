# 子任务阻塞状态指示器

> 日期：2026-04-06
> 状态：已批准

## 问题

当子任务（通过 task tool 委派）执行过程中遇到 permission（授权）或 question（提问）等需要用户交互的阻塞点时，主界面上 task 工具行仅显示普通的 running 进度（如"3 工具调用 / 读取文件"），用户无法感知子任务已被阻塞。从用户视角看，主任务像卡死了一样没有任何进展，必须自己猜测并手动打开子任务弹层才能发现问题。

## 方案

利用已有的 SSE 事件和前端状态数据，在 task 工具行的渲染层检测子会话是否有未解决的 permission/question，有则改变工具行的视觉状态，引导用户打开弹层操作。

不需要任何后端改动或新的 SSE 事件。

### 为什么选这个方案

- `permission.asked` 和 `question.asked` 事件已经通过 SSE 全局推送，`MessagesContext` 中按 `sessionID` 索引存储了 `permissions` 和 `questions`
- 当前 `ToolPart/index.tsx` 已经能通过 `subtaskSessionId` 拿到子会话 ID
- 改动集中在前端渲染层，范围小且风险低

## 数据流

task 工具行渲染时，新增一个 `blocked` 计算：

```
输入: subtaskSessionId, permissions (数组), getQuestionsBySession (函数)
输出: "permission" | "question" | null
```

逻辑：

1. `subtaskSessionId` 为空 → `null`
2. `permissions.some(p => p.sessionID === subtaskSessionId)` → `"permission"`
3. `getQuestionsBySession(subtaskSessionId).length > 0` → `"question"`
4. 否则 → `null`

permission 优先于 question（两者同时存在时显示 permission）。

数据来源全部是现有的 SSE 事件驱动状态，不需要额外的 API 调用或轮询。

## 视觉变化

task 工具行在三种状态下的外观差异：

### 正常运行（blocked = null）

- 图标：闪电图标，`animate-pulse`
- 文案：`委派子任务：xxx [ N 工具调用 / 当前工具 ]`
- 左侧边框：`border-gray-200 dark:border-gray-700`
- 背景：默认 `bg-gray-50 dark:bg-gray-900`

### 等待授权（blocked = "permission"）

- 图标：三角警告图标，琥珀色，`animate-pulse`（加速脉冲）
- 文案：`委派子任务：xxx [ ⚠ 等待授权 — 点击查看 ]`，文字颜色 `text-amber-600`
- 左侧边框：`border-amber-400 dark:border-amber-600`
- 背景：`bg-amber-50/50 dark:bg-amber-900/10`

### 等待回答（blocked = "question"）

- 图标：问号圆圈图标，蓝色，`animate-pulse`（加速脉冲）
- 文案：`委派子任务：xxx [ ❓ 等待回答 — 点击查看 ]`，文字颜色 `text-blue-600`
- 左侧边框：`border-blue-500 dark:border-blue-600`
- 背景：`bg-blue-50/50 dark:bg-blue-900/10`

## 点击交互

- `blocked === null`：点击整行 → 展开/折叠（现有行为不变）
- `blocked !== null`：点击整行 → 调用 `openSubtaskDrawer()` 打开弹层
- 右侧 `>` 箭头：始终保留展开/折叠功能（无论是否阻塞）
- 右侧"查看子任务"按钮：行为不变

## 阻塞解除后的状态恢复

当用户在弹层中完成授权或回答后：

1. SSE 推送 `permission.replied` → `MessagesContext` 从 `permissions` 数组中移除该条记录
2. SSE 推送 `question.replied` → `MessagesContext` 从 `questions` Map 中移除该条记录
3. `blocked` 的 useMemo 自动重新求值 → 变回 `null`
4. 工具行外观自动恢复为正常 running 状态
5. 点击行为也自动恢复为展开/折叠

不需要任何额外的"恢复"逻辑，完全由响应式数据驱动。

## 弹层内部

`SubtaskDrawer` / `SubtaskMessageList` 已经能正确渲染子会话的 `PermissionBanner` 和 `QuestionPart`，不需要改动。

## 文件改动清单

### `ToolPart/index.tsx`

- 从 `useMessages()` 额外解构 `permissions` 和 `getQuestionsBySession`
- 新增 `blocked` 的 useMemo 计算
- 修改 `taskProgressName`：当 `blocked` 非 null 时替换进度文案为阻塞提示
- 将 `blocked` 传给 `ToolHeader`
- 修改 `getBorderColor` 调用：传入 `blocked` 信息
- 阻塞时整行点击改为打开弹层

### `ToolPart/ToolHeader.tsx`

- 新增可选 prop `blocked: "permission" | "question" | null`
- 新增可选 prop `onBlockedClick: () => void`
- 图标渲染：`blocked` 时用 `getBlockedIcon(blocked)` 替代 `getStatusIcon(status)`
- 背景样式：`blocked` 时加微弱的琥珀/蓝底色
- 点击处理：`blocked` 时 `onClick` 指向 `onBlockedClick` 而非 `onToggle`

### `ToolPart/utils.tsx`

- 新增 `getBlockedIcon(type: "permission" | "question")` → 返回对应 SVG 图标
- 新增 `getBlockedClasses(type: "permission" | "question")` → 返回背景色 CSS 类
- 修改 `getBorderColor`：支持 `blocked` 参数影响边框颜色

### `MessagesContext.tsx`

- 确认 `permissions` 数组已在 context value 中暴露（当前已通过 `permissions = []` 在解构中出现，可能需要确认 context value 赋值处）

### 不需要改动

- `SubtaskDrawer.tsx` / `SubtaskMessageList.tsx`
- `PermissionBanner.tsx`
- 后端文件
- SSE 事件处理

## 测试

在 `ToolPart/index.test.tsx` 中新增：

1. mock 子会话有 pending permission 时 → 验证工具行渲染琥珀色阻塞状态 + "等待授权"文案
2. mock 子会话有 pending question 时 → 验证工具行渲染蓝色阻塞状态 + "等待回答"文案
3. blocked 状态下点击整行 → 验证触发 `openSubtaskDrawer` 而非 `onToggle`
4. permission 清除后 → 验证工具行恢复正常 running 状态
