package paviko.opencode.backendprocess

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowManager
import com.intellij.terminal.frontend.toolwindow.TerminalToolWindowTab
import com.intellij.terminal.frontend.toolwindow.TerminalToolWindowTabsManager
import com.intellij.terminal.ui.TerminalWidget
import com.intellij.ui.content.Content
import com.intellij.util.Alarm
import org.jetbrains.plugins.terminal.TerminalToolWindowManager
import paviko.opencode.settings.OpenCodeSettings
import java.io.IOException
import java.io.PipedOutputStream
import java.net.ServerSocket

/**
 * Launches the bundled backend inside the Terminal tool window using the 2026.1 tab API.
 */
object BackendLauncher {
    private val logger = Logger.getInstance(BackendLauncher::class.java)

    /**
     * Launches the backend process.
     */
    fun launchBackend(project: Project): BackendProcess {
        require(!ApplicationManager.getApplication().isDispatchThread) {
            "launchBackend must not be called from EDT - it performs heavy I/O operations"
        }
        val isWin = System.getProperty("os.name").lowercase().contains("win")
        val bin = findBundledBinary(if (isWin) "opencode.exe" else "opencode") ?: "opencode"

        val settings = OpenCodeSettings.getInstance()
        val customCommand = settings.state.customCommand.trim()
        val command = backendCommand(bin, customCommand, reserveLoopbackPort())
        logger.info("Launching backend with args: '${command.args.drop(1).joinToString(" ")}'")

        val baseDir = project.basePath ?: System.getProperty("user.dir")
        return TerminalBackendProcess(project, command.args, baseDir, customCommand, command)
    }

    internal data class BackendCommand(val args: List<String>, val baseUrl: String, val appUrl: String)

    internal fun backendCommand(bin: String, customCommand: String, port: Int): BackendCommand {
        val extraArgs = customCommand.split(" ").filter { it.isNotBlank() }
        val args = listOf(bin, "serve") + extraArgs + listOf("--hostname", "127.0.0.1", "--port", port.toString())
        val baseUrl = "http://127.0.0.1:$port"
        return BackendCommand(args, baseUrl, "$baseUrl/app")
    }

    private fun reserveLoopbackPort(): Int {
        return try {
            ServerSocket(0).use { socket ->
                socket.reuseAddress = true
                socket.localPort
            }
        } catch (e: IOException) {
            logger.warn("Failed to reserve loopback port; falling back to 4096", e)
            4096
        }
    }

    internal fun launchBackendWithTerminalCheck(
        project: Project,
        args: List<String>,
        baseDir: String,
        customCommand: String,
        outputBuffer: PipedOutputStream,
        isCancelled: () -> Boolean,
        callback: (BackendProcess?, Exception?) -> Unit,
    ) {
        waitForTerminalAvailabilityAsync(project, isCancelled) { success, isVisible ->
            if (isCancelled()) return@waitForTerminalAvailabilityAsync
            if (success) {
                doLaunchBackend(project, args, baseDir, customCommand, outputBuffer, isVisible, isCancelled, callback)
            } else {
                callback(null, RuntimeException("Terminal tool window is not available. Please ensure the Terminal plugin is installed and enabled."))
            }
        }
    }

    private fun waitForTerminalAvailabilityAsync(project: Project, isCancelled: () -> Boolean, callback: (Boolean, Boolean) -> Unit) {
        val alarm = Alarm(Alarm.ThreadToUse.SWING_THREAD, project)
        val maxAttempts = 100
        var attempts = 0

        val isVisible = ToolWindowManager.getInstance(project).getToolWindow("Terminal")?.isVisible ?: false

        fun checkAvailability() {
            if (isCancelled()) {
                logger.info("Terminal availability wait cancelled")
                alarm.cancelAllRequests()
                return
            }

            try {
                val terminalManager = TerminalToolWindowManager.getInstance(project)
                val terminalWindow: ToolWindow? = terminalManager.toolWindow
                if (terminalWindow != null && terminalWindow.isAvailable) {
                    logger.info("Terminal tool window is available after ${attempts * 100}ms")
                    callback(true, isVisible)
                    return
                }

                if (isCancelled()) return
                ToolWindowManager.getInstance(project).getToolWindow("Terminal")?.show()
                attempts++
                if (attempts >= maxAttempts) {
                    logger.warn("Terminal tool window did not become available within ${maxAttempts * 100}ms")
                    callback(false, isVisible)
                    return
                }

                alarm.addRequest({ checkAvailability() }, 100)
            } catch (e: Exception) {
                logger.warn("Error checking terminal availability: ${e.message}", e)
                callback(false, false)
            }
        }

        logger.info("Waiting for terminal tool window to become available...")
        alarm.addRequest({ checkAvailability() }, 0)
    }

