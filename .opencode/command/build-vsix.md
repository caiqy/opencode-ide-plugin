---
description: 打包 Windows 平台 VSCode 插件 (.vsix)，自动更新日期版本号
---

快速执行：不要重新探索仓库；在 OpenCode 的 `bash`/PowerShell 工具环境里必须拆成“两步”：先用 PowerShell 原生逻辑更新并校验版本号，再执行构建与打包。timeout 设为 600000（10 分钟）。

版本号格式：`YY.M.DDNN` — `YY` 年份后两位，`M` 月份（不补零），`DDNN` = 日期×100 + 两位构建序号（00-99）。跨天后必须切换到新的日期段，并把当天构建序号重置为 `00`。

版本号只由 `bun run release:version` 计算，不要手写，也不要用 `node -e` one-liner。

## 第一步：更新并校验版本号

```powershell
bun run release:version --write
```

`script/release-version.ts` 按 `YY.M.DDNN` 更新 `packages/opencode/webgui/package.json`、`hosts/vscode-plugin/package.json` 和 `bun.lock`，并校验日期段等于今天（Asia/Shanghai）。校验失败必须停止，不得继续打包。

## 第二步：构建、打包并校验 VSIX

```powershell
$ErrorActionPreference = 'Stop'; $version = (Get-Content -Raw -LiteralPath 'hosts/vscode-plugin/package.json' | ConvertFrom-Json).version; $webguiVersion = (Get-Content -Raw -LiteralPath 'packages/opencode/webgui/package.json' | ConvertFrom-Json).version; if ([string]::IsNullOrWhiteSpace($version)) { throw 'Package version is empty; run the version update step first' }; if ($version -ne $webguiVersion) { throw "Version mismatch: vscode=$version webgui=$webguiVersion" }; $now = Get-Date; $yy = $now.Year % 100; $m = $now.Month; $dd = $now.Day; $parts = @($version -split '\.' | ForEach-Object { [int]$_ }); if ($parts.Length -ne 3 -or $parts[0] -ne $yy -or $parts[1] -ne $m -or [math]::Floor($parts[2] / 100) -ne $dd) { throw "Version $version does not match today's version rule; rerun the version update step" }; Push-Location 'packages/opencode'; bun 'script/build.ts' --single; Pop-Location; Copy-Item -LiteralPath 'packages/opencode/dist/opencode-windows-x64/bin/opencode.exe' -Destination 'hosts/vscode-plugin/resources/bin/windows/amd64/opencode.exe' -Force; Push-Location 'hosts/vscode-plugin'; Remove-Item -Force '*.vsix' -ErrorAction SilentlyContinue; npx -y @vscode/vsce package --no-dependencies --allow-missing-repository --out "opencode-vscode-win-amd64-$version.vsix"; Pop-Location; $vsix = "hosts/vscode-plugin/opencode-vscode-win-amd64-$version.vsix"; if (!(Test-Path -LiteralPath $vsix)) { throw "Missing VSIX: $vsix" }; Add-Type -AssemblyName System.IO.Compression.FileSystem; $zip = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $vsix)); try { $packageEntry = $zip.GetEntry('extension/package.json'); if (!$packageEntry) { throw 'Missing extension/package.json' }; if (!$zip.GetEntry('extension/resources/bin/windows/amd64/opencode.exe')) { throw 'Missing bundled opencode.exe' }; $reader = New-Object System.IO.StreamReader($packageEntry.Open()); try { $manifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }; if ($manifest.version -ne $version) { throw "VSIX manifest version $($manifest.version) does not match expected $version" }; Get-Item -LiteralPath $vsix | Select-Object FullName,Length,LastWriteTime } finally { $zip.Dispose() }
```

完成后只汇报版本、VSIX 路径、文件大小和安装方式：`Ctrl+Shift+P → Extensions: Install from VSIX...`
