# Stream Timeout Auto Retry Design

## 背景

在对话过程中，偶尔会收到上游流式错误帧：

```json
{
  "type": "error",
  "sequence_number": 0,
  "error": {
    "type": "upstream_error",
    "code": "stream_timeout",
    "message": "stream_timeout"
  }
}
```

这里的关键信息是：**这不是 HTTP response status 错误，而是 SSE / event 流中的某一行 `type: "error"` 事件输出**。用户在界面里看到的是最终的“会话错误”，但抓包看到的根因信号来自流内 error event。

当前问题不应被当作普通 HTTP 失败处理，而应沿着流式 error event → `MessageV2.fromError()` → `SessionRetry.policy()` 这条链路处理。

## 目标

对用户实际遇到的这类 SSE / event 流内 `stream_timeout` error event 做静默自动重试，让暂时性的上游流超时优先走现有退避重试链路，而不是立即暴露成前端错误卡片：

```json
{
  "type": "error",
  "sequence_number": 0,
  "error": {
    "type": "upstream_error",
    "code": "stream_timeout",
    "message": "stream_timeout"
  }
}
```

## 非目标

- 不扩大到所有 `upstream_error`
- 不改动 `context_length_exceeded`、鉴权失败、配额不足等非瞬时错误的现有行为
- 不在前端增加“见到该错误就自动 retrySession” 的特殊补丁逻辑
- 不修改现有手动“重试”按钮语义

## 现状与根因

### 现有链路

1. `SessionProcessor.process()` 在流式生成阶段使用 `SessionRetry.policy()` 执行自动重试。
2. `SessionRetry.policy()` 是否重试，取决于 `SessionRetry.retryable(error)` 的判断结果。
3. `retryable()` 依赖 `MessageV2.fromError()` 对底层异常做归一化。
4. 流式帧错误的结构化解析由 `packages/opencode/src/provider/error.ts` 中的 `parseStreamError()` 负责。

### 根因

按当前已知证据，用户实际看到的原始 error event 是嵌套结构；但在当前 `@ai-sdk/openai-compatible` 的 chat 流适配链路里，这类 error chunk 继续往下游传递时，只保留了 `error.message`，没有继续携带 `error.type`、`error.code`、`sequence_number` 等结构化字段。

因此，到 `SessionProcessor` / `MessageV2.fromError()` / `SessionRetry.retryable()` 这一层，真实参与重试判定的对象并不一定还是原始嵌套 error event，而很可能只剩一个被压平后的字符串 `"stream_timeout"`（或等价的 plain string message）。

当前问题的根因不是 response status 识别错误，而是：**真实重试链路里，`stream_timeout` 信号在 provider adapter 之后退化成了纯 message 文本，而现有 retry 判定没有覆盖这类文本信号。**

## 设计方案

### 总体思路

保留用户截图里的原始 error event 作为问题证据，但实现上按**真实运行链路**修复：接受 `stream_timeout` 在 provider adapter 之后被压平成字符串这一现实，并在 `SessionRetry.retryable()` 这一层把该字符串信号识别为可重试错误。

这样可以最小化改动范围，不需要改 provider adapter，也不需要前端补丁，就能让真实会话链路进入现有自动重试机制。

### 具体改动

#### 1. 保留原始流错误证据，但按真实链路识别 message

用户遇到的原始 error event 仍然是：

- `body.type === "error"`
- `body.error.type === "upstream_error"`
- `body.error.code === "stream_timeout"`

但本次修复不要求在 provider adapter 里继续保留整段结构化 error 对象。

相反，本次实现接受现有适配层会把该错误压成 `error.message` 继续向下游传递，并把下面这些 message 信号视为同一类可重试超时：

- `stream_timeout`
- `"stream_timeout"`（字符串被再次 JSON 序列化后的等价形式）

这会让 `SessionRetry.retryable()` 能在真实运行链路里识别该超时，并进入现有退避重试。

#### 2. 复用现有重试策略

不新增新的重试调度器，也不新增单独的“stream timeout retry”状态类型。

继续复用当前已有行为：

- `SessionRetry.policy()` 负责退避与次数控制
- `session.status = retry` 负责内部状态切换
- 如果后续尝试成功，则会话继续正常流式输出
- 如果重试耗尽，则仍按现有逻辑发布最终 `session.error`

#### 3. 保持前端语义不变

不在 WebGUI 中新增任何针对 `stream_timeout` 的自动重试特殊逻辑。

前端预期行为自然变为：

- 重试成功：不会先看到“会话错误”卡片
- 重试失败且耗尽：仍看到现有“会话错误”卡片，并可手动重试

