# 标签页右键菜单新增“重新生成标签名”

> 日期：2026-04-16
> 状态：待审阅

## 问题

当前 WebGUI 标签页右键菜单中提供了“重命名”，但没有提供“重新生成标签名”。

现状意味着：

- 如果自动标题不理想，用户只能手动输入新标题
- 即使服务端已经具备基于会话内容自动生成标题的能力，WebGUI 也无法对已有会话再次触发这套逻辑
- 手动重命名与自动命名之间缺少一个中间选项，导致标签整理效率不够高

本次需求是在标签页右键菜单中新增一个“重新生成标签名”入口，并放在“重命名”上方。点击后，直接基于当前会话内容重新生成标题并覆盖当前标签名。

## 范围

本次只处理 WebGUI 标签页右键菜单中的“重新生成标签名”能力，以及支撑它的会话标题重生成接口与测试。

包含：

- `TabContextMenu` 新增菜单项，并调整菜单顺序
- `TabBar` 透传新的重生成回调
- `CompactHeader` 调用 SessionContext 新增的重生成方法
- `SessionContext` 新增 `regenerateSessionTitle(sessionId)`
- 服务端新增“重新生成会话标题”接口
- 将现有标题生成逻辑提取为可复用能力，供首次自动命名与手动重生成共用
- 补充前端与后端测试

不包含：

- 修改“重命名”的交互与行为
- 新增确认弹窗、预览弹窗或二次确认
- 把该能力扩展到历史会话列表、TUI 或 IDE host 原生菜单
- 改动标题生成提示词、模型选择策略或标题长度规则
- 仅对默认标题开放该功能；本次对任意标题都可直接重生成

## 方案

采用“前端新增显式入口 + 后端复用既有标题生成逻辑”的方案。

### 交互规则

标签页右键菜单在“重命名”上方新增：

- `重新生成标签名`

点击后行为如下：

1. 对当前右键命中的会话发起“重新生成标题”请求
2. 服务端根据该会话现有消息历史重新生成标题
3. 若成功生成并成功写回，会话最新标题返回前端
4. 前端同步更新标签与当前会话状态

本次不增加成功 toast；用户直接看到标签名变化即可。失败时显示错误 toast：`重新生成标签名失败`。

### 为什么选择这个方案

- 与现有首次自动命名逻辑保持一致，标题质量更稳定
- 避免前端自行摘要导致标题规则分叉
- 交互直接，符合“重新生成”而不是“建议一个新名字”的预期
- 改动边界清晰：菜单层、状态层、服务端路由层各自只增加一个明确职责点

## 设计细节

### 前端菜单层：`TabContextMenu.tsx`

`TabContextMenu` 新增一个 `onRegenerateTitle` 回调，并在会话操作区将菜单顺序调整为：

1. `重新生成标签名`
2. `重命名`
3. `删除会话`

点击菜单项时仍沿用当前模式：先执行动作，再关闭菜单。

这样可以保持已有菜单交互一致，不引入新的关闭逻辑或局部状态。

### 标签容器层：`TabBar.tsx`

`TabBarProps` 新增：

- `onRegenerateTitle: (id: string) => void`

当右键菜单作用于某个标签时，`ctxMenu.sessionId` 已经能标识当前目标会话，因此这里直接把该 `sessionId` 传给上层即可。

`TabBar` 不负责生成标题，也不维护额外 loading 状态；它只负责把当前目标会话 ID 从菜单事件传递给 `CompactHeader`。

### 头部编排层：`CompactHeader/index.tsx`

`CompactHeader` 从 `useSession()` 里取出新的 `regenerateSessionTitle` 方法，并把它绑定到 `TabBar` 的 `onRegenerateTitle`。

处理规则：

- 成功：无需 toast，依赖返回后的 session 状态更新反映到标签
- 失败：显示 `重新生成标签名失败` 的错误 toast

这里不额外做 optimistic update。因为标题最终应以后端实际生成结果为准，直接复用 SessionContext 的成功返回更简单且更安全。

### 状态层：`SessionContext.tsx`

新增：

- `regenerateSessionTitle: (sessionId: string) => Promise<boolean>`

职责与现有 `updateSessionTitle` 类似，但不接收手动输入标题，而是调用一个新的后端接口，让服务端自行生成并返回更新后的 `Session.Info`。

成功后：

- 更新 `sessions`
- 如果当前会话就是该 `sessionId`，同步更新 `currentSession`
- 返回 `true`

失败后：

- 设置现有 `error` 状态
- 返回 `false`

这样能与 `updateSessionTitle`、`deleteSession` 保持相同风格，便于 `CompactHeader` 统一消费。

### 服务端路由层：`packages/opencode/src/server/routes/session.ts`

新增专用接口，建议形态为：

- 在 `session` 路由下新增 `POST /:sessionID/title/regenerate`

返回值直接使用更新后的 `Session.Info`，保持与前端现有 session 状态同步方式一致。

选择专用路由而不是复用 `PATCH /:sessionID` 的原因：

- “手动设置标题”和“基于消息生成标题”是两种不同语义
- 避免在 `PATCH` body 中再引入布尔开关或特殊魔法值
- API 意图更清晰，SDK 生成后前端调用也更直观

