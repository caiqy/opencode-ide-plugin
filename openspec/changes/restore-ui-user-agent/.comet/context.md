# Comet Design Handoff

- Change: restore-ui-user-agent
- Phase: design
- Mode: compact
- Context hash: 24c25ea69d8bfee89599233cf468750e8a4498a298ee8a7cef176e2cd4655b04

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/restore-ui-user-agent/proposal.md

- Source: openspec/changes/restore-ui-user-agent/proposal.md
- Lines: 1-25
- SHA256: c83220546b0a3c9cc1ac4008111df2cbb6e7dc6e4317e60c64010772371666c0

```md
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

```

## openspec/changes/restore-ui-user-agent/design.md

- Source: openspec/changes/restore-ui-user-agent/design.md
- Lines: 1-49
- SHA256: 91a867a6ff6bb6b34f8dff4b4430b0756d49269aed1252a6ae5e6c1668bbf3d2

```md
## Context

历史实现通过统一的 Installation helper 构造带 `opencode-ui/<version>` 的 User-Agent，并由 VS Code launcher 注入插件版本。上游同步后 helper 被简化，但注入端仍存在；同时代码库新增了 xAI、DigitalOcean、Snowflake 等硬编码 `opencode/<version>` 的请求路径。直接在全局 HTTP 层改写 header 会误伤 provider 或用户显式提供的第三方 User-Agent。

## Goals / Non-Goals

**Goals:**

- 集中定义“仅定制 OpenCode 自有 UA”的规则。
- 覆盖当前由 OpenCode 自己生成 UA 的出站路径。
- 保持第三方 header 覆盖、版本注入和系统信息等现有语义。
- 让定制操作可独立测试且幂等。

**Non-Goals:**

- 不改写任意第三方、provider 或用户自定义 UA。
- 不引入全局 HTTP middleware。
- 不改变认证流程、请求地址、provider 参数或公开协议。

## Decisions

### 使用统一纯函数定制已有 UA

Core Installation 模块提供接收已有 UA 字符串的纯函数。函数只在首个产品 token 以 `opencode/` 开头时追加 UI 产品；已有 `opencode-ui/*` 时直接返回原值。OpenCode 的 `Installation.userAgent(...)` 继续负责生成 OpenCode UA，并在返回前调用该函数。

选择该方案而非全局 HTTP middleware，因为请求最终可能被 provider/user headers 覆盖，且第三方 SDK 自有 UA 不应被修改。选择该方案而非只恢复旧调用点，因为当前代码已新增多条 OpenCode UA 构造路径。

### UI 版本延续历史回退规则

`OPENCODE_UI_VERSION` 去除首尾空白后优先使用；缺失或空白时使用 `InstallationVersion`。这样 VS Code 发送扩展版本，JetBrains 或普通 backend 仍保留可识别的 UI 产品版本。

### 在构造点迁移，不在最终 header 合并后强制覆盖

所有硬编码 `opencode/...` 的本地构造改用统一 helper；`input.model.headers`、插件 hook、fetch `Request`/`init` headers 或用户配置保持后置覆盖。当前强制写回默认 UA 的认证 wrapper 调整为先设默认值、再合并调用者 headers。由此，第三方 UA 即使出现在最终请求中也不会被重新定制。

## Risks / Trade-offs

- [遗漏新的硬编码 OpenCode UA] → 搜索所有 `User-Agent` 与 `opencode/` 构造点，并留下 helper 单测和代表性调用点测试。
- [重复追加 UI 产品] → 纯函数先检查已有 `opencode-ui/*` token，保证幂等。
- [误判包含 opencode 字样的第三方 UA] → 只检查首个产品 token，不做任意子串匹配。
- [模块加载时缓存错误 UI 版本] → 动态 helper 在调用时读取环境变量；仅常量语义保持与现有代码一致。

## Migration Plan

无需数据迁移。部署后新请求立即采用统一 UA 规则；回滚可恢复 helper 与调用点，不影响持久数据。

## Open Questions

无。

```

## openspec/changes/restore-ui-user-agent/tasks.md

- Source: openspec/changes/restore-ui-user-agent/tasks.md
- Lines: 1-16
- SHA256: 8c85902a1d91f717fbfedc24d7060526b804e3b7e2c6878d38b0a5a49c57d967

```md
## 1. User-Agent 契约

- [ ] 1.1 为 OpenCode 首 token 判定、第三方 UA 保持、版本回退和幂等行为添加失败测试
- [ ] 1.2 在 Core 实现统一 User-Agent 定制 helper，并在 Installation 模块恢复 `userAgent` 的 UI 产品与可选产品/系统信息能力

## 2. 出站路径迁移

- [ ] 2.1 将 Core 与 OpenCode 的 LLM、provider、tool 和模型列表中的 OpenCode UA 构造迁移到统一 helper，保持后置 header 覆盖顺序
- [ ] 2.2 将 OpenAI Codex、GitHub Copilot、xAI、DigitalOcean、Snowflake、WebSearch 等插件和工具中的 OpenCode UA 构造迁移到统一 helper
- [ ] 2.3 添加测试，证明 provider 附加产品和系统信息保留，Core models-dev 使用统一 UA，且 xAI、Snowflake、Copilot 的第三方覆盖不被定制

## 3. 验证与回归保护

- [ ] 3.1 运行 Installation、provider、插件和 LLM 相关聚焦测试
- [ ] 3.2 分别运行 `packages/core` 与 `packages/opencode` 类型检查，并扫描剩余硬编码 OpenCode User-Agent
- [ ] 3.3 审查最终差异，确认没有数据库、协议、依赖或第三方 UA 行为变更

```

## openspec/changes/restore-ui-user-agent/specs/user-agent-customization/spec.md

- Source: openspec/changes/restore-ui-user-agent/specs/user-agent-customization/spec.md
- Lines: 1-49
- SHA256: 2ae150ded2dbcd65a5b39811f90b5892dcf1ca353195cc352f226ef68fad5b71

```md
## ADDED Requirements

### Requirement: OpenCode User-Agent 包含 UI 产品标识
系统 SHALL 为首个产品 token 以 `opencode/` 开头的出站 User-Agent 追加一个 `opencode-ui/<version>` 产品 token。

#### Scenario: 使用注入的 UI 版本
- **WHEN** 原始 User-Agent 的首个产品 token 以 `opencode/` 开头且 `OPENCODE_UI_VERSION` 包含非空白版本
- **THEN** 系统追加去除首尾空白后的 `opencode-ui/<version>` 产品 token

#### Scenario: 回退 backend 版本
- **WHEN** 原始 User-Agent 的首个产品 token 以 `opencode/` 开头且 `OPENCODE_UI_VERSION` 缺失或为空白
- **THEN** 系统追加 `opencode-ui/<InstallationVersion>` 产品 token

### Requirement: 非 OpenCode User-Agent 保持不变
系统 MUST 不修改首个产品 token 不以 `opencode/` 开头的 User-Agent。

#### Scenario: 第三方 UA 包含后置 OpenCode token
- **WHEN** User-Agent 为 `third-party/1.0 opencode/1.2.3`
- **THEN** 系统返回完全相同的 User-Agent

#### Scenario: provider 或用户覆盖 UA
- **WHEN** provider 或用户在 OpenCode 默认 header 之后提供非 OpenCode User-Agent
- **THEN** 最终请求继续使用该非 OpenCode User-Agent且不追加 UI 产品

### Requirement: User-Agent 定制幂等
系统 MUST 避免向已包含任意 `opencode-ui/*` 产品 token 的 OpenCode User-Agent 重复追加 UI 产品。

#### Scenario: 已定制的 OpenCode UA
- **WHEN** OpenCode User-Agent 已包含 `opencode-ui/1.0`
- **THEN** 系统返回完全相同的 User-Agent

### Requirement: 当前 OpenCode UA 构造路径使用统一规则
系统 SHALL 使 Core 模型目录、当前 provider、LLM、认证插件和工具中由 OpenCode 生成的 User-Agent 使用统一定制规则，同时保持各路径已有的附加产品 token、系统信息和 header 合并顺序。统一定制 MUST NOT 向所有路径全局追加 `(codex app)` 或其他调用点不具备的 comment。

#### Scenario: 带 provider 产品的 OpenCode UA
- **WHEN** provider 构造包含自身产品 token 的 OpenCode User-Agent
- **THEN** 该 provider 产品信息保持存在且 User-Agent 包含一个 UI 产品 token

#### Scenario: 带系统信息的 OpenCode UA
- **WHEN** OpenCode 请求要求在 User-Agent comment 中携带系统信息
- **THEN** 系统信息保持存在且 User-Agent 包含一个 UI 产品 token

#### Scenario: Core 模型目录请求
- **WHEN** Core 模型目录服务构造 OpenCode User-Agent
- **THEN** User-Agent 使用相同的 UI 产品标识、版本回退和幂等规则

#### Scenario: 非 Codex 请求
- **WHEN** 非 Codex 调用点构造 OpenCode User-Agent 且原格式不含 comment
- **THEN** 系统只追加 UI 产品 token且不新增 `(codex app)` comment

```
