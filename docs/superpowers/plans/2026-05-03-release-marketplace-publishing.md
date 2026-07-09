# JetBrains Marketplace Release Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保留现有 GitHub Release 五平台 JetBrains zip 与 VSCode `.vsix` 产物的前提下，为 `.github/workflows/release.yml` 增加 JetBrains Marketplace 自动签名与发布能力，并只发布包含 Windows x64、macOS ARM64、Linux x64 三个平台后端二进制的 Marketplace 组合包。

**Architecture:** 继续把 `build-jetbrains` 作为唯一的 JetBrains 平台构建入口；新增一个与 `release` 并列的 `publish-jetbrains-marketplace` job，只下载三个指定 artifact，从各自插件 zip 内部的 plugin jar 中提取目标二进制，重建 `hosts/jetbrains-plugin/src/main/resources/bin` 后再执行 Gradle `buildPlugin`、`signPlugin`、`publishPlugin`。Gradle 配置负责从环境变量读取签名证书与 Marketplace token；workflow 负责 artifact 选择、版本去前缀、失败即中断 release。

**Tech Stack:** GitHub Actions YAML、Gradle IntelliJ Platform Plugin 2.2.1、Kotlin DSL (`build.gradle.kts`)、Bash、Python 3 标准库 `zipfile`

---

## 文件结构

- Modify: `.github/workflows/release.yml`
  - 新增 `publish-jetbrains-marketplace` job
  - 下载 `jetbrains-windows-x64`、`jetbrains-macos-arm64`、`jetbrains-linux-x64` 三个 artifact
  - 从 plugin zip 内部 jar 提取 `bin/.../opencode` 资源，重建 Marketplace 组合包
  - 执行 `buildPlugin` → 内容校验 → `signPlugin` / `publishPlugin`
  - 只在该 job 注入 `JETBRAINS_*` secrets

- Modify: `hosts/jetbrains-plugin/build.gradle.kts`
  - 在现有 `intellijPlatform {}` 中增加 `signing {}` 与 `publishing {}`
  - 保留现有 `pluginVerifier()`、`zipSigner()`、`pluginConfiguration {}`

---

### Task 1: 接入 JetBrains Marketplace 的 Gradle 签名与发布配置

**Files:**

- Modify: `hosts/jetbrains-plugin/build.gradle.kts`

- [ ] **Step 1: 先写失败的结构断言，锁定 Gradle 必须声明 signing / publishing 环境变量入口**

在仓库根目录准备并执行下面这条断言命令；它会要求 `build.gradle.kts` 同时包含 `JETBRAINS_CERTIFICATE_CHAIN`、`JETBRAINS_PRIVATE_KEY`、`JETBRAINS_PRIVATE_KEY_PASSWORD`、`JETBRAINS_MARKETPLACE_TOKEN`。当前文件尚未接入这些配置，预期失败。

```bash
node -e "const fs=require('fs'); const text=fs.readFileSync('hosts/jetbrains-plugin/build.gradle.kts','utf8'); if(!/signing\s*\{[\s\S]*JETBRAINS_CERTIFICATE_CHAIN[\s\S]*JETBRAINS_PRIVATE_KEY[\s\S]*JETBRAINS_PRIVATE_KEY_PASSWORD[\s\S]*\}/m.test(text)) throw new Error('missing signing configuration'); if(!/publishing\s*\{[\s\S]*JETBRAINS_MARKETPLACE_TOKEN[\s\S]*\}/m.test(text)) throw new Error('missing publishing configuration'); console.log('jetbrains marketplace gradle config ok')"
```

- [ ] **Step 2: 运行断言命令，确认当前确实失败**

Run（仓库根目录）:

```bash
node -e "const fs=require('fs'); const text=fs.readFileSync('hosts/jetbrains-plugin/build.gradle.kts','utf8'); if(!/signing\s*\{[\s\S]*JETBRAINS_CERTIFICATE_CHAIN[\s\S]*JETBRAINS_PRIVATE_KEY[\s\S]*JETBRAINS_PRIVATE_KEY_PASSWORD[\s\S]*\}/m.test(text)) throw new Error('missing signing configuration'); if(!/publishing\s*\{[\s\S]*JETBRAINS_MARKETPLACE_TOKEN[\s\S]*\}/m.test(text)) throw new Error('missing publishing configuration'); console.log('jetbrains marketplace gradle config ok')"
```

Expected:

```text
Error: missing signing configuration
```

- [ ] **Step 3: 在现有 `intellijPlatform {}` 中补上签名与发布配置，且不动已有 plugin metadata**

