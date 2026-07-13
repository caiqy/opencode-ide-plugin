## 1. User-Agent 契约

- [x] 1.1 为 OpenCode 首 token 判定、第三方 UA 保持、版本回退和幂等行为添加失败测试
- [x] 1.2 在 Core 实现统一 User-Agent 定制 helper，并在 Installation 模块恢复 `userAgent` 的 UI 产品与可选产品/系统信息能力

## 2. 出站路径迁移

- [x] 2.1 将 Core 与 OpenCode 的 LLM、provider、tool 和模型列表中的 OpenCode UA 构造迁移到统一 helper，保持后置 header 覆盖顺序
- [x] 2.2 将 OpenAI Codex、GitHub Copilot、xAI、DigitalOcean、Snowflake、WebSearch 等插件和工具中的 OpenCode UA 构造迁移到统一 helper
- [x] 2.3 添加测试，证明 provider 附加产品和系统信息保留，Core models-dev 使用统一 UA，且 xAI、Snowflake、Copilot 的第三方覆盖不被定制

## 3. 验证与回归保护

- [x] 3.1 运行 Installation、provider、插件和 LLM 相关聚焦测试
- [x] 3.2 分别运行 `packages/core` 与 `packages/opencode` 类型检查，并扫描剩余硬编码 OpenCode User-Agent
- [x] 3.3 审查最终差异，确认没有数据库、协议、依赖或第三方 UA 行为变更
