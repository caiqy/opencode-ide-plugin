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
import com.intellij.ui.jcef.JBCefClient
import com.intellij.util.ui.JBUI
import paviko.opencode.backendprocess.BackendLauncher
import paviko.opencode.settings.OpenCodeSettings
import java.awt.BorderLayout
import java.awt.Font
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.URI
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import javax.swing.*

class ChatToolWindowFactory : ToolWindowFactory, DumbAware {
    private var connectionInfo: ConnInfo? = null
    private val logger = Logger.getInstance(ChatToolWindowFactory::class.java)

    private fun pluginVersion(): String {
        // Use pluginDescriptor.version without hardcoding plugin id.
        // PluginUtil ties a classloader back to the hosting plugin.
        val pluginId = PluginUtil.getPluginId(javaClass.classLoader) ?: return "dev"
        val descriptor = PluginManagerCore.getPlugin(pluginId) ?: return "dev"
        return descriptor.version
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

        val proc = try {
            BackendLauncher.launchBackend(project)
        } catch (e: Exception) {
            logger.error("Failed to launch backend", e)
            mainPanel.removeAll()
            mainPanel.add(JPanel(BorderLayout()).apply {
                add(
                    JLabel("<html><center>Failed to start backend:<br/>${e.message}<br/><br/>Check logs for details.</center></html>"),
                    BorderLayout.CENTER
                )
            }, BorderLayout.CENTER)
            mainPanel.add(hideableLogs, BorderLayout.SOUTH)
            mainPanel.revalidate()
            mainPanel.repaint()
            return
        }
        val reader = BufferedReader(InputStreamReader(proc.inputStream, StandardCharsets.UTF_8))
        val logThread = Thread {
            try {
                var line: String?
                var browserSet = false
                var connectionTimeout = System.currentTimeMillis() + 300000 // 300 second timeout

                while (reader.readLine().also { line = it } != null) {
                    val l = line!!.trim()
                    SwingUtilities.invokeLater { logArea.append(l + "\n") }

                    if (!browserSet) {
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
                                browserSet = true
                                logger.info("Backend connection established at $appUrl")

                                SwingUtilities.invokeLater {
                                    try {
                                        // Create client with JS_QUERY_POOL_SIZE for Windows IDEA 2024.3 compatibility
                                        // This allows JBCefJSQuery.create() to work after browser creation
                                        val client = JBCefApp.getInstance().createClient()
                                        try {
                                            client.setProperty(JBCefClient.Properties.JS_QUERY_POOL_SIZE, 1)
                                        } catch (_: Throwable) {}
                                        val browser = JBCefBrowser.createBuilder()
                                            .setClient(client)
                                            .setUrl(withCacheBuster(appUrl, pluginVersion()))
                                            .build()

                                        // Store browser reference for path insertion (context actions)
                                        // PathInserter.setBrowser(browser) - Removed, now stateless

                                        // Enable dropping files from the IDE onto the web UI via helper
                                        try {
                                            DragAndDropInstaller.install(project, browser, logger)
                                        } catch (e: Exception) {
                                            logger.warn("Failed to set up drag and drop", e)
                                        }
                                        
                                        // Add browser to component hierarchy - required for JBCefJSQuery in IDEA 2024.3
                                        mainPanel.removeAll()
                                        mainPanel.add(browser.component, BorderLayout.CENTER)
                                        // keep logs section at the bottom
                                        mainPanel.add(hideableLogs, BorderLayout.SOUTH)
                                        mainPanel.revalidate()
                                        mainPanel.repaint()

                                        // Install IdeBridge - uses CefLoadHandler internally to wait for browser ready
                                        IdeBridge.install(browser, project)

                                        // Push opened files and current file from IDE into the webview (@ overlay)
                                        try {
                                            val filesUpdater = IdeOpenFilesUpdater(project, browser)
                                            filesUpdater.install()
                                            Disposer.register(browser, filesUpdater)
                                        } catch (e: Exception) {
                                            logger.warn("Failed to install IdeOpenFilesUpdater", e)
                                        }

                                        // Immediate attempt to enable tooltip polyfill (redundant with load handler)
                                        try {
                                            val polyfillScriptEarly = """
                                                (function(){
                                                    try { 
                                                        document.documentElement.classList.add('tip-polyfill'); 
                                                    } catch(e){}
                                                    try { 
                                                        if (window.__setTooltipPolyfill) {
                                                            window.__setTooltipPolyfill(true);
                                                        }
                                                    } catch(e){}
                                                })();
                                            """.trimIndent()
                                            browser.cefBrowser.executeJavaScript(
                                                polyfillScriptEarly,
                                                browser.cefBrowser.url,
                                                0
                                            )
                                        } catch (e: Exception) {
                                            logger.debug(
                                                "Early tooltip polyfill injection failed (will retry on load)",
                                                e
                                            )
                                        }
                                    } catch (e: Exception) {
                                        logger.error("Failed to create browser component", e)
                                        mainPanel.removeAll()
                                        mainPanel.add(JPanel(BorderLayout()).apply {
                                            add(
                                                JLabel("<html><center>Failed to create browser:<br/>${e.message}</center></html>"),
                                                BorderLayout.CENTER
                                            )
                                        }, BorderLayout.CENTER)
                                        mainPanel.revalidate()
                                        mainPanel.repaint()
                                    }
                                }
                            } catch (e: Exception) {
                                logger.warn("Failed to set up browser for backend connection", e)
                            }
                        }
                    }

                    // Check for connection timeout
                    if (!browserSet && System.currentTimeMillis() > connectionTimeout) {
                        logger.error("Backend connection timeout after 30 seconds")
                        SwingUtilities.invokeLater {
                            mainPanel.removeAll()
                            mainPanel.add(JPanel(BorderLayout()).apply {
                                add(
                                    JLabel("<html><center>Backend connection timeout.<br/>Check logs for details.</center></html>"),
                                    BorderLayout.CENTER
                                )
                            }, BorderLayout.CENTER)
                            mainPanel.add(hideableLogs, BorderLayout.SOUTH)
                            mainPanel.revalidate()
                            mainPanel.repaint()
                        }
                        break
                    }
                }
            } catch (e: Exception) {
                logger.error("Error reading backend output", e)
                SwingUtilities.invokeLater {
                    mainPanel.removeAll()
                    mainPanel.add(JPanel(BorderLayout()).apply {
                        add(
                            JLabel("<html><center>Backend communication error:<br/>${e.message}</center></html>"),
                            BorderLayout.CENTER
                        )
                    }, BorderLayout.CENTER)
                    mainPanel.add(hideableLogs, BorderLayout.SOUTH)
                    mainPanel.revalidate()
                    mainPanel.repaint()
                }
            }
        }
        logThread.isDaemon = true
        logThread.start()

        Disposer.register(toolWindow.disposable) {
            try {
                proc.destroy()
            } catch (_: Throwable) {
            }
            // Clear browser references
            IdeBridge.remove(project)

        }
    }


}
