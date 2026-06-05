---
description: 打包 Windows 平台 VSCode 插件 (.vsix)，自动更新日期版本号
---

快速执行：不要重新探索仓库；在 OpenCode 的 `bash`/PowerShell 工具环境里必须拆成“两步”：先用 PowerShell 原生逻辑更新并校验版本号，再执行构建与打包。timeout 设为 600000（10 分钟）。

版本号格式：`YY.M.DDNN` — `YY` 年份后两位，`M` 月份（不补零），`DDNN` = 日期×100 + 两位构建序号（00-99）。跨天后必须切换到新的日期段，并把当天构建序号重置为 `00`。

不要使用 `node -e` one-liner 计算版本号；该形式在当前 PowerShell 工具环境里可能丢失引号，导致 `$version` 为空或沿用旧版本。若版本计算或校验失败，必须停止，不得继续打包。

## 第一步：更新并校验版本号

```powershell
$ErrorActionPreference = 'Stop'; $files = @('packages/opencode/webgui/package.json', 'hosts/vscode-plugin/package.json'); $now = Get-Date; $yy = $now.Year % 100; $m = $now.Month; $dd = $now.Day; $pkg = Get-Content -Raw -LiteralPath $files[0] | ConvertFrom-Json; $parts = @($pkg.version -split '\.' | ForEach-Object { [int]$_ }); $seq = if ($parts.Length -eq 3 -and $parts[0] -eq $yy -and $parts[1] -eq $m -and [math]::Floor($parts[2] / 100) -eq $dd) { ($parts[2] % 100) + 1 } else { 0 }; $version = "$yy.$m.$($dd * 100 + $seq)"; if ([string]::IsNullOrWhiteSpace($version)) { throw 'Version calculation produced an empty version' }; $versionParts = @($version -split '\.' | ForEach-Object { [int]$_ }); if ($versionParts.Length -ne 3 -or $versionParts[0] -ne $yy -or $versionParts[1] -ne $m -or [math]::Floor($versionParts[2] / 100) -ne $dd) { throw "Calculated version $version does not match today's date segment" }; foreach ($file in $files) { $raw = Get-Content -Raw -LiteralPath $file; $updated = $raw -replace '"version"\s*:\s*"[^"]+"', "`"version`": `"$version`""; if ($updated -eq $raw) { throw "Failed to update version in $file" }; Set-Content -LiteralPath $file -Value $updated -NoNewline }; $versions = $files | ForEach-Object { (Get-Content -Raw -LiteralPath $_ | ConvertFrom-Json).version }; if (($versions | Select-Object -Unique).Count -ne 1 -or $versions[0] -ne $version) { throw "Version mismatch after update: $($versions -join ', ')" }; Write-Host "==> Version: $version"
```

## 第二步：构建、打包并校验 VSIX

```powershell
$ErrorActionPreference = 'Stop'; $version = (Get-Content -Raw -LiteralPath 'hosts/vscode-plugin/package.json' | ConvertFrom-Json).version; $webguiVersion = (Get-Content -Raw -LiteralPath 'packages/opencode/webgui/package.json' | ConvertFrom-Json).version; if ([string]::IsNullOrWhiteSpace($version)) { throw 'Package version is empty; run the version update step first' }; if ($version -ne $webguiVersion) { throw "Version mismatch: vscode=$version webgui=$webguiVersion" }; $now = Get-Date; $yy = $now.Year % 100; $m = $now.Month; $dd = $now.Day; $parts = @($version -split '\.' | ForEach-Object { [int]$_ }); if ($parts.Length -ne 3 -or $parts[0] -ne $yy -or $parts[1] -ne $m -or [math]::Floor($parts[2] / 100) -ne $dd) { throw "Version $version does not match today's version rule; rerun the version update step" }; Push-Location 'packages/opencode'; bun 'script/build.ts' --single; Pop-Location; Copy-Item -LiteralPath 'packages/opencode/dist/opencode-windows-x64/bin/opencode.exe' -Destination 'hosts/vscode-plugin/resources/bin/windows/amd64/opencode.exe' -Force; Push-Location 'hosts/vscode-plugin'; Remove-Item -Force '*.vsix' -ErrorAction SilentlyContinue; npx -y @vscode/vsce package --no-dependencies --allow-missing-repository --out "opencode-vscode-win-amd64-$version.vsix"; Pop-Location; $vsix = "hosts/vscode-plugin/opencode-vscode-win-amd64-$version.vsix"; if (!(Test-Path -LiteralPath $vsix)) { throw "Missing VSIX: $vsix" }; Add-Type -AssemblyName System.IO.Compression.FileSystem; $zip = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $vsix)); try { $packageEntry = $zip.GetEntry('extension/package.json'); if (!$packageEntry) { throw 'Missing extension/package.json' }; if (!$zip.GetEntry('extension/resources/bin/windows/amd64/opencode.exe')) { throw 'Missing bundled opencode.exe' }; $reader = New-Object System.IO.StreamReader($packageEntry.Open()); try { $manifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }; if ($manifest.version -ne $version) { throw "VSIX manifest version $($manifest.version) does not match expected $version" }; Get-Item -LiteralPath $vsix | Select-Object FullName,Length,LastWriteTime } finally { $zip.Dispose() }
```

完成后只汇报版本、VSIX 路径、文件大小和安装方式：`Ctrl+Shift+P → Extensions: Install from VSIX...`
