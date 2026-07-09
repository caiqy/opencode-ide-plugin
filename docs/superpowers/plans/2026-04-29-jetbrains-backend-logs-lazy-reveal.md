# JetBrains Backend Logs Lazy Reveal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 JetBrains 插件在正常启动时完全不显示后端日志面板，只在启动失败或运行期错误时自动显示并保留该面板。

**Architecture:** 先把“按需显示日志面板”的行为抽成一个仅依赖 Swing 的小型控制器，并用 JUnit 5 覆盖“默认隐藏、仅插入一次、错误后可重新挂载”这几个核心状态。然后在 `ChatToolWindowFactory` 中接入该控制器，统一所有错误路径的日志显示逻辑，同时保持现有 backend 启动、terminal 输出捕获、`server listening on ...` 解析链路完全不变。

**Tech Stack:** Kotlin 1.9、Swing/JCEF、IntelliJ Platform Gradle Plugin、JUnit 5

---

### Task 1: 提取并测试日志面板懒显示控制器

**Files:**

- Create: `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/BackendLogsVisibilityController.kt`
- Create: `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/BackendLogsVisibilityControllerTest.kt`

- [ ] **Step 1: 先写失败测试，锁定“默认隐藏 / 只挂载一次 / removeAll 后可重新挂载”行为**

```kotlin
package paviko.opencode.ui

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.awt.BorderLayout
import javax.swing.JLabel
import javax.swing.JPanel

class BackendLogsVisibilityControllerTest {
    @Test
    fun `初始状态不挂载日志面板`() {
        val mainPanel = JPanel(BorderLayout())
        val logsPanel = JPanel()

        val controller = BackendLogsVisibilityController(mainPanel, logsPanel)

        assertFalse(controller.wasRevealed())
        assertEquals(0, mainPanel.componentCount)
        assertEquals(null, logsPanel.parent)
    }

    @Test
    fun `首次 reveal 时把日志面板挂到底部且只挂一次`() {
        val mainPanel = JPanel(BorderLayout())
        val logsPanel = JPanel()

        val controller = BackendLogsVisibilityController(mainPanel, logsPanel)

        controller.reveal()
        controller.reveal()

        assertTrue(controller.wasRevealed())
        assertEquals(1, mainPanel.componentCount)
        assertSame(mainPanel, logsPanel.parent)
    }

    @Test
    fun `error 布局 removeAll 后再次 reveal 会重新挂载日志面板`() {
        val mainPanel = JPanel(BorderLayout())
        val logsPanel = JPanel()
        val controller = BackendLogsVisibilityController(mainPanel, logsPanel)

        controller.reveal()
        mainPanel.removeAll()
        mainPanel.add(JLabel("Backend connection timeout"), BorderLayout.CENTER)

        controller.reveal()

        assertTrue(controller.wasRevealed())
        assertEquals(2, mainPanel.componentCount)
        assertSame(mainPanel, logsPanel.parent)
    }
}
```

- [ ] **Step 2: 运行测试，确认当前因控制器尚不存在而失败**

Run（PowerShell, `hosts/jetbrains-plugin/` 目录）:

```powershell
.\gradlew unitTest --tests "paviko.opencode.ui.BackendLogsVisibilityControllerTest"
```

Expected:

```text
> Task :compileTestKotlin FAILED
e: ... BackendLogsVisibilityControllerTest.kt: Unresolved reference: BackendLogsVisibilityController
```

- [ ] **Step 3: 编写最小实现，只负责“按需挂载并记录是否曾显示”**

```kotlin
package paviko.opencode.ui

import java.awt.BorderLayout
import javax.swing.JComponent
import javax.swing.JPanel

internal class BackendLogsVisibilityController(
    private val mainPanel: JPanel,
    private val logsPanel: JComponent,
) {
    private var revealed = false

    fun reveal() {
        if (logsPanel.parent !== mainPanel) {
            mainPanel.add(logsPanel, BorderLayout.SOUTH)
            mainPanel.revalidate()
            mainPanel.repaint()
        }

        revealed = true
    }

    fun wasRevealed(): Boolean = revealed
}
```

- [ ] **Step 4: 重新运行测试，确认控制器行为通过**

Run（PowerShell, `hosts/jetbrains-plugin/` 目录）:

```powershell
.\gradlew unitTest --tests "paviko.opencode.ui.BackendLogsVisibilityControllerTest"
```

Expected:

```text
BUILD SUCCESSFUL
```

