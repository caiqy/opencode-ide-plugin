# Gradle 命令规则

本仓库在 Windows/PowerShell 环境中执行 `gradlew.bat` 相关命令时，默认遵守以下规则。

## 通用规则

- 不只是打包，所有 `gradlew.bat` 命令都尽量加 `--no-daemon --console=plain`，包括编译、测试、验证、打包等。
- 这样可以减少命令结束后卡死、后台 Gradle daemon 占用文件锁、后续清理失败，以及交互式输出影响工具判断的问题。
- 如果出现 Gradle daemon 卡住、Windows 文件锁或构建目录无法删除，先执行 `./gradlew.bat --stop`，再重试原命令。
- 在 PowerShell 中传递 `-P...=...` Gradle 属性时要加引号，例如 `"-Pplugin.version=26.5.1000"`，否则可能被解析成错误任务名。

## 示例

```powershell
./gradlew.bat unitTest --no-daemon --console=plain
./gradlew.bat build --no-daemon --console=plain
./gradlew.bat verifyPlugin --no-daemon --console=plain
./gradlew.bat buildPlugin "-Pplugin.version=<版本号>" --no-daemon --console=plain
```
