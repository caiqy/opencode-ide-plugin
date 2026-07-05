# 能力：流式错误恢复

> **象限**：Reference（能力参考）
> **能力编号**：J2（见 [capabilities-index](../capabilities-index.md)）
> **基线状态**：**新增**（2026-06 CHANGELOG `v26.6.800`）

## 代码真源

| 角色 | 文件 |
|------|------|
| Retry 分类与退避 | `packages/opencode/src/session/retry.ts` |
| Session status | `packages/opencode/src/session/status.ts` |
| Provider fetch/SSE patch | `packages/opencode/src/provider/provider.ts` |
| Provider 错误解析 | `packages/opencode/src/provider/error.ts` |
| Responses SSE 过滤 | `packages/opencode/src/provider/responses-filter.ts` |
| WebGUI retry 提示 | `packages/opencode/webgui/src/components/TypingIndicator.tsx` |

> 命名交叉核验（Step 5）：J2 是新增能力，CHANGELOG `v26.6.800` 明确记录 Responses API 临时错误重试、上下文超限识别和兼容帧过滤；对应 [upstream-compatibility](upstream-compatibility.md)。

## 意图

把长流式响应中的瞬时错误变成可恢复状态，并把永久性上下文超限保留为明确错误，减少 Provider 抖动导致的对话中断。

## 行为契约

- `stream_timeout` 是独立 retry 信号，不被包装成最终失败消息；识别 plain text 和 JSON string 两种形态（`retry.ts` 第 25 行、第 126-131 行）。
- Retry policy 对 `stream_timeout` 写入 session status message=`stream_timeout`，不附带 action（`retry.ts` 第 181-205 行）。
- `SessionStatus.Info` 支持 `idle`、`retry`、`busy`；retry 状态包含 attempt、message、next 和可选 action（`status.ts` 第 8-31 行）。
- TypingIndicator 对 retry 状态显示倒计时和第几次尝试，避免把可重试流错误固化为最终失败（`TypingIndicator.tsx` 第 37-55 行、第 96-104 行）。
- Provider 错误解析把 `connection_timeout`、`internal_error`、`rate_limit_exceeded`、`server_error`、`server_is_overloaded`、`stream_read_error`、`stream_timeout` 视为 transient stream error code（`provider/error.ts` 第 30-38 行、第 122-124 行）。
- Responses 流中的 `context_too_large` 与 `context_length_exceeded` 会转成 `context_overflow`，保留上游 response body（`provider/error.ts` 第 176-183 行）。
- 普通 API call error 也识别 413、overflow 文案和 OpenAI body 中的 context code（`provider/error.ts` 第 233-247 行）。
- session processor 遇到 provider-error 的 context code 会失败为 `MessageV2.ContextOverflowError`，不是 retryable provider error（`processor.ts` 第 554-565 行）。
- Responses SSE 过滤器只作用于 OpenAI/Azure `/responses` 请求，过滤 `object === "chat.completion.chunk"` 的兼容帧和空占位 frame（`responses-filter.ts` 第 15-61 行、第 63-80 行）。
- Provider fetch wrapper 在 `/responses` 返回后挂载 ResponsesFilter，再做 Anthropic normalizer 和 SSE read timeout 包装（`provider.ts` 第 1712-1727 行）。

## 边界与约束

- transient stream error 才能重试；上下文超限、quota、invalid api key 等永久错误不能被重试吞掉（`provider/error.ts` 第 184-205 行）。
- `normalizeAnthropic` 只修正 Anthropic SSE text block 缺 `text` 的兼容问题（`provider.ts` 第 93-162 行）。
- `wrapSSE` 只处理 `text/event-stream` response；非 SSE response 不改写（`provider.ts` 第 45-91 行）。

## 静态锚点

- stream timeout 信号类型：`packages/opencode/src/session/retry.ts:25`
- stream timeout 文本识别：`packages/opencode/src/session/retry.ts:129`
- retry status 写入：`packages/opencode/src/session/retry.ts:196`
- SessionStatus retry schema：`packages/opencode/src/session/status.ts:13`
- TypingIndicator retry 倒计时：`packages/opencode/webgui/src/components/TypingIndicator.tsx:37`
- transient stream code 集合：`packages/opencode/src/provider/error.ts:30`
- stream context overflow 转换：`packages/opencode/src/provider/error.ts:176`
- API call context overflow 转换：`packages/opencode/src/provider/error.ts:233`
- Responses frame 过滤：`packages/opencode/src/provider/responses-filter.ts:15`
- Responses filter 挂载点：`packages/opencode/src/provider/provider.ts:1718`

## 维护检查

- 新增可重试错误码时，先判断是否 transient；上下文、鉴权、配额类错误默认不进 retry。
- 修改 Provider SDK 或 AI SDK 版本后，优先核对 `parseStreamError` 与 `ResponsesFilter.shouldApply`。
- 修改 WebGUI 生成中 UI 时，保留 retry status 的倒计时提示。

## 运行时待核验

- [ ] 真实 Provider 返回 `stream_timeout` 时，WebGUI 是否持续显示 retry 倒计时并最终恢复生成（`待运行时核验`）。
- [ ] 第三方 OpenAI proxy 注入 Chat Completions frame 时，Responses 流是否不再重复/空消息（`待运行时核验`）。

## 相关

- Provider 设置：[provider-settings](provider-settings.md)
- 上游适配总览：[upstream-compatibility](upstream-compatibility.md)
