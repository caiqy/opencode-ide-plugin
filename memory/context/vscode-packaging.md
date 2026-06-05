# VSCode Windows VSIX 快速打包

当用户说“打包下一个版本 / 打包新版本 / 打包 vsix”时：不要重新探索流程，直接按 `.opencode/command/build-vsix.md` 的两步流程执行。

## 快速规则

- 使用仓库通用版本规则：见 `memory/context/versioning.md`
- 先更新版本号，再执行构建与打包；不要把“算版本号 + 打包”绑成一条脆弱的单行命令。
- 版本更新后必须校验两个 `package.json` 版本一致、非空，并且符合当天日期段；校验失败必须停止，不能沿用旧 package 版本继续打包。
- 只改两个版本号：
  - `packages/opencode/webgui/package.json`
  - `hosts/vscode-plugin/package.json`
- 后端构建用：`bun "script/build.ts" --single`，工作目录必须是 `packages/opencode`。
- 复制：`packages/opencode/dist/opencode-windows-x64/bin/opencode.exe` → `hosts/vscode-plugin/resources/bin/windows/amd64/opencode.exe`。
- `vsce package` 必须在 `hosts/vscode-plugin` 目录执行。
- 最终只验证四件事：VSIX 存在、VSIX 文件名包含非空目标版本、VSIX manifest 版本正确、内含 Windows amd64 二进制。

## 本仓库当前环境下的额外注意事项

- 在 OpenCode 的 `bash`/PowerShell 工具里，`node -e '...'` 这种“外层单引号、内层双引号”的 one-liner 可能被错误改写，导致 Node 收到的脚本丢失字符串引号。
- 因此当用户说“打包下一个版本”时，必须遵循这里的稳定顺序：
  1. 按版本规则先算出目标版本号
  2. 直接写入上面两个 `package.json`
  3. 校验目标版本号非空、两个 `package.json` 一致、日期段等于今天
  4. 再执行构建、复制二进制、`vsce package`
- 不要在当前工具环境里使用 `node -e` one-liner 计算版本号；如果任何命令生成了 `opencode-vscode-win-amd64-.vsix` 或日期段不等于今天，必须删除错误产物并重新从版本更新步骤开始。

## 默认输出

产物：`hosts/vscode-plugin/opencode-vscode-win-amd64-<version>.vsix`

安装：`Ctrl+Shift+P → Extensions: Install from VSIX...`