把 `hosts/jetbrains-plugin/build.gradle.kts` 的 `intellijPlatform {}` 块扩展成下面这个目标形态（保持 `pluginConfiguration {}` 原内容不变，只在其后追加 `signing` 与 `publishing`）：

```kotlin
intellijPlatform {
    pluginConfiguration {
        ideaVersion {
            sinceBuild.set("243")
        }
        description = providers.provider {
            val f = file("description.html")
            if (!f.isFile) {
                return@provider "在 JetBrains IDE 内运行本地 OpenCode 后端，并提供聊天式 AI 编码界面。"
            }

            val text = f.readText().trim()
            if (text.isEmpty()) {
                "在 JetBrains IDE 内运行本地 OpenCode 后端，并提供聊天式 AI 编码界面。"
            } else {
                text
            }
        }
        changeNotes = providers.provider {
            val f = file("changelog.html")
            if (!f.isFile) {
                return@provider "See CHANGELOG.md for details."
            }

            val text = f.readText().trim()
            if (text.isEmpty()) {
                "See CHANGELOG.md for details."
            } else {
                text
            }
        }
    }

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

要求：

- 不删除 `dependencies { intellijPlatform { pluginVerifier(); zipSigner() } }`
- 不修改默认版本表达式 `findProperty("plugin.version")?.toString() ?: "26.2.15"`
- 不调整 `tasks {}` 里的测试与 `patchPluginXml` 行为

- [ ] **Step 4: 重跑结构断言，确认 Gradle 配置已接好**

Run（仓库根目录）:

```bash
node -e "const fs=require('fs'); const text=fs.readFileSync('hosts/jetbrains-plugin/build.gradle.kts','utf8'); if(!/signing\s*\{[\s\S]*JETBRAINS_CERTIFICATE_CHAIN[\s\S]*JETBRAINS_PRIVATE_KEY[\s\S]*JETBRAINS_PRIVATE_KEY_PASSWORD[\s\S]*\}/m.test(text)) throw new Error('missing signing configuration'); if(!/publishing\s*\{[\s\S]*JETBRAINS_MARKETPLACE_TOKEN[\s\S]*\}/m.test(text)) throw new Error('missing publishing configuration'); console.log('jetbrains marketplace gradle config ok')"
```

Expected:

```text
jetbrains marketplace gradle config ok
```

- [ ] **Step 5: 做一次本地 Gradle smoke，确认配置解析不破坏现有 buildPlugin**

Run（`hosts/jetbrains-plugin` 目录）:

```bash
./gradlew buildPlugin -Pplugin.version=26.4.2902 -x test -x unitTest
```

Expected:

```text
BUILD SUCCESSFUL
```

- [ ] **Step 6: 提交 Gradle 配置这一小步**

```bash
git add hosts/jetbrains-plugin/build.gradle.kts
git commit -m "build(jetbrains): wire marketplace signing config"
```

---

### Task 2: 在 `release.yml` 中新增 JetBrains Marketplace 发布 job

**Files:**

- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: 先写失败的 workflow 结构断言，锁定新 job 的骨架与关键约束**

在仓库根目录准备并执行下面这条断言命令；它会要求 `release.yml` 存在 `publish-jetbrains-marketplace` job、三个指定 artifact、四个 `JETBRAINS_*` secrets，以及 `signPlugin` / `publishPlugin` 调用。当前文件还没有这个 job，预期失败。

```bash
node -e "const fs=require('fs'); const text=fs.readFileSync('.github/workflows/release.yml','utf8'); const checks=[['job',/^\s{2}publish-jetbrains-marketplace:/m],['needs',/needs:\s*\[preflight,\s*build-jetbrains\]/m],['windows artifact',/name:\s*jetbrains-windows-x64/m],['macos artifact',/name:\s*jetbrains-macos-arm64/m],['linux artifact',/name:\s*jetbrains-linux-x64/m],['marketplace token',/JETBRAINS_MARKETPLACE_TOKEN/m],['certificate chain',/JETBRAINS_CERTIFICATE_CHAIN/m],['private key',/JETBRAINS_PRIVATE_KEY/m],['private key password',/JETBRAINS_PRIVATE_KEY_PASSWORD/m],['version stripping',/CLEAN_VERSION=\"\$\{VERSION#v\}\"/m],['sign plugin',/signPlugin/m],['publish plugin',/publishPlugin/m]]; for (const [label,re] of checks) { if (!re.test(text)) throw new Error('missing '+label); } console.log('marketplace workflow job shape ok')"
```

- [ ] **Step 2: 运行断言命令，确认当前确实失败**

Run（仓库根目录）:

```bash
node -e "const fs=require('fs'); const text=fs.readFileSync('.github/workflows/release.yml','utf8'); const checks=[['job',/^\s{2}publish-jetbrains-marketplace:/m],['needs',/needs:\s*\[preflight,\s*build-jetbrains\]/m],['windows artifact',/name:\s*jetbrains-windows-x64/m],['macos artifact',/name:\s*jetbrains-macos-arm64/m],['linux artifact',/name:\s*jetbrains-linux-x64/m],['marketplace token',/JETBRAINS_MARKETPLACE_TOKEN/m],['certificate chain',/JETBRAINS_CERTIFICATE_CHAIN/m],['private key',/JETBRAINS_PRIVATE_KEY/m],['private key password',/JETBRAINS_PRIVATE_KEY_PASSWORD/m],['version stripping',/CLEAN_VERSION=\"\$\{VERSION#v\}\"/m],['sign plugin',/signPlugin/m],['publish plugin',/publishPlugin/m]]; for (const [label,re] of checks) { if (!re.test(text)) throw new Error('missing '+label); } console.log('marketplace workflow job shape ok')"
```

Expected:

```text
Error: missing job
```

- [ ] **Step 3: 新增 `publish-jetbrains-marketplace` job，并把三平台 artifact 重组为 Marketplace 组合包**

把下面这个 job 加到 `.github/workflows/release.yml` 中，位置放在 `build-jetbrains` 之后、`release` 之前：

```yml
publish-jetbrains-marketplace:
  needs: [preflight, build-jetbrains]
  runs-on: ubuntu-latest
  permissions:
    contents: read
  env:
    JETBRAINS_MARKETPLACE_TOKEN: ${{ secrets.JETBRAINS_MARKETPLACE_TOKEN }}
    JETBRAINS_CERTIFICATE_CHAIN: ${{ secrets.JETBRAINS_CERTIFICATE_CHAIN }}
    JETBRAINS_PRIVATE_KEY: ${{ secrets.JETBRAINS_PRIVATE_KEY }}
    JETBRAINS_PRIVATE_KEY_PASSWORD: ${{ secrets.JETBRAINS_PRIVATE_KEY_PASSWORD }}
  steps:
    - name: Checkout
      uses: actions/checkout@v4

    - name: Set up Java
      uses: actions/setup-java@v4
      with:
        distribution: "temurin"
        java-version: "21"

    - name: Setup Gradle
      uses: gradle/actions/setup-gradle@v4
      with:
        gradle-version: "8.7"

    - name: Assert Marketplace secrets are present
      run: |
        test -n "$JETBRAINS_MARKETPLACE_TOKEN" || { echo "::error::JETBRAINS_MARKETPLACE_TOKEN is required"; exit 1; }
        test -n "$JETBRAINS_CERTIFICATE_CHAIN" || { echo "::error::JETBRAINS_CERTIFICATE_CHAIN is required"; exit 1; }
        test -n "$JETBRAINS_PRIVATE_KEY" || { echo "::error::JETBRAINS_PRIVATE_KEY is required"; exit 1; }
        test -n "$JETBRAINS_PRIVATE_KEY_PASSWORD" || { echo "::error::JETBRAINS_PRIVATE_KEY_PASSWORD is required"; exit 1; }

    - name: Download Windows x64 artifact
      uses: actions/download-artifact@v4
      with:
        name: jetbrains-windows-x64
        path: marketplace-artifacts/windows-x64

    - name: Download macOS ARM64 artifact
      uses: actions/download-artifact@v4
      with:
        name: jetbrains-macos-arm64
        path: marketplace-artifacts/macos-arm64

    - name: Download Linux x64 artifact
      uses: actions/download-artifact@v4
      with:
        name: jetbrains-linux-x64
        path: marketplace-artifacts/linux-x64

    - name: Rebuild Marketplace binary bundle from selected plugin zips
      run: |
        python <<'PY'
        import io
        import shutil
        import zipfile
        from pathlib import Path

        artifact_root = Path("marketplace-artifacts")
        target_root = Path("hosts/jetbrains-plugin/src/main/resources/bin")
        if target_root.exists():
            shutil.rmtree(target_root)

        targets = [
            ("windows-x64", "windows", "amd64", "opencode.exe"),
            ("macos-arm64", "macos", "arm64", "opencode"),
            ("linux-x64", "linux", "amd64", "opencode"),
        ]

        for label, os_dir, arch_dir, binary in targets:
            archives = sorted((artifact_root / label).glob("*.zip"))
            if len(archives) != 1:
                raise SystemExit(f"Expected exactly one archive for {label}, found {len(archives)}")

            entry = f"bin/{os_dir}/{arch_dir}/{binary}"
            output = target_root / os_dir / arch_dir / binary
            output.parent.mkdir(parents=True, exist_ok=True)

            found = False
            with zipfile.ZipFile(archives[0]) as plugin_zip:
                for member in plugin_zip.namelist():
                    if not member.endswith(".jar"):
                        continue
                    payload = plugin_zip.read(member)
                    with zipfile.ZipFile(io.BytesIO(payload)) as jar_zip:
                        try:
                            output.write_bytes(jar_zip.read(entry))
                            found = True
                            break
                        except KeyError:
                            continue

            if not found:
                raise SystemExit(f"Missing {entry} inside {archives[0]}")
        PY

    - name: Verify Marketplace binary bundle
      run: |
        test -f hosts/jetbrains-plugin/src/main/resources/bin/windows/amd64/opencode.exe
        test -f hosts/jetbrains-plugin/src/main/resources/bin/macos/arm64/opencode
        test -f hosts/jetbrains-plugin/src/main/resources/bin/linux/amd64/opencode
        chmod +x hosts/jetbrains-plugin/src/main/resources/bin/macos/arm64/opencode
        chmod +x hosts/jetbrains-plugin/src/main/resources/bin/linux/amd64/opencode

    - name: Build Marketplace plugin package
      working-directory: hosts/jetbrains-plugin
      run: |
        VERSION="${{ needs.preflight.outputs.version }}"
        CLEAN_VERSION="${VERSION#v}"
        chmod +x gradlew
        ./gradlew clean buildPlugin \
          -Pplugin.version="$CLEAN_VERSION" \
          -x test \
          -x unitTest

    - name: Verify Marketplace package contains only 3 binaries
      run: |
        python <<'PY'
        import io
        import zipfile
        from pathlib import Path

        archives = sorted(Path("hosts/jetbrains-plugin/build/distributions").glob("*.zip"))
        if len(archives) != 1:
            raise SystemExit(f"Expected exactly one Marketplace zip, found {len(archives)}")

        expected = {
            "bin/windows/amd64/opencode.exe",
            "bin/macos/arm64/opencode",
            "bin/linux/amd64/opencode",
        }

        actual = None
        with zipfile.ZipFile(archives[0]) as plugin_zip:
            for member in plugin_zip.namelist():
                if not member.endswith(".jar"):
                    continue
                payload = plugin_zip.read(member)
                with zipfile.ZipFile(io.BytesIO(payload)) as jar_zip:
                    entries = {name for name in jar_zip.namelist() if name.startswith("bin/") and not name.endswith("/")}
                    if expected.issubset(entries):
                        actual = entries
                        break

        if actual is None:
            raise SystemExit(f"Could not find bundled binaries inside {archives[0]}")

        if actual != expected:
            raise SystemExit(f"Expected only {sorted(expected)}, got {sorted(actual)}")

        print("marketplace bundle contents ok")
        PY

    - name: Sign and publish Marketplace plugin
      working-directory: hosts/jetbrains-plugin
      run: |
        VERSION="${{ needs.preflight.outputs.version }}"
        CLEAN_VERSION="${VERSION#v}"
        chmod +x gradlew
        ./gradlew signPlugin publishPlugin \
          -Pplugin.version="$CLEAN_VERSION" \
          -x test \
          -x unitTest
