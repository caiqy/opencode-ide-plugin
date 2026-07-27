package paviko.opencode.ui

import com.google.gson.Gson
import com.google.gson.JsonObject
import com.intellij.ide.BrowserUtil
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.editor.LogicalPosition
import com.intellij.openapi.editor.ScrollType
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.OpenFileDescriptor
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.IconLoader
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.wm.ToolWindowManager
import com.intellij.openapi.wm.WindowManager
import com.intellij.util.IconUtil
import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import paviko.opencode.update.PluginUpdateService
import paviko.opencode.update.PluginVersionSource
import paviko.opencode.update.installedPluginVersionSource
import java.awt.Frame
import java.awt.GraphicsEnvironment
import java.awt.SystemTray
import java.awt.TrayIcon
import java.awt.Toolkit
import java.awt.datatransfer.StringSelection
import java.io.File
import java.io.OutputStreamWriter
import java.net.InetSocketAddress
import java.net.URL
import java.net.URLDecoder
import java.util.*
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import javax.swing.JFileChooser
import javax.swing.SwingUtilities

data class Session(
    val id: String,
    val token: String,
    val project: Project,
    var webUiBaseUrl: String? = null,
    val sseClients: MutableSet<HttpExchange> = Collections.synchronizedSet(mutableSetOf()),
    val mem: MutableMap<String, String> = ConcurrentHashMap(),
    val storage: IdeBridgeStorageBackend = IdeBridgePropertiesStorageBackend,
    val updateService: PluginUpdateService = PluginUpdateService(),
)

data class SessionInfo(val baseUrl: String, val token: String, val sessionId: String)

object IdeBridge {
    private val LOG = Logger.getInstance(IdeBridge::class.java)
    private val gson = Gson()

    @Volatile
    internal var restartHook: () -> Unit = {
        ApplicationManager.getApplication().restart()
    }

    @Volatile
    internal var notificationHook: (Project, String, String, String, () -> Unit) -> Unit = { _, _, title, body, onClick ->
        showSystemNotification(title, body, onClick)
    }

    @Volatile
    internal var notificationClickHook: (Project, () -> Unit) -> Unit = { project, openSession ->
        ApplicationManager.getApplication().invokeLater {
            try {
                val frame = WindowManager.getInstance().getFrame(project) as? Frame
                if (frame != null) {
                    frame.extendedState = frame.extendedState and Frame.ICONIFIED.inv()
                    frame.isVisible = true
                    frame.toFront()
                    frame.requestFocus()
                }
            } catch (t: Throwable) {
                LOG.info("Failed to focus project frame", t)
            }

            try {
                ToolWindowManager.getInstance(project).getToolWindow("OpenCode")?.show()
            } catch (t: Throwable) {
                LOG.info("Failed to show OpenCode tool window", t)
            }

            try {
                executor.execute {
                    try {
                        openSession()
                    } catch (t: Throwable) {
                        LOG.info("Failed to open session from notification click", t)
                    }
                }
            } catch (t: Throwable) {
                LOG.info("Failed to open session from notification click", t)
            }
        }
    }

    @Volatile
    internal var installStartRunner: ((() -> Unit) -> Unit)? = null

    @Volatile
    internal var openPluginSettingsHook: (() -> Unit)? = null

    @Volatile
    internal var saveImageTargetHook: ((Project, String) -> File?)? = null

    @Volatile
    internal var readUrlBytesHook: ((String) -> ByteArray)? = null
    
    private var server: HttpServer? = null
    private var port: Int = 0
    private val sessions = ConcurrentHashMap<String, Session>()
    private val projectToSession = ConcurrentHashMap<Project, String>()
    private val activeTrayIcons = ConcurrentHashMap<TrayIcon, SystemTray>()
    @Volatile private var executor = Executors.newCachedThreadPool()
    private var keepaliveTimer: java.util.Timer? = null

    private val minVersion: String by lazy {
        try {
            val props = java.util.Properties()
            IdeBridge::class.java.getResourceAsStream("/opencode-build.properties")?.use { props.load(it) }
            props.getProperty("opencode.min.version", "1.1.1")
        } catch (_: Throwable) { "1.1.1" }
    }

