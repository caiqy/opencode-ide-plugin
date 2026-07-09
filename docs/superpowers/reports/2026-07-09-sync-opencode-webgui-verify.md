# sync-opencode-webgui 验证报告

## 结论

| 维度 | 状态 |
| --- | --- |
| Completeness | 17/17 tasks 已完成；4 个 requirements、6 个 scenarios 已对照 |
| Correctness | opencode、WebGUI、HTTP API、VSCode 当前证据通过；JetBrains 受本机 Java 8 阻塞 |
| Coherence | 实现符合“小 adapter 保留 WebGUI/IDE bridge”的设计方向；reviewer 未发现 Critical/Important |

最终判断：未发现阻断 archive 的 Critical 或 Important 问题。剩余项均为记录型风险或 Minor。

## 验证证据

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| Comet verify 入口 | `node C:\Users\caiqy\.comet\skills\skills\comet\scripts\comet-state.mjs check sync-opencode-webgui verify` | PASS |
| 规模评估 | `node C:\Users\caiqy\.comet\skills\skills\comet\scripts\comet-state.mjs scale sync-opencode-webgui` | `verify_mode=full` |
| OpenSpec 状态 | `openspec status --change "sync-opencode-webgui" --json` | artifacts 完整 |
| OpenSpec 任务 | `openspec instructions apply --change "sync-opencode-webgui" --json` | 17/17 complete |
| opencode typecheck | `bun typecheck` in `packages/opencode` | PASS |
| opencode 受影响测试 | `bun test test/permission/next.test.ts test/session/tool-permission.test.ts test/session/message-v2.test.ts test/session/retry.test.ts test/cli/run/stream.transport.test.ts test/server/httpapi-control-plane.test.ts test/server/httpapi-global.test.ts test/server/httpapi-mcp.test.ts --timeout 30000` | 199 pass, 0 fail |
| HTTP API exerciser | `bun run script/httpapi-exercise.ts --mode effect --fail-on-missing --fail-on-skip` in `packages/opencode` | `pass=215 fail=0 skip=0 missing=0 extra=0` |
| opencode build | `bun run --cwd packages/opencode build --single --skip-install` | PASS；smoke `1.17.16` |
| WebGUI tests | `bun run test:run` in `packages/opencode/webgui` | 首次 1 个 `CompactHeader` timeout；focused 单测和文件测试通过；重跑全量 151 files / 1274 tests pass |
| WebGUI build | `bun run build` in `packages/opencode/webgui` | PASS |
| VSCode compile | `bun run compile` in `sdks/vscode` | PASS；48 个现有 `semi` warnings |
| VSCode package | `bun run package` in `sdks/vscode` | PASS；48 个现有 `semi` warnings |
| JetBrains JVM | `java -version` | OpenJDK 8 |
| JetBrains check | `.\gradlew.bat check --no-daemon --console=plain` in `hosts/jetbrains-plugin` | BLOCKED：Gradle plugin requires JVM 17+ |
| 冲突索引 | `git ls-files -u` | 无输出 |
| 冲突标记 | `rg --hidden -n "^(<<<<<<<|=======|>>>>>>>)" --glob "!.git/**" --glob "!node_modules/**"` | 无输出 |

## Issues

### Critical

无。

### Important

无。

### Warning

- JetBrains plugin 尚未在 Java 17+ 环境下完成 source/build 验证。本机 OpenJDK 8 会在 Gradle 配置阶段失败，错误为 `Dependency requires at least JVM runtime version 17`。
- WebGUI 全量测试首次出现一次 `CompactHeader/index.test.tsx` 5s timeout；focused 单测、整文件测试和全量重跑均通过，按 flaky 风险记录。

### Minor

- `packages/opencode/webgui/src/lib/api/events.ts:7` 中 `session.created/session.updated` 类型仍描述为 `properties.session`，当前 schema/server 和 `SessionContext` 实际使用 `properties.info`。运行时未受影响，但后续类型维护容易被误导。
- `sdks/vscode/src/extension.ts` 当前 lint 输出 48 个 `semi` warnings；命令退出码为 0，不阻塞本次验证。

## 规格映射

- Preserve WebGUI behavior through upstream sync：由 WebGUI full tests/build、opencode session/message/permission/provider 相关测试、HTTP API exerciser 覆盖。
- Preserve IDE bridge behavior through upstream sync：由 WebGUI `ideBridge` tests、VSCode compile/package 覆盖；JetBrains 受 Java 17+ 环境阻塞。
- Stop before unresolved tradeoffs：build evidence 记录用户选择 `端口适配`，未发现新的二选一产品取舍。
- Verify fork-specific compatibility：已覆盖 opencode checks、WebGUI checks、VSCode host checks，并记录 JetBrains 环境阻塞。

## 分支状态

待用户选择分支处理方式后更新 `branch_status`。
