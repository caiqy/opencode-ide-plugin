# 能力：打包与发布链路

> **象限**：Reference（能力参考）
> **能力编号**：I4 + I5（见 [capabilities-index](../capabilities-index.md)）
> **基线状态**：基线

## 代码真源

| 角色 | 文件 |
|------|------|
| VSCode 打包脚本 | `hosts/scripts/build_vscode.sh` |
| VSCode Marketplace 元数据 | `hosts/vscode-plugin/package.json` |
| JetBrains Gradle 构建 | `hosts/jetbrains-plugin/build.gradle.kts` |
| 发布内容共享真源 | `docs/release-content/manifest.json`、`README.shared.md`、`description.shared.md`、`CHANGELOG.md` |
| 发布内容同步 | `script/release-content.ts`、`script/release-content-sync.ts` |
| 自动发布入口 | `.github/workflows/release.yml` |
| 本地打包记忆 | `memory/context/vscode-packaging.md`、`memory/context/gradle.md`、`memory/context/versioning.md` |

> 命名交叉核验（Step 5）：能力 I4/I5 对应 [hosts-vscode-plugin 参考](../repositories/hosts-vscode-plugin.md)，代码真源集中在 release-content、host package metadata 与 release workflow。

## 意图

让 VSCode 与 JetBrains 两端使用同一发布内容真源，同时保持各自平台的打包形态：VSCode 是平台定向 VSIX，JetBrains 是平台 ZIP 与 Marketplace 组合包。

## 行为契约

- VSCode 本地打包脚本构建/检查插件内 backend binary；全量模式要求 Windows amd64、macOS amd64/arm64、Linux amd64/arm64 五个 binary（`build_vscode.sh` 第 151-158 行、第 202-235 行）。
- VSCode extension 的 Marketplace Unique Identifier 是 `caiqy.opencode-ui`，由 `publisher=caiqy` 和 `name=opencode-ui` 组成（`package.json` 第 2-6 行）。
- `package.json` 中 `opencode.minVersion` 是版本门禁配置项，空值表示禁用兼容门禁（`package.json` 第 167-170 行）。
- JetBrains 版本优先由 `-Pplugin.version` 注入，fallback 版本只在未注入时使用（`build.gradle.kts` 第 9-10 行）。
- JetBrains `processResources` 注入 `opencodeMinVersion` 与 `distribution.channel` 到资源文件（`build.gradle.kts` 第 133-145 行）。
- 发布内容真源在 `docs/release-content/`；同步脚本生成 VSCode README/CHANGELOG/package 描述和 JetBrains README/description/changelog（`release-content.ts` 第 119-142 行）。
- `release-content:check` 是 release preflight 的第一道门，防止发布内容漂移（`release.yml` 第 37-41 行）。
- `push v* tag` 是自动发版入口；tag 含 `-` 时视为 prerelease（`release.yml` 第 3-7 行、第 49-60 行）。
- VSCode release job 构建 5 个平台定向包，并校验每个 VSIX 只包含目标平台 binary（`release.yml` 第 91-110 行、第 437-488 行）。
- VSCode 只发布 Visual Studio Marketplace artifact，workflow 未包含 Open VSX 发布 job（`release.yml` 第 405-506 行）。
- JetBrains Marketplace job 从 Windows x64、macOS ARM64、Linux x64 三个平台 ZIP 提取 binary，重建一个 Marketplace 组合包（`release.yml` 第 543-578 行）。
- JetBrains Marketplace build/sign/publish 必须注入 `-Pdistribution.channel="marketplace"`，并校验产物 metadata 与 3 binary 内容（`release.yml` 第 615-625 行、第 715-783 行、第 785-795 行）。

## 边界与约束

- 版本规则是 `YY.M.DDNN`，跨天日期段必须更新，当天序号从 `00` 起（`memory/context/versioning.md` 第 3-11 行）。
- Windows 本地 VSIX 快速打包只更新 `packages/opencode/webgui/package.json` 和 `hosts/vscode-plugin/package.json`，并验证 VSIX 内含 Windows amd64 binary（`memory/context/vscode-packaging.md` 第 7-16 行）。
- Windows/PowerShell 下 Gradle 命令默认加 `--no-daemon --console=plain`，`-P...=...` 参数要加引号（`memory/context/gradle.md` 第 5-10 行）。

## 静态锚点

- VSCode 5 平台 binary 检查：`hosts/scripts/build_vscode.sh:202`
- VSCode package script：`hosts/vscode-plugin/package.json:185`
- JetBrains plugin version 注入点：`hosts/jetbrains-plugin/build.gradle.kts:10`
- JetBrains distribution channel 资源注入：`hosts/jetbrains-plugin/build.gradle.kts:136`
- release-content 生成目标：`script/release-content.ts:135`
- release-content check 入口：`script/release-content-sync.ts:5`
- Release tag 入口：`.github/workflows/release.yml:3`
- VSCode 5 平台 matrix：`.github/workflows/release.yml:91`
- VSCode Marketplace 发布：`.github/workflows/release.yml:490`
- JetBrains Marketplace 3 binary 组合：`.github/workflows/release.yml:574`
- Marketplace channel 校验：`.github/workflows/release.yml:715`

## 维护检查

- 改 `docs/release-content/*` 后要跑 release-content sync/check，平台目录生成物不是长期真源。
- 改 VSCode publisher/name 时会改变 Marketplace Unique Identifier，默认不应修改。
- 改 JetBrains Marketplace binary 组合时，同步 bundle 提取、metadata 校验和 release 文档。

## 运行时待核验

- [ ] VSCode Marketplace 上 5 个 platform VSIX 是否都被平台选择逻辑正确识别（`待运行时核验`：需要 Marketplace 安装/更新链路）。
- [ ] JetBrains Marketplace 组合包在 Windows x64、macOS ARM64、Linux x64 三端是否都能解出对应 backend binary（`待运行时核验`）。

## 相关

- 版本与更新：[version-update](version-update.md)
- 发布内容清单：[hosts-vscode-plugin 参考](../repositories/hosts-vscode-plugin.md)
