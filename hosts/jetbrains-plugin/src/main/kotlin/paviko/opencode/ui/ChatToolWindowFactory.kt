package paviko.opencode.ui


import com.intellij.ide.plugins.PluginManagerCore
import com.intellij.ide.plugins.PluginUtil
import com.intellij.openapi.diagnostic.Logger

import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.jcef.JBCefApp
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.util.concurrency.AppExecutorUtil
import com.intellij.util.ui.JBUI
import paviko.opencode.backendprocess.BackendLauncher
import paviko.opencode.backendprocess.TerminalBackendProcess
import java.awt.BorderLayout
import java.awt.Font
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URI
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import javax.swing.*

internal fun webGuiUrlWithCacheBuster(url: String, version: String, cache: String): String {
    val sep = if (url.contains("?")) "&" else "?"
    return buildString {
        append(url)
        append(sep)
        append("v=")
        append(URLEncoder.encode(version, StandardCharsets.UTF_8))
        append("&cache=")
        append(URLEncoder.encode(cache, StandardCharsets.UTF_8))
    }
}

class ChatToolWindowFactory : ToolWindowFactory, DumbAware {
    private var connectionInfo: ConnInfo? = null
    private val logger = Logger.getInstance(ChatToolWindowFactory::class.java)
    private val maxLogChars = 200_000

    private fun pluginVersion(): String {
        return javaClass.`package`?.implementationVersion ?: java.time.LocalDate.now().toString()
    }

    private fun isBackendReady(appUrl: String): Boolean {
        return try {
            val conn = URI(appUrl).toURL().openConnection() as HttpURLConnection
            conn.requestMethod = "GET"
            conn.connectTimeout = 1_000
            conn.readTimeout = 1_000
            conn.instanceFollowRedirects = false
            val code = conn.responseCode
            conn.disconnect()
            code in 200..399
        } catch (_: Exception) {
            false
        }
    }

    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val mainPanel = JPanel(BorderLayout())
        val content = toolWindow.contentManager.factory.createContent(mainPanel, "", false)
        toolWindow.contentManager.addContent(content)

        if (!JBCefApp.isSupported()) {
            val notSupported = JPanel(BorderLayout()).apply {
                add(JLabel("JCEF not supported on this platform"), BorderLayout.CENTER)
            }
            mainPanel.add(notSupported, BorderLayout.CENTER)
            return
        }

        val logArea = JTextArea().apply {
            font = Font(Font.MONOSPACED, Font.PLAIN, 12)
            isEditable = false
            lineWrap = true
            wrapStyleWord = true
        }
        val logScroll = JScrollPane(logArea)

        // Create backend logs panel but keep it detached until an error needs diagnostics.
        val logsPanel = JPanel(BorderLayout()).apply {
            border = JBUI.Borders.empty(4)
            add(JLabel("Backend logs (merged stdout/stderr)"), BorderLayout.NORTH)
            add(logScroll, BorderLayout.CENTER)
        }
        val logsVisibility = BackendLogsVisibilityController(mainPanel, logsPanel)

        // Placeholder center until browser loads
        mainPanel.add(JPanel(BorderLayout()).apply {
            add(JLabel("Starting backend..."), BorderLayout.CENTER)
        }, BorderLayout.CENTER)

        val procRef = AtomicReference<paviko.opencode.backendprocess.BackendProcess?>(null)
        val connected = AtomicBoolean(false)
        val logLock = Any()
        val logBuffer = StringBuilder()
        val logFlushScheduled = AtomicBoolean(false)

        fun scheduleLogFlush() {
            if (!logFlushScheduled.compareAndSet(false, true)) return
            SwingUtilities.invokeLater {
                val chunk = synchronized(logLock) {
                    val s = logBuffer.toString()
                    logBuffer.setLength(0)
                    s
                }
                logArea.append(chunk)
                try {
                    val doc = logArea.document
                    val overflow = doc.length - maxLogChars
                    if (overflow > 0) doc.remove(0, overflow)
                } catch (_: Throwable) {}

                logFlushScheduled.set(false)

                // If new logs arrived while we were flushing, schedule again.
                val hasMore = synchronized(logLock) { logBuffer.isNotEmpty() }
                if (hasMore) scheduleLogFlush()
            }
        }

        fun queueLog(line: String) {
            synchronized(logLock) {
                logBuffer.append(line).append('\n')
            }
            scheduleLogFlush()
        }

        val timeoutMs = 300_000L
        val timeoutFuture = AppExecutorUtil.getAppScheduledExecutorService().schedule({
            if (connected.get()) return@schedule
            logger.warn("Backend connection timeout after ${timeoutMs}ms")
            SwingUtilities.invokeLater {
                BackendLogsErrorView.show(mainPanel, logsVisibility, "Backend connection timeout.<br/>Check logs for details.")
            }
            try { procRef.get()?.destroy() } catch (_: Throwable) {}
            try { procRef.get()?.inputStream?.close() } catch (_: Throwable) {}
        }, timeoutMs, TimeUnit.MILLISECONDS)