### 标题生成逻辑复用：`packages/opencode/src/session/prompt.ts`

当前标题生成逻辑只在首次自动命名流程中使用。为了支持手动重生成，需要把“根据会话历史生成标题并写回 session”的逻辑提取成可复用函数，而不是复制一份。

建议拆分为两层：

1. **标题计算层**：根据会话、历史消息、provider/model，返回一个生成后的标题字符串或空值
2. **标题写回层**：对返回的有效标题调用 `Session.setTitle`

首次自动命名与手动重生成都调用同一套标题计算逻辑，保持以下规则一致：

- 标题基于会话内容生成
- 继续清洗 `<think>` 内容与空行
- 继续沿用现有最大长度截断规则
- 未生成出有效标题时，不覆盖原标题

与首次自动命名不同的是，手动重生成不应再受“仅默认标题才允许生成”的限制；否则无法满足用户对任意会话标题重新生成的需求。因此需要把“是否允许触发生成”与“如何生成标题”解耦：

- 首次自动命名：仍保留现有 `isDefaultTitle` 保护
- 手动重生成：直接走生成逻辑，不检查是否为默认标题

## 文件改动清单

### 前端修改

- `packages/opencode/webgui/src/components/CompactHeader/TabContextMenu.tsx`
- `packages/opencode/webgui/src/components/CompactHeader/TabBar.tsx`
- `packages/opencode/webgui/src/components/CompactHeader/index.tsx`
- `packages/opencode/webgui/src/state/SessionContext.tsx`
- 如 SDK 接口更新后需同步客户端类型，涉及 `packages/opencode/webgui/src/lib/api/` 的调用点

### 后端修改

- `packages/opencode/src/server/routes/session.ts`
- `packages/opencode/src/session/prompt.ts`
- 如提取复用函数，可能涉及 `packages/opencode/src/session/` 下新增或调整共享实现
- 如需刷新 SDK，涉及 `packages/sdk/js/` 生成产物

### 测试修改

- `packages/opencode/webgui/src/components/CompactHeader/TabContextMenu.test.tsx`
- `packages/opencode/webgui/src/components/CompactHeader/TabBar.test.tsx`
- `packages/opencode/webgui/src/components/CompactHeader/index.test.tsx`
- 服务端对应 session route / title generation 测试文件

## 测试

本次适合采用小范围 TDD：先写失败测试，再补实现。

### 前端测试

#### `TabContextMenu.test.tsx`

至少覆盖：

1. 右键菜单出现 `重新生成标签名`
2. `重新生成标签名` 位于 `重命名` 上方
3. 点击 `重新生成标签名` 时，调用 `onRegenerateTitle`
4. 点击后菜单会关闭

#### `TabBar.test.tsx`

至少覆盖：

1. 从右键菜单点击 `重新生成标签名`，会把当前标签 ID 传给新的回调
2. 不影响现有 `重命名` 内联编辑行为测试

#### `CompactHeader/index.test.tsx`

至少覆盖：

1. 触发 `onRegenerateTitle` 时会调用 `regenerateSessionTitle(sessionId)`
2. `regenerateSessionTitle` 返回 `false` 时显示 `重新生成标签名失败`
3. 成功时不显示错误 toast

### 后端测试

至少覆盖：

1. 新接口可对指定 session 触发标题重生成
2. 标题生成逻辑仍会清洗空内容与 `<think>` 片段
3. 生成出有效标题时会写回 session 并返回更新后的 session
4. 未生成出有效标题时不会覆盖原标题，并向调用方返回失败或保持原值的明确结果
5. 首次自动命名仍保留“仅默认标题触发”的原有约束，防止手动重构破坏现有行为

## 风险与兼容性

### 风险

- 复用标题生成逻辑时，如果直接改动 `ensureTitle` 内部判断，可能误伤首次自动命名行为
- 新接口进入 SDK 后，若未同步更新前端调用代码，类型或请求路径可能不一致
- 手动重生成时必须沿用现有标题生成链路的模型选择顺序：优先使用 `title` agent 自身配置；没有时沿用现有 small model 回退逻辑，避免首次自动命名与手动重生成结果来源不一致

### 降低风险的方式

- 把“允许生成的条件判断”和“生成标题的纯逻辑”拆开
- 保持接口返回 `Session.Info`，减少前端二次拼装状态
- 用回归测试锁定首次自动命名与手动重生成两条路径

## 非目标

本次不处理：

- 历史会话下拉列表中的同名能力
- 批量重新生成多个会话标题
- 重新生成时的 loading 动画、禁用态或进度提示
- 标题生成 prompt 的产品优化
- “删除会话”“分享会话”等其他菜单项的位置与能力扩展

## 预期结果

用户在 WebGUI 标签页上右键时，会看到：

- `重新生成标签名`
- `重命名`

且“重新生成标签名”位于“重命名”上方。

点击后，系统会基于当前会话内容重新生成标题，并在成功后直接更新标签名称；失败时只提示错误，不改掉原标题。这样既保留手动重命名能力，也补上了已有自动命名能力的手动重触发入口。
