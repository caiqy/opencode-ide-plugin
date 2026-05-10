# 通用版本规则

仓库内使用的版本号格式为：`YY.M.DDNN`

## 规则

- `YY`：年份后两位
- `M`：月份，不补零
- `DDNN`：日期 × 100 + 当天构建序号
- 同一天重复发布或打包时，只递增最后两位序号（`00`、`01`、`02` ...）
- 跨天后必须切换到新的日期段，并把当天构建序号重置为 `00`

## 例子

- `26.5.100`：2026 年 5 月 1 日当天第 0 次
- `26.5.101`：2026 年 5 月 1 日当天第 1 次
- `26.5.303`：2026 年 5 月 3 日当天第 3 次
- `26.5.400`：2026 年 5 月 4 日当天第 0 次
- `26.5.401`：2026 年 5 月 4 日当天第 1 次
- `26.5.700`：2026 年 5 月 7 日当天第 0 次（JetBrains Marketplace 截图中曾显示的当前最新版）
- `26.5.1000`：2026 年 5 月 10 日当天第 0 次；日期为两位数时第三段自然变成四位数

## 额外说明

- 版本号不会跨天连续累加最后两位；例如 `26.5.303` 的下一天首个版本应为 `26.5.400`，而不是 `26.5.304`
- 判断“最新版”时必须先按当前日期计算第三段，不要沿用 `hosts/jetbrains-plugin/build.gradle.kts` 中可能过期的 fallback 版本号。
- 本地打包 JetBrains/IDEA 插件时优先通过 Gradle 属性注入版本：`./gradlew.bat buildPlugin "-Pplugin.version=<按日期计算的版本号>" --no-daemon --console=plain`，避免把旧 fallback（例如 `26.2.15`）打进包里。
- 所有 `gradlew.bat` 相关命令都遵守通用 Gradle 命令规则：尽量追加 `--no-daemon --console=plain`；在 PowerShell 中 `-Pplugin.version=...` 必须加引号；如遇 daemon 卡住或 Windows 文件锁，先执行 `./gradlew.bat --stop` 再重试。详见 `memory/context/gradle.md`。

当前已知会使用这套规则的场景包括 VSCode 插件、JetBrains/IDEA 插件和正式 release tag；默认把它视为本仓库的通用版本规则，而不是 VSIX 特有规则。