    private fun doLaunchBackend(
        project: Project,
        args: List<String>,
        baseDir: String,
        customCommand: String,
        outputBuffer: PipedOutputStream,
        isVisible: Boolean,
        isCancelled: () -> Boolean,
        callback: (BackendProcess?, Exception?) -> Unit,
    ) {
        if (isCancelled()) return
        try {
            logger.info("Starting backend in minimized terminal: ${args.joinToString(" ")}")
            launchInTerminal(project, args, baseDir, outputBuffer, isVisible, true, isCancelled) { process, exception ->
                if (exception == null) {
                    callback(process, null)
                    return@launchInTerminal
                }

                if (isCancelled()) return@launchInTerminal
                if (customCommand.isEmpty()) {
                    logger.warn("Failed to launch backend with default command", exception)
                    callback(null, RuntimeException("Failed to launch backend: ${exception.message}"))
                    return@launchInTerminal
                }

                logger.warn("Failed to launch backend with custom command '$customCommand': ${exception.message}")
                logger.info("Attempting fallback to default command")
                val bin = args.first()
                val fallbackArgs = listOf(bin, "serve")
                logger.info("Starting fallback backend in minimized terminal: ${fallbackArgs.joinToString(" ")}")
                launchInTerminal(project, fallbackArgs, baseDir, outputBuffer, isVisible, true, isCancelled) { fallbackProcess, fallbackException ->
                    if (fallbackException == null) {
                        callback(fallbackProcess, null)
                    } else if (!isCancelled()) {
                        logger.warn("Fallback backend launch also failed", fallbackException)
                        callback(
                            null,
                            RuntimeException("Failed to launch backend with custom command '$customCommand' and fallback also failed: ${fallbackException.message}"),
                        )
                    }
                }
            }
        } catch (e: Exception) {
            if (!isCancelled()) callback(null, e)
        }
    }

    private data class TerminalSelection(val previous: Content?, val current: Content?)

    internal data class TerminalStartup(
        val shellCommand: List<String>,
        val requiresTypedSend: Boolean,
        val reuseExistingTab: Boolean,
    )

    internal fun terminalStartup(args: List<String>) = TerminalStartup(args, requiresTypedSend = false, reuseExistingTab = false)

    private data class TerminalTabSession(
        val tab: TerminalToolWindowTab,
        val selection: TerminalSelection,
    )

    private fun createTerminalTabSession(
        project: Project,
        workingDir: String,
        terminalName: String,
        args: List<String>,
        isVisible: Boolean,
        minimized: Boolean,
        isCancelled: () -> Boolean,
    ): TerminalTabSession {
        if (isCancelled()) throw RuntimeException("Backend launch cancelled")
        val tabsManager = TerminalToolWindowTabsManager.getInstance(project)
        val terminalToolWindow = ToolWindowManager.getInstance(project).getToolWindow("Terminal")
        val previousSelected = terminalToolWindow?.contentManager?.selectedContent

        if (isCancelled()) throw RuntimeException("Backend launch cancelled")
        val tab = tabsManager.createTabBuilder()
            .workingDirectory(workingDir)
            .shellCommand(terminalStartup(args).shellCommand)
            .tabName(terminalName)
            .requestFocus(!minimized)
            .deferSessionStartUntilUiShown(false)
            .createTab()

        if (!isVisible && minimized) {
            ApplicationManager.getApplication().invokeLater {
                if (isCancelled()) return@invokeLater
                val tw = ToolWindowManager.getInstance(project).getToolWindow("Terminal")
                if (tw != null && tw.isVisible) {
                    tw.hide(null)
                    logger.info("Terminal '$terminalName' tool window hidden - running in background")
                }
            }
        }

        return TerminalTabSession(tab, TerminalSelection(previousSelected, tab.content))
    }

