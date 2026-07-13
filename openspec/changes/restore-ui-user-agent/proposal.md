## Why

IDE backend 仍接收 `OPENCODE_UI_VERSION`，但上游同步覆盖了消费该值并追加 UI 产品标识的逻辑，导致发往上游的 OpenCode User-Agent 无法区分 IDE/UI 版本。恢复时还需避免修改 provider、用户或第三方组件明确设置的非 OpenCode User-Agent。

## What Changes

- 为 OpenCode 自有 User-Agent 恢复 `opencode-ui/<version>` 产品标识。
- 仅当首个产品 token 以 `opencode/` 开头时执行定制，其他 User-Agent 原样保留。
- 已包含 `opencode-ui/*` 的 User-Agent 保持不变，保证转换幂等。
- UI 版本优先使用 `OPENCODE_UI_VERSION`，缺失或空白时回退 backend 的 `InstallationVersion`。
- 将当前各 provider、认证插件、LLM 和工具中的 OpenCode User-Agent 构造统一接入该规则，并保留后置第三方 header 覆盖语义。

## Capabilities

### New Capabilities

- `user-agent-customization`: 定义 OpenCode 自有出站 User-Agent 的 IDE/UI 产品标识、条件定制、版本回退和幂等行为。

### Modified Capabilities

无。

## Impact

影响 `packages/core` 中共享 User-Agent helper、模型目录、provider/tool 请求，以及 `packages/opencode` 中 Installation helper、provider/LLM 请求、OpenAI Codex、GitHub Copilot、xAI、DigitalOcean、Snowflake、WebSearch 等当前硬编码 OpenCode UA 的出站路径和相关测试。无 public API、数据库 schema 或新增依赖变更。
