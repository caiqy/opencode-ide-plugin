# Outcome

提供与当前对话模型解耦的原生搜索路由。当前会话继续暴露一个 `websearch` 本地工具；工具执行时按配置和优先级选择 OpenAI、Anthropic 或 xAI 的搜索模型，向所选厂商发起独立模型请求，并在该请求中使用厂商原生 Web Search。另支持显式的 `alpha-search` 模式，通过 OpenAI Alpha Search endpoint 执行搜索。搜索回答和引用再作为工具结果回传给当前对话模型。

# Scope

- 增加独立搜索路由配置，允许按优先级配置 OpenAI、Anthropic、xAI 的搜索模型。
- 当前对话模型所属厂商若在可用搜索路由中，优先选择该厂商；否则按配置顺序选择。
- `websearch` 工具向所选搜索模型发起一次独立请求，并在 OpenAI Responses、Anthropic Messages 或 xAI Responses 协议中声明厂商原生搜索工具。
- 搜索请求收集厂商生成的回答、引用和可诊断的 provider 信息，并作为本地工具结果返回当前模型。
- 增加 `websearch.mode`，默认使用 `responses`；`alpha-search` 模式向 OpenAI `/alpha/search` endpoint 发起独立请求。
- Alpha Search 优先使用模型 `api.url`，模型 URL 为空时回退到 provider `options.baseURL`，并使用 provider credentials 进行 Bearer 鉴权。
- 搜索路由不可用或调用失败时按配置顺序尝试下一条可用路由；全部失败时返回稳定的工具错误。
- 为路由选择、协议 lowering、独立请求、结果投影和失败场景增加 focused tests。

# Non-goals

- 不删除 `websearch` 工具入口，但原生搜索模式启用时不执行现有 Exa/Parallel 后端。
- 不在本 change 中实现 provider 之外的 Web Search 聚合服务、网页抓取或自定义引用引擎。
- `alpha-search` 仅支持 OpenAI provider，不在本 change 中扩展为通用 Alpha Search 聚合协议。
- 不默认启用搜索参数、域名过滤、用户位置、图片搜索或深度研究等高级控制，除非现有模型配置已经提供对应 provider options。
- 不支持 Anthropic Bedrock 上的原生搜索；Anthropic 原生 server tool 仅针对直接 Messages API 路由。

# Acceptance examples

- A1: 配置可声明有序的 OpenAI、Anthropic、xAI 搜索模型；未配置或显式关闭时维持现有 Exa/Parallel `websearch` 行为。
- A2: 当前对话模型厂商存在可用搜索路由时优先选择该厂商；否则按配置顺序选择首个可用路由，不把主模型请求直接转发给另一厂商。
- A3: OpenAI 搜索请求使用 Responses `web_search`，Anthropic 搜索请求使用 Messages server tool，xAI 搜索请求使用 Responses `web_search`。
- A4: 搜索请求是独立 provider turn；provider-executed 搜索调用由内部搜索运行时消费，不在当前会话触发本地 dispatch，最终回答和引用作为当前 `websearch` 工具结果返回。
- A5: 首选搜索路由不可用或调用失败时尝试下一条配置路由；全部失败时返回包含稳定摘要、但不泄露凭据的工具错误。
- A6: 原生搜索模式启用时，现有 Exa/Parallel 执行路径不暴露给模型；关闭原生模式后现有行为不变。
- A7: 相关协议、路由选择、工具执行和结果投影测试通过，覆盖普通对话模型与搜索厂商不同、同厂商优先和全部路由失败。
- A8: `websearch.mode` 可选择 `responses` 或 `alpha-search`；未配置 mode 时保持 `responses` 行为。
- A9: `alpha-search` 仅选择 OpenAI 路由，向规范化后的 provider URL `/alpha/search` 发送带 Bearer credentials 的请求；模型 URL 为空时使用 provider `options.baseURL`。
- A10: Alpha Search 返回的回答和 sources 投影为现有 `websearch` 工具结果；私有 citation 标记不会泄露给当前模型。
- A11: Alpha Search 的配置解析、URL fallback、失败 fallback 和真实运行调用均有验证证据。

# Constraints and invariants

- 搜索由独立搜索模型及其 provider 执行，可能产生额外模型和搜索费用；不得在没有明确启用状态时调用。
- 内部搜索请求必须继续使用 `providerExecuted` 语义；当前会话只执行一次本地 `websearch` 工具，不得尝试本地 dispatch 内部 hosted search。
- OpenAI Responses 使用 `web_search`；xAI Responses 使用 `web_search`；Anthropic 使用直接 Messages server tool 基线。
- 原生搜索模式复用现有 `websearch` 权限边界；未获许可时不得发起任何独立搜索请求。
- 保持 `packages/schema`/`packages/llm`/`packages/core`/`packages/opencode` 的现有依赖方向，不引入新的第三方依赖。

# Decisions

- 已确认：目标是实现模型原生搜索，覆盖 OpenAI、Anthropic、xAI。
- 已确认：使用 Comet Native 工作流完成设计、开发和验收。
- 已确认：通过配置开启原生搜索；同一配置兼容多个厂商。
- 已确认：搜索 provider 与当前对话模型解耦，始终作为独立搜索请求执行；当前模型厂商仅影响路由优先级。
- 已确认：原生搜索开启时隐藏现有 Exa/Parallel 执行路径，但保留 `websearch` 工具入口和权限体验。
- 已调查：内部 hosted search 的响应解析与 `providerExecuted` 语义大部分已经存在，主要缺口是原生工具 lowering、独立搜索路由选择和结果投影。
- 已确定：`alpha-search` 是显式的 OpenAI 搜索传输模式；模型 `api.url` 缺失时使用 provider `options.baseURL`，避免要求模型目录重复声明 endpoint。

# Open questions

- 已确认：`websearch` 作为本地工具发起独立搜索模型请求；支持 OpenAI、Anthropic、xAI 原生搜索；当前模型厂商优先，其余按配置顺序 fallback；每条路由显式配置完整 `provider/model`；启用时不执行 Exa/Parallel；结果回传当前模型。
- 已确认：`alpha-search` 作为显式模式仅使用 OpenAI `/alpha/search` endpoint，优先读取模型 URL，缺失时回退 provider base URL。

# Verification expectations

- 使用包级测试命令，不从仓库根目录运行测试。
- 至少运行 `bun test` 的 focused tests：`packages/llm` provider protocol tests、`packages/opencode` session/native runtime tests，以及受影响的 `packages/core` tests。
- 运行受影响包的 `bun typecheck`。
- Verify 阶段由独立只读 Verifier 逐项检查 A1-A7。
