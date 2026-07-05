# 能力：后端启动生命周期

> **象限**：Reference（能力参考）
> **能力编号**：H1（见 [capabilities-index](../capabilities-index.md)）
> **基线状态**：基线

## 代码真源

| 角色 | 文件 |
|------|------|
| VSCode backend launcher | `hosts/vscode-plugin/src/backend/BackendLauncher.ts` |
| VSCode binary extraction | `hosts/vscode-plugin/src/backend/ResourceExtractor.ts` |
| VSCode process cleanup | `hosts/vscode-plugin/src/backend/kill.ts` |
| JetBrains backend launcher | `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/backendprocess/BackendLauncher.kt` |
| JetBrains terminal process | `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/backendprocess/TerminalBackendProcess.kt`、`BackendProcess.kt` |
| JetBrains terminal log capture | `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/backendprocess/TerminalOutputCapture.kt` |
| JetBrains binary extraction | `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/util/ResourceExtractor.kt` |
| JetBrains UI connect | `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/ChatToolWindowFactory.kt` |

> 命名交叉核验（Step 5）：能力索引 H1 的 `BackendLauncher`、`TerminalBackendProcess` 与代码中的 backend lifecycle 类名一致。

## 意图

在 IDE 插件内启动或连接 `opencode serve`，拿到 backend `/app` 地址后加载 WebGUI。宿主插件结构见 [hosts-vscode-plugin 参考](../repositories/hosts-vscode-plugin.md)。

## 行为契约

- VSCode `launchBackend` 可复用当前进程；`forceNew` 会启动额外 backend 但不覆盖共享连接（`BackendLauncher.ts:49-79`）。
- VSCode 启动命令为 `{binary} serve` 加自定义 serve args；失败时如果配置了 custom command，会 fallback 到不带 custom command 的默认 serve（`BackendLauncher.ts:109-127`、`BackendLauncher.ts:146-173`、`BackendLauncher.ts:259-275`）。
- VSCode binary 优先级按当前代码为 `OPENCODE_BIN` > 内嵌 binary > PATH/system candidate（`BackendLauncher.ts:194-215`、`BackendLauncher.ts:222-250`）。
- VSCode 内嵌 binary 从 `resources/bin/{os}/{arch}/opencode(.exe)` 复制到稳定 temp 目录，非 Windows 设置 executable（`ResourceExtractor.ts:33-63`）。
- VSCode 通过 stdout 匹配 `opencode server listening on <url>`，解析 base URL 后把 UI 地址设为 `{baseUrl}/app`（`BackendLauncher.ts:346-382`）。
- VSCode 终止进程时调用 `killTree`；Windows 用 `taskkill /f /t`，非 Windows 优先杀进程组（`BackendLauncher.ts:525-531`、`kill.ts:23-51`）。
- JetBrains `launchBackend` 要求不在 EDT 执行，先解析 binary，再保留 loopback port，命令为 `{bin} serve ... --hostname 127.0.0.1 --port {port}`（`BackendLauncher.kt:28-41`、`BackendLauncher.kt:46-63`）。
- JetBrains binary 优先级为 `OPENCODE_BIN` > 内嵌 resource > PATH `opencode`（`BackendLauncher.kt:32-34`、`BackendLauncher.kt:333-350`）。
- JetBrains 在 Terminal tool window 中启动后端，`TerminalBackendProcess` 暴露合并日志 inputStream（`BackendLauncher.kt:264-330`、`TerminalBackendProcess.kt:22-80`）。
- JetBrains 发现 backend ready 有两条路径：轮询预留的 `/app` URL 成功后连接，或从日志中匹配 `opencode server listening on <url>` 后连接（`ChatToolWindowFactory.kt:53-66`、`ChatToolWindowFactory.kt:237-268`）。
- JetBrains custom command 启动失败时 fallback 到 `{bin} serve`（`BackendLauncher.kt:146-168`）。
- JetBrains dispose 时 destroy backend process 并关闭 inputStream（`ChatToolWindowFactory.kt:218-221`、`TerminalBackendProcess.kt:102-115`）。

## 边界与约束

- VSCode `parseConnectionInfo` 等待 backend 输出最多 300 秒；JetBrains tool window 也设置 300 秒连接超时（`BackendLauncher.ts:352-357`、`ChatToolWindowFactory.kt:138-147`）。
- JetBrains `customCommand.split(" ")` 不支持 shell quoting；VSCode `parseCommandArgs` 支持单双引号（`BackendLauncher.kt:46-48`、`BackendLauncher.ts:287-300`）。
- JetBrains 会保留端口再启动，仍可能被其他进程抢占；代码只在 reserve 失败时 fallback 到 4096（`BackendLauncher.kt:53-62`）。

## 代码锚点速查

| 契约 | 锚点 |
|------|------|
| VSCode 复用进程 | `BackendLauncher.ts:49-53` |
| VSCode binary 优先级 | `BackendLauncher.ts:194-215` |
| VSCode stdout 解析 | `BackendLauncher.ts:346-382` |
| VSCode killTree | `kill.ts:23-51` |
| JetBrains 命令构造 | `BackendLauncher.kt:46-51` |
| JetBrains binary 优先级 | `BackendLauncher.kt:333-350` |
| JetBrains ready 轮询 | `ChatToolWindowFactory.kt:237-243` |
| JetBrains 日志匹配 | `ChatToolWindowFactory.kt:254-268` |

## 运行时待核验

- [ ] JetBrains Terminal 输出捕获在 2026.1 以外 IDE 版本是否仍能读到 `server listening`（`待运行时核验`）。
- [ ] VSCode/JetBrains custom command 中复杂 quoting 的实际兼容差异（`待运行时核验`：需要真实设置输入）。

## 相关

- Webview/JCEF 承载：[host-webview-integration](host-webview-integration.md)
- 宿主动作：[host-actions](host-actions.md)
