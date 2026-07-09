# VSCode Marketplace Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保留现有 GitHub Release 五平台 VSCode `.vsix` 产物的前提下，为 `.github/workflows/release.yml` 增加 Visual Studio Marketplace 自动发布能力，并让 Marketplace 发布失败时直接使整个 workflow 失败。

**Architecture:** 继续把 `build-vscode` 作为唯一的 VSCode 平台构建入口；新增一个与 `publish-jetbrains-marketplace` 并列的 `publish-vscode-marketplace` job，只下载 `build-vscode` 已上传的五个平台 `.vsix` artifact，先做 secret / 版本 / 包内容校验，再按 `preflight.outputs.prerelease` 决定是否附加 `--pre-release`，最后逐个调用 `vsce publish --packagePath` 发布。`release` job 保持原职责不变，仍然只负责 GitHub Release 资产汇总与上传。

**Tech Stack:** GitHub Actions YAML、Bash、Node.js 20、`@vscode/vsce`、Python 3 标准库 `json` / `re` / `zipfile`

---

## 文件结构

- Modify: `.github/workflows/release.yml`
  - 新增 `publish-vscode-marketplace` job
  - 仅在该 job 注入 `VSCE_PAT`
  - 下载 `vscode-*` artifacts 并校验五个平台 `.vsix`
  - 验证 repo manifest 身份、VSIX 内版本、平台二进制路径、Marketplace semver 兼容性
  - 按 prerelease 语义逐个执行 `vsce publish --packagePath`
  - 保持 `release` job 与 `build-vscode` / `build-jetbrains` 现有职责不变

---

### Task 1: 为 `release.yml` 新增 VSCode Marketplace 发布 job 骨架与输入校验

**Files:**

- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: 先写失败的 workflow 结构断言，锁定新 job 的骨架与校验入口**

在仓库根目录准备并执行下面这条断言命令；它要求 `release.yml` 已存在 `publish-vscode-marketplace` job、`needs: [preflight, build-vscode]`、`VSCE_PAT` secret 注入、`vscode-*` artifact 下载，以及 `Verify VSCode Marketplace publish inputs` 步骤。当前文件还没有这个 job，预期失败。

```bash
node -e "const fs=require('fs'); const text=fs.readFileSync('.github/workflows/release.yml','utf8'); const checks=[['job',/^\s{2}publish-vscode-marketplace:/m],['needs',/needs:\s*\[preflight,\s*build-vscode\]/m],['secret',/VSCE_PAT:\s*\$\{\{\s*secrets\.VSCE_PAT\s*\}\}/m],['artifact download',/pattern:\s*vscode-\*/m],['verify step',/name:\s*Verify VSCode Marketplace publish inputs/m]]; for (const [label,re] of checks) { if (!re.test(text)) throw new Error('missing '+label); } console.log('vscode marketplace workflow shape ok')"
```

- [ ] **Step 2: 运行断言命令，确认当前确实失败**

Run（仓库根目录）:

```bash
node -e "const fs=require('fs'); const text=fs.readFileSync('.github/workflows/release.yml','utf8'); const checks=[['job',/^\s{2}publish-vscode-marketplace:/m],['needs',/needs:\s*\[preflight,\s*build-vscode\]/m],['secret',/VSCE_PAT:\s*\$\{\{\s*secrets\.VSCE_PAT\s*\}\}/m],['artifact download',/pattern:\s*vscode-\*/m],['verify step',/name:\s*Verify VSCode Marketplace publish inputs/m]]; for (const [label,re] of checks) { if (!re.test(text)) throw new Error('missing '+label); } console.log('vscode marketplace workflow shape ok')"
```

Expected:

```text
Error: missing job
```

- [ ] **Step 3: 在 `publish-jetbrains-marketplace` 前插入完整的 VSCode Marketplace job 骨架与包校验步骤**

把下面这个 job 加到 `.github/workflows/release.yml` 中，位置放在 `publish-jetbrains-marketplace` 之前；同时把注释编号顺延为：`# 4. Publish VSCode Marketplace`、`# 5. Publish JetBrains Marketplace`、`# 6. Collect all artifacts...`、`# 7. Post-release artifact verification`。

