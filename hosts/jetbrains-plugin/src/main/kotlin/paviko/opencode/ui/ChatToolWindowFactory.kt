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
import java.awt.BorderLayout
import java.awt.Font
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.URI
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import javax.swing.*

class ChatToolWindowFactory : ToolWindowFactory, DumbAware {
    private var connectionInfo: ConnInfo? = null
    private val logger = Logger.getInstance(ChatToolWindowFactory::class.java)
    private val maxLogChars = 200_000

    private fun showError(mainPanel: JPanel, hideableLogs: JComponent, message: String) {
        mainPanel.removeAll()
        mainPanel.add(JPanel(BorderLayout()).apply {
            add(JLabel("<html><center>$message</center></html>"), BorderLayout.CENTER)
        }, BorderLayout.CENTER)
        mainPanel.add(hideableLogs, BorderLayout.SOUTH)
        mainPanel.revalidate()
        mainPanel.repaint()
    }

    private fun pluginVersion(): String {
        return javaClass.`package`?.implementationVersion ?: java.time.LocalDate.now().toString()
    }

    private fun withCacheBuster(url: String, version: String): String {
        val encodedVersion = URLEncoder.encode(version, StandardCharsets.UTF_8)
        val sep = if (url.contains("?")) "&" else "?"
        return if (url.contains("v=")) url else "${url}${sep}v=${encodedVersion}"
    }

    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        // vertical=true => top/bottom split; top takes 100% initially (logs collapsed)
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

        // Create collapsible logs panel (collapsed by default)
        val logsPanel = JPanel(BorderLayout()).apply {
            border = JBUI.Borders.empty(4)
            add(logScroll, BorderLayout.CENTER)
        }
        val hideableLogs = com.intellij.ui.HideableTitledPanel("Backend logs (merged stdout/stderr)", false)
        hideableLogs.setContentComponent(logsPanel)

        // Placeholder center until browser loads
        mainPanel.add(JPanel(BorderLayout()).apply {
            add(JLabel("Starting backend..."), BorderLayout.CENTER)
        }, BorderLayout.CENTER)
        // Add collapsible logs at the bottom
        mainPanel.add(hideableLogs, BorderLayout.SOUTH)

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
                showError(mainPanel, hideableLogs, "Backend connection timeout.<br/>Check logs for details.")
            }
            try { procRef.get()?.destroy() } catch (_: Throwable) {}
            try { procRef.get()?.inputStream?.close() } catch (_: Throwable) {}
        }, timeoutMs, TimeUnit.MILLISECONDS)

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
                    showError(mainPanel, hideableLogs, "Failed to start backend:<br/>${e.message}<br/><br/>Check logs for details.")
                }
                timeoutFuture.cancel(false)
                return@execute
            }
            procRef.set(proc)

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
                                    val serverUri = URI(serverUrlRaw)
                                    val port = if (serverUri.port != -1) serverUri.port else when (serverUri.scheme?.lowercase()) {
                                        "https" -> 443
                                        else -> 80
                                    }
                                    val baseUrl = serverUri.toString().trimEnd('/')
                                    val appUrl = "$baseUrl/app"

                                    proc.stopCapture()
                                    connectionInfo = ConnInfo(port, appUrl)
                                    connected.set(true)
                                    timeoutFuture.cancel(false)
                                    logger.info("Backend connection established at $appUrl")

                                    SwingUtilities.invokeLater {
                                        try {
                                            val client = JBCefApp.getInstance().createClient()
                                            
                                            // Create browser WITHOUT URL first
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
                                            mainPanel.add(hideableLogs, BorderLayout.SOUTH)
                                            mainPanel.revalidate()
                                            mainPanel.repaint()

                                            // Create bridge session and build URL with bridge params
                                            val session = IdeBridge.createSession(project)
                                            val baseUrl = withCacheBuster(appUrl, pluginVersion())
                                            val urlWithBridge = buildString {
                                                append(baseUrl)
                                                append(if ('?' in baseUrl) '&' else '?')
                                                append("ideBridge=")
                                                append(URLEncoder.encode(session.baseUrl, StandardCharsets.UTF_8))
                                                append("&ideBridgeToken=")
                                                append(URLEncoder.encode(session.token, StandardCharsets.UTF_8))
                                            }
                                            
                                            // Load the URL with bridge params
                                            browser.loadURL(urlWithBridge)
                                            
                                            // Register cleanup for the session
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
                                            showError(mainPanel, hideableLogs, "Failed to create browser:<br/>${e.message}")
                                        }
                                    }
                                } catch (e: Exception) {
                                    logger.warn("Failed to set up browser for backend connection", e)
                                }
                            }
                        }
                    }
                } catch (e: Exception) {
                    logger.error("Error reading backend output", e)
                    SwingUtilities.invokeLater {
                        showError(mainPanel, hideableLogs, "Backend communication error:<br/>${e.message}")
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
