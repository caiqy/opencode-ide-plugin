# restore-ui-user-agent 验证报告

## 摘要

| 维度 | 结果 |
|---|---|
| 完整性 | PASS：10/10 tasks，4/4 requirements |
| 正确性 | PASS：11/11 scenarios 已由实现与测试覆盖 |
| 一致性 | PASS：实现符合 OpenSpec design 与 Design Doc |

## 验证证据

- 2026-07-14 重新运行 Core 聚焦测试：39 pass，0 fail，64 assertions。
- 2026-07-14 重新运行 OpenCode 聚焦测试：55 pass，0 fail，175 assertions。
- `packages/core`：`bun typecheck` 退出码 0。
- `packages/opencode`：`bun typecheck` 退出码 0。
- 残留扫描覆盖 `packages/core/src`、`packages/opencode/src`、`packages/opencode/script` 与 `packages/console`。
- 最终独立代码审查：READY，无 Critical、Important 或 Minor。
- `git diff --check 1f2cdf59fa1f59ff019d381827ba2ae1ef42ecd7 -- packages/core packages/opencode` 通过。

## 规格映射

- 首产品判定、版本 trim/fallback、comment 前插入和幂等由 Core 纯函数测试覆盖。
- comment 内文本与 comment 后 UI product 分别有回归用例。
- Core models.dev 通过真实本地 HTTP 请求验证 UI token。
- xAI、Snowflake、Copilot 验证第三方 User-Agent 后置覆盖及认证 header 所有权。
- Bun 打包脚本不再全局强制 OpenCode User-Agent。
- 启动前注入 `OPENCODE_UI_VERSION` 由真实 Bun 子进程首次加载测试覆盖。

## 问题

- CRITICAL：无。
- WARNING：无。
- SUGGESTION：无。

## 分支处理

用户选择将整个 `restore-ui-agent` 分支本地合并到 `ide-plugin`，随后明确要求 commit & push。`ide-plugin`、`origin/ide-plugin` 与 `restore-ui-agent` 均指向 `4891af937af315bd3992baf480dc96b672d30d7e`。

分支在 User-Agent change 之后还包含独立的 retry regression 修复与 release/lockfile 同步提交；这些不改变本 change 的 User-Agent requirements、design 或 scenario 验证结论。

## 结论

验证通过，可进入归档确认阶段。