```

要求：

- 不给 `publish-jetbrains-marketplace` 加 `continue-on-error`
- 不修改 `release` job 的 `needs: [preflight, build-vscode, build-jetbrains]`
- 不让 `release` job 等待 Marketplace 发布；二者并列执行
- 不在 `build-jetbrains` job 中注入 `JETBRAINS_*` secrets
- 不下载 `jetbrains-macos-x64` 与 `jetbrains-linux-arm64` artifact

- [ ] **Step 4: 重跑 workflow 结构断言，确认新 job 关键骨架已到位**

Run（仓库根目录）:

```bash
node -e "const fs=require('fs'); const text=fs.readFileSync('.github/workflows/release.yml','utf8'); const checks=[['job',/^\s{2}publish-jetbrains-marketplace:/m],['needs',/needs:\s*\[preflight,\s*build-jetbrains\]/m],['windows artifact',/name:\s*jetbrains-windows-x64/m],['macos artifact',/name:\s*jetbrains-macos-arm64/m],['linux artifact',/name:\s*jetbrains-linux-x64/m],['marketplace token',/JETBRAINS_MARKETPLACE_TOKEN/m],['certificate chain',/JETBRAINS_CERTIFICATE_CHAIN/m],['private key',/JETBRAINS_PRIVATE_KEY/m],['private key password',/JETBRAINS_PRIVATE_KEY_PASSWORD/m],['version stripping',/CLEAN_VERSION=\"\$\{VERSION#v\}\"/m],['sign plugin',/signPlugin/m],['publish plugin',/publishPlugin/m]]; for (const [label,re] of checks) { if (!re.test(text)) throw new Error('missing '+label); } console.log('marketplace workflow job shape ok')"
```

Expected:

```text
marketplace workflow job shape ok
```

- [ ] **Step 5: 做一次人工 smoke checklist，确认新 job 没越界破坏现有 release 架构**

按下面 checklist 检查 `.github/workflows/release.yml`：

```text
1. 仍存在 build-vscode、build-jetbrains、release、test-artifacts 四个既有 job
2. 新增 publish-jetbrains-marketplace，且 needs 只有 preflight 与 build-jetbrains
3. release job 的 needs 仍然是 [preflight, build-vscode, build-jetbrains]
4. publish-jetbrains-marketplace 没有 continue-on-error
5. 只有 publish-jetbrains-marketplace 引用了四个 JETBRAINS_* secrets
6. 新 job 只下载 windows-x64、macos-arm64、linux-x64 三个 JetBrains artifact
```

Expected: 以上 6 项全部满足。

- [ ] **Step 6: 提交 workflow 这一小步**

```bash
git add .github/workflows/release.yml
git commit -m "ci(release): publish jetbrains marketplace package"
```

---

### Task 3: 配置 GitHub secrets 并完成首个真实发布验证

**Files:**

- Modify: GitHub repository settings → Secrets and variables → Actions（仓库外配置，无代码文件变更）

- [ ] **Step 1: 在 GitHub Actions secrets 中创建 4 个精确名称的 secrets**

在仓库 `caiqy/opencode-ide-plugin` 的 Actions secrets 中新增以下四项，名称必须完全一致：

```text
JETBRAINS_MARKETPLACE_TOKEN
JETBRAINS_CERTIFICATE_CHAIN
JETBRAINS_PRIVATE_KEY
JETBRAINS_PRIVATE_KEY_PASSWORD
```

Expected: 四个 secrets 全部创建完成，且只供 `publish-jetbrains-marketplace` job 消费。

- [ ] **Step 2: 用批准版本触发一次真实 release，观察新 job 与既有 release job 并行执行**

Run（仓库根目录）:

```bash
git tag v26.5.300
git push origin v26.5.300
```

Expected:

```text
远端触发 Release workflow，run 中同时出现 release 与 publish-jetbrains-marketplace 两条并行分支
```

- [ ] **Step 3: 在 GitHub Actions UI 中验证失败策略与版本注入**

检查本次 `Release` workflow：

```text
1. publish-jetbrains-marketplace 在 build-jetbrains 之后启动
2. 该 job 的 Gradle 命令使用的是 26.5.300（而不是 v26.5.300）
3. 如果 secrets 缺失、artifact 缺失、buildPlugin / signPlugin / publishPlugin 失败，整个 workflow 结论为 failed
4. release job 仍照常创建 GitHub Release，不依赖 Marketplace job 完成
```

Expected: 以上 4 项全部满足。

- [ ] **Step 4: 验证 GitHub Release 与 JetBrains Marketplace 的外部可见结果**

检查两处外部结果：

```text
GitHub Release:
- 仍有 5 个 JetBrains 平台 zip：windows-x64、macos-x64、macos-arm64、linux-x64、linux-arm64

JetBrains Marketplace:
- 新版本号显示为 26.5.300
- 对应包来自自动发布，而非手工上传
- 本次 workflow 的“Verify Marketplace package contains only 3 binaries”步骤通过
```

Expected: GitHub Release 资产策略不变，Marketplace 版本成功上架。

---

## 交付后验证

实现完成后，再补一轮最终验证：

1. 运行 `./gradlew buildPlugin -Pplugin.version=26.4.2902 -x test -x unitTest`，确认 Gradle 配置未破坏本地 JetBrains 打包。
2. 重新执行两条 Node 结构断言，确认 `build.gradle.kts` 与 `release.yml` 仍保留 signing / publishing / marketplace job 关键骨架。
3. 确认 Actions 运行记录中出现 `publish-jetbrains-marketplace`，并且该 job 不使用 `continue-on-error`。
4. 确认 GitHub Release 页面仍保留 5 个 JetBrains zip。
5. 确认 Marketplace 上的版本号去掉了前导 `v`，且构建内容校验步骤日志输出 `marketplace bundle contents ok`。