        fun connectToBackend(appUrl: String) {
            val serverUri = URI(appUrl)
            val port = if (serverUri.port != -1) serverUri.port else when (serverUri.scheme?.lowercase()) {
                "https" -> 443
                else -> 80
            }
            val normalizedAppUrl = appUrl.trimEnd('/')
            if (!connected.compareAndSet(false, true)) return

            procRef.get()?.stopCapture()
            connectionInfo = ConnInfo(port, normalizedAppUrl)
            timeoutFuture.cancel(false)
            logger.info("Backend connection established at $normalizedAppUrl")

            SwingUtilities.invokeLater {
                try {
                    val client = JBCefApp.getInstance().createClient()

                    val browser = JBCefBrowser.createBuilder()
                        .setClient(client)
                        .build()

                    try {
                        DragAndDropInstaller.install(project, browser, logger)
                    } catch (e: Exception) {
                        logger.warn("Failed to set up drag and drop", e)
                    }

                    mainPanel.removeAll()
                    mainPanel.add(browser.component, BorderLayout.CENTER)
                    mainPanel.revalidate()
                    mainPanel.repaint()

                    val session = IdeBridge.createSession(project)
                    val baseUrl = webGuiUrlWithCacheBuster(
                        normalizedAppUrl,
                        pluginVersion(),
                        System.currentTimeMillis().toString(),
                    )
                    val urlWithBridge = buildString {
                        append(baseUrl)
                        append(if ('?' in baseUrl) '&' else '?')
                        append("ideBridge=")
                        append(URLEncoder.encode(session.baseUrl, StandardCharsets.UTF_8))
                        append("&ideBridgeToken=")
                        append(URLEncoder.encode(session.token, StandardCharsets.UTF_8))
                        append("&jcefScrollMultiplier=4")
                    }

                    browser.loadURL(urlWithBridge)

                    Disposer.register(toolWindow.disposable) {
                        IdeBridge.removeSession(session.sessionId)
                    }

                    try {
                        val filesUpdater = IdeOpenFilesUpdater(project, browser, session.sessionId)
                        filesUpdater.install()
                        Disposer.register(browser, filesUpdater)
                    } catch (e: Exception) {
                        logger.warn("Failed to install IdeOpenFilesUpdater", e)
                    }
                } catch (e: Exception) {
                    logger.error("Failed to create browser component", e)
                    BackendLogsErrorView.show(mainPanel, logsVisibility, "Failed to create browser:<br/>${e.message}")
                }
            }
        }

        Disposer.register(toolWindow.disposable) {
            timeoutFuture.cancel(false)
            try { procRef.get()?.destroy() } catch (_: Throwable) {}
            try { procRef.get()?.inputStream?.close() } catch (_: Throwable) {}
        }

        AppExecutorUtil.getAppExecutorService().execute {
            val proc = try {
                BackendLauncher.launchBackend(project)
            } catch (e: Exception) {
                logger.error("Failed to launch backend", e)
                SwingUtilities.invokeLater {
                    BackendLogsErrorView.show(mainPanel, logsVisibility, "Failed to start backend:<br/>${e.message}<br/><br/>Check logs for details.")
                }
                timeoutFuture.cancel(false)
                return@execute
            }
            procRef.set(proc)

            (proc as? TerminalBackendProcess)?.command?.let { command ->
                AppExecutorUtil.getAppExecutorService().execute {
                    while (!connected.get() && !Thread.currentThread().isInterrupted) {
                        if (isBackendReady(command.appUrl)) {
                            queueLog("opencode server listening on ${command.baseUrl}")
                            connectToBackend(command.appUrl)
                            return@execute
                        }
                        try {
                            Thread.sleep(500)
                        } catch (_: InterruptedException) {
                            Thread.currentThread().interrupt()
                        }
                    }
                }
            }

            val reader = BufferedReader(InputStreamReader(proc.inputStream, StandardCharsets.UTF_8))
            val logThread = Thread {
                try {
                    var line: String?
                    while (reader.readLine().also { line = it } != null) {
                        val l = line!!.trim()
                        queueLog(l)

                        if (!connected.get()) {
                            val serverMatch = Regex("opencode server listening on (https?://\\S+)", RegexOption.IGNORE_CASE).find(l)
                            if (serverMatch != null) {
                                val serverUrlRaw = serverMatch.groupValues[1]
                                try {
                                    val baseUrl = URI(serverUrlRaw).toString().trimEnd('/')
                                    connectToBackend("$baseUrl/app")
                                } catch (e: Exception) {
                                    logger.warn("Failed to set up browser for backend connection", e)
                                }
                            }
                        }
                    }
                } catch (e: Exception) {
                    logger.error("Error reading backend output", e)
                    SwingUtilities.invokeLater {
                        BackendLogsErrorView.show(mainPanel, logsVisibility, "Backend communication error:<br/>${e.message}")
                    }
                } finally {
                    try { reader.close() } catch (_: Throwable) {}
                }
            }
            logThread.isDaemon = true
            logThread.start()
        }
    }
}
