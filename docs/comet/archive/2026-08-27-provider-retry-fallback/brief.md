# Outcome

撤回未提交的 HTTP 429 专用重试实现，改为让 rate-limit、concurrency-limit 和 HTTP 429 复用 opencode 原有 `SessionRetry.policy`。为这套原有 Session retry 增加 `provider_retry.max_retries` 配置，默认最多重试 10 次。

# Scope

- legacy Session 普通对话以及 task/subagent 子 Session 使用的现有 `SessionRetry.policy`。
- rate-limit、concurrency-limit 与 HTTP 429 的 retryable 分类补充。
- 原 Session retry 的可配置最大重试次数。
- 原指数退避参数调整、jitter 与 Retry-After 行为。
- V1/V2 Config schema、配置迁移、公开 JSON Schema/OpenAPI/SDK 生成产物和用户全局配置验证。
- 精确撤回上一轮未提交的 V2 executor、model-backed search、Session 删除中断和 HTTP 429 专用实现。

# Non-goals

- 不统一 V2 RequestExecutor、V1/V2 model-backed search 或 MCP websearch 的重试配置。
- 不新增 HTTP 429 专用 retry loop、固定 10 秒最短等待、独立预算、累计等待上限或专用状态协议。
- 不改变现有 Session retry 的错误处理顺序、可见输出行为、取消行为、provider-specific 404/5xx 兼容、quota/auth/permission/context-overflow 规则，除非为防止新增 concurrency/rate 分类覆盖 permanent failure 所必需。
- 不修改 task 工具本身；task/subagent 仅通过其子 Session 继承同一配置。
- 不新增第三方依赖、UI、provider/model failover 或 tool 副作用去重。
- 不撤回独立 release 版本改动 `26.8.2706`、全局 `opencode.jsonc` 或 Comet 正式产物。

# Acceptance examples

- A1：普通对话或 task/subagent 子 Session 在原 Session retry 可处理的错误、HTTP 429、明确 rate-limit 或明确 concurrency-limit 失败后，均通过同一个 `SessionRetry.policy` 重试；adapter、SDK、executor 和 task 不建立额外 retry loop。
- A2：`provider_retry.max_retries` 是非负整数，表示初始请求之外允许的最大重试次数；未配置默认 10，配置 0 不执行重试，配置 10 时最多产生 11 次 provider 请求。
- A3：无有效 Retry-After 时，第 N 次重试使用 `2 秒 × 2^(N-1)` 的基础指数退避并保留现有 0–25% jitter；本地计算的单次等待封顶 120 秒。
- A4：合法 `retry-after-ms` 或 `Retry-After` 继续优先于本地指数退避，并可要求超过 120 秒的等待；缺失或无效 header 继续回退本地退避。
- A5：新增 rate/concurrency/429 分类不得把 insufficient quota、认证、权限、context overflow 或其他现有 permanent failure 改为 retryable；现有非目标错误的分类和展示保持兼容。
- A6：配置只作用于 `SessionRetry.policy`；V2 RequestExecutor、model-backed search 和 MCP websearch 的请求次数、等待与错误处理和 Git 基线一致。
- A7：上一轮未提交的 HTTP 429 专用实现、V2/search 配置传递、递归 Session 删除中断和相关测试/生成差异被撤回；独立 `26.8.2706` release 文件保持不变。
- A8：V1/V2 Config schema、V1→V2 迁移、OpenAPI/SDK 类型和全局 JSONC 均接受 `provider_retry.max_retries`；描述明确默认 10 且只控制 Session retry。
- A9：确定性测试覆盖默认/0/自定义次数、次数耗尽、指数退避、jitter、120 秒本地封顶、长 Retry-After、rate/concurrency/429、permanent failure 否决和 task 子 Session 继承，不调用真实 provider。

# Constraints and invariants

- `SessionRetry.policy` 是本 change 唯一允许修改重试次数和退避决策的 owner。
- 配置缺失与显式 10 的运行结果一致；初始请求不计入 `max_retries`。
- 本地退避上限只限制指数退避结果，不截断合法 Retry-After。
- 新增 concurrency 分类必须覆盖已验证的 `Concurrency limit exceeded for user/account, please retry later`，同时避免宽泛匹配普通业务文本。
- permanent failure 判定始终先于新增 rate/concurrency retryable fallback。
- 只回退上一轮 provider retry 相关文件；保留工作区中独立 release 版本改动和 Comet 产物。
- 保持单一 change；回退、SessionRetry 重建、配置 schema 和验证属于同一个紧耦合结果。

# Decisions

- 当前 Git 基线于提交 `c78986831c` 将原无限重试改成写死 5 次；本 change 不恢复无限重试，而是将默认改为 10 并允许配置覆盖。
- `provider_retry.max_retries` 只控制 legacy `SessionRetry.policy`，不控制 V2 executor 或 model-backed search。
- rate-limit、concurrency-limit 和 429 复用原有 retryable error、指数退避、jitter、Retry-After、状态发布和取消流程。
- 本地退避使用 2 秒初始值、2 倍因子、0–25% jitter、单次 120 秒封顶；合法 Retry-After 不受 120 秒限制。
- 不保留上一版固定 10 秒、429 专用预算、V2/search 全局配置传递、累计等待上限或 Session 删除扩展。
- 实现前执行已授权的精确干净回退；保留 `bun.lock`、`hosts/vscode-plugin/package.json` 与 `packages/opencode/webgui/package.json` 的 `26.8.2706` 改动。

# Open questions

# Verification expectations

- 回退后先检查 Git 差异只剩独立 release 文件、Comet 产物和新方案需要的实现。
- 用现有 Session retry 测试的 characterization 证明非目标分类、状态和等待行为未被意外重写。
- 使用 fake error/provider 验证 rate-limit、`Concurrency limit exceeded for user/account`、HTTP 429、quota/permanent 否决，以及默认/0/10 请求数。
- 用 TestClock 确定性验证指数退避、jitter、120 秒本地封顶和长 Retry-After，不进行真实等待。
- 验证 task/subagent 不新增第二层预算；V2 executor、search 与 MCP 通过差异检查和定向测试保持基线。
- 运行受影响 package 的定向测试、`bun typecheck`、必要生成命令、全局 JSONC schema 校验和 `git diff --check`，再由新的只读 Verifier 逐项验收 A1-A9。