```yml
# ---------------------------------------------------------------------------
# 4.  Publish VSCode Marketplace packages from existing VSIX artifacts
# ---------------------------------------------------------------------------
publish-vscode-marketplace:
  needs: [preflight, build-vscode]
  runs-on: ubuntu-latest
  permissions:
    contents: read
  env:
    VSCE_PAT: ${{ secrets.VSCE_PAT }}
    VSCODE_VERSION: ${{ needs.preflight.outputs.vscode_version }}
    VSCODE_PRERELEASE: ${{ needs.preflight.outputs.prerelease }}
  steps:
    - name: Checkout
      uses: actions/checkout@v4

    - name: Set up Node.js
      uses: actions/setup-node@v4
      with:
        node-version: "20"

    - name: Install vsce
      run: npm install -g @vscode/vsce

    - name: Assert VSCode Marketplace secret is present
      run: |
        test -n "$VSCE_PAT" || { echo "::error::VSCE_PAT is required"; exit 1; }

    - name: Download VSCode artifacts
      uses: actions/download-artifact@v4
      with:
        pattern: vscode-*
        path: vscode-marketplace-artifacts
        merge-multiple: true

    - name: Verify VSCode Marketplace publish inputs
      run: |
        python <<'PY'
        import json
        import os
        import re
        import zipfile
        from pathlib import Path

        version = os.environ["VSCODE_VERSION"]
        if not re.fullmatch(r"\d+\.\d+\.\d+", version):
            raise SystemExit(f"VSCode Marketplace version must be major.minor.patch, got {version}")

        repo_pkg = json.loads(Path("hosts/vscode-plugin/package.json").read_text(encoding="utf-8"))
        if repo_pkg.get("publisher") != "caiqy":
            raise SystemExit(f"Unexpected publisher in hosts/vscode-plugin/package.json: {repo_pkg.get('publisher')}")
        if repo_pkg.get("name") != "opencode-ui":
            raise SystemExit(f"Unexpected extension name in hosts/vscode-plugin/package.json: {repo_pkg.get('name')}")

        expected = {
            "opencode-win32-x64.vsix": "resources/bin/windows/amd64/opencode.exe",
            "opencode-darwin-x64.vsix": "resources/bin/macos/amd64/opencode",
            "opencode-darwin-arm64.vsix": "resources/bin/macos/arm64/opencode",
            "opencode-linux-x64.vsix": "resources/bin/linux/amd64/opencode",
            "opencode-linux-arm64.vsix": "resources/bin/linux/arm64/opencode",
        }

        root = Path("vscode-marketplace-artifacts")
        actual = {path.name for path in root.glob("*.vsix")}
        if actual != set(expected):
            raise SystemExit(f"Expected VSIX files {sorted(expected)}, got {sorted(actual)}")

        for name, binary in expected.items():
            with zipfile.ZipFile(root / name) as archive:
                pkg = json.loads(archive.read("extension/package.json"))
                if pkg.get("publisher") != "caiqy":
                    raise SystemExit(f"{name} has unexpected publisher {pkg.get('publisher')}")
                if pkg.get("name") != "opencode-ui":
                    raise SystemExit(f"{name} has unexpected extension name {pkg.get('name')}")
                if pkg.get("version") != version:
                    raise SystemExit(f"{name} has version {pkg.get('version')} but expected {version}")

                entries = {
                    item.removeprefix("extension/")
                    for item in archive.namelist()
                    if item.startswith("extension/resources/bin/") and not item.endswith("/")
                }
                if entries != {binary}:
                    raise SystemExit(f"{name} should contain only {binary}, got {sorted(entries)}")

        print("vscode marketplace publish inputs ok")
        PY
```

要求：

- 不修改 `build-vscode` 的 matrix、artifact 名或打包逻辑
- 不给这个 job 注入 `OPENVSX_TOKEN`
- 不改 `release` job 的 `needs: [preflight, build-vscode, build-jetbrains]`

