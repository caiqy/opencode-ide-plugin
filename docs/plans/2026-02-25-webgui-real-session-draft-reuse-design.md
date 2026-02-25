# Design: WebGUI 新建会话全面真实化与单草稿复用

## 背景与问题

当前新建会话依赖 `virtual-*` 作为“未落库草稿态”，在首条消息发送时再 materialize 为真实会话。该方案最初目的是减少空会话落库，但在近期 tab 恢复与会话切换演进中带来持续复杂度：

- 启动恢复链路需要同时处理真实会话与 virtual 会话分支；
- `openTabs/activeTab` 持久化与 virtual 初始态存在竞态；
- close-other / close-right / restore 等路径出现大量 virtual 特判；
- 错误回退（switch/create 失败）语义不一致，易引发回归。

本设计目标是：**去除 virtual 作为主路径，统一为真实会话模型**，并通过“单草稿复用”控制空会话增长。

---

## 目标与非目标

### 目标

1. 点击“新建会话”即创建真实会话。
2. 冷启动无可恢复 tab 时自动创建真实会话。
3. 空会话（无消息）可保留并展示。
4. 新增“单草稿复用”机制，减少空会话膨胀。
5. 创建失败时不切换上下文、不新增 tab，直接提示错误。

### 非目标

1. 不做旧状态兼容（不保留 legacy virtual 迁移逻辑）。
2. 不引入用户可配置双轨策略（本次固定单一策略）。
3. 不改动服务端 session 数据结构。

---

## 方案对比（含推荐）

### 方案 A（推荐）：全面真实化 + 单草稿复用

- 新建即 `createSession`；
- 维护一个 `draftSessionId`，新建优先复用有效草稿；
- 草稿发出首条消息后失效。

优点：

- 显著减少 virtual 分支与恢复竞态；
- 保持“可立即编辑”的体验；
- 控制空会话数量，兼顾简洁与可追溯。

缺点：

- 需要额外维护草稿有效性校验逻辑。

### 方案 B：全面真实化但不复用草稿

- 每次新建都创建一个新真实会话。

优点：逻辑最直观。

缺点：空会话会快速膨胀，历史噪音大。

### 方案 C：保留 virtual 并继续打补丁

优点：改动看似小。

缺点：长期复杂度和回归风险最高，不符合当前稳定性诉求。

---

## 架构与数据流设计

### 1) 会话模型收敛

- `SessionContext` 仅承载真实会话；
- 删除/下线 virtual 主路径能力：
  - `createVirtualSession`
  - `newVirtual`
  - `materializeSession`
  - `isVirtualSession`
- `currentSession` 初始为 `null`，仅在真实会话创建/切换成功后赋值。

### 2) 启动恢复流程

`tabStore.loaded` 后执行：

1. 若存在 `openTabs + activeTab`：`switchSession(activeTab)`。
2. 若无可恢复 tab：
   - 若存在有效 `draftSessionId`，直接切换并打开该草稿；
   - 否则创建新真实会话并激活。

### 3) 新建会话流程

1. 检查有效草稿：有则复用；
2. 无有效草稿则调用 `createSession`；
3. 成功后 `openTab + setActiveTab + switchSession`（或直接设置 current）；
4. 失败时 toast 报错并保持当前上下文不变。

### 4) 删除与关闭行为

- 删除当前会话后若无剩余 tab：走“自动创建真实会话/复用草稿”流程；
- `close-other` / `close-right` / `activate` 不再需要任何 virtual guard。

---

## 草稿复用设计（单草稿）

### 草稿定义

- 真实会话；
- 消息数为 0；
- 系统最多维护一个 `draftSessionId`。

### 存储位置

- `draftSessionId` 存在 `uiBridgeState`（与 `openTabs/activeTab` 同层）。
- 这是前端交互策略，不进入服务端 session schema。

### 生命周期

1. 新建并创建成功后：将该会话设为 `draftSessionId`。
2. 草稿发送首条消息后：清空 `draftSessionId`。
3. 草稿被删除或不存在：清空 `draftSessionId`。

### 有效性校验

复用前校验：

- 会话存在；
- 会话消息仍为空。

校验失败则清空标记并创建新会话。

---

## 错误处理与并发控制

1. 新建动作加 in-flight 保护，避免连点创建多个会话。
2. 需要创建但失败时：
   - 展示错误 toast；
   - 不变更 `activeTab/currentSession`；
   - 不写入新的 `draftSessionId`。
3. 复用草稿失败：
   - 清空 `draftSessionId`；
   - 尝试创建新会话；
   - 创建失败则终止并报错。

---

## 测试策略

### 单元/组件测试

1. 新建时优先复用有效草稿。
2. 草稿失效（已发消息/已删除）时自动新建并覆盖 `draftSessionId`。
3. 冷启动无 tab：优先草稿，否则自动创建真实会话。
4. 创建失败不改变当前会话与 tab。
5. 发送首条消息后 `draftSessionId` 被清空。
6. close-other / close-right / restore 路径在无 virtual 前提下稳定。

### 回归验证

- 现有 tab 恢复测试继续通过；
- 移除 virtual 后，删除对应分支测试并补齐真实化新行为测试。

---

## 风险与缓解

1. **风险：** 草稿有效性判断依赖消息查询，可能增加一次请求。  
   **缓解：** 仅在“新建复用检查”触发，且失败时可快速回退创建。

2. **风险：** 自动创建真实会话可能增加空会话数量。  
   **缓解：** 单草稿复用机制限制增长。

3. **风险：** 删除 virtual 路径带来一次性改动面。  
   **缓解：** 以测试驱动重构，优先覆盖启动恢复、新建、关闭三条关键链路。

---

## 验收标准

1. 代码路径中不再依赖 `virtual-*` 会话 ID。
2. 新建会话始终为真实会话，失败即报错且不扰动当前上下文。
3. `draftSessionId` 仅维护一个，并按生命周期正确更新。
4. 冷启动无恢复数据时可进入可编辑真实会话。
5. `bun run --filter webgui test:run` 通过。
