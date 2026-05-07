# JetBrains Marketplace API Verifier Warnings 记录

**日期：** 2026-05-07  
**插件版本：** `26.5.700`  
**Marketplace 页面：** `https://plugins.jetbrains.com/plugin/31609-opencode-ui-unofficial-/edit/versions/stable/1041170`  
**兼容范围：** `243.0 — 261.*`  
**Verifier：** `IntelliJ Plugin Verifier 1.403`

## 背景

JetBrains Marketplace 的版本详情页显示当前 JetBrains 插件在兼容性验证中存在 internal API 与 deprecated API 使用。页面总体判定仍为 `Compatible`，但这些 API 使用可能影响 Marketplace 审核、未来 IDE 版本兼容性，以及后续插件维护成本。

## Marketplace 验证结果

### IntelliJ IDEA 2026.1.2 rc `(261.24374.66)`

验证时间：`07 May 2026 02:14`

结论：

```text
Compatible. 2 usages of deprecated API. 5 usages of internal API
```

具体问题：

#### Internal API usages `(5)`

- `MarketplaceRequests`：2 次
- `MarketplaceRequests.Companion`：1 次
- `MarketplaceRequests.Companion` 字段：1 次
- `MarketplaceRequests.Companion.getInstance()`：1 次

#### Deprecated API usages `(2)`

- `HideableTitledPanel`：1 次
- `TerminalToolWindowManager.createShellWidget(...)`：1 次

其中 `TerminalToolWindowManager.createShellWidget(...)` 的完整签名为：

```text
org.jetbrains.plugins.terminal.TerminalToolWindowManager.createShellWidget(
  java.lang.String workingDirectory,
  java.lang.String tabName,
  boolean requestFocus,
  boolean deferSessionStartUntilUiShown
) : com.intellij.terminal.ui.TerminalWidget
```

### IntelliJ IDEA 2025.3.5

验证时间：`07 May 2026 02:17`

结论：

```text
Compatible. 1 usage of deprecated API. 5 usages of internal API
```

已展开信息显示 internal API 仍是 Marketplace 相关 API；deprecated API 为 `HideableTitledPanel`。

### IntelliJ IDEA 2025.2.6.2 / 2025.1.7.1 / 2024.3.7.1

页面折叠行显示：

```text
Compatible. 1 usage of deprecated API. 5 usages of internal API
```

## 代码定位

### 1. `MarketplaceRequests` internal API

文件：

```text
hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/update/PluginUpdateService.kt
```

相关代码：

```kotlin
import com.intellij.ide.plugins.marketplace.MarketplaceRequests

private fun loadMarketplaceUpdate(): MarketplaceLookup {
    val requests = MarketplaceRequests.getInstance()
    // ...
}
```

后续还通过反射调用 Marketplace 相关方法：

```kotlin
getLastCompatiblePluginUpdateModel
getLastCompatiblePluginUpdate
loadLastCompatiblePluginUpdate
loadPluginDescriptor
```

根因：插件内置“检查 Marketplace 更新 + 动态安装”的逻辑直接依赖 IntelliJ Platform 的 Marketplace 内部实现。`MarketplaceRequests` 属于 internal API，不应由第三方插件直接使用。

### 2. `HideableTitledPanel` deprecated API

文件：

```text
hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/ChatToolWindowFactory.kt
```

相关代码：

```kotlin
val hideableLogs = com.intellij.ui.HideableTitledPanel("Backend logs (merged stdout/stderr)", false)
hideableLogs.setContentComponent(logsPanel)
val logsVisibility = BackendLogsVisibilityController(mainPanel, hideableLogs)
```

根因：后端日志错误面板使用了已废弃的 IntelliJ UI 组件。

### 3. `TerminalToolWindowManager.createShellWidget(...)` deprecated API

文件：

```text
hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/backendprocess/BackendLauncher.kt
```

相关代码：

```kotlin
terminalManager.createShellWidget(workingDir, terminalName, false, !minimized)
```

JetBrains 2026.1 源码中的弃用说明建议使用：

