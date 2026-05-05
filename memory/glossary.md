# Glossary

本文件用于记录仓库协作中的术语、缩写、别名和项目代号。当前仅提供模板，具体内容后续按需补充。

## Acronyms / 缩写

| Term | Meaning | Context |
|------|---------|---------|
|      |         |         |

## Internal Terms / 内部术语

| Term | Meaning | Context |
|------|---------|---------|
| build-vsix | Windows 版 VSCode 插件 `.vsix` 快速打包流程 | 见 `memory/context/vscode-packaging.md` |
| 打包下一个版本 | 先更新版本号，再执行 Windows VSIX 构建与打包；不要在当前 PowerShell 工具环境中直接依赖带 `node -e` 的脆弱单行命令 | 见 `memory/context/vscode-packaging.md` |
| 发布下一个版本 | 直接执行基于 tag 的正式发版流程：提交本次实现、推送分支、按版本规则创建并推送下一个 `v` 标签、跟进 `release.yml` 结果 | 见 `memory/context/release-publishing.md` |
| 版本规则 | `YY.M.DDNN`：`YY`=年份后两位，`M`=月份不补零，`DDNN`=日期×100 + 当天序号；跨天后日期部分必须更新，当天序号重置为 `00` | 仓库通用版本规则，见 `memory/context/versioning.md` |
|      |         |         |

## Nicknames / 别名

| Nickname | Full Name / Meaning | Context |
|----------|---------------------|---------|
|          |                     |         |

## Project Codenames / 项目代号

| Codename | Project | Context |
|----------|---------|---------|
|          |         |         |