- [ ] **Step 5: 提交这一小步**

```bash
git add hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/BackendLogsVisibilityController.kt hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/BackendLogsVisibilityControllerTest.kt
git commit -m "test: cover jetbrains lazy backend logs visibility"
```

### Task 2: 在 ChatToolWindowFactory 中接入懒显示控制器

**Files:**

- Modify: `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/ChatToolWindowFactory.kt`
- Reuse: `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/BackendLogsVisibilityController.kt`
- Re-run: `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/BackendLogsVisibilityControllerTest.kt`

- [ ] **Step 1: 先定位要替换的 4 个挂载点，避免实现时漏掉成功路径或错误路径**

需要改的点只有这几类：

```text
1. showError(...) 当前直接 add(hideableLogs, BorderLayout.SOUTH)
2. 初始化阶段当前直接 add(hideableLogs, BorderLayout.SOUTH)
3. browser 成功加载时当前再次 add(hideableLogs, BorderLayout.SOUTH)
4. timeout / launch failure / browser creation failure / backend read failure 都要统一走 reveal
```

Expected: 你能明确“成功路径永远不 add 日志面板，错误路径统一 reveal”。

- [ ] **Step 2: 先改出一个失败态，删除初始/成功路径直接挂载，让编译错误提醒你补齐新依赖**

把 `ChatToolWindowFactory.kt` 先改成下面这个中间态（此时还没补完整 `showError` 签名和调用，会编译失败，这是预期的）：

```kotlin
val hideableLogs = com.intellij.ui.HideableTitledPanel("Backend logs (merged stdout/stderr)", false)
hideableLogs.setContentComponent(logsPanel)
val logsVisibility = BackendLogsVisibilityController(mainPanel, hideableLogs)

mainPanel.add(JPanel(BorderLayout()).apply {
    add(JLabel("Starting backend..."), BorderLayout.CENTER)
}, BorderLayout.CENTER)

// 删除这一行：mainPanel.add(hideableLogs, BorderLayout.SOUTH)

// browser 成功后只保留：
mainPanel.removeAll()
mainPanel.add(browser.component, BorderLayout.CENTER)
mainPanel.revalidate()
mainPanel.repaint()
```

Run（PowerShell, `hosts/jetbrains-plugin/` 目录）:

```powershell
.\gradlew unitTest --tests "paviko.opencode.ui.BackendLogsVisibilityControllerTest"
```

Expected:

```text
> Task :compileKotlin FAILED
e: ... type mismatch / no value passed for parameter logsVisibility
```

- [ ] **Step 3: 补齐 `showError` 和所有错误分支，使错误时才 reveal 日志面板**

把 `ChatToolWindowFactory.kt` 收敛到下面这个目标形态：

```kotlin
private fun showError(
    mainPanel: JPanel,
    logsVisibility: BackendLogsVisibilityController,
    message: String,
) {
    mainPanel.removeAll()
    mainPanel.add(JPanel(BorderLayout()).apply {
        add(JLabel("<html><center>$message</center></html>"), BorderLayout.CENTER)
    }, BorderLayout.CENTER)
    logsVisibility.reveal()
    mainPanel.revalidate()
    mainPanel.repaint()
}

override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
    val mainPanel = JPanel(BorderLayout())
    val content = toolWindow.contentManager.factory.createContent(mainPanel, "", false)
    toolWindow.contentManager.addContent(content)

    // ... logArea / logScroll / logsPanel 保持不变

    val hideableLogs = com.intellij.ui.HideableTitledPanel("Backend logs (merged stdout/stderr)", false)
    hideableLogs.setContentComponent(logsPanel)
    val logsVisibility = BackendLogsVisibilityController(mainPanel, hideableLogs)

    mainPanel.add(JPanel(BorderLayout()).apply {
        add(JLabel("Starting backend..."), BorderLayout.CENTER)
    }, BorderLayout.CENTER)

    // 不再在初始化阶段 add(hideableLogs, BorderLayout.SOUTH)

    val timeoutFuture = AppExecutorUtil.getAppScheduledExecutorService().schedule({
        if (connected.get()) return@schedule
        logger.warn("Backend connection timeout after ${'$'}{timeoutMs}ms")
        SwingUtilities.invokeLater {
            showError(mainPanel, logsVisibility, "Backend connection timeout.<br/>Check logs for details.")
        }
        try { procRef.get()?.destroy() } catch (_: Throwable) {}
        try { procRef.get()?.inputStream?.close() } catch (_: Throwable) {}
    }, timeoutMs, TimeUnit.MILLISECONDS)

    // launch failure
    showError(mainPanel, logsVisibility, "Failed to start backend:<br/>${'$'}{e.message}<br/><br/>Check logs for details.")

    // browser success
    mainPanel.removeAll()
    mainPanel.add(browser.component, BorderLayout.CENTER)
    mainPanel.revalidate()
    mainPanel.repaint()

    // browser creation failure
    showError(mainPanel, logsVisibility, "Failed to create browser:<br/>${'$'}{e.message}")

    // backend read failure
    showError(mainPanel, logsVisibility, "Backend communication error:<br/>${'$'}{e.message}")
}
```

