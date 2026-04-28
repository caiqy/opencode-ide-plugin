---
description: 打包 Windows 平台 VSCode 插件 (.vsix)，自动更新日期版本号
---

用一条 Bash 命令完成全部打包流程（版本号计算 → 构建二进制 → 复制 → 打包 .vsix）。
timeout 设为 600000（10 分钟）。不要加载其他 skills 和 workflow。

版本号格式：`YY.M.DDNN` — `YY` 年份后两位，`M` 月份（不补零），`DDNN` = 日期×100 + 两位构建序号（00-99）。

```bash
VERSION=$(node -e "
const fs = require('fs');
const now = new Date();
const yy = now.getFullYear() % 100, m = now.getMonth() + 1, dd = now.getDate();
const files = ['packages/opencode/webgui/package.json', 'hosts/vscode-plugin/package.json'];
const pkg = JSON.parse(fs.readFileSync(files[0], 'utf8'));
const parts = pkg.version.split('.').map(Number);
let seq = (parts[0] === yy && parts[1] === m && Math.floor(parts[2] / 100) === dd) ? (parts[2] % 100) + 1 : 0;
const ver = yy + '.' + m + '.' + (dd * 100 + seq);
files.forEach(f => fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/\"version\":\s*\"[^\"]+\"/, '\"version\": \"' + ver + '\"')));
console.log(ver);
") && echo "==> Version: $VERSION" && \
cd packages/opencode && bun run build -- --single && cd ../.. && \
cp packages/opencode/dist/opencode-windows-x64/bin/opencode.exe hosts/vscode-plugin/resources/bin/windows/amd64/opencode.exe && \
cd hosts/vscode-plugin && rm -f *.vsix && \
npx -y @vscode/vsce package --no-dependencies --allow-missing-repository --out "opencode-vscode-win-amd64-$VERSION.vsix" && \
echo "=== Build Complete ===" && echo "File: opencode-vscode-win-amd64-$VERSION.vsix" && ls -lh "opencode-vscode-win-amd64-$VERSION.vsix"
```

运行后显示 .vsix 文件名、大小、版本号，提示安装方式：`Ctrl+Shift+P → Extensions: Install from VSIX...`