- [ ] **Step 4: 重跑 workflow 结构断言，确认新 job 骨架和校验步骤已接好**

Run（仓库根目录）:

```bash
node -e "const fs=require('fs'); const text=fs.readFileSync('.github/workflows/release.yml','utf8'); const checks=[['job',/^\s{2}publish-vscode-marketplace:/m],['needs',/needs:\s*\[preflight,\s*build-vscode\]/m],['secret',/VSCE_PAT:\s*\$\{\{\s*secrets\.VSCE_PAT\s*\}\}/m],['artifact download',/pattern:\s*vscode-\*/m],['verify step',/name:\s*Verify VSCode Marketplace publish inputs/m]]; for (const [label,re] of checks) { if (!re.test(text)) throw new Error('missing '+label); } console.log('vscode marketplace workflow shape ok')"
```

Expected:

```text
vscode marketplace workflow shape ok
```

- [ ] **Step 5: 单独跑一次校验脚本语法 smoke，确认 Python 校验块能在本地解释执行**

先在仓库根目录放入这条本地 smoke 命令；它不依赖 GitHub Actions，只复用你刚写进 workflow 的 Python 校验逻辑，对仓库里现有的单个 Windows VSIX 做一次最小语法验证。预期通过并输出 `local vscode marketplace validator syntax ok`。

```bash
python <<'PY'
import json
import re
import zipfile
from pathlib import Path

version = "26.5.100"
assert re.fullmatch(r"\d+\.\d+\.\d+", version)

repo_pkg = json.loads(Path("hosts/vscode-plugin/package.json").read_text(encoding="utf-8"))
assert repo_pkg["publisher"] == "caiqy"
assert repo_pkg["name"] == "opencode-ui"

archive = Path("hosts/vscode-plugin/opencode-vscode-win-amd64-26.5.100.vsix")
assert archive.is_file()

with zipfile.ZipFile(archive) as z:
    pkg = json.loads(z.read("extension/package.json"))
    assert pkg["publisher"] == "caiqy"
    assert pkg["name"] == "opencode-ui"
    assert pkg["version"] == version
    entries = {
        name.removeprefix("extension/")
        for name in z.namelist()
        if name.startswith("extension/resources/bin/") and not name.endswith("/")
    }
    assert entries == {"resources/bin/windows/amd64/opencode.exe"}

print("local vscode marketplace validator syntax ok")
PY
```

Expected:

```text
local vscode marketplace validator syntax ok
```

- [ ] **Step 6: 提交 workflow 骨架这一小步**

```bash
git add .github/workflows/release.yml
git commit -m "ci(release): add vscode marketplace job"
```

---

### Task 2: 增加 prerelease 分流与五平台 `vsce publish` 循环

**Files:**

- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: 先写失败的发布行为断言，锁定 prerelease 与 `--packagePath` 发布方式**

在仓库根目录准备并执行下面这条断言命令；它要求 workflow 已存在 `Publish VSCode Marketplace packages` 步骤、`VSCODE_PRERELEASE` 环境变量分流、五个固定 `.vsix` 路径，以及 `vsce publish ... --packagePath` 发布方式。当前骨架里还没有发布步骤，预期失败。

```bash
node -e "const fs=require('fs'); const text=fs.readFileSync('.github/workflows/release.yml','utf8'); const checks=[['publish step',/name:\s*Publish VSCode Marketplace packages/m],['prerelease env',/VSCODE_PRERELEASE:\s*\$\{\{\s*needs\.preflight\.outputs\.prerelease\s*\}\}/m],['pre-release flag',/prerelease_args\+\=\(--pre-release\)/m],['win32 package',/opencode-win32-x64\.vsix/m],['darwin x64 package',/opencode-darwin-x64\.vsix/m],['darwin arm64 package',/opencode-darwin-arm64\.vsix/m],['linux x64 package',/opencode-linux-x64\.vsix/m],['linux arm64 package',/opencode-linux-arm64\.vsix/m],['packagePath publish',/vsce publish \"\$\{prerelease_args\[@\]\}\" --packagePath \"\$vsix\"/m]]; for (const [label,re] of checks) { if (!re.test(text)) throw new Error('missing '+label); } console.log('vscode marketplace publish loop ok')"
```

