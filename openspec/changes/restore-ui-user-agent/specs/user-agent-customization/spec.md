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

#### Scenario: comment 后已有 UI 产品
- **WHEN** OpenCode User-Agent 在 comment 后包含 `opencode-ui/1.0` 产品 token
- **THEN** 系统返回完全相同的 User-Agent且不把 comment 内容误判为产品

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

#### Scenario: 未显式归属的打包请求
- **WHEN** 打包后的 Bun 请求没有调用点显式提供 OpenCode User-Agent
- **THEN** 系统不通过全局运行时参数强制设置 OpenCode User-Agent
