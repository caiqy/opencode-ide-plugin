# Compact Overflow Error Suppression Design

## 背景

当前会话在正常 AI 对话连续输出过程中，如果上游模型因为输入上下文过大而返回 `context_length_exceeded` / `Input exceeds context window of this model`，opencode 会识别这是一个可恢复的上下文溢出场景，并自动发起一次 compaction。

但当前实现里，`SessionProcessor` 在识别到 `ContextOverflowError` 后，会先发布 `session.error` 事件；WebGUI 收到该事件后会立刻插入一条 synthetic `session-error` 消息。虽然 compaction 成功后 `session.compacted` 会清掉这条错误，但用户在 compact 输出期间仍会短暂看到“上下文超限”错误，形成误报和闪烁。

## 目标

只修复这类 **会自动转入 compaction 的上下文超限误报**：

- 普通对话阶段触发上下文超限时，如果系统将立即进入 auto compaction，则不向 UI 暴露这条中间 `session.error`
- compaction 成功时，用户只看到 compact 过程和后续继续执行
- compaction 失败时，仍显示最终友好的 compact 失败错误

## 非目标

- 不隐藏所有 `ContextOverflowError`
- 不改变不会进入 compaction 的错误展示逻辑
- 不在前端增加“看到 overflow 就猜测是否忽略”的竞态补丁
- 不修改现有 `session.compacted` 清理 synthetic session error 的通用机制
- 不改变 compaction 自身失败后的最终错误文案

## 现状与根因

### 现有链路

1. 普通对话请求在 `SessionProcessor.process()` 中流式执行。
2. 上游返回上下文超限后，`MessageV2.fromError()` 会把它归一化成 `ContextOverflowError`。
3. `SessionProcessor.halt()` 识别到该错误后：
   - 设置 `ctx.needsCompaction = true`
   - 立即 `bus.publish(Session.Event.Error, ...)`
4. `process()` 最终返回 `"compact"`。
5. `SessionPrompt.runLoop()` 收到 `"compact"` 后，调用 `compaction.create(...)` 发起 auto compaction。
6. WebGUI 的 `MessagesContext` 监听到 `session.error` 后会立刻插入 synthetic `session-error` 消息。
7. compaction 成功后，`session.compacted` 才会把这条 synthetic error 清掉。

### 根因

根因不是 compaction 没有触发，而是：

**同一条 overflow 信号既被当成“进入 compaction 的内部流程控制信号”，又被当成“需要立即展示给用户的 session 级错误”。**

对于会立即进入 auto compaction 的场景，这条 overflow 并不是最终失败，而是恢复流程的入口信号。当前过早发布 `session.error`，导致 UI 在恢复流程完成前先显示了一条本不该对用户可见的临时错误。

## 方案比较

### 方案 A：后端在“将自动进入 compaction”时抑制 `session.error`（推荐）

- `ContextOverflowError` 仍被识别
- `ctx.needsCompaction` 仍照常设置
- 但当该错误会直接把本轮处理导向 `"compact"` 时，不再发布 `Session.Event.Error`
- UI 不会再收到这条中间错误事件

优点：

- 语义最准确：这是一条流程控制信号，不是最终用户错误
- 改动面最小，集中在后端源头
- 不需要前端猜测状态，也不会影响其他事件消费者的一致性

缺点：

- 需要小心只抑制“将自动 compact”的 overflow，不要吞掉真正应暴露的错误

### 方案 B：前端在 compaction 期间忽略 `session.error`

- 后端行为不变
- WebGUI 根据当前 session 是否处于 compact/compacting 状态决定是否忽略 synthetic `session-error`

优点：

- 后端实现最少改动

缺点：

- 前端需要推断时序，容易有竞态
- 事件已经发出，其他消费者仍会看到误报
- 前后端语义割裂

### 方案 C：后端发带标记的 `session.error`，前端据此忽略

- 后端继续发错误，但在事件里增加类似 `handledByCompaction: true` 的标记
- WebGUI 只忽略带该标记的 overflow error

优点：

- 比纯前端判断更稳

缺点：

- 需要扩展事件协议
- 比方案 A 更重，没有额外收益

## 推荐方案

采用 **方案 A**。

设计原则：

> 如果一次普通对话请求因为上下文超限而会被系统立即转入 auto compaction，则这条 overflow 只作为内部流程控制信号处理，不再对外发布 `session.error`。

这样可以保证：

- 原始对话 overflow：静默进入 compact
- compact 成功：无误报
- compact 失败：仍保留最终可见错误

## 详细设计

### 1. `SessionProcessor` 调整 overflow 分支语义

当前 `packages/opencode/src/session/processor.ts` 的 `halt()` 中，`ContextOverflowError` 分支会：

- `ctx.needsCompaction = true`
- `bus.publish(Session.Event.Error, { ... })`

修复后改为：

- 保留 `ctx.needsCompaction = true`
- **移除这一路径的 `Session.Event.Error` 发布**
- 直接返回，让 `process()` 最终走到：

```ts
if (ctx.needsCompaction) return "compact"
```

这表示 overflow 被内部消费，后续由 `SessionPrompt.runLoop()` 驱动 compaction。

### 2. 抑制边界只限于“进入 auto compaction”的 overflow