    @Synchronized
    fun start() {
        if (server != null) return

        // If stop() was called previously, executor may be shutdown.
        if (executor.isShutdown) executor = Executors.newCachedThreadPool()
        
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).apply {
            executor = this@IdeBridge.executor
            createContext("/idebridge") { exchange -> handleRequest(exchange) }
            start()
        }
        port = server!!.address.port
        LOG.info("IdeBridge server started on port $port")
    }

    @Synchronized
    fun stop() {
        keepaliveTimer?.cancel()
        keepaliveTimer = null
        sessions.keys.toList().forEach(::removeSession)
        activeTrayIcons.entries.toList().forEach { removeTrayIcon(it.value, it.key) }
        server?.stop(0)
        server = null
        try {
            executor.shutdownNow()
            executor.awaitTermination(1, TimeUnit.SECONDS)
        } catch (_: Throwable) {}
    }

    fun createSession(
        project: Project,
        storage: IdeBridgeStorageBackend = IdeBridgePropertiesStorageBackend,
        versionSource: PluginVersionSource = installedPluginVersionSource(),
        updateServiceFactory: (PluginVersionSource) -> PluginUpdateService = { source ->
            PluginUpdateService(versionSource = source)
        },
        webUiBaseUrl: String? = null,
    ): SessionInfo {
        start() // ensure server is running
        
        // Remove any existing session for this project
        projectToSession[project]?.let { oldId ->
            removeSession(oldId)
        }
        
        val sessionId = UUID.randomUUID().toString()
        val token = UUID.randomUUID().toString()
        val updateService = updateServiceFactory(versionSource)
        sessions[sessionId] = Session(
            id = sessionId,
            token = token,
            project = project,
            webUiBaseUrl = webUiBaseUrl,
            storage = storage,
            updateService = updateService,
        )
        projectToSession[project] = sessionId
        
        // Start keepalive timer if not running
        if (keepaliveTimer == null) {
            keepaliveTimer = java.util.Timer("IdeBridge-Keepalive", true).apply {
                scheduleAtFixedRate(object : java.util.TimerTask() {
                    override fun run() {
                        sendKeepaliveToAll()
                    }
                }, 15000, 15000) // Every 15 seconds
            }
        }
        
        val baseUrl = "http://127.0.0.1:$port/idebridge/$sessionId"
        return SessionInfo(baseUrl, token, sessionId)
    }

    fun removeSession(sessionId: String) {
        sessions.remove(sessionId)?.let { session ->
            projectToSession.remove(session.project)
            closeSessionClients(session)
        }
    }

    private fun closeSessionClients(session: Session) {
        synchronized(session.sseClients) {
            session.sseClients.forEach {
                try { it.close() } catch (_: Throwable) {}
            }
            session.sseClients.clear()
        }
    }

    fun send(sessionId: String, type: String, payload: Map<String, Any?> = emptyMap()) {
        val session = sessions[sessionId] ?: return
        val msg = JsonObject().apply {
            addProperty("type", type)
            add("payload", gson.toJsonTree(payload))
            addProperty("timestamp", System.currentTimeMillis())
        }
        broadcastSSE(session, gson.toJson(msg))
    }
    
    /**
     * Send a message to UI using project reference (looks up session automatically).
     * Used by PathInserter, DragAndDropInstaller, and other utilities.
     */
    fun send(project: Project, type: String, payload: Map<String, Any?> = emptyMap()) {
        val sessionId = projectToSession[project]
        if (sessionId == null) {
            LOG.warn("No session found for project: ${project.name}")
            return
        }
        send(sessionId, type, payload)
    }
    
    private fun sendKeepaliveToAll() {
        sessions.values.forEach { session ->
            synchronized(session.sseClients) {
                val toRemove = mutableListOf<HttpExchange>()
                session.sseClients.forEach { client ->
                    try {
                        val writer = OutputStreamWriter(client.responseBody)
                        writer.write(": ping\n\n")
                        writer.flush()
                    } catch (e: Exception) {
                        toRemove.add(client)
                    }
                }
                toRemove.forEach {
                    session.sseClients.remove(it)
                    try { it.close() } catch (_: Throwable) {}
                }
            }
        }
    }

    private fun handleRequest(exchange: HttpExchange) {
        if (exchange.requestURI.path.contains("/events")) {
            val raw = exchange.requestURI.rawQuery ?: ""
            try {
                val params = parseQuery(raw)
                val sessionId = exchange.requestURI.path.split("/").filter { it.isNotEmpty() }.getOrNull(1)
                LOG.debug("IdeBridge events request session=$sessionId tokenPresent=${params["token"] != null}")
            } catch (_: Throwable) {}
        }
        // Add CORS headers
        exchange.responseHeaders.apply {
            add("Access-Control-Allow-Origin", "*")
            add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            add("Access-Control-Allow-Headers", "Content-Type")
        }

        if (exchange.requestMethod == "OPTIONS") {
            exchange.sendResponseHeaders(204, -1)
            exchange.close()
            return
        }

        // Parse path: /idebridge/{sessionId}/{action}
        val pathParts = exchange.requestURI.path.split("/").filter { it.isNotEmpty() }
        if (pathParts.size < 3 || pathParts[0] != "idebridge") {
            exchange.sendResponseHeaders(404, -1)
            exchange.close()
            return
        }

        val sessionId = pathParts[1]
        val action = pathParts[2]
        val session = sessions[sessionId]

        // Parse token from query
        val queryParams = parseQuery(exchange.requestURI.rawQuery ?: "")
        val token = queryParams["token"]

        if (session == null || session.token != token) {
            LOG.warn("IdeBridge unauthorized: sessionId=$sessionId action=$action")
            exchange.sendResponseHeaders(401, -1)
            exchange.close()
            return
        }

        when (action) {
            "events" -> handleSSE(exchange, session)
            "send" -> handleSend(exchange, session)
            else -> {
                exchange.sendResponseHeaders(404, -1)
                exchange.close()
            }
        }
    }

    private fun handleSSE(exchange: HttpExchange, session: Session) {
        exchange.responseHeaders.apply {
            add("Content-Type", "text/event-stream")
            add("Cache-Control", "no-cache, no-transform")
            add("Connection", "keep-alive")
            add("X-Accel-Buffering", "no") // Disable nginx buffering
        }
        exchange.sendResponseHeaders(200, 0)
        
        synchronized(session.sseClients) {
            session.sseClients.add(exchange)
        }
        
        // Send initial connection event
        try {
            val data = JsonObject().apply {
                addProperty("minVersion", minVersion)
                addProperty("restartMode", "ide")
            }
            val writer = OutputStreamWriter(exchange.responseBody)
            writer.write("event: connected\ndata: ${gson.toJson(data)}\n\n")
            writer.flush()
        } catch (e: Exception) {
            synchronized(session.sseClients) {
                session.sseClients.remove(exchange)
            }
            try { exchange.close() } catch (_: Throwable) {}
        }
        
        // Keep connection open - will be cleaned up when client disconnects or session removed
    }

    private fun handleSend(exchange: HttpExchange, session: Session) {
        if (exchange.requestMethod != "POST") {
            exchange.sendResponseHeaders(405, -1)
            exchange.close()
            return
        }

        try {
            val body = exchange.requestBody.bufferedReader().readText()
            val msg = gson.fromJson(body, JsonObject::class.java)
            
            val type = msg.get("type")?.asString
            val id = msg.get("id")?.asString
            val payload = msg.getAsJsonObject("payload")

            when (type) {
                "openFile" -> {
                    val rawPath = payload?.get("path")?.asString
                    if (rawPath != null) {
                        val lineFromPayload1Based = payload.get("line")?.asInt ?: -1
                        val rangeRegex = Regex(":(\\d+)(?:-(\\d+))?$")
                        val match = rangeRegex.find(rawPath)
                        val startFromPath1Based = try {
                            match?.groupValues?.getOrNull(1)?.toInt()
                        } catch (_: Throwable) { null }
                        val endFromPath1Based = try {
                            match?.groupValues?.getOrNull(2)?.toInt()
                        } catch (_: Throwable) { null }
                        val cleanedPath = rawPath.replace(rangeRegex, "")

                        val startLine1Based = if (lineFromPayload1Based > 0) lineFromPayload1Based else startFromPath1Based ?: -1
                        val endLine1Based = endFromPath1Based ?: -1

                        val startLine0Based = if (startLine1Based > 0) startLine1Based - 1 else -1
                        val endLine0Based = if (endLine1Based > 0) endLine1Based - 1 else -1

                        openFile(session.project, cleanedPath, startLine0Based, endLine0Based)
                        replyOk(session, id)
                    } else {
                        replyError(session, id, "Missing path")
                    }
                }
                "ensureAndOpenFile" -> {
                    val raw = payload?.get("path")?.asString?.trim()
                    if (raw.isNullOrEmpty()) {
                        replyError(session, id, "Missing path")
                    } else {
                        try {
                            val target = if (raw.matches(Regex("^~([/\\\\].*|$)")))
                                System.getProperty("user.home") + raw.substring(1)
                            else raw
                            val file = File(target)
                            file.parentFile?.mkdirs()
                            if (!file.exists()) file.createNewFile()
                            openFile(session.project, target.replace("\\", "/"), -1, -1)
                            replyOk(session, id)
                        } catch (e: Exception) {
                            replyError(session, id, "ensureAndOpenFile failed: $e")
                        }
                    }
                }
                "openUrl" -> {
                    val url = payload?.get("url")?.asString
                    if (url != null) {
                        BrowserUtil.browse(url)
                        replyOk(session, id)
                    } else {
                        replyError(session, id, "Missing url")
                    }
                }
                "reloadPath" -> {
                    val path = payload?.get("path")?.asString
                    if (path != null) {
                        reloadPath(path)
                        replyOk(session, id)
                    } else {
                        replyError(session, id, "Missing path")
                    }
                }
                "clipboardWrite" -> {
                    val text = payload?.get("text")?.asString
                    if (text != null) {
                        val clipboard = Toolkit.getDefaultToolkit().systemClipboard
                        clipboard.setContents(StringSelection(text), null)
                        replyOk(session, id)
                    } else {
                        replyError(session, id, "Missing text")
                    }
                }

                "saveImage" -> {
                    val url = payload?.get("url")?.asString?.trim()
                    val filename = payload?.get("filename")?.asString?.trim()
                    if (url.isNullOrEmpty() || filename.isNullOrEmpty()) {
                        replyError(session, id, "Missing url or filename")
                    } else {
                        try {
                            val target = chooseSaveImageTarget(session.project, filename)
                            if (target == null) {
                                replyResult(session, id, mapOf("cancelled" to true))
                            } else {
                                val bytes = readImageBytes(session, url)
                                target.parentFile?.mkdirs()
                                target.writeBytes(bytes)
                                replyResult(session, id, mapOf("cancelled" to false))
                            }
                        } catch (e: Exception) {
                            replyError(session, id, "saveImage failed: ${e.message ?: e}")
                        }
                    }
                }

                "getExtensionVersion" -> {
                    try {
                        replyResult(
                            session,
                            id,
                            mapOf("version" to session.updateService.currentVersion()),
                        )
                    } catch (e: Exception) {
                        replyError(session, id, "getExtensionVersion failed: ${e.message ?: e}")
                    }
                }

                "getUpdateInfo" -> {
                    try {
                        replyResult(session, id, session.updateService.getUpdateInfo())
                    } catch (e: Exception) {
                        replyError(session, id, "getUpdateInfo failed: ${e.message ?: e}")
                    }
                }

                "checkForUpdates" -> {
                    try {
                        replyResult(session, id, session.updateService.checkForUpdates())
                    } catch (e: Exception) {
                        replyError(session, id, "checkForUpdates failed: ${e.message ?: e}")
                    }
                }

                "installUpdate" -> {
                    val version = payload?.get("version")?.asString?.trim()
                    if (version.isNullOrEmpty()) {
                        replyError(session, id, "Missing version")
                    } else {
                        val ready = CountDownLatch(1)
                        val shouldStart = AtomicBoolean(false)

                        try {
                            val prepared = session.updateService.prepareInstall(version)
                            scheduleInstallStart {
                                ready.await()
                                if (!shouldStart.get()) return@scheduleInstallStart

                                try {
                                    prepared.start { eventType, eventPayload ->
                                        if (eventType == "manualUpdate") {
                                            openPluginSettings(session.project)
                                        }
                                        send(session.id, eventType, eventPayload)
                                    }
                                } catch (e: Exception) {
                                    send(
                                        session.id,
                                        "error",
                                        mapOf(
                                            "version" to version,
                                            "error" to (e.message ?: e),
                                        ),
                                    )
                                }
                            }

                            if (replyOk(session, id)) {
                                shouldStart.set(true)
                            }
                        } catch (e: Exception) {
                            replyError(session, id, "installUpdate failed: ${e.message ?: e}")
                        } finally {
                            ready.countDown()
                        }
                    }
                }

                "restartHost" -> {
                    try {
                        restartHook()
                        replyOk(session, id)
                    } catch (e: Exception) {
                        replyError(session, id, "restartHost failed: $e")
                    }
                }

                "showSystemNotification" -> {
                    val targetSessionID = payload?.get("sessionID")?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isString }
                        ?.asString?.trim()
                    val title = payload?.get("title")?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isString }
                        ?.asString?.trim()
                    val content = payload?.get("body")?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isString }
                        ?.asString?.trim()
                    if (targetSessionID.isNullOrEmpty() || title.isNullOrEmpty() || content.isNullOrEmpty()) {
                        replyError(session, id, "Missing sessionID, title, or body")
                    } else {
                        val clicked = AtomicBoolean(false)
                        notificationHook(session.project, targetSessionID, title, content) {
                            if (clicked.compareAndSet(false, true)) {
                                notificationClickHook(session.project) {
                                    send(session.id, "openSession", mapOf("sessionID" to targetSessionID))
                                }
                            }
                        }
                        replyOk(session, id)
                    }
                }

                "openPluginManager" -> {
                    try {
                        openPluginSettings(session.project)
                        replyOk(session, id)
                    } catch (e: Exception) {
                        replyError(session, id, "openPluginManager failed: ${e.message ?: e}")
                    }
                }

                "storageGet" -> {
                    val scope = payload?.get("scope")?.asString
                    if (scope != "global" && scope != "workspace" && scope != "mem") {
                        replyError(session, id, "Invalid scope")
                    } else {
                        val keys = payload.getAsJsonArray("keys")
                        val result = JsonObject()
                        keys?.forEach { k ->
                            val key = k.asString
                            val value = when (scope) {
                                "global" -> session.storage.getGlobal(key)
                                "workspace" -> session.storage.getWorkspace(session.project, key)
                                else -> session.mem[key]
                            }
                            if (value != null) result.addProperty(key, value)
                        }
                        if (id != null) {
                            broadcastSSE(session, gson.toJson(JsonObject().apply {
                                addProperty("replyTo", id)
                                addProperty("ok", true)
                                add("result", result)
                                addProperty("timestamp", System.currentTimeMillis())
                            }))
                        }
                    }
                }

                "storageSet" -> {
                    val scope = payload?.get("scope")?.asString
                    if (scope != "global" && scope != "workspace" && scope != "mem") {
                        replyError(session, id, "Invalid scope")
                    } else {
                        val key = payload.get("key")?.asString
                        val value = payload.get("value")?.asString
                        if (key != null && value != null) {
                            when (scope) {
                                "global" -> session.storage.setGlobal(key, value)
                                "workspace" -> session.storage.setWorkspace(session.project, key, value)
                                else -> session.mem[key] = value
                            }
                            replyOk(session, id)
                        } else {
                            replyError(session, id, "Missing key or value")
                        }
                    }
                }

                else -> replyError(session, id, "unsupported message type")
            }

            exchange.sendResponseHeaders(204, -1)
        } catch (e: Exception) {
            LOG.warn("Error handling send", e)
            exchange.sendResponseHeaders(400, -1)
        }
        exchange.close()
    }

    private fun replyOk(session: Session, id: String?): Boolean {
        if (id == null) return false
        val msg = JsonObject().apply {
            addProperty("replyTo", id)
            addProperty("ok", true)
            addProperty("timestamp", System.currentTimeMillis())
        }
        return broadcastSSE(session, gson.toJson(msg))
    }

    private fun replyResult(session: Session, id: String?, result: Any): Boolean {
        if (id == null) return false
        val msg = JsonObject().apply {
            addProperty("replyTo", id)
            addProperty("ok", true)
            add("result", gson.toJsonTree(result))
            addProperty("timestamp", System.currentTimeMillis())
        }
        return broadcastSSE(session, gson.toJson(msg))
    }

    private fun replyError(session: Session, id: String?, error: String): Boolean {
        if (id == null) return false
        val msg = JsonObject().apply {
            addProperty("replyTo", id)
            addProperty("ok", false)
            addProperty("error", error)
            addProperty("timestamp", System.currentTimeMillis())
        }
        return broadcastSSE(session, gson.toJson(msg))
    }

    private fun scheduleInstallStart(task: () -> Unit) {
        installStartRunner?.invoke(task) ?: executor.execute(task)
    }

    @Synchronized
    private fun showSystemNotification(title: String, body: String, onClick: () -> Unit) {
        if (GraphicsEnvironment.isHeadless() || !SystemTray.isSupported()) {
            LOG.info("System tray notifications unavailable; skipping notification")
            return
        }

        try {
            val tray = SystemTray.getSystemTray()
            val trayIcon = TrayIcon(
                IconUtil.toImage(IconLoader.getIcon("/icons/opencodeToolWindow.svg", IdeBridge::class.java)),
                "OpenCode",
            ).apply {
                isImageAutoSize = true
            }
            val remove = Runnable { removeTrayIcon(tray, trayIcon) }
            trayIcon.addActionListener {
                remove.run()
                onClick()
            }
            try {
                tray.add(trayIcon)
                activeTrayIcons[trayIcon] = tray
                trayIcon.displayMessage(title, body, TrayIcon.MessageType.NONE)
                CompletableFuture.delayedExecutor(15, TimeUnit.SECONDS).execute(remove)
            } catch (t: Throwable) {
                remove.run()
                throw t
            }
        } catch (t: Throwable) {
            LOG.info("Failed to show system notification", t)
        }
    }

    private fun removeTrayIcon(tray: SystemTray, trayIcon: TrayIcon) {
        activeTrayIcons.remove(trayIcon, tray)
        try {
            tray.remove(trayIcon)
        } catch (_: Throwable) {
        }
    }

    private fun openPluginSettings(project: Project) {
        openPluginSettingsHook?.invoke() ?: OpenPluginSettings.open(project)
    }

    private fun chooseSaveImageTarget(project: Project, filename: String): File? {
        saveImageTargetHook?.let { return it(project, filename) }

        val target = arrayOfNulls<File>(1)
        val task = Runnable {
            val chooser = JFileChooser(project.basePath?.let(::File)).apply {
                dialogTitle = "Save Image"
                selectedFile = File(defaultImageFilename(filename))
            }
            if (chooser.showSaveDialog(null) == JFileChooser.APPROVE_OPTION) {
                target[0] = chooser.selectedFile
            }
        }

        val app = ApplicationManager.getApplication()
        if (app != null) {
            if (app.isDispatchThread) task.run() else app.invokeAndWait(task)
        } else {
            if (SwingUtilities.isEventDispatchThread()) task.run() else SwingUtilities.invokeAndWait(task)
        }
        return target[0]
    }

    private fun readImageBytes(session: Session, url: String): ByteArray {
        return if (url.startsWith("data:")) {
            readDataUrl(url)
        } else {
            val resolved = resolveImageUrl(session, url)
            readUrlBytesHook?.invoke(resolved) ?: URL(resolved).openStream().use { it.readBytes() }
        }
    }

    private fun resolveImageUrl(session: Session, url: String): String {
        return try {
            URL(url).toString()
        } catch (_: Exception) {
            val baseUrl = session.webUiBaseUrl ?: throw IllegalArgumentException("Relative image URL requires web UI base URL")
            URL(URL(baseUrl), url).toString()
        }
    }

    private fun readDataUrl(url: String): ByteArray {
        val comma = url.indexOf(',')
        if (comma < 0 || !url.startsWith("data:")) {
            throw IllegalArgumentException("Unsupported data URL")
        }

        val meta = url.substring(5, comma).split(';')
        if (meta.drop(1).none { it.trim().equals("base64", ignoreCase = true) }) {
            throw IllegalArgumentException("Unsupported data URL")
        }

        val data = url.substring(comma + 1)
        if (!isValidBase64(data)) {
            throw IllegalArgumentException("Invalid base64 data URL")
        }

        return Base64.getDecoder().decode(data)
    }

    private fun isValidBase64(value: String): Boolean {
        if (value.isEmpty()) return true
        if (value.length % 4 != 0) return false
        if (!Regex("^[A-Za-z0-9+/]*={0,2}$").matches(value)) return false

        return try {
            Base64.getEncoder().encodeToString(Base64.getDecoder().decode(value)) == value
        } catch (_: IllegalArgumentException) {
            false
        }
    }

    private fun defaultImageFilename(filename: String): String {
        return filename.split('/', '\\').filter { it.isNotBlank() }.lastOrNull() ?: filename
    }

    private fun broadcastSSE(session: Session, json: String): Boolean {
        synchronized(session.sseClients) {
            val toRemove = mutableListOf<HttpExchange>()
            var delivered = 0
            session.sseClients.forEach { client ->
                try {
                    val writer = OutputStreamWriter(client.responseBody)
                    writer.write("event: message\ndata: $json\n\n")
                    writer.flush()
                    delivered += 1
                } catch (e: Exception) {
                    toRemove.add(client)
                }
            }
            toRemove.forEach { 
                session.sseClients.remove(it)
                try { it.close() } catch (_: Throwable) {}
            }
            return delivered > 0
        }
    }

    private fun openFile(project: Project, rawPath: String, startLine: Int, endLine: Int) {
        try {
            val lfs = LocalFileSystem.getInstance()
            val vf = lfs.findFileByPath(rawPath) ?: lfs.refreshAndFindFileByPath(rawPath)
            if (vf != null) {
                ApplicationManager.getApplication().invokeLater {
                    val fm = FileEditorManager.getInstance(project)
                    if (startLine >= 0) {
                        try {
                            val desc = OpenFileDescriptor(project, vf, startLine, 0)
                            try { desc.isUseCurrentWindow = true } catch (_: Throwable) {}
                            val ed = try { fm.openTextEditor(desc, true) } catch (_: Throwable) { null }
                            if (ed == null) fm.openFile(vf, true) else try {
                                val doc = ed.document
                                val lineCount = doc.lineCount
                                val clampedStart = startLine.coerceIn(0, (lineCount - 1).coerceAtLeast(0))
                                val targetEnd = if (endLine >= 0) endLine else startLine
                                val clampedEnd = targetEnd.coerceIn(clampedStart, (lineCount - 1).coerceAtLeast(0))

                                val pos = LogicalPosition(clampedStart.coerceAtLeast(0), 0)
                                ed.caretModel.moveToLogicalPosition(pos)

                                if (clampedEnd > clampedStart) {
                                    val startOffset = doc.getLineStartOffset(clampedStart)
                                    val endOffset = doc.getLineEndOffset(clampedEnd)
                                    ed.selectionModel.setSelection(startOffset, endOffset)
                                } else {
                                    ed.selectionModel.removeSelection()
                                }

                                ed.scrollingModel.scrollToCaret(ScrollType.CENTER)
                            } catch (_: Throwable) {}
                        } catch (_: Throwable) {
                            fm.openFile(vf, true)
                        }
                    } else {
                        fm.openFile(vf, true)
                    }
                }
            }
        } catch (t: Throwable) {
            LOG.warn("openFile failed", t)
        }
    }

    private fun reloadPath(path: String) {
        try {
            val lfs = LocalFileSystem.getInstance()
            val vf = lfs.findFileByPath(path) ?: lfs.refreshAndFindFileByPath(path)
            if (vf != null) {
                // Use async=true to avoid blocking EDT during VFS refresh
                vf.refresh(true, false)
            } else {
                // File doesn't exist yet (new file), refresh parent directory asynchronously
                val parentPath = path.substringBeforeLast("/")
                val parentVf = lfs.findFileByPath(parentPath) ?: lfs.refreshAndFindFileByPath(parentPath)
                parentVf?.refresh(true, true)
            }
        } catch (t: Throwable) {
            LOG.warn("reloadPath failed", t)
        }
    }

    private fun parseQuery(query: String): Map<String, String> {
        return query.split("&")
            .filter { it.isNotEmpty() }
            .associate { param ->
                val parts = param.split("=", limit = 2)
                val key = URLDecoder.decode(parts[0], "UTF-8")
                val value = if (parts.size > 1) URLDecoder.decode(parts[1], "UTF-8") else ""
                key to value
            }
    }
}