- [ ] **Step 2: 运行断言命令，确认当前确实失败**

Run（仓库根目录）:

```bash
node -e "const fs=require('fs'); const text=fs.readFileSync('.github/workflows/release.yml','utf8'); const checks=[['publish step',/name:\s*Publish VSCode Marketplace packages/m],['prerelease env',/VSCODE_PRERELEASE:\s*\$\{\{\s*needs\.preflight\.outputs\.prerelease\s*\}\}/m],['pre-release flag',/prerelease_args\+\=\(--pre-release\)/m],['win32 package',/opencode-win32-x64\.vsix/m],['darwin x64 package',/opencode-darwin-x64\.vsix/m],['darwin arm64 package',/opencode-darwin-arm64\.vsix/m],['linux x64 package',/opencode-linux-x64\.vsix/m],['linux arm64 package',/opencode-linux-arm64\.vsix/m],['packagePath publish',/vsce publish \"\$\{prerelease_args\[@\]\}\" --packagePath \"\$vsix\"/m]]; for (const [label,re] of checks) { if (!re.test(text)) throw new Error('missing '+label); } console.log('vscode marketplace publish loop ok')"
```

Expected:

```text
Error: missing publish step
```

- [ ] **Step 3: 在 VSCode Marketplace job 后半段追加 prerelease 分流与五平台发布循环**

把下面这个步骤追加到 `Verify VSCode Marketplace publish inputs` 之后：

```yml
- name: Publish VSCode Marketplace packages
  run: |
    prerelease_args=()
    if [ "$VSCODE_PRERELEASE" = "true" ]; then
      prerelease_args+=(--pre-release)
    fi

    for vsix in \
      vscode-marketplace-artifacts/opencode-win32-x64.vsix \
      vscode-marketplace-artifacts/opencode-darwin-x64.vsix \
      vscode-marketplace-artifacts/opencode-darwin-arm64.vsix \
      vscode-marketplace-artifacts/opencode-linux-x64.vsix \
      vscode-marketplace-artifacts/opencode-linux-arm64.vsix
    do
      echo "Publishing $(basename "$vsix")"
      vsce publish "${prerelease_args[@]}" --packagePath "$vsix"
    done
```

要求：

- 不使用 `ovsx`
- 不重新执行 `vsce package`
- 不在 workflow 内修改 `hosts/vscode-plugin/package.json`
- 不把五个平台折叠为一个通用包

- [ ] **Step 4: 重跑发布行为断言，确认 prerelease 分流与五平台循环已存在**

Run（仓库根目录）:

```bash
node -e "const fs=require('fs'); const text=fs.readFileSync('.github/workflows/release.yml','utf8'); const checks=[['publish step',/name:\s*Publish VSCode Marketplace packages/m],['prerelease env',/VSCODE_PRERELEASE:\s*\$\{\{\s*needs\.preflight\.outputs\.prerelease\s*\}\}/m],['pre-release flag',/prerelease_args\+\=\(--pre-release\)/m],['win32 package',/opencode-win32-x64\.vsix/m],['darwin x64 package',/opencode-darwin-x64\.vsix/m],['darwin arm64 package',/opencode-darwin-arm64\.vsix/m],['linux x64 package',/opencode-linux-x64\.vsix/m],['linux arm64 package',/opencode-linux-arm64\.vsix/m],['packagePath publish',/vsce publish \"\$\{prerelease_args\[@\]\}\" --packagePath \"\$vsix\"/m]]; for (const [label,re] of checks) { if (!re.test(text)) throw new Error('missing '+label); } console.log('vscode marketplace publish loop ok')"
```

Expected:

```text
vscode marketplace publish loop ok
```

- [ ] **Step 5: 在本地跑一次 shell 数组 smoke，确认 prerelease 开关会生成正确命令行**