```kotlin
TerminalToolWindowTabsManager.getInstance(project)
  .createTabBuilder()
  .workingDirectory(workingDirectory)
  .tabName(tabName)
  .createTab()
```

根因：插件当前通过旧 Terminal API 创建 classic terminal tab，并依赖返回的 `ShellTerminalWidget` 执行命令和复用终端。新版推荐 API 位于 `com.intellij.terminal.frontend.toolwindow.TerminalToolWindowTabsManager`，但其自身标记为 `@ApiStatus.Experimental`，迁移需要额外验证。

## 风险分析

### Internal API 风险

- 风险最高。
- JetBrains 明确说明 internal API 是私有实现，不保证二进制兼容或源码兼容。
- Marketplace Verifier 会持续标红。
- 未来 IDE 版本可能重命名、修改或移除 `MarketplaceRequests` 相关方法。

### Deprecated API 风险

- 风险中等。
- `HideableTitledPanel` 替换成本低，建议尽快清理。
- `TerminalToolWindowManager.createShellWidget(...)` 替换成本较高，因为会影响后端启动、终端 tab 复用、命令执行和隐藏逻辑。

## 建议修复方向

### 优先级 1：移除 `MarketplaceRequests` internal API

建议停止在插件内直接查询 Marketplace 更新，改为依赖 IDE 自带插件更新机制。

候选实现：

1. 对 Marketplace 渠道返回不支持内置更新：

```kotlin
UpdateInfoResult(
    supported = false,
    reason = "marketplace-only",
    currentVersion = currentVersion,
    latest = null,
    hasUpdate = false,
)
```

2. WebGUI / IDE Bridge 中展示提示：

```text
请通过 JetBrains IDE 的 Settings / Plugins / Marketplace 更新 OpenCode UI。
```

3. 删除或绕开：
   - `MarketplaceRequests`
   - `PluginDownloader`
   - Marketplace update lookup 相关反射逻辑

预期收益：清除全部 `5 usages of internal API`。

### 优先级 2：替换 `HideableTitledPanel`

建议使用普通 public Swing 组件替代：

- `JPanel(BorderLayout())`
- 顶部 `JLabel("Backend logs (merged stdout/stderr)")`
- 中间 `JScrollPane(logArea)`
- 保持 `BackendLogsVisibilityController` 只负责在出错时把日志面板加入 `BorderLayout.SOUTH`

预期收益：清除 `HideableTitledPanel` deprecated usage。

### 优先级 3：评估 Terminal API 迁移

短期建议谨慎处理，不要在未验证的情况下直接替换。

可选路线：

1. 继续保留旧 API，暂时接受 1 个 deprecated warning。
2. 新增 terminal 创建适配层：
   - 新 IDE 优先使用 `TerminalToolWindowTabsManager.createTabBuilder()`。
   - 旧 IDE fallback 到 `TerminalToolWindowManager.createShellWidget(...)`。
3. 同步改造命令执行逻辑：
   - 旧 API：继续使用 `ShellTerminalWidget.executeCommand(...)`。
   - 新 API：评估 `TerminalView.sendText(...)` 或 builder 的 `shellCommand(...)`。

注意：`TerminalToolWindowTabsManager` 当前是 `@ApiStatus.Experimental`，迁移后需要确认 Plugin Verifier 是否接受 experimental API，以及是否影响 2024.3 起的兼容范围。

## 验证建议

修复后建议至少执行：

```powershell
./gradlew unitTest
./gradlew build
./gradlew verifyPlugin
```

工作目录：

```text
hosts/jetbrains-plugin
```

如果本地 `verifyPlugin` 配置未覆盖 Marketplace 上的目标版本，需要额外在 Marketplace 上传隐藏版本或手动调度验证。

## 结论

当前最值得优先处理的是 `MarketplaceRequests` internal API，因为它占全部 internal API 告警，且属于 Marketplace 审核和未来兼容性的主要风险。`HideableTitledPanel` 是低成本清理项，可以与前者一起处理。`TerminalToolWindowManager.createShellWidget(...)` 建议单独评估迁移，避免为了清理一个 deprecated warning 引入更大的 terminal 行为回归。
