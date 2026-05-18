# Validation Baseline

**Status**: 基线清单
**Created**: 2026-05-18
**Purpose**: 列出后续 specs 和 upstream merges 可引用的 executable checks，作为 validation evidence。

## General Rules

- 除非另有说明，命令必须在拥有对应 script 的 package directory 中运行。
- 不要运行根目录 `bun test`；root package 故意返回错误以阻止从根目录跑测试。
- Windows PowerShell 中的 Gradle 命令必须追加 `--no-daemon --console=plain`。
- 如果命令需要 secrets 或外部服务，记录为 skipped 并说明原因；不得暴露 secret values。
- 完成声明必须提供 command output 或 manual scenario notes，并映射到受影响 requirements 或 regression matrix rows。

## Core opencode

Working directory: `packages/opencode`

```powershell
bun typecheck
bun test --timeout 30000
bun run script/build.ts --single
```

适用场景：

- server routes，包括 `/app`
- session/provider/agent/tool 行为
- 影响 SDK/OpenAPI 的 routes
- `packages/opencode/src/**` 中的 upstream merge conflicts

## WebGUI

Working directory: `packages/opencode/webgui`

```powershell
bun typecheck
bun test:run
bun build
```

适用场景：

- React components 或 hooks
- contexts、repos、scoped storage、tabs、session/message state
- IDE bridge client code
- Vite/Tailwind/build embedding 行为

UI 行为受影响时的手动检查：

- 从运行中的 backend 打开 `/app`，确认 SPA 加载。
- 创建 session，发送 prompt，并观察 streaming/idle state。
- 打开 command palette/settings/help，并用 keyboard shortcuts 关闭。
- 当改动涉及 IDE context 时，通过 host bridge 或 drag/drop 插入路径。

## VSCode Plugin

Working directory: `hosts/vscode-plugin`

```powershell
pnpm run compile
pnpm run lint
pnpm test
```

Packaging checks:

```powershell
pnpm run package:dev
```

Windows VSIX release packaging 需遵循 `memory/context/vscode-packaging.md`。

适用场景：

- VSCode activation 或 commands
- `BackendLauncher`、resource extraction、process cleanup
- `IdeBridgeServer`、webview loading、settings、diagnostics、update flow

手动检查：

- 打开 OpenCode activity bar panel。
- 确认 backend 启动且 WebGUI 加载。
- 执行 Add to context、Add lines to context 和 Paste path commands。
- backend launch 失败时，确认 diagnostics 或 logs 可用。

## JetBrains Plugin

Working directory: `hosts/jetbrains-plugin`

```powershell
./gradlew.bat unitTest --no-daemon --console=plain
./gradlew.bat build --no-daemon --console=plain
```

Packaging check:

```powershell
./gradlew.bat buildPlugin "-Pplugin.version=<version>" --no-daemon --console=plain
```

如果出现 Gradle daemon 或 file locks：

```powershell
./gradlew.bat --stop
```

适用场景：

- tool window / JCEF integration
- terminal backend launch
- `IdeBridge`、storage backend、open file/path insertion、update flow
- Gradle build 或 plugin metadata

手动检查：

- 在支持的 JetBrains IDE 中打开 OpenCode tool window。
- 确认 JCEF support path 可加载 WebGUI。
- 确认 backend logs 仅在错误或需要 diagnostics 时显示。
- 执行 project/editor context actions，并确认 prompt insertion。

## Cross-Client Smoke

upstream merges 或 shared protocol changes 之后使用：

1. Core：在 `packages/opencode` 运行 `bun typecheck`。
2. WebGUI：在 `packages/opencode/webgui` 运行 `bun test:run` 和 `bun build`。
3. VSCode：在 `hosts/vscode-plugin` 运行 `pnpm run compile`。
4. JetBrains：在 `hosts/jetbrains-plugin` 运行 `./gradlew.bat unitTest --no-daemon --console=plain`。
5. Manual：如果 bridge/backend 行为变化，至少启动一个 IDE host 做手动检查。

## Evidence Format

在 final summary 或 review notes 中按以下格式记录 validation evidence：

```text
Command: <exact command>
Working directory: <path>
Result: PASS/FAIL/SKIPPED
Output summary: <key lines or failure reason>
Covers: <spec requirement or regression matrix row>
```

手动检查按以下格式记录：

```text
Scenario: <manual scenario>
Environment: <host, OS, IDE/version if known>
Result: PASS/FAIL/SKIPPED
Observed: <what happened>
Covers: <spec requirement or regression matrix row>
```
