# Glossary

本文件用于记录仓库协作中的术语、缩写、别名和项目代号。当前仅提供模板，具体内容后续按需补充。

## Acronyms / 缩写

| Term | Meaning | Context |
| ---- | ------- | ------- |
|      |         |         |

## Internal Terms / 内部术语

| Term                         | Meaning                                                                                                                                                                                                                                                    | Context                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| build-vsix                   | Windows 版 VSCode 插件 `.vsix` 快速打包流程                                                                                                                                                                                                                | 见 `memory/context/vscode-packaging.md`                               |
| 打包下一个版本               | 按 `.opencode/command/build-vsix.md` 的两步流程打包 Windows VSIX：先按版本规则更新并校验版本号（非空、两个 package 一致、日期段等于今天），再构建与打包；不要使用 `node -e` one-liner，也不能沿用旧 package 版本继续打包                                   | 见 `memory/context/vscode-packaging.md`                               |
| 执行 gradlew.bat 命令        | Windows/PowerShell 中所有 `gradlew.bat` 命令默认追加 `--no-daemon --console=plain`，包括编译、测试、验证、打包；如遇 daemon 卡住或文件锁，先 `./gradlew.bat --stop`；`-P...=...` 参数要加引号                                                              | 见 `memory/context/gradle.md`                                         |
| 打包最新版 Windows IDEA 插件 | 按版本规则用当前日期计算版本号，并通过 `./gradlew.bat buildPlugin "-Pplugin.version=<版本号>" --no-daemon --console=plain` 打包 JetBrains/IDEA Windows 测试包；不要使用 `build.gradle.kts` 里可能过期的 fallback 版本；同时遵守通用 `gradlew.bat` 命令规则 | 见 `memory/context/versioning.md` 与 `memory/context/gradle.md`       |
| 发布下一个版本               | 直接执行基于 tag 的正式发版流程：提交本次实现、推送分支、按版本规则创建并推送下一个 `v` 标签、跟进 `release.yml` 结果                                                                                                                                      | 见 `memory/context/release-publishing.md`                             |
| 版本规则                     | `YY.M.DDNN`：`YY`=年份后两位，`M`=月份不补零，`DDNN`=日期×100 + 当天序号；跨天后日期部分必须更新，当天序号重置为 `00`                                                                                                                                      | 仓库通用版本规则，见 `memory/context/versioning.md`                   |
| Speckit 文档语言             | 后续新增或更新 Spec Kit 相关文档时，模板骨架标题可保留官方英文；项目特定正文、需求、计划、任务、检查项和验证说明使用简体中文；技术专有名词、命令、文件路径、标识符和协议名按原文保留                                                                       | 见 `.specify/memory/constitution.md` 的 Documentation Language Policy |
| 启动长驻服务命令             | 不要用可能卡住当前工具终端的方式启动长驻服务（例如直接 `bun ... serve/web` 或不可靠的 `Start-Process` 包装）；需要验证本地服务时优先复用已运行进程，或使用仓库既有后台/tmux/明确可停止的方式，并先说明与记录 PID/停止方式                                  | 用户明确指出“这个启动方式会卡住终端，下次别犯”                        |
|                              |                                                                                                                                                                                                                                                            |                                                                       |

## Nicknames / 别名

| Nickname | Full Name / Meaning | Context |
| -------- | ------------------- | ------- |
|          |                     |         |

## Project Codenames / 项目代号

| Codename | Project | Context |
| -------- | ------- | ------- |
|          |         |         |