    internal fun waitForTerminalWidget(
        content: Content,
        terminalName: String,
        isCancelled: () -> Boolean,
        findWidget: () -> TerminalWidget?,
        schedule: (() -> Unit, Int) -> Unit,
        callback: (TerminalWidget?, Exception?) -> Unit,
    ) {
        // Terminal tab creation can publish its Content before the backing widget is registered.
        // Poll for up to 5 seconds to cover that IDE-side async gap without blocking the EDT.
        val maxAttempts = 50
        var attempts = 0

        fun resolve() {
            if (isCancelled()) {
                callback(null, RuntimeException("Backend launch cancelled"))
                return
            }

            val widget = findWidget()
            if (widget != null) {
                callback(widget, null)
                return
            }

            attempts++
            if (attempts >= maxAttempts) {
                callback(null, UnsupportedOperationException("Cannot resolve TerminalWidget for terminal '$terminalName'"))
                return
            }

            schedule({ resolve() }, 100)
        }

        resolve()
    }

    private fun launchInTerminal(
        project: Project,
        args: List<String>,
        workingDir: String,
        outputBuffer: PipedOutputStream,
        isVisible: Boolean,
        minimized: Boolean = false,
        isCancelled: () -> Boolean,
        callback: (BackendProcess?, Exception?) -> Unit,
    ) {
        if (isCancelled()) return
        val session = createTerminalTabSession(project, workingDir, "Opencode Backend", args, isVisible, minimized, isCancelled)
        val adjustedArgs = args.toList()

        val alarm = Alarm(Alarm.ThreadToUse.SWING_THREAD, project)
        waitForTerminalWidget(
            content = session.tab.content,
            terminalName = "Opencode Backend",
            isCancelled = isCancelled,
            findWidget = { TerminalToolWindowManager.findWidgetByContent(session.tab.content) },
            schedule = { task, delay -> alarm.addRequest({ task() }, delay) },
        ) { widget, exception ->
            if (exception != null) {
                if (!isCancelled()) callback(null, exception)
                return@waitForTerminalWidget
            }

            try {
                if (isCancelled()) return@waitForTerminalWidget
                val terminalWidget = checkNotNull(widget)
                val backendProcess = RunningTerminalBackendProcess(terminalWidget, session.tab.view, adjustedArgs.joinToString(" "), outputBuffer)

                if (isCancelled()) {
                    backendProcess.destroy()
                    return@waitForTerminalWidget
                }

                try {
                    val prev = session.selection.previous
                    val curr = session.selection.current
                    if (prev != null && curr != null && prev != curr) {
                        ApplicationManager.getApplication().invokeLater {
                            if (isCancelled()) return@invokeLater
                            try {
                                val tw = ToolWindowManager.getInstance(project).getToolWindow("Terminal")
                                tw?.contentManager?.setSelectedContent(prev, true)
                                logger.info("Restored previously active terminal tab after launching backend")
                            } catch (e: Exception) {
                                logger.warn("Failed to restore previously active terminal tab: ${e.message}", e)
                            }
                        }
                    }
                } catch (e: Exception) {
                    logger.warn("Error while attempting to restore previous terminal selection: ${e.message}", e)
                }

                if (!isVisible && minimized) {
                    logger.info("Backend launched in minimized terminal without focus")
                } else {
                    logger.info("Backend launched in regular terminal")
                }

                callback(backendProcess, null)
            } catch (e: Exception) {
                if (!isCancelled()) callback(null, e)
            }
        }
    }

    private fun findBundledBinary(name: String): String? {
        val override = System.getenv("OPENCODE_BIN")
        if (!override.isNullOrBlank()) return override
        val os = System.getProperty("os.name").lowercase()
        val arch = System.getProperty("os.arch").lowercase()
        val osDir = when {
            os.contains("win") -> "windows"
            os.contains("mac") || os.contains("darwin") -> "macos"
            os.contains("nux") || os.contains("linux") -> "linux"
            else -> null
        } ?: return null
        val archDir = when {
            arch.contains("aarch64") || arch.contains("arm64") -> "arm64"
            arch.contains("64") -> "amd64"
            else -> null
        } ?: return null
        val resourcePath = "bin/$osDir/$archDir/$name"
        return paviko.opencode.util.ResourceExtractor.extractToTemp(resourcePath, name)
    }
}