实现时坚持这 3 条约束：

```text
1. 不改 queueLog / scheduleLogFlush / Regex("opencode server listening on ...")
2. 不改 BackendLauncher、TerminalBackendProcess、RunningTerminalBackendProcess、TerminalOutputCapture
3. 成功路径绝不 add(hideableLogs, BorderLayout.SOUTH)
```

- [ ] **Step 4: 运行回归测试，确认 JetBrains 现有测试 + 新增测试通过**

Run（PowerShell, `hosts/jetbrains-plugin/` 目录）:

```powershell
.\gradlew unitTest --tests "paviko.opencode.ui.BackendLogsVisibilityControllerTest" --tests "paviko.opencode.ui.BackendLogsErrorViewTest" --tests "paviko.opencode.ui.IdeBridgeStorageScopeTest" --tests "paviko.opencode.ui.IdeBridgeRestartHostTest"
```

Expected:

```text
BUILD SUCCESSFUL
```

- [ ] **Step 5: 提交接线改动**

```bash
git add hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/ChatToolWindowFactory.kt hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/BackendLogsVisibilityController.kt hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/BackendLogsVisibilityControllerTest.kt hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/BackendLogsErrorViewTest.kt
git commit -m "fix: reveal jetbrains backend logs only on error"
```

### Task 3: 做手动回归，确认正常路径彻底看不到日志区

**Files:**

- Verify: `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/ChatToolWindowFactory.kt`
- Verify: `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/backendprocess/BackendLauncher.kt`
- Reference: `docs/superpowers/specs/2026-04-29-jetbrains-backend-logs-lazy-reveal-design.md`

- [ ] **Step 1: 重新运行 JetBrains 插件测试任务，确认没有遗漏编译或运行时问题**

Run（PowerShell, `hosts/jetbrains-plugin/` 目录）:

```powershell
.\gradlew test
```

Expected:

```text
BUILD SUCCESSFUL
```

- [ ] **Step 2: 手动验证正常启动路径完全不显示日志标题栏**

手动检查流程：

```text
1. 在 IDE 中启动 JetBrains 插件开发实例
2. 打开 OpenCode 工具窗口
3. 观察初始态只显示 “Starting backend...”
4. 等待 backend 成功连接并加载 web UI
5. 确认界面底部完全没有 “Backend logs (merged stdout/stderr)” 标题栏
```

Expected:

```text
正常启动后，工具窗口只剩 web UI；日志区完全不可见。
```

- [ ] **Step 3: 手动制造失败，确认错误时自动显示并保留日志区**

推荐的最小失败注入方式：在插件设置里临时把 custom command 改成一个无效参数，例如：

```text
--definitely-invalid-flag
```

然后执行：

```text
1. 重新打开 OpenCode 工具窗口
2. 等待 backend 启动失败或连接超时
3. 确认中心区出现错误文案
4. 确认底部出现 “Backend logs (merged stdout/stderr)” 面板
5. 展开面板，确认能看到失败日志
6. 再触发一次错误刷新，确认日志面板仍保留且没有重复插入
```

Expected:

```text
错误发生后日志区自动出现，并在当前窗口生命周期内持续可见。
```

- [ ] **Step 4: 恢复设置并做一次最终 smoke check**

```text
1. 清空无效 custom command
2. 再次打开 OpenCode 工具窗口
3. 确认正常启动恢复
4. 确认日志面板再次回到“默认不可见”状态
```

Expected:

```text
恢复后成功路径与错误路径都符合 spec，没有残留 UI 异常。
```

- [ ] **Step 5: 确认手动验证后没有遗留未提交改动**

```bash
git status --short
```

Expected:

```text
(no output)
```