Run（仓库根目录）:

```bash
bash -lc 'for flag in true false; do prerelease_args=(); if [ "$flag" = "true" ]; then prerelease_args+=(--pre-release); fi; printf "%s -> " "$flag"; printf "vsce publish "; printf "%s " "${prerelease_args[@]}"; printf "--packagePath %s\n" "vscode-marketplace-artifacts/opencode-win32-x64.vsix"; done'
```

Expected:

```text
true -> vsce publish --pre-release --packagePath vscode-marketplace-artifacts/opencode-win32-x64.vsix
false -> vsce publish --packagePath vscode-marketplace-artifacts/opencode-win32-x64.vsix
```

- [ ] **Step 6: 提交发布循环这一小步**

```bash
git add .github/workflows/release.yml
git commit -m "ci(release): publish vscode marketplace packages"
```

---

### Task 3: 做 release workflow 回归校验并准备真实发版验证

**Files:**

- Test: `.github/workflows/release.yml`

- [ ] **Step 1: 运行完整 workflow 断言，确认没有破坏现有 release / artifact 逻辑**

Run（仓库根目录）:

```bash
node -e "const fs=require('fs'); const text=fs.readFileSync('.github/workflows/release.yml','utf8'); const checks=[['publish vscode job',/^\s{2}publish-vscode-marketplace:/m],['publish jetbrains job',/^\s{2}publish-jetbrains-marketplace:/m],['release needs unchanged',/^\s{2}release:\n\s{4}needs: \[preflight, build-vscode, build-jetbrains\]/m],['vscode secret',/VSCE_PAT:\s*\$\{\{\s*secrets\.VSCE_PAT\s*\}\}/m],['vsce install',/name:\s*Install vsce/m],['verify inputs',/vscode marketplace publish inputs ok/m],['publish loop',/name:\s*Publish VSCode Marketplace packages/m],['package publish',/vsce publish \"\$\{prerelease_args\[@\]\}\" --packagePath \"\$vsix\"/m],['test artifacts still present',/^\s{2}test-artifacts:/m],['release rename still present',/opencode-vscode-\$\{target\}-\$\{VERSION\}\.vsix/m]]; for (const [label,re] of checks) { if (!re.test(text)) throw new Error('missing '+label); } console.log('release workflow regression checklist ok')"
```

Expected:

```text
release workflow regression checklist ok
```

- [ ] **Step 2: 再跑一遍本地 VSIX 内容 smoke，确认现有平台包结构仍符合“单平台单二进制”假设**

Run（仓库根目录）:

```bash
python <<'PY'
import json
import zipfile
from pathlib import Path

archive = Path("hosts/vscode-plugin/opencode-vscode-win-amd64-26.5.100.vsix")
assert archive.is_file()

with zipfile.ZipFile(archive) as z:
    pkg = json.loads(z.read("extension/package.json"))
    assert pkg["publisher"] == "caiqy"
    assert pkg["name"] == "opencode-ui"
    binaries = {
        name.removeprefix("extension/")
        for name in z.namelist()
        if name.startswith("extension/resources/bin/") and not name.endswith("/")
    }
    assert binaries == {"resources/bin/windows/amd64/opencode.exe"}

print("existing platform-specific VSIX layout ok")
PY
```

Expected:

```text
existing platform-specific VSIX layout ok
```

- [ ] **Step 3: 在用户明确授权远端验证后，用正式版 tag 验证 Marketplace 正式发布链路**

```bash
git tag v26.5.303
git push origin v26.5.303
```

Expected:

```text
GitHub Actions 启动 release.yml，出现 publish-vscode-marketplace job，并在 Actions 页面显示 success
```

- [ ] **Step 4: 在用户明确授权远端验证后，再用 prerelease tag 验证 `--pre-release` 分流**

```bash
git tag v26.5.303-rc.1
git push origin v26.5.303-rc.1
```

Expected:

```text
GitHub Actions 启动 release.yml，publish-vscode-marketplace 成功，Marketplace 记录为 pre-release 版本
```