这样可以避免：

- 服务端与前端双重重试
- 错误卡片先出现又消失的闪烁
- `retrySession()` 语义被错误复用到流内瞬时失败场景

## 错误边界

### 应自动重试

仅以下精确场景：

- 用户遇到的原始流内 `type: "error"` event 行满足：
  - `error.type === "upstream_error"`
  - `error.code === "stream_timeout"`
- 且它在真实 provider adapter 链路中被压平后，对下游暴露为等价的 message：
  - `stream_timeout`
  - `"stream_timeout"`

### 不应自动重试

以下行为保持现状：

- `context_length_exceeded`
- `insufficient_quota`
- `usage_not_included`
- `invalid_prompt`
- 非 `stream_timeout` 的 `upstream_error`
- 其他普通文本 message
- 其他当前未被判定为 retryable 的普通错误

这样可以把行为面严格收窄在本次需求内，避免把未知上游错误误标为瞬时可恢复错误。

## 测试策略

### 1. 流错误解析单测

在服务端测试中保留这组流错误用例，证明用户截图中的原始 event 证据可以被识别：

```json
{
  "type": "error",
  "sequence_number": 0,
  "error": {
    "type": "upstream_error",
    "code": "stream_timeout",
    "message": "stream_timeout"
  }
}
```

断言：

- `MessageV2.fromError()` 产出 `APIError`
- `APIError.data.isRetryable === true`

这组测试的作用是**保留用户原始嵌套 SSE error event 证据的解析覆盖**，而不是驱动本次主要生产修复。

### 2. 重试判定单测

在 `SessionRetry.retryable()` 的测试中新增 message 级用例，证明真实链路里的压平 message 也会触发自动重试：

- `stream_timeout`
- `"stream_timeout"`

断言：

- 返回值是 `stream_timeout`
- 不会把其他普通 message 一起误判成可重试

### 3. 会话处理行为测试

参考现有 session processor 的 retry 相关测试，新增一个**真实 SSE / event 行**的 `stream_timeout` 场景：

- 首次流式处理收到用户截图那种嵌套 error event 行
- 处理器进入现有 retry 状态
- 后续重试成功后返回正常继续结果
- 不直接形成最终会话错误

另外，需要增加一条 **adapter 压平后的 `error.message` 链路** 集成测试：

- 输入不再携带原始结构化 `type/code` 字段
- processor 收到的下游错误只剩 `stream_timeout` 文本
- 仍然进入同一自动重试链路

这条测试用于锁定 1/A：本次修复点确实是 `SessionRetry.retryable()` 对真实链路文本信号的识别，而不是结构化解析路径的偶然兜底。

### 4. 回归约束

保留并确认以下既有行为不变：

- `context_length_exceeded` 仍走 compaction / 非重试语义
- `server_error` 仍保持可重试
- 非 `stream_timeout` 的普通文本 message 不应误触发自动重试
- 非 retryable 错误仍在耗尽前不被误吞

## 验收标准

1. 用户截图中的嵌套型 `stream_timeout` event 进入真实会话链路时，会触发自动重试。
2. 即使下游实际只收到 `stream_timeout` / `"stream_timeout"` message，也能进入同一自动重试链路。
3. 自动重试成功时，对话继续完成，前端不出现“会话错误”卡片。
4. 自动重试耗尽后，才出现现有最终错误展示与手动“重试”入口。
5. 其他错误类型的重试与报错行为保持不变。

## 影响范围

- `packages/opencode/src/session/retry.ts`
- `packages/opencode/src/session/message-v2.ts` 相关测试覆盖
- `packages/opencode/src/session/retry.ts` 相关测试覆盖
- `packages/opencode/test/session/` 下的 stream error / processor retry 测试

## 风险与缓解

### 风险

如果 message 级匹配写得太宽，会把其他无关文本错误也误判成 `stream_timeout`，造成误重试。

### 缓解

本设计只把 `stream_timeout`（以及等价的 `"stream_timeout"`）识别为该类超时信号，不把其他普通文本错误一起放进自动重试；同时需要配套反例测试，确认 message 级匹配没有误伤。

## 实施建议

按 TDD 顺序实施：

1. 先确认并保留解析层回归测试，覆盖用户截图中的原始嵌套 SSE error event 证据
2. 再补 `SessionRetry.retryable()` 的真实链路 message 红灯测试
3. 再补 processor 集成红灯测试，证明真实会话链路也会触发自动重试
4. 最小改动实现 retry 判定逻辑
5. 跑定向测试验证 retry 行为
6. 最后执行相关回归测试
