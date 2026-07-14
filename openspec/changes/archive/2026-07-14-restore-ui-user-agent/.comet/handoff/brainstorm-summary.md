# Brainstorm Summary

- Change: restore-ui-user-agent
- Date: 2026-07-13

## 已确认事实与约束

- 仅首个产品 token 以 `opencode/` 开头的 UA 可被定制。
- 非 OpenCode UA 完全不变，即使后续 token 含 `opencode/`。
- 已包含 `opencode-ui/*` 的 UA 完全不变。
- UI 版本优先取去除空白后的 `OPENCODE_UI_VERSION`，否则回退 `InstallationVersion`。
- Core 的模型目录 UA 纳入本次范围，纯定制函数下沉 Core。
- 全局只追加 `opencode-ui/<version>`，不恢复 `(codex app)` 注释。

## 确认的技术方案

Core 提供纯 UA 定制函数，OpenCode Installation helper 和所有当前硬编码 OpenCode UA 构造点统一复用。保持 provider/user header 的现有后置覆盖顺序，不增加全局 middleware。

## 关键取舍与风险

- 下沉 Core 避免 Core 反向依赖 OpenCode，也避免重复规则。
- 构造点迁移比全局拦截改动多，但不会误伤第三方 UA。
- 需用残留扫描防止遗漏硬编码 `opencode/` UA。

## 测试策略

- 纯函数表驱动测试：OpenCode、第三方、后置 OpenCode token、已有 UI token、注入版本、版本回退。
- Installation helper 测试：products 和 system comment 保留。
- 代表性 provider/plugin/LLM 测试：统一 helper 被使用，后置第三方覆盖不变。
- 包级类型检查和硬编码残留扫描。

## Spec Patch

- 补充 Core 模型目录路径纳入统一规则。
- 明确统一定制不全局追加 `(codex app)` 注释，各调用点只保留自身已有 comment。
