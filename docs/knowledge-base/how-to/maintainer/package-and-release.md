# 打包与发布

适用：本地打包 VSCode VSIX / JetBrains 插件，或触发基于 tag 的正式发版。

## 真源

1. VSCode Windows VSIX：[vscode-packaging](../../../../memory/context/vscode-packaging.md)
2. Gradle 命令规则：[gradle](../../../../memory/context/gradle.md)
3. 版本规则：[versioning](../../../../memory/context/versioning.md)
4. 正式发版：[release-publishing](../../../../memory/context/release-publishing.md)
5. 能力背景：[packaging-release](../../reference/business/packaging-release.md)。

## 版本规则

1. 使用 `YY.M.DDNN`。
2. `YY` 是年份后两位。
3. `M` 是不补零月份。
4. `DDNN` 是日期乘以 100 加当天序号。
5. 跨天后日期段必须更新，当天序号从 `00` 重新开始。
6. 不沿用 `build.gradle.kts` 里可能过期的 fallback 版本。

## 打包 VSCode Windows VSIX

1. 先按 `memory/context/vscode-packaging.md` 计算目标版本。
2. 更新两个 package 版本：
   - `packages/opencode/webgui/package.json`
   - `hosts/vscode-plugin/package.json`
3. 校验两个版本非空、一致、日期段等于今天。
4. 校验失败就停止，不沿用旧版本继续打包。
5. 在 `packages/opencode` 构建后端。
6. 复制 Windows amd64 backend binary 到 VSCode 插件 resources。
7. 在 `hosts/vscode-plugin` 执行 `vsce package` 流程。
8. 最终确认 VSIX 存在、文件名含版本、manifest 版本正确、内含 Windows amd64 二进制。

Packaging check，Working directory: `hosts/vscode-plugin`

```powershell
pnpm run package:dev
```

## 打包 JetBrains 插件

1. 按 `memory/context/versioning.md` 计算目标版本。
2. 用 Gradle 属性注入版本，不依赖 fallback。
3. PowerShell 中 `-Pplugin.version=...` 必须加引号。
4. 所有 `gradlew.bat` 命令追加 `--no-daemon --console=plain`。

Working directory: `hosts/jetbrains-plugin`

```powershell
./gradlew.bat buildPlugin "-Pplugin.version=<version>" --no-daemon --console=plain
```

如果出现 Gradle daemon 或 file locks：

```powershell
./gradlew.bat --stop
```

## 正式发布

1. 只提交本次实现相关改动。
2. 推送当前分支到 `origin`。
3. 按版本规则创建下一个 `vYY.M.DDNN` tag。
4. 推送 tag，触发 `.github/workflows/release.yml`。
5. 跟进 GitHub Actions：`publish-vscode-marketplace`、`publish-jetbrains-marketplace`、`release`。
6. 任一 Marketplace job 失败时，以 workflow 失败处理；不要本地伪造成功状态。

## 发布前验证

按 `specs/000-existing-capabilities/validation.md` 选择受影响 package 的 baseline。

VSCode，Working directory: `hosts/vscode-plugin`

```powershell
pnpm run compile
pnpm run lint
pnpm test
```

JetBrains，Working directory: `hosts/jetbrains-plugin`

```powershell
./gradlew.bat unitTest --no-daemon --console=plain
./gradlew.bat build --no-daemon --console=plain
```

> 待运行时核验：正式发版依赖 GitHub Actions secrets 和 Marketplace 账号状态。