需要明确哪些错误被抑制，哪些不能抑制。

#### 应抑制

- 普通对话阶段的 `ContextOverflowError`
- 该错误会使 `SessionProcessor.process()` 返回 `"compact"`
- `SessionPrompt.runLoop()` 会紧接着调用 `compaction.create(...)`

#### 不应抑制

- 非 overflow 错误
- 中断 / AbortError
- 不会进入 compaction 的错误
- compaction 流程本身失败后的最终错误

这里的实现边界不需要额外新增状态字段；当前 `ContextOverflowError -> needsCompaction -> return "compact"` 已经天然形成了足够清晰的后端边界。

### 3. compaction 自身失败逻辑保持不变

`packages/opencode/src/session/compaction.ts` 已有处理：

- 如果 compaction 处理结果再次返回 `"compact"`
- 则将 summary assistant message 标记为：
  - `finish = "error"`
  - 友好的 `ContextOverflowError` 文案，例如：
    - `Conversation history too large to compact - exceeds model context limit`
    - `Session too large to compact - context exceeds model limit even after stripping media`

这部分应保持不变，因为它代表的是**最终失败**，而不是中间流程信号。

### 4. WebGUI 不需要功能性改动

当前 `MessagesContext` 在收到 `session.error` 时会创建 synthetic `session-error` 消息，在收到 `session.compacted` 时会清理这些 synthetic errors。

这套前端逻辑本身没有问题；问题在于后端过早发错事件。

因此本次修复不需要改 WebGUI 行为。修复后：

- auto compaction overflow 场景下前端根本收不到 `session.error`
- 原有 `session.compacted` 清理逻辑继续服务于其他场景或历史兼容路径

## 数据流变化

### 修复前

1. 对话请求 overflow
2. `SessionProcessor.halt()` 发布 `session.error`
3. WebGUI 显示 synthetic `session-error`
4. `process()` 返回 `"compact"`
5. 发起 compaction
6. `session.compacted` 到达后清理错误

### 修复后

1. 对话请求 overflow
2. `SessionProcessor.halt()` 仅设置 `needsCompaction`
3. `process()` 返回 `"compact"`
4. 发起 compaction
5. compaction 成功则继续，无 synthetic error
6. compaction 失败则由 compaction summary message 落最终错误

## 测试策略

### 1. 后端处理行为测试

在 `packages/opencode/test/session/processor-effect.test.ts` 新增或扩展用例，覆盖：

- 上游返回 `context_length_exceeded`
- `handle.process(...)` 返回 `"compact"`
- **不会发布** `Session.Event.Error`
- `handle.message.error` 仍为 `undefined`

这是本次修复最核心的回归测试。

### 2. 保留现有 overflow 归一化测试

现有这类测试应继续通过：

- `MessageV2.fromError()` 仍把 context overflow 归一化为 `ContextOverflowError`
- `processor-effect.test.ts` 中 overflow 仍然返回 `"compact"`

说明本次不是改变 error 分类，而只是调整其是否作为 session 级最终错误对外广播。

### 3. 保留 compaction 失败落最终错误的测试

现有 `compaction.test.ts` 中的类似用例仍应通过：

- compaction 再次超限时
- summary message 被标记为 `finish = "error"`
- 最终错误文案仍存在

### 4. WebGUI 测试策略

当前 WebGUI 已有测试验证：

- 收到 `session.error` 会生成 synthetic `session-error`
- 收到 `session.compacted` 会清理 synthetic error

这些测试无需删除。

如需补充，可以增加更高层的集成语义测试，但不是本次修复的必要条件。因为修复点在后端，核心保证是：**该场景下不再发送 `session.error`。**

## 验收标准

1. 正常对话阶段的上下文超限在会自动转入 compaction 时，不会先生成前端 `session-error` 卡片。
2. 同一场景下，`SessionProcessor.process()` 仍返回 `"compact"`，auto compaction 仍能正常触发。
3. compaction 成功时，用户看不到中间 overflow 误报。
4. compaction 失败时，仍能看到最终友好的 compact 失败错误。
5. 非 overflow 错误、非 compaction 错误和中断行为保持不变。

## 影响范围

- `packages/opencode/src/session/processor.ts`
- `packages/opencode/test/session/processor-effect.test.ts`
- 现有 `packages/opencode/test/session/compaction.test.ts` 与 `message-v2` 相关测试作为回归保障

## 风险与缓解

### 风险

如果抑制范围写得太宽，可能会把本该展示的 `ContextOverflowError` 一并吞掉。

### 缓解

- 只修改 `SessionProcessor.halt()` 中 `ContextOverflowError` 触发 `needsCompaction` 的那条分支
- 通过测试锁定：
  - overflow 仍返回 `"compact"`
  - 不再发布 `Session.Event.Error`
  - compaction 失败仍有最终错误

## 实施建议

按最小改动顺序进行：

1. 先补红灯测试，证明 overflow -> `"compact"` 时不会发布 `Session.Event.Error`
2. 再修改 `processor.ts` 的 `ContextOverflowError` 分支
3. 跑定向测试：processor / compaction / message-v2 / webgui session-error
4. 最后再跑相关回归测试，确认错误边界没有扩大
