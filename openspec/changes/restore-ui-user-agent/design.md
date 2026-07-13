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

所有硬编码 `opencode/...` 的本地构造改用统一 helper；`input.model.headers`、插件 hook、fetch `Request`/`init` headers 或用户配置保持后置覆盖。当前强制写回默认 UA 的认证 wrapper 调整为先设默认值、再合并调用者 headers。打包脚本不再通过 Bun `--user-agent` 为所有未显式归属的请求强制设置 OpenCode UA。由此，第三方 UA 即使出现在最终请求中也不会被重新定制。

## Risks / Trade-offs

- [遗漏新的硬编码 OpenCode UA] → 搜索所有 `User-Agent` 与 `opencode/` 构造点，并留下 helper 单测和代表性调用点测试。
- [重复追加 UI 产品] → 纯函数先检查已有 `opencode-ui/*` token，保证幂等。
- [comment 内容误判或 comment 后产品遗漏] → 只把 comment 外 token 视为产品，并覆盖 comment 前后位置。
- [误判包含 opencode 字样的第三方 UA] → 只检查首个产品 token，不做任意子串匹配。
- [模块加载时缓存错误 UI 版本] → 动态 helper 在调用时读取环境变量；仅常量语义保持与现有代码一致。

## Migration Plan

无需数据迁移。部署后新请求立即采用统一 UA 规则；回滚可恢复 helper 与调用点，不影响持久数据。

## Open Questions

无。
