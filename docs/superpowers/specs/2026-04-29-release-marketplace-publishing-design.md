# Release 工作流中的 JetBrains Marketplace 发布设计

## 背景

当前仓库已有 `.github/workflows/release.yml`，可以通过 `workflow_dispatch` 输入版本号，构建 VSCode 与 JetBrains 插件的多平台产物，并创建 GitHub Release。JetBrains 插件目前在 matrix 中分别构建 5 个平台 zip：Windows x64、macOS x64、macOS ARM64、Linux x64、Linux ARM64。

目标是在不拆分新 workflow 的前提下，扩展现有 `release.yml`：GitHub Release 继续保留 5 个 JetBrains 平台 zip，同时额外发布一个 JetBrains Marketplace 组合包。该组合包只包含 Windows x64、macOS ARM64、Linux x64 三个平台的后端二进制。

## 决策

- 在现有 `.github/workflows/release.yml` 中新增 `publish-jetbrains-marketplace` job。
- Marketplace 插件版本与 release 输入版本一致：输入 `v26.4.2902` 时，Gradle 插件版本为 `26.4.2902`。
- GitHub Release 附件保持现有 5 个 JetBrains 平台 zip 不变。
- Marketplace 额外发布一个组合包，只包含：
  - Windows x64：`bin/windows/amd64/opencode.exe`
  - macOS ARM64：`bin/macos/arm64/opencode`
  - Linux x64：`bin/linux/amd64/opencode`
- Marketplace 包中的二进制从 `build-jetbrains` matrix artifact 中提取，不在发布 job 中重新构建。
- 这次只实现 JetBrains Marketplace 自动发布；VSCode 插件市场发布暂不实现，但保留同类汇总发布 job 的结构空间。
- Marketplace 发布失败时，整个 `Release` workflow 失败。
- 完整接入 JetBrains 插件签名和 Marketplace 发布。

## Workflow 架构

现有 workflow 保持：

1. `preflight`：计算版本信息。
2. `build-vscode`：构建 VSCode matrix 产物。
3. `build-jetbrains`：构建 JetBrains 5 平台 matrix 产物。
4. `release`：下载所有产物并创建 GitHub Release。
5. `test-artifacts`：验证 GitHub Release 产物完整性。

新增：

```yaml
publish-jetbrains-marketplace:
  needs: [preflight, build-jetbrains]
```

该 job 只负责 Marketplace 发布，不混入 GitHub Release 创建逻辑。它与 `release` job 并列依赖 `build-jetbrains`，这样职责边界清晰，后续可以用同样模式新增 `publish-vscode-marketplace`。

## Marketplace 发布流程

`publish-jetbrains-marketplace` 执行以下步骤：

1. checkout 仓库。
2. 设置 Java 21 与 Gradle。
3. 下载指定 artifact：
   - `jetbrains-windows-x64`
   - `jetbrains-macos-arm64`
   - `jetbrains-linux-x64`
4. 清空 `hosts/jetbrains-plugin/src/main/resources/bin`。
5. 解压三个平台 zip，并从插件包内提取指定二进制到目标目录。
6. 校验三个目标二进制都存在。
7. 对非 Windows 二进制执行 `chmod +x`。
8. 使用 release 输入版本去掉 `v` 前缀后执行 Gradle：

```bash
./gradlew clean buildPlugin signPlugin publishPlugin \
  -Pplugin.version=26.4.2902 \
  -x test \
  -x unitTest
```

工作目录为：

```text
hosts/jetbrains-plugin
```

## Gradle 配置

修改 `hosts/jetbrains-plugin/build.gradle.kts`，在现有 `intellijPlatform` 配置中补充签名与发布配置：

```kotlin
intellijPlatform {
    signing {
        certificateChain = providers.environmentVariable("JETBRAINS_CERTIFICATE_CHAIN")
        privateKey = providers.environmentVariable("JETBRAINS_PRIVATE_KEY")
        password = providers.environmentVariable("JETBRAINS_PRIVATE_KEY_PASSWORD")
    }

    publishing {
        token = providers.environmentVariable("JETBRAINS_MARKETPLACE_TOKEN")
    }
}
```

保留现有依赖：

```kotlin
pluginVerifier()
zipSigner()
```

## GitHub Secrets

需要在仓库 Actions secrets 中配置：

```text
JETBRAINS_MARKETPLACE_TOKEN
JETBRAINS_CERTIFICATE_CHAIN
JETBRAINS_PRIVATE_KEY
JETBRAINS_PRIVATE_KEY_PASSWORD
```

这些 secret 只注入 `publish-jetbrains-marketplace` job，不注入普通构建 job。

## 失败策略

`publish-jetbrains-marketplace` 不设置 `continue-on-error`。以下任一情况都会使整个 workflow 失败：

- 指定 artifact 下载失败。
- 解压失败。
- 找不到 Windows x64、macOS ARM64 或 Linux x64 二进制。
- `buildPlugin` 失败。
- `signPlugin` 失败。
- `publishPlugin` 失败。
- Marketplace token 或签名证书配置错误。

## VSCode Marketplace 预留

这次不实现 VSCode 插件市场发布。后续可按相同模式新增：

```yaml
publish-vscode-marketplace:
  needs: [preflight, build-vscode]
```

该 job 可下载选定 `.vsix` matrix artifact，使用同一 release 版本，并调用 `vsce publish` 或 OpenVSX 发布命令。失败策略与 JetBrains Marketplace 保持一致。

## 非目标

- 不新增单独的 JetBrains Marketplace workflow。
- 不改变 GitHub Release 现有 5 平台 JetBrains zip 附件策略。
- 不在 Marketplace 发布 job 中重新编译 opencode 后端二进制。
- 不在本次实现 VSCode Marketplace 发布。
- 不改动本地 `hosts/scripts/build_jetbrains.sh` 构建脚本，除非实现阶段发现必须复用或抽取公共逻辑。

## 验收标准

- `release.yml` 仍能构建并上传现有 GitHub Release 产物。
- 新增 Marketplace job 能从 matrix artifact 提取三平台二进制并构建组合包。
- 组合包内只包含 Windows x64、macOS ARM64、Linux x64 三个平台二进制。
- Gradle 使用 release 输入版本去掉 `v` 前缀后的版本号。
- 插件签名和 Marketplace 发布使用 GitHub Secrets 注入。
- Marketplace 发布失败会使整个 Release workflow 失败。
