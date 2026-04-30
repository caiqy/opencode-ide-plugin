---
description: 打包 Windows 平台 VSCode 插件 (.vsix)，自动更新日期版本号
---

快速执行：不要重新探索仓库；直接运行下面这条 PowerShell 命令。timeout 设为 600000（10 分钟）。

版本号格式：`YY.M.DDNN` — `YY` 年份后两位，`M` 月份（不补零），`DDNN` = 日期×100 + 两位构建序号（00-99）。

```powershell
$ErrorActionPreference = 'Stop'; $version = node -e "const fs=require('fs'); const files=['packages/opencode/webgui/package.json','hosts/vscode-plugin/package.json']; const now=new Date(); const yy=now.getFullYear()%100,m=now.getMonth()+1,dd=now.getDate(); const pkg=JSON.parse(fs.readFileSync(files[0],'utf8')); const parts=pkg.version.split('.').map(Number); const seq=(parts[0]===yy&&parts[1]===m&&Math.floor(parts[2]/100)===dd)?(parts[2]%100)+1:0; const ver=yy+'.'+m+'.'+(dd*100+seq); for (const f of files) fs.writeFileSync(f, fs.readFileSync(f,'utf8').replace(/\"version\":\s*\"[^\"]+\"/, '\"version\": \"'+ver+'\"')); console.log(ver)"; Write-Host "==> Version: $version"; Push-Location 'packages/opencode'; bun 'script/build.ts' --single; Pop-Location; Copy-Item -LiteralPath 'packages/opencode/dist/opencode-windows-x64/bin/opencode.exe' -Destination 'hosts/vscode-plugin/resources/bin/windows/amd64/opencode.exe' -Force; Push-Location 'hosts/vscode-plugin'; Remove-Item -Force '*.vsix' -ErrorAction SilentlyContinue; npx -y @vscode/vsce package --no-dependencies --allow-missing-repository --out "opencode-vscode-win-amd64-$version.vsix"; Pop-Location; $vsix="hosts/vscode-plugin/opencode-vscode-win-amd64-$version.vsix"; if (!(Test-Path -LiteralPath $vsix)) { throw "Missing VSIX: $vsix" }; Add-Type -AssemblyName System.IO.Compression.FileSystem; $zip=[System.IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $vsix)); try { if (!$zip.GetEntry('extension/package.json')) { throw 'Missing extension/package.json' }; if (!$zip.GetEntry('extension/resources/bin/windows/amd64/opencode.exe')) { throw 'Missing bundled opencode.exe' }; Get-Item -LiteralPath $vsix | Select-Object FullName,Length,LastWriteTime } finally { $zip.Dispose() }
```

完成后只汇报版本、VSIX 路径、文件大小和安装方式：`Ctrl+Shift+P → Extensions: Install from VSIX...`
