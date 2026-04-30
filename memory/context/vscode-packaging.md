# VSCode Windows VSIX 快速打包

当用户说“打包下一个版本 / 打包新版本 / 打包 vsix”时：不要重新探索流程，直接按 `.opencode/command/build-vsix.md` 执行。

## 快速规则

- 版本格式：`YY.M.DDNN`，只递增当天序号。
- 只改两个版本号：
  - `packages/opencode/webgui/package.json`
  - `hosts/vscode-plugin/package.json`
- 后端构建用：`bun "script/build.ts" --single`，工作目录必须是 `packages/opencode`。
- 复制：`packages/opencode/dist/opencode-windows-x64/bin/opencode.exe` → `hosts/vscode-plugin/resources/bin/windows/amd64/opencode.exe`。
- `vsce package` 必须在 `hosts/vscode-plugin` 目录执行。
- 最终只验证三件事：VSIX 存在、VSIX manifest 版本正确、内含 Windows amd64 二进制。

## 默认输出

产物：`hosts/vscode-plugin/opencode-vscode-win-amd64-<version>.vsix`

安装：`Ctrl+Shift+P → Extensions: Install from VSIX...`
