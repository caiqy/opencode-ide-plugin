# Responses Overflow Regression Coverage Design

## 背景

当前工作区已经修复了 OpenAI Responses API 在 HTTP 200 SSE 流内返回 `context_too_large` 时，native runtime、AI SDK runtime、session processor 之间的错误语义丢失问题。但并行评审指出还缺少几类高价值回归保护：

1. 非流式 HTTP JSON error 中的 `context_too_large` 仍可能没有被归类为 `context_overflow`
2. `includeRawChunks` 必须作为 `streamText({...})` 顶层参数传入的契约没有被直接锁定
3. Azure Responses 路径还缺少针对 overflow 语义保留与 compaction 的专门覆盖
4. WebGUI 层还缺少更贴近用户症状的断言，无法直接证明不会再次展示泛化的 `"Provider stream finished with error"`

## 目标

在不扩大行为面的前提下，补齐上述 4 个回归缺口，使本次修复从 provider error 归类、AI SDK 调用契约、Azure Responses 路径，到 WebGUI 最终呈现形成闭环保护。

## 非目标

- 不重构现有 runtime/processor 分层
- 不引入新的跨 package 共享抽象
- 不修改用户提供的 `response.txt`
- 不处理当前仓库里与本次改动无关的全量 `typecheck` 历史失败

## 设计

### 1. 非流式 APICallError overflow 识别补齐

在 `packages/opencode/src/provider/error.ts` 的 `parseAPICallError()` 中，把 `body?.error?.code === "context_too_large"` 视为与 `context_length_exceeded` 等价的 overflow 触发条件。这样即使上游没有返回可匹配正则的 message，只要 code 明确，就仍会被归类为 `context_overflow`，后续 session 才能进入 compaction。

### 2. 锁定 `includeRawChunks` 顶层调用契约

在 `packages/opencode/test/session/llm.test.ts` 中直接捕获发往 provider 的请求体或 `streamText` 调用行为，验证：

- OpenAI Responses 路径会启用 raw chunk 支持
- Azure Responses 路径会启用 raw chunk 支持
- Azure `useCompletionUrls: true` 的 Chat Completions 路径不会启用 raw chunk
- 上述能力不依赖 `providerOptions` 注入

测试重点是防止未来重构时把 `includeRawChunks` 再次错误塞回 `providerOptions`。

### 3. Azure Responses overflow 链路测试

在现有 AI SDK / session 级测试中补一条 Azure Responses 场景，证明 top-level raw `context_too_large` 可以：

- 在 adapter 中保留真实 `code`
- 不被后续泛化的 `upstream_error` 覆盖
- 在 processor 中被识别为 `ContextOverflowError`
- 最终返回 `compact`

这部分优先补测试，不额外扩大生产代码改动；除非红灯表明现有实现确有缺口。

### 4. WebGUI 用户症状回归断言

在 `packages/opencode/webgui/src/state/MessagesContext.session-error.test.tsx` 增加一个贴近用户现象的用例：先收到一条泛化 `session.error`，随后收到 `session.compacted`，确认该会话最终不再保留任何 `session-error` synthetic message，也不会继续显示 `"Provider stream finished with error"`。

这条断言不要求前端理解 overflow code，只要求 UI 在 compaction 成功切换后不残留旧错误文案。

## 影响文件

- 生产代码
  - `packages/opencode/src/provider/error.ts`
- 测试代码
  - `packages/opencode/test/provider/error.test.ts`
  - `packages/opencode/test/session/llm.test.ts`
  - `packages/opencode/test/session/processor-effect.test.ts`（如 Azure compaction 需要 processor 层验证）
  - `packages/opencode/webgui/src/state/MessagesContext.session-error.test.tsx`

## 验证策略

优先按 TDD 分步执行：

1. 先补 `parseAPICallError(context_too_large)` 红灯测试
2. 再补 `includeRawChunks` / Azure / WebGUI 红灯测试
3. 逐项做最小实现直到转绿
4. 运行相关测试集，避免扩大回归面

建议至少运行：

- `bun test test/provider/error.test.ts`
- `bun test test/session/llm.test.ts`
- `bun test test/session/processor-effect.test.ts`
- `bun run test:run src/state/MessagesContext.session-error.test.tsx`

## 风险与控制

- `includeRawChunks` 的真实生效位置容易在后续重构中再次漂移：通过直接测试契约来控制
- Azure 同时支持 Responses / Chat Completions 两条路径：通过 `useCompletionUrls` 分叉测试控制
- WebGUI 测试只验证最终 message store 状态，不替代真实浏览器调试；但它能覆盖本次用户症状的关键回归点

## 预期结果

完成后，本次修复将具备以下稳定性保证：

- SSE 流内与非流式 JSON error 中的 `context_too_large` 都能稳定进入 overflow 处理
- OpenAI / Azure Responses 依赖的 raw chunk 能力有明确测试锁定
- Azure 不会因 provider-specific 分叉而悄悄失去 compaction 行为
- WebGUI 不会在成功 compact 后残留泛化错误文案
