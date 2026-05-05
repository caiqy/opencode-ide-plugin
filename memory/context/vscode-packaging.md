# VSCode Windows VSIX 快速打包

当用户说“打包下一个版本 / 打包新版本 / 打包 vsix”时：不要重新探索流程，直接按 `.opencode/command/build-vsix.md` 执行。

## 快速规则

- 使用仓库通用版本规则：见 `memory/context/versioning.md`
- 先更新版本号，再执行构建与打包；不要把“算版本号 + 打包”绑成一条脆弱的单行命令。
- 只改两个版本号：
  - `packages/opencode/webgui/package.json`
  - `hosts/vscode-plugin/package.json`
- 后端构建用：`bun "script/build.ts" --single`，工作目录必须是 `packages/opencode`。
- 复制：`packages/opencode/dist/opencode-windows-x64/bin/opencode.exe` → `hosts/vscode-plugin/resources/bin/windows/amd64/opencode.exe`。
- `vsce package` 必须在 `hosts/vscode-plugin` 目录执行。
- 最终只验证三件事：VSIX 存在、VSIX manifest 版本正确、内含 Windows amd64 二进制。

## 本仓库当前环境下的额外注意事项

- 在 OpenCode 的 `bash`/PowerShell 工具里，`node -e '...'` 这种“外层单引号、内层双引号”的 one-liner 可能被错误改写，导致 Node 收到的脚本丢失字符串引号。
- 因此当用户说“打包下一个版本”时，优先遵循这里的稳定顺序：
  1. 按版本规则先算出目标版本号
  2. 直接写入上面两个 `package.json`
  3. 再执行构建、复制二进制、`vsce package`
- 不要在当前工具环境里盲信 `.opencode/command/build-vsix.md` 中那条带 `node -e` 的单行命令；除非先最小复现确认该环境的引号行为正常。

## 默认输出

产物：`hosts/vscode-plugin/opencode-vscode-win-amd64-<version>.vsix`

安装：`Ctrl+Shift+P → Extensions: Install from VSIX...`
