package paviko.opencode.ui

import com.google.gson.Gson
import com.google.gson.JsonArray
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.intellij.execution.RunManager
import com.intellij.execution.RunnerAndConfigurationSettings
import com.intellij.execution.process.ProcessHandler
import com.intellij.execution.ui.RunContentDescriptor
import com.intellij.execution.ui.RunContentManager
import com.intellij.openapi.application.Application
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.options.Configurable
import com.intellij.openapi.options.SearchableConfigurable
import com.intellij.openapi.options.ShowSettingsUtil
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Key
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.xdebugger.XDebugSession
import com.intellij.xdebugger.XDebuggerManager
import com.intellij.xdebugger.XSourcePosition
import com.intellij.xdebugger.breakpoints.XBreakpoint
import com.intellij.xdebugger.breakpoints.XBreakpointManager
import com.intellij.xdebugger.breakpoints.XLineBreakpoint
import com.intellij.xdebugger.evaluation.XDebuggerEvaluator
import com.intellij.xdebugger.frame.XCompositeNode
import com.intellij.xdebugger.frame.XExecutionStack
import com.intellij.xdebugger.frame.XStackFrame
import com.intellij.xdebugger.frame.XSuspendContext
import com.intellij.xdebugger.frame.XValue
import com.intellij.xdebugger.frame.XValueChildrenList
import com.intellij.xdebugger.frame.XValueNode
import org.jetbrains.plugins.terminal.ShellTerminalWidget
import org.jetbrains.plugins.terminal.TerminalToolWindowManager
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.mockito.Mockito
import paviko.opencode.update.MarketplacePluginRelease
import paviko.opencode.update.MarketplaceVersionSource
import paviko.opencode.update.PluginUpdateService
import paviko.opencode.update.PluginVersionSource
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.URL
import java.nio.file.Files
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import java.util.function.Consumer
import java.util.function.Predicate
import kotlin.concurrent.thread

class IdeBridgeUpdateTest {
    private val gson = Gson()

    @AfterEach
    fun cleanup() {
        IdeBridge.installStartRunner = null
        IdeBridge.openPluginSettingsHook = null
        setNullableIdeBridgeField("saveImageTargetHook", null)
        setNullableIdeBridgeField("chooseFilesHook", null)
        setNullableIdeBridgeField("readUrlBytesHook", null)
        setNullableIdeBridgeField("getAcpCapabilitiesHook", null)
        setNullableIdeBridgeField("executeAcpToolHook", null)
        IdeBridge.stop()
    }

    @Test
    fun `stop closes server side sse clients`() {
        val session = IdeBridge.createSession(project = project())
        val events = sse(session)

        try {
            IdeBridge.stop()
            events.awaitDisconnected()
        } finally {
            events.close()
        }
    }

    @Test
    fun `getExtensionVersion returns installed plugin version`() {
        val session = IdeBridge.createSession(
            project = project(),
            versionSource = PluginVersionSource { "26.5.600" },
        )

        sse(session).use { events ->
            val reply = events.send("getExtensionVersion", JsonObject())
            val result = reply.getAsJsonObject("result")

            assertEquals(true, reply.get("ok")?.asBoolean)
            assertNotNull(result)
            assertEquals("26.5.600", result.get("version")?.asString)
        }
    }

    @Test
    fun `getExtensionVersion failure replies with bridge error`() {
        val session = IdeBridge.createSession(
            project = project(),
            versionSource = PluginVersionSource {
                throw IllegalStateException("descriptor missing")
            },
        )

        sse(session).use { events ->
            val reply = events.send("getExtensionVersion", JsonObject())

            assertEquals(false, reply.get("ok")?.asBoolean)
            assertEquals("getExtensionVersion failed: descriptor missing", reply.get("error")?.asString)
        }
    }

    @Test
    fun `getExtensionVersion and getUpdateInfo share the same version source`() {
        var version = "26.5.501"
        val source = PluginVersionSource { version }
        val session = IdeBridge.createSession(
            project = project(),
            versionSource = source,
        )

        sse(session).use { events ->
            val versionReply = events.send("getExtensionVersion", JsonObject())
            val updateReply = events.send("getUpdateInfo", JsonObject())

            assertEquals("26.5.501", versionReply.getAsJsonObject("result").get("version")?.asString)
            assertEquals("26.5.501", updateReply.getAsJsonObject("result").get("currentVersion")?.asString)

            version = "26.5.502"

            val nextVersionReply = events.send("getExtensionVersion", JsonObject())
            val nextUpdateReply = events.send("getUpdateInfo", JsonObject())

            assertEquals("26.5.502", nextVersionReply.getAsJsonObject("result").get("version")?.asString)
            assertEquals("26.5.502", nextUpdateReply.getAsJsonObject("result").get("currentVersion")?.asString)
        }
    }

    @Test
    fun `getUpdateInfo stays supported for local builds`() {
        val session = IdeBridge.createSession(
            project = project(),
            versionSource = PluginVersionSource { "26.5.501" },
            updateServiceFactory = { source ->
                PluginUpdateService(
                    versionSource = source,
                    distributionChannelProvider = { "local" },
                    marketplaceVersionSource = MarketplaceVersionSource { null },
                    backgroundRunner = { task -> task() },
                )
            },
        )

        sse(session).use { events ->
            val reply = events.send("getUpdateInfo", JsonObject())
            val result = reply.getAsJsonObject("result")

            assertEquals(true, reply.get("ok")?.asBoolean)
            assertNotNull(result)
            assertEquals(true, result.get("supported")?.asBoolean)
            assertEquals(null, result.get("reason"))
        }
    }

    @Test
    fun `checkForUpdates returns structured available result`() {
        val session = IdeBridge.createSession(
            project = project(),
            versionSource = PluginVersionSource { "26.5.501" },
            updateServiceFactory = { source ->
                PluginUpdateService(
                    versionSource = source,
                    distributionChannelProvider = { "marketplace" },
                    marketplaceVersionSource = MarketplaceVersionSource {
                        MarketplacePluginRelease(
                            version = "26.5.502",
                            releaseUrl = "https://plugins.jetbrains.com/plugin/31609-opencode-ui-unofficial-/versions/stable/123456",
                        )
                    },
                    backgroundRunner = { task -> task() },
                )
            },
        )

        sse(session).use { events ->
            val reply = events.send("checkForUpdates", JsonObject())
            val result = reply.getAsJsonObject("result")

            assertEquals(true, reply.get("ok")?.asBoolean)
            assertNotNull(result)
            assertEquals("available", result.get("status")?.asString)
            assertEquals("26.5.502", result.getAsJsonObject("latest")?.get("version")?.asString)
            assertEquals(true, result.getAsJsonObject("latest")?.get("manualUpdate")?.asBoolean)
        }
    }

    @Test
    fun `getUpdateInfo failure replies with error and later request still succeeds`() {
        val attempts = AtomicInteger(0)
        val session = IdeBridge.createSession(
            project = project(),
            versionSource = PluginVersionSource { "26.5.501" },
            updateServiceFactory = { source ->
                PluginUpdateService(
                    versionSource = PluginVersionSource {
                        if (attempts.getAndIncrement() == 0) {
                            throw IllegalStateException("boom")
                        }
                        source.currentVersion()
                    },
                    distributionChannelProvider = { "local" },
                    marketplaceVersionSource = MarketplaceVersionSource { null },
                    backgroundRunner = { task -> task() },
                )
            },
        )

        sse(session).use { events ->
            val failure = events.send("getUpdateInfo", JsonObject())
            assertEquals(false, failure.get("ok")?.asBoolean)
            assertEquals("getUpdateInfo failed: boom", failure.get("error")?.asString)

            val success = events.send("getUpdateInfo", JsonObject())
            val result = success.getAsJsonObject("result")

            assertEquals(true, success.get("ok")?.asBoolean)
            assertEquals(true, result.get("supported")?.asBoolean)
            assertEquals(false, result.get("hasUpdate")?.asBoolean)
        }
    }

    @Test
    fun `openPluginManager delegates to settings opener`() {
        val opened = AtomicInteger(0)
        IdeBridge.openPluginSettingsHook = {
            opened.incrementAndGet()
        }

        val session = IdeBridge.createSession(project = project())

        sse(session).use { events ->
            val reply = events.send("openPluginManager", JsonObject())

            assertEquals(true, reply.get("ok")?.asBoolean)
            assertEquals(1, opened.get())
        }
    }

    @Test
    fun `openPluginManager failure replies with bridge error`() {
        IdeBridge.openPluginSettingsHook = {
            throw IllegalStateException("settings unavailable")
        }

        val session = IdeBridge.createSession(project = project())

        sse(session).use { events ->
            val reply = events.send("openPluginManager", JsonObject())

            assertEquals(false, reply.get("ok")?.asBoolean)
            assertEquals("openPluginManager failed: settings unavailable", reply.get("error")?.asString)
        }
    }

    @Test
    fun `open plugin settings propagates failures off edt`() {
        val project = project()
        val app = Mockito.mock(Application::class.java)
        val settingsUtil = Mockito.mock(ShowSettingsUtil::class.java)

        Mockito.`when`(app.isDispatchThread).thenReturn(false)
        Mockito.doAnswer {
            (it.arguments[0] as Runnable).run()
            null
        }.`when`(app).invokeAndWait(Mockito.any(Runnable::class.java))
        Mockito.doThrow(IllegalStateException("settings unavailable"))
            .`when`(settingsUtil)
            .showSettingsDialog(
                Mockito.eq(project),
                Mockito.any<Predicate<Configurable>>(),
                Mockito.isNull<Consumer<in Configurable>>(),
            )

        Mockito.mockStatic(ApplicationManager::class.java).use { applicationManager ->
            applicationManager.`when`<Application> { ApplicationManager.getApplication() }.thenReturn(app)
            Mockito.mockStatic(ShowSettingsUtil::class.java).use { settingsUtilStatic ->
                settingsUtilStatic.`when`<ShowSettingsUtil> { ShowSettingsUtil.getInstance() }.thenReturn(settingsUtil)

                val error = assertThrows(IllegalStateException::class.java) {
                    OpenPluginSettings.open(project)
                }

                assertEquals("settings unavailable", error.message)
            }
        }
    }

    @Test
    fun `open plugin settings matches plugin manager configurable id`() {
        val project = project()
        val app = Mockito.mock(Application::class.java)
        val settingsUtil = Mockito.mock(ShowSettingsUtil::class.java)
        var predicate: Predicate<Configurable>? = null

        Mockito.`when`(app.isDispatchThread).thenReturn(true)
        Mockito.doAnswer {
            @Suppress("UNCHECKED_CAST")
            predicate = it.arguments[1] as Predicate<Configurable>
            null
        }.`when`(settingsUtil).showSettingsDialog(
            Mockito.eq(project),
            Mockito.any<Predicate<Configurable>>(),
            Mockito.isNull<Consumer<in Configurable>>(),
        )

        Mockito.mockStatic(ApplicationManager::class.java).use { applicationManager ->
            applicationManager.`when`<Application> { ApplicationManager.getApplication() }.thenReturn(app)
            Mockito.mockStatic(ShowSettingsUtil::class.java).use { settingsUtilStatic ->
                settingsUtilStatic.`when`<ShowSettingsUtil> { ShowSettingsUtil.getInstance() }.thenReturn(settingsUtil)

                OpenPluginSettings.open(project)
            }
        }

        val pluginManager = Mockito.mock(SearchableConfigurable::class.java)
        Mockito.`when`(pluginManager.id).thenReturn("preferences.pluginManager")
        val other = Mockito.mock(SearchableConfigurable::class.java)
        Mockito.`when`(other.id).thenReturn("Plugins")

        assertNotNull(predicate)
        assertTrue(predicate!!.test(pluginManager as Configurable))
        assertFalse(predicate!!.test(other as Configurable))
    }

    @Test
    fun `installUpdate replies before starting install and emits bridge events`() {
        val replyObserved = CountDownLatch(1)
        val startRequested = CountDownLatch(1)
        val startedBeforeReply = AtomicBoolean(false)
        val settingsOpened = AtomicInteger(0)
        IdeBridge.openPluginSettingsHook = {
            settingsOpened.incrementAndGet()
        }

        lateinit var service: PluginUpdateService
        val session = IdeBridge.createSession(
            project = project(),
            versionSource = PluginVersionSource { "26.5.501" },
            updateServiceFactory = { source ->
                PluginUpdateService(
                    versionSource = source,
                    distributionChannelProvider = { "marketplace" },
                    marketplaceVersionSource = MarketplaceVersionSource {
                        MarketplacePluginRelease(
                            version = "26.5.502",
                            releaseUrl = "https://plugins.jetbrains.com/plugin/31609-opencode-ui-unofficial-/versions/stable/123456",
                        )
                    },
                    backgroundRunner = { task ->
                        startRequested.countDown()
                        if (replyObserved.count > 0L) {
                            startedBeforeReply.set(true)
                        }
                        thread(start = true, isDaemon = true) {
                            replyObserved.await(2, TimeUnit.SECONDS)
                            task()
                        }
                    },
                ).also { service = it }
            },
        )
        service.checkForUpdates()

        sse(session).use { events ->
            val request = events.post("installUpdate", JsonObject().apply {
                addProperty("version", "26.5.502")
            })

            val reply = events.awaitReply(request)
            replyObserved.countDown()
            assertEquals(true, reply.get("ok")?.asBoolean)
            assertTrue(startRequested.await(1, TimeUnit.SECONDS), "prepared install should start")
            assertEquals(false, startedBeforeReply.get())

            val relevant = events.awaitRelevantCount(request, 2)
            assertEquals(request.id, relevant[0].get("replyTo")?.asString)
            assertEquals("manualUpdate", relevant[1].get("type")?.asString)
            assertEquals("26.5.502", relevant[1].getAsJsonObject("payload")?.get("version")?.asString)
            assertEquals(true, relevant[1].getAsJsonObject("payload")?.get("manualUpdate")?.asBoolean)
            assertEquals(1, settingsOpened.get())
        }
    }

    @Test
    fun `installUpdate missing version returns error reply`() {
        val session = IdeBridge.createSession(
            project = project(),
            versionSource = PluginVersionSource { "26.5.501" },
            updateServiceFactory = { source ->
                PluginUpdateService(
                    versionSource = source,
                    distributionChannelProvider = { "marketplace" },
                    marketplaceVersionSource = MarketplaceVersionSource { null },
                    backgroundRunner = { task -> task() },
                )
            },
        )

        sse(session).use { events ->
            val reply = events.send("installUpdate", JsonObject().apply {
                addProperty("version", "   ")
            })

            assertEquals(false, reply.get("ok")?.asBoolean)
            assertEquals("Missing version", reply.get("error")?.asString)
        }
    }

    @Test
    fun `installUpdate prepareInstall rejection returns request error`() {
        val session = IdeBridge.createSession(
            project = project(),
            versionSource = PluginVersionSource { "26.5.501" },
            updateServiceFactory = { source ->
                PluginUpdateService(
                    versionSource = source,
                    distributionChannelProvider = { "marketplace" },
                    marketplaceVersionSource = MarketplaceVersionSource { null },
                    backgroundRunner = { task -> task() },
                )
            },
        )

        sse(session).use { events ->
            val reply = events.send("installUpdate", JsonObject().apply {
                addProperty("version", "26.5.502")
            })

            assertEquals(false, reply.get("ok")?.asBoolean)
            assertEquals("installUpdate failed: Update not available: 26.5.502", reply.get("error")?.asString)
        }
    }

    @Test
    fun `installUpdate scheduling failure returns single request error without fake success`() {
        IdeBridge.installStartRunner = {
            throw RejectedExecutionException("scheduler down")
        }

        lateinit var service: PluginUpdateService
        val session = IdeBridge.createSession(
            project = project(),
            versionSource = PluginVersionSource { "26.5.501" },
            updateServiceFactory = { source ->
                PluginUpdateService(
                    versionSource = source,
                    distributionChannelProvider = { "marketplace" },
                    marketplaceVersionSource = MarketplaceVersionSource {
                        MarketplacePluginRelease(
                            version = "26.5.502",
                            releaseUrl = "https://plugins.jetbrains.com/plugin/31609-opencode-ui-unofficial-/versions/stable/123456",
                        )
                    },
                    backgroundRunner = { task -> task() },
                ).also { service = it }
            },
        )
        service.checkForUpdates()

        sse(session).use { events ->
            val request = events.post("installUpdate", JsonObject().apply {
                addProperty("version", "26.5.502")
            })

            val reply = events.awaitReply(request)
            assertEquals(false, reply.get("ok")?.asBoolean)
            assertEquals("installUpdate failed: scheduler down", reply.get("error")?.asString)
            events.assertRelatedCount(request, 1)
        }
    }

    @Test
    fun `saveImage request is handled instead of reporting unsupported type`() {
        val session = IdeBridge.createSession(project = project())

        sse(session).use { events ->
            val reply = events.send("saveImage", JsonObject())

            assertEquals(false, reply.get("ok")?.asBoolean)
            assertEquals("Missing url or filename", reply.get("error")?.asString)
        }
    }

    @Test
    fun `saveImage writes decoded data url bytes to selected file`() {
        val target = tempFile("data-url-image.png")
        setNullableIdeBridgeField("saveImageTargetHook") { _: Project, _: String -> target }
        val session = IdeBridge.createSession(project = project())

        sse(session).use { events ->
            val reply = events.send("saveImage", JsonObject().apply {
                addProperty("url", "data:image/png;base64,aGVsbG8=")
                addProperty("filename", "copied-image.png")
            })

            assertEquals(true, reply.get("ok")?.asBoolean)
            assertEquals(false, reply.getAsJsonObject("result")?.get("cancelled")?.asBoolean)
            assertEquals("hello", target.readText())
        }
    }

    @Test
    fun `saveImage fetches remote urls before writing`() {
        val target = tempFile("remote-image.png")
        setNullableIdeBridgeField("saveImageTargetHook") { _: Project, _: String -> target }
        val session = IdeBridge.createSession(project = project())

        withHttpServer(byteArrayOf(1, 2, 3, 4)) { url ->
            sse(session).use { events ->
                val reply = events.send("saveImage", JsonObject().apply {
                    addProperty("url", url)
                    addProperty("filename", "remote-image.png")
                })

                assertEquals(true, reply.get("ok")?.asBoolean)
                assertEquals(false, reply.getAsJsonObject("result")?.get("cancelled")?.asBoolean)
                assertTrue(target.readBytes().contentEquals(byteArrayOf(1, 2, 3, 4)))
            }
        }
    }

    @Test
    fun `saveImage resolves generated-image relative urls against session web ui base`() {
        val target = tempFile("generated-image.png")
        setNullableIdeBridgeField("saveImageTargetHook") { _: Project, _: String -> target }
        val session = IdeBridge.createSession(project = project())

        withHttpServer(byteArrayOf(9, 8, 7)) { url ->
            setSessionWebUiBaseUrl(session.sessionId, "$url/app")

            sse(session).use { events ->
                val reply = events.send("saveImage", JsonObject().apply {
                    addProperty("url", "/generated-image?path=.opencode%2Fgenerated-images%2Ffoo.png")
                    addProperty("filename", "generated-image.png")
                })

                assertEquals(true, reply.get("ok")?.asBoolean)
                assertEquals(false, reply.getAsJsonObject("result")?.get("cancelled")?.asBoolean)
                assertTrue(target.readBytes().contentEquals(byteArrayOf(9, 8, 7)))
            }
        }
    }

    @Test
    fun `saveImage resolves app generated-image relative urls against session web ui base`() {
        val target = tempFile("app-generated-image.png")
        setNullableIdeBridgeField("saveImageTargetHook") { _: Project, _: String -> target }
        val session = IdeBridge.createSession(project = project())

        withHttpServer(byteArrayOf(6, 5, 4)) { url ->
            setSessionWebUiBaseUrl(session.sessionId, "$url/app")

            sse(session).use { events ->
                val reply = events.send("saveImage", JsonObject().apply {
                    addProperty("url", "/app/generated-image?path=.opencode%2Fgenerated-images%2Fbar.png")
                    addProperty("filename", "app-generated-image.png")
                })

                assertEquals(true, reply.get("ok")?.asBoolean)
                assertEquals(false, reply.getAsJsonObject("result")?.get("cancelled")?.asBoolean)
                assertTrue(target.readBytes().contentEquals(byteArrayOf(6, 5, 4)))
            }
        }
    }

    @Test
    fun `saveImage returns cancelled when user skips the save dialog`() {
        setNullableIdeBridgeField("saveImageTargetHook") { _: Project, _: String -> null }
        val session = IdeBridge.createSession(project = project())

        sse(session).use { events ->
            val reply = events.send("saveImage", JsonObject().apply {
                addProperty("url", "https://example.com/cancelled-image.png")
                addProperty("filename", "cancelled-image.png")
            })

            assertEquals(true, reply.get("ok")?.asBoolean)
            assertEquals(true, reply.getAsJsonObject("result")?.get("cancelled")?.asBoolean)
        }
    }

    @Test
    fun `saveImage rejects invalid data urls without creating files`() {
        val target = tempFile("invalid-image.png")
        target.delete()
        setNullableIdeBridgeField("saveImageTargetHook") { _: Project, _: String -> target }
        val session = IdeBridge.createSession(project = project())

        sse(session).use { events ->
            val reply = events.send("saveImage", JsonObject().apply {
                addProperty("url", "data:image/png,hello")
                addProperty("filename", "invalid-image.png")
            })

            assertEquals(false, reply.get("ok")?.asBoolean)
            assertEquals("saveImage failed: Unsupported data URL", reply.get("error")?.asString)
            assertFalse(target.exists())
        }
    }

    @Test
    fun `saveImage rejects invalid base64 data urls without creating files`() {
        val target = tempFile("invalid-base64-image.png")
        target.delete()
        setNullableIdeBridgeField("saveImageTargetHook") { _: Project, _: String -> target }
        val session = IdeBridge.createSession(project = project())

        sse(session).use { events ->
            val reply = events.send("saveImage", JsonObject().apply {
                addProperty("url", "data:image/png;base64,%%%")
                addProperty("filename", "invalid-base64-image.png")
            })

            assertEquals(false, reply.get("ok")?.asBoolean)
            assertEquals("saveImage failed: Invalid base64 data URL", reply.get("error")?.asString)
            assertFalse(target.exists())
        }
    }

    private class InMemoryBreakpointIdStore : BreakpointIdStore {
        private val values = ConcurrentHashMap<XBreakpoint<*>, String>()

        override fun read(breakpoint: XBreakpoint<*>): String? = values[breakpoint]

        override fun write(breakpoint: XBreakpoint<*>, id: String) {
            values[breakpoint] = id
        }
    }

    private fun executeToolPayload(category: String, toolId: String, parameters: JsonObject): JsonObject =
        JsonObject().apply {
            addProperty("category", category)
            addProperty("toolId", toolId)
            add("parameters", parameters)
        }

    private fun project(): Project {
        val project = Mockito.mock(Project::class.java)
        Mockito.`when`(project.name).thenReturn("update-test-project")
        return project
    }

    private fun tempFile(name: String): File {
        return Files.createTempDirectory("ide-bridge-save-image").resolve(name).toFile()
    }

    private fun withHttpServer(bytes: ByteArray, block: (String) -> Unit) {
        val server = com.sun.net.httpserver.HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        val responder: (com.sun.net.httpserver.HttpExchange) -> Unit = { exchange ->
            exchange.sendResponseHeaders(200, bytes.size.toLong())
            exchange.responseBody.use { out -> out.write(bytes) }
        }
        server.createContext("/image", responder)
        server.createContext("/generated-image", responder)
        server.createContext("/app/generated-image", responder)
        server.start()

        try {
            block("http://127.0.0.1:${server.address.port}/image")
        } finally {
            server.stop(0)
        }
    }

    private fun setNullableIdeBridgeField(name: String, value: Any?) {
        try {
            val field = IdeBridge::class.java.getDeclaredField(name)
            field.isAccessible = true
            field.set(IdeBridge, value)
        } catch (e: NoSuchFieldException) {
            if (value != null) {
                throw e
            }
        }
    }

    private fun setSessionWebUiBaseUrl(sessionId: String, baseUrl: String) {
        val field = IdeBridge::class.java.getDeclaredField("sessions")
        field.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val sessions = field.get(IdeBridge) as MutableMap<String, Any>
        val session = sessions[sessionId] ?: error("Session $sessionId not found")
        val sessionField = session.javaClass.getDeclaredField("webUiBaseUrl")
        sessionField.isAccessible = true
        sessionField.set(session, baseUrl)
    }

    private fun sse(session: SessionInfo): EventStream {
        return EventStream(session = session, gson = gson).also { it.connect() }
    }

    private class EventStream(
        private val session: SessionInfo,
        private val gson: Gson,
    ) : AutoCloseable {
        data class Request(val id: String, val startIndex: Int)

        private val messages = CopyOnWriteArrayList<JsonObject>()
        private val queue = LinkedBlockingQueue<JsonObject>()
        private val error = AtomicReference<Throwable?>(null)
        private val sendError = AtomicReference<Throwable?>(null)
        private val connected = CountDownLatch(1)
        private val connectedOk = AtomicBoolean(false)
        private val connection = URL("${session.baseUrl}/events?token=${session.token}").openConnection() as HttpURLConnection
        @Volatile private var closed = false
        private var readerThread: Thread? = null
        private val senders = CopyOnWriteArrayList<Thread>()

        fun connect() {
            connection.requestMethod = "GET"
            connection.connectTimeout = 2000
            connection.readTimeout = 10000

            readerThread = thread(start = true, isDaemon = true) {
                try {
                    connection.inputStream.bufferedReader().use { reader ->
                        connectedOk.set(true)
                        connected.countDown()
                        var dataLine: String? = null
                        while (true) {
                            val line = reader.readLine() ?: break
                            if (line.startsWith("data:")) {
                                dataLine = line.removePrefix("data:").trim()
                                continue
                            }
                            if (line.isNotEmpty()) continue
                            if (dataLine == null) continue
                            val msg = gson.fromJson(dataLine, JsonObject::class.java)
                            dataLine = null
                            messages += msg
                            queue.put(msg)
                        }
                    }
                } catch (t: Throwable) {
                    if (!closed) {
                        error.set(t)
                    }
                    connected.countDown()
                }
            }

            assertEquals(true, connected.await(2, TimeUnit.SECONDS), "timeout waiting for sse connect")
            error.get()?.let { throw it }
            assertEquals(true, connectedOk.get(), "sse reader exited before connection was established")
        }

        fun send(type: String, payload: JsonObject): JsonObject {
            val request = post(type, payload)
            return awaitReply(request)
        }

        fun post(type: String, payload: JsonObject): Request {
            val id = "msg-${System.currentTimeMillis()}-${(0..9999).random()}"
            val request = Request(id = id, startIndex = messages.size)
            val sendUrl = URL("${session.baseUrl}/send?token=${session.token}")
            val sendConn = sendUrl.openConnection() as HttpURLConnection
            sendConn.requestMethod = "POST"
            sendConn.doOutput = true
            sendConn.connectTimeout = 2000
            sendConn.readTimeout = 2000
            sendConn.setRequestProperty("Content-Type", "application/json")

            val body = JsonObject().apply {
                addProperty("id", id)
                addProperty("type", type)
                add("payload", payload)
            }

            val sender = thread(start = true, isDaemon = true) {
                try {
                    sendConn.outputStream.use { out ->
                        out.write(gson.toJson(body).toByteArray())
                    }
                    assertEquals(204, sendConn.responseCode)
                } catch (t: Throwable) {
                    sendError.compareAndSet(null, t)
                } finally {
                    sendConn.disconnect()
                }
            }
            senders += sender

            return request
        }

        fun awaitReply(request: Request, timeout: Long = 3): JsonObject {
            return awaitSince(request.startIndex, timeout) { msg -> msg.get("replyTo")?.asString == request.id }
        }

        fun awaitEvent(type: String, timeout: Long = 3): JsonObject {
            return awaitSince(0, timeout) { msg -> msg.get("type")?.asString == type }
        }

        fun awaitRelevantCount(request: Request, count: Int, timeout: Long = 3): List<JsonObject> {
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(timeout)
            while (System.nanoTime() < deadline) {
                val relevant = relatedMessages(request)
                if (relevant.size >= count) return relevant
                Thread.sleep(10)
            }
            throw AssertionError("timeout waiting for $count relevant messages")
        }

        fun assertRelatedCount(request: Request, expectedCount: Int, timeoutMs: Long = 200) {
            Thread.sleep(timeoutMs)
            assertEquals(expectedCount, relatedMessages(request).size)
        }

        fun awaitDisconnected(timeout: Long = 3) {
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(timeout)
            while (System.nanoTime() < deadline) {
                error.get()?.let { err ->
                    if (err is IOException) return
                    throw err
                }
                if (readerThread?.isAlive == false) {
                    return
                }
                Thread.sleep(10)
            }
            throw AssertionError("timeout waiting for SSE disconnect")
        }

        override fun close() {
            closed = true
            connection.disconnect()
            readerThread?.join(1000)
            senders.forEach { it.join(1000) }
            error.get()?.let { err -> if (!isExpectedDisconnect(err)) throw err }
            sendError.get()?.let { throw it }
        }

        private fun isExpectedDisconnect(error: Throwable): Boolean {
            return closed && error is IOException
        }

        private fun awaitSince(startIndex: Int, timeout: Long, match: (JsonObject) -> Boolean): JsonObject {
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(timeout)
            while (System.nanoTime() < deadline) {
                error.get()?.let { throw it }
                sendError.get()?.let { throw it }

                messages.drop(startIndex).firstOrNull(match)?.let { return it }

                val remaining = deadline - System.nanoTime()
                val msg = queue.poll(remaining.coerceAtLeast(0), TimeUnit.NANOSECONDS) ?: break
                if (messages.indexOf(msg) >= startIndex && match(msg)) {
                    return msg
                }
            }
            throw AssertionError("timeout waiting for matching SSE message")
        }

        private fun relatedMessages(request: Request): List<JsonObject> {
            return messages.drop(request.startIndex).filter { msg ->
                msg.get("replyTo")?.asString == request.id ||
                    msg.get("type")?.asString == "manualUpdate" ||
                    msg.get("type")?.asString == "error"
            }
        }
    }

    @Test
    fun `selectFiles returns selected file paths`() {
        setNullableIdeBridgeField("chooseFilesHook") { _: Project, mode: String, multiple: Boolean ->
            assertEquals("file", mode)
            assertTrue(multiple)
            listOf("C:/project/test.txt", "C:/project/image.png")
        }
        val session = IdeBridge.createSession(project = project())

        sse(session).use { events ->
            val reply = events.send("selectFiles", JsonObject().apply {
                addProperty("mode", "file")
                addProperty("multiple", true)
            })

            assertEquals(true, reply.get("ok")?.asBoolean)
            val result = reply.getAsJsonObject("result")
            assertEquals(false, result.get("cancelled")?.asBoolean)
            val paths = result.getAsJsonArray("paths")
            assertEquals(2, paths.size())
            assertEquals("C:/project/test.txt", paths[0].asString)
            assertEquals("C:/project/image.png", paths[1].asString)
        }
    }

    @Test
    fun `selectFiles in directory mode returns selected directory path`() {
        setNullableIdeBridgeField("chooseFilesHook") { _: Project, mode: String, multiple: Boolean ->
            assertEquals("directory", mode)
            assertFalse(multiple)
            listOf("C:/project/src")
        }
        val session = IdeBridge.createSession(project = project())

        sse(session).use { events ->
            val reply = events.send("selectFiles", JsonObject().apply {
                addProperty("mode", "directory")
                addProperty("multiple", false)
            })

            assertEquals(true, reply.get("ok")?.asBoolean)
            val result = reply.getAsJsonObject("result")
            assertEquals(false, result.get("cancelled")?.asBoolean)
            val paths = result.getAsJsonArray("paths")
            assertEquals(1, paths.size())
            assertEquals("C:/project/src", paths[0].asString)
        }
    }

    @Test
    fun `selectFiles returns cancelled when user skips dialog`() {
        setNullableIdeBridgeField("chooseFilesHook") { _: Project, _: String, _: Boolean ->
            emptyList<String>()
        }
        val session = IdeBridge.createSession(project = project())

        sse(session).use { events ->
            val reply = events.send("selectFiles", JsonObject().apply {
                addProperty("mode", "file")
            })

            assertEquals(true, reply.get("ok")?.asBoolean)
            val result = reply.getAsJsonObject("result")
            assertEquals(true, result.get("cancelled")?.asBoolean)
            val paths = result.getAsJsonArray("paths")
            assertEquals(0, paths.size())
        }
    }

    @Test
    fun `readFiles returns base64 content and per-file error`() {
        val tempFile = Files.createTempFile("opencode-read", ".txt").toFile()
        try {
            tempFile.writeText("hello")
            val session = IdeBridge.createSession(project = project())

            sse(session).use { events ->
                val reply = events.send("readFiles", JsonObject().apply {
                    add("paths", JsonArray().apply {
                        add(tempFile.absolutePath.replace('\\', '/'))
                        add("C:/does/not/exist/opencode-missing.png")
                    })
                })

                assertEquals(true, reply.get("ok")?.asBoolean)
                val files = reply.getAsJsonObject("result").getAsJsonArray("files")
                assertEquals(2, files.size())
                val first = files[0].getAsJsonObject()
                assertEquals(tempFile.absolutePath.replace('\\', '/'), first.get("path")?.asString)
                assertEquals("aGVsbG8=", first.get("base64")?.asString)
                assertTrue(files[1].getAsJsonObject().has("error"))
            }
        } finally {
            tempFile.delete()
        }
    }

    @Test
    fun `readFiles without paths replies with bridge error`() {
        val session = IdeBridge.createSession(project = project())

        sse(session).use { events ->
            val reply = events.send("readFiles", JsonObject())

            assertEquals(false, reply.get("ok")?.asBoolean)
            assertEquals("Missing paths", reply.get("error")?.asString)
        }
    }

    @Test
    fun `getAcpCapabilities returns default categories and tools`() {
        val session = IdeBridge.createSession(project = project())

        sse(session).use { events ->
            val reply = events.send("getAcpCapabilities", JsonObject())

            assertEquals(true, reply.get("ok")?.asBoolean)
            val result = reply.getAsJsonObject("result")
            val categories = result.getAsJsonArray("categories")
            assertTrue(categories.size() >= 4)

            val toolsByCategory = categories.associate { category ->
                val obj = category.asJsonObject
                obj.get("id").asString to obj.getAsJsonArray("tools").map { it.asJsonObject.get("id").asString }
            }

            assertEquals(listOf("executeAction", "listActions", "editor"), toolsByCategory["intellij"])
            assertEquals(
                listOf(
                    "listRunConfigurations",
                    "getProblems",
                    "runConfiguration",
                    "debugConfiguration",
                    "stopRunConfiguration",
                ),
                toolsByCategory["tasks_and_problems"],
            )
            assertEquals(listOf("sendToTerminal", "runCommand"), toolsByCategory["terminal"])
            assertEquals(
                listOf(
                    "getDebugState",
                    "getCallStack",
                    "getVariables",
                    "listBreakpoints",
                    "addLineBreakpoint",
                    "addExceptionBreakpoint",
                    "removeBreakpoint",
                    "controlExecution",
                    "evaluateExpression",
                ),
                toolsByCategory["debug"],
            )
            assertEquals(setOf("intellij", "tasks_and_problems", "terminal", "debug"), toolsByCategory.keys)

            categories.forEach { category ->
                category.asJsonObject.getAsJsonArray("tools").forEach { tool ->
                    val obj = tool.asJsonObject
                    assertNotNull(obj.get("name"))
                    assertNotNull(obj.get("description"))
                    val schema = obj.getAsJsonObject("parametersSchema")
                    assertEquals("object", schema.get("type").asString)
                    val properties = schema.getAsJsonObject("properties")
                    assertNotNull(properties)
                    // Tools that declare required parameters must describe them.
                    if (schema.get("required") != null) assertTrue(properties.size() > 0)
                }
            }
        }
    }

    @Test
    fun `terminal tools reject missing or blank commands`() {
        val session = IdeBridge.createSession(project = project())

        sse(session).use { events ->
            val send = events.send("executeAcpTool", executeToolPayload("terminal", "sendToTerminal", JsonObject()))
            assertEquals(false, send.get("ok")?.asBoolean)
            assertTrue(send.get("error")?.asString?.contains("command") == true)

            val run = events.send("executeAcpTool", executeToolPayload("terminal", "runCommand", JsonObject()))
            assertEquals(false, run.get("ok")?.asBoolean)
            assertTrue(run.get("error")?.asString?.contains("command") == true)
        }
    }

    @Test
    fun `runCommand executes commands and reports exit codes`() {
        val session = IdeBridge.createSession(project = project())

        sse(session).use { events ->
            val ok = events.send(
                "executeAcpTool",
                executeToolPayload("terminal", "runCommand", JsonObject().apply { addProperty("command", "echo opencode") }),
            )
            assertEquals(true, ok.get("ok")?.asBoolean)
            val okOutput = JsonParser.parseString(ok.getAsJsonObject("result").get("output").asString).asJsonObject
            assertEquals(0, okOutput.get("exitCode").asInt)
            assertTrue(okOutput.get("stdout").asString.contains("opencode"))

            val failed = events.send(
                "executeAcpTool",
                executeToolPayload("terminal", "runCommand", JsonObject().apply { addProperty("command", "exit 3") }),
            )
            assertEquals(true, failed.get("ok")?.asBoolean)
            val failedOutput = JsonParser.parseString(failed.getAsJsonObject("result").get("output").asString).asJsonObject
            assertEquals(3, failedOutput.get("exitCode").asInt)
        }
    }

    @Test
    fun `run configuration tools require a name`() {
        val session = IdeBridge.createSession(project = project())

        sse(session).use { events ->
            val run = events.send("executeAcpTool", executeToolPayload("tasks_and_problems", "runConfiguration", JsonObject()))
            assertEquals(false, run.get("ok")?.asBoolean)
            assertTrue(run.get("error")?.asString?.contains("name") == true)

            val debug = events.send("executeAcpTool", executeToolPayload("tasks_and_problems", "debugConfiguration", JsonObject()))
            assertEquals(false, debug.get("ok")?.asBoolean)
            assertTrue(debug.get("error")?.asString?.contains("name") == true)
        }
    }

    @Test
    fun `run configuration tools report unknown names and missing processes`() {
        val project = project()
        val session = IdeBridge.createSession(project = project)
        val runManager = Mockito.mock(RunManager::class.java)
        val contentManager = Mockito.mock(RunContentManager::class.java)
        Mockito.`when`(project.getService(RunManager::class.java)).thenReturn(runManager)
        Mockito.`when`(project.getService(RunContentManager::class.java)).thenReturn(contentManager)
        Mockito.`when`(runManager.findConfigurationByName(Mockito.anyString())).thenReturn(null)
        Mockito.`when`(contentManager.allDescriptors).thenReturn(emptyList())

        sse(session).use { events ->
            val missing = JsonObject().apply { addProperty("name", "missing") }

            val run = events.send(
                "executeAcpTool",
                executeToolPayload("tasks_and_problems", "runConfiguration", missing),
            )
            assertEquals(false, run.get("ok")?.asBoolean)
            assertTrue(run.get("error")?.asString?.contains("not found") == true)

            val debug = events.send(
                "executeAcpTool",
                executeToolPayload("tasks_and_problems", "debugConfiguration", missing),
            )
            assertEquals(false, debug.get("ok")?.asBoolean)
            assertTrue(debug.get("error")?.asString?.contains("not found") == true)

            val stop = events.send(
                "executeAcpTool",
                executeToolPayload("tasks_and_problems", "stopRunConfiguration", missing),
            )
            assertEquals(false, stop.get("ok")?.asBoolean)
            assertTrue(stop.get("error")?.asString?.contains("No running process") == true)
        }
    }

    @Test
    fun `debug tools reject unsupported actions and missing breakpoint ids`() {
        val session = IdeBridge.createSession(project = project())

        sse(session).use { events ->
            val action = events.send(
                "executeAcpTool",
                executeToolPayload("debug", "controlExecution", JsonObject().apply { addProperty("action", "fly") }),
            )
            assertEquals(false, action.get("ok")?.asBoolean)
            assertTrue(action.get("error")?.asString?.contains("Unsupported action") == true)

            // Underscore spellings are outside the declared enum and must not be accepted.
            val underscored = events.send(
                "executeAcpTool",
                executeToolPayload("debug", "controlExecution", JsonObject().apply { addProperty("action", "step_over") }),
            )
            assertEquals(false, underscored.get("ok")?.asBoolean)
            assertTrue(underscored.get("error")?.asString?.contains("Unsupported action") == true)

            val remove = events.send("executeAcpTool", executeToolPayload("debug", "removeBreakpoint", JsonObject()))
            assertEquals(false, remove.get("ok")?.asBoolean)
            assertTrue(remove.get("error")?.asString?.contains("id") == true)
        }
    }

    @Test
    fun `addLineBreakpoint validates hit count before touching the platform`() {
        val session = IdeBridge.createSession(project = project())

        sse(session).use { events ->
            val invalid = events.send(
                "executeAcpTool",
                executeToolPayload(
                    "debug",
                    "addLineBreakpoint",
                    JsonObject().apply {
                        addProperty("file", "C:/does/not/exist/Foo.java")
                        addProperty("line", 1)
                        addProperty("hitCount", 0)
                    },
                ),
            )
            assertEquals(false, invalid.get("ok")?.asBoolean)
            assertTrue(invalid.get("error")?.asString?.contains("hitCount") == true)
        }
    }

    @Test
    fun `addExceptionBreakpoint validates its parameters`() {
        val session = IdeBridge.createSession(project = project())

        sse(session).use { events ->
            val invalidClass = events.send(
                "executeAcpTool",
                executeToolPayload(
                    "debug",
                    "addExceptionBreakpoint",
                    JsonObject().apply { addProperty("exceptionClass", "not a class!") },
                ),
            )
            assertEquals(false, invalidClass.get("ok")?.asBoolean)
            assertTrue(invalidClass.get("error")?.asString?.contains("exception class") == true)

            val invalidBoolean = events.send(
                "executeAcpTool",
                executeToolPayload(
                    "debug",
                    "addExceptionBreakpoint",
                    JsonObject().apply { addProperty("caught", "maybe") },
                ),
            )
            assertEquals(false, invalidBoolean.get("ok")?.asBoolean)
            assertTrue(invalidBoolean.get("error")?.asString?.contains("caught") == true)

            val noFilter = events.send(
                "executeAcpTool",
                executeToolPayload(
                    "debug",
                    "addExceptionBreakpoint",
                    JsonObject().apply {
                        addProperty("caught", false)
                        addProperty("uncaught", false)
                    },
                ),
            )
            assertEquals(false, noFilter.get("ok")?.asBoolean)
            assertTrue(noFilter.get("error")?.asString?.contains("caught") == true)
        }
    }

    @Test
    fun `sendToTerminal runs commands in a terminal tab`() {
        val project = project()
        val session = IdeBridge.createSession(project = project)
        val manager = Mockito.mock(TerminalToolWindowManager::class.java)
        val widget = Mockito.mock(ShellTerminalWidget::class.java)
        Mockito.`when`(project.getService(TerminalToolWindowManager::class.java)).thenReturn(manager)
        Mockito.`when`(manager.createLocalShellWidget(Mockito.any(), Mockito.any())).thenReturn(widget)

        sse(session).use { events ->
            val reply = events.send(
                "executeAcpTool",
                executeToolPayload(
                    "terminal",
                    "sendToTerminal",
                    JsonObject().apply { addProperty("command", "echo hello") },
                ),
            )
            assertEquals(true, reply.get("ok")?.asBoolean)
            Mockito.verify(widget).executeCommand("echo hello")
        }
    }

    @Test
    fun `run configuration tools start run and debug configurations`() {
        val project = project()
        val session = IdeBridge.createSession(project = project)
        val runManager = Mockito.mock(RunManager::class.java)
        val settings = Mockito.mock(RunnerAndConfigurationSettings::class.java)
        val launched = mutableListOf<Pair<RunnerAndConfigurationSettings, Boolean>>()
        Mockito.`when`(project.getService(RunManager::class.java)).thenReturn(runManager)
        Mockito.`when`(runManager.findConfigurationByName("app")).thenReturn(settings)

        val previousLauncher = executeConfigurationAction
        executeConfigurationAction = { _, configuration, debug -> launched += configuration to debug }
        try {
            sse(session).use { events ->
                val name = JsonObject().apply { addProperty("name", "app") }

                val run = events.send("executeAcpTool", executeToolPayload("tasks_and_problems", "runConfiguration", name))
                assertEquals(true, run.get("ok")?.asBoolean, run.toString())
                assertTrue(run.getAsJsonObject("result").get("output").asString.contains("Run"))

                val debug = events.send("executeAcpTool", executeToolPayload("tasks_and_problems", "debugConfiguration", name))
                assertEquals(true, debug.get("ok")?.asBoolean, debug.toString())
                assertTrue(debug.getAsJsonObject("result").get("output").asString.contains("Debug"))

                assertEquals(listOf(settings to false, settings to true), launched)
            }
        } finally {
            executeConfigurationAction = previousLauncher
        }
    }

    @Test
    fun `stopRunConfiguration stops the matching process`() {
        val project = project()
        val session = IdeBridge.createSession(project = project)
        val contentManager = Mockito.mock(RunContentManager::class.java)
        val handler = Mockito.mock(ProcessHandler::class.java)
        val descriptor = Mockito.mock(RunContentDescriptor::class.java)
        Mockito.`when`(project.getService(RunContentManager::class.java)).thenReturn(contentManager)
        Mockito.`when`(contentManager.allDescriptors).thenReturn(listOf(descriptor))
        Mockito.`when`(descriptor.processHandler).thenReturn(handler)
        Mockito.`when`(handler.isProcessTerminated).thenReturn(false)
        Mockito.`when`(descriptor.runConfigurationName).thenReturn("app")

        sse(session).use { events ->
            val stop = events.send(
                "executeAcpTool",
                executeToolPayload(
                    "tasks_and_problems",
                    "stopRunConfiguration",
                    JsonObject().apply { addProperty("name", "app") },
                ),
            )
            assertEquals(true, stop.get("ok")?.asBoolean)
            assertTrue(stop.getAsJsonObject("result").get("output").asString.contains("app"))
            Mockito.verify(handler).destroyProcess()
        }
    }

    @Test
    fun `debug tools read state frames variables and evaluate expressions`() {
        val project = project()
        val session = IdeBridge.createSession(project = project)
        val manager = Mockito.mock(XDebuggerManager::class.java)
        val debugSession = Mockito.mock(XDebugSession::class.java)
        val context = Mockito.mock(XSuspendContext::class.java)
        val stack = Mockito.mock(XExecutionStack::class.java)
        val frame = Mockito.mock(XStackFrame::class.java)
        val position = Mockito.mock(XSourcePosition::class.java)
        val file = Mockito.mock(VirtualFile::class.java)
        val value = Mockito.mock(XValue::class.java)
        val evaluator = Mockito.mock(XDebuggerEvaluator::class.java)

        Mockito.`when`(project.getService(XDebuggerManager::class.java)).thenReturn(manager)
        Mockito.`when`(manager.debugSessions).thenReturn(arrayOf(debugSession))
        Mockito.`when`(manager.currentSession).thenReturn(debugSession)
        Mockito.`when`(debugSession.sessionName).thenReturn("app")
        Mockito.`when`(debugSession.isSuspended).thenReturn(true)
        Mockito.`when`(debugSession.suspendContext).thenReturn(context)
        Mockito.`when`(context.activeExecutionStack).thenReturn(stack)
        Mockito.`when`(debugSession.topFramePosition).thenReturn(position)
        Mockito.`when`(frame.sourcePosition).thenReturn(position)
        Mockito.`when`(frame.evaluator).thenReturn(evaluator)
        Mockito.`when`(position.file).thenReturn(file)
        Mockito.`when`(file.path).thenReturn("/src/Main.java")
        Mockito.`when`(position.line).thenReturn(41)
        Mockito.doAnswer { invocation ->
            invocation.getArgument<XExecutionStack.XStackFrameContainer>(1)
                .addStackFrames(mutableListOf<XStackFrame>(frame), true)
            null
        }.`when`(stack).computeStackFrames(Mockito.anyInt(), Mockito.any())
        Mockito.doAnswer { invocation ->
            val children = XValueChildrenList()
            children.add("answer", value)
            invocation.getArgument<XCompositeNode>(0).addChildren(children, true)
            null
        }.`when`(frame).computeChildren(Mockito.any())
        Mockito.doAnswer { invocation ->
            invocation.getArgument<XValueNode>(0).setPresentation(null, "42", "int", false)
            null
        }.`when`(value).computePresentation(Mockito.any(), Mockito.any())
        Mockito.doAnswer { invocation ->
            invocation.getArgument<XDebuggerEvaluator.XEvaluationCallback>(1).evaluated(value)
            null
        }.`when`(evaluator).evaluate(Mockito.anyString(), Mockito.any(), Mockito.any())

        sse(session).use { events ->
            val state = events.send("executeAcpTool", executeToolPayload("debug", "getDebugState", JsonObject()))
            assertEquals(true, state.get("ok")?.asBoolean)
            val sessions = JsonParser.parseString(state.getAsJsonObject("result").get("output").asString)
                .asJsonObject.getAsJsonArray("sessions")
            assertEquals(1, sessions.size())
            assertEquals(true, sessions.get(0).asJsonObject.get("paused").asBoolean)

            val callStack = events.send("executeAcpTool", executeToolPayload("debug", "getCallStack", JsonObject()))
            assertEquals(true, callStack.get("ok")?.asBoolean, callStack.toString())
            val frames = JsonParser.parseString(callStack.getAsJsonObject("result").get("output").asString)
                .asJsonObject.getAsJsonArray("frames")
            assertEquals(1, frames.size())
            assertEquals("/src/Main.java", frames.get(0).asJsonObject.get("file").asString)
            assertEquals(42, frames.get(0).asJsonObject.get("line").asInt)

            val variables = events.send("executeAcpTool", executeToolPayload("debug", "getVariables", JsonObject()))
            assertEquals(true, variables.get("ok")?.asBoolean)
            val values = JsonParser.parseString(variables.getAsJsonObject("result").get("output").asString)
                .asJsonObject.getAsJsonArray("variables")
            assertEquals(1, values.size())
            assertEquals("42", values.get(0).asJsonObject.get("value").asString)
            assertEquals("int", values.get(0).asJsonObject.get("type").asString)

            val evaluation = events.send(
                "executeAcpTool",
                executeToolPayload("debug", "evaluateExpression", JsonObject().apply { addProperty("expression", "x + 1") }),
            )
            assertEquals(true, evaluation.get("ok")?.asBoolean)
            val result = JsonParser.parseString(evaluation.getAsJsonObject("result").get("output").asString).asJsonObject
            assertEquals("42", result.get("result").asString)
            assertEquals("int", result.get("type").asString)

            val control = events.send(
                "executeAcpTool",
                executeToolPayload("debug", "controlExecution", JsonObject().apply { addProperty("action", "resume") }),
            )
            assertEquals(true, control.get("ok")?.asBoolean)
            Mockito.verify(debugSession).resume()
        }
    }

    @Test
    fun `listBreakpoints reports breakpoints from the breakpoint manager`() {
        val project = project()
        val session = IdeBridge.createSession(project = project)
        val manager = Mockito.mock(XDebuggerManager::class.java)
        val breakpointManager = Mockito.mock(XBreakpointManager::class.java)
        val breakpoint = Mockito.mock(XLineBreakpoint::class.java)
        Mockito.`when`(project.getService(XDebuggerManager::class.java)).thenReturn(manager)
        Mockito.`when`(manager.breakpointManager).thenReturn(breakpointManager)
        Mockito.`when`(breakpointManager.allBreakpoints).thenReturn(arrayOf(breakpoint))
        Mockito.`when`(breakpoint.isEnabled).thenReturn(true)
        Mockito.`when`(breakpoint.fileUrl).thenReturn("file:///src/Main.java")
        Mockito.`when`(breakpoint.line).thenReturn(41)
        Mockito.`when`(breakpoint.isLogMessage).thenReturn(false)

        sse(session).use { events ->
            val reply = events.send("executeAcpTool", executeToolPayload("debug", "listBreakpoints", JsonObject()))
            assertEquals(true, reply.get("ok")?.asBoolean, reply.toString())
            val breakpoints = JsonParser.parseString(reply.getAsJsonObject("result").get("output").asString)
                .asJsonObject.getAsJsonArray("breakpoints")
            assertEquals(1, breakpoints.size())
            val entry = breakpoints.get(0).asJsonObject
            assertEquals(true, entry.get("enabled").asBoolean)
            assertEquals("file:///src/Main.java", entry.get("file").asString)
            assertEquals(42, entry.get("line").asInt)
        }
    }

    @Test
    fun `addExceptionBreakpoint creates a java exception breakpoint`() {
        val project = project()
        val session = IdeBridge.createSession(project = project)
        val manager = Mockito.mock(XDebuggerManager::class.java)
        val breakpointManager = Mockito.mock(XBreakpointManager::class.java)
        val created = Mockito.mock(XBreakpoint::class.java)
        Mockito.`when`(project.getService(XDebuggerManager::class.java)).thenReturn(manager)
        Mockito.`when`(manager.breakpointManager).thenReturn(breakpointManager)
        Mockito.doReturn(created).`when`(breakpointManager).addBreakpoint(Mockito.any(), Mockito.any())

        sse(session).use { events ->
            val reply = events.send(
                "executeAcpTool",
                executeToolPayload(
                    "debug",
                    "addExceptionBreakpoint",
                    JsonObject().apply {
                        addProperty("exceptionClass", "java.lang.IllegalStateException")
                        addProperty("caught", true)
                        addProperty("uncaught", false)
                    },
                ),
            )
            assertEquals(true, reply.get("ok")?.asBoolean, reply.toString())
            val output = reply.getAsJsonObject("result").get("output").asString
            assertTrue(output.contains("IllegalStateException"))
            assertTrue(output.contains("true"))
            Mockito.verify(breakpointManager).addBreakpoint(Mockito.any(), Mockito.any())
        }
    }

    @Test
    fun `removeBreakpoint deletes the breakpoint reported by listBreakpoints`() {
        val project = project()
        val session = IdeBridge.createSession(project = project)
        val manager = Mockito.mock(XDebuggerManager::class.java)
        val breakpointManager = Mockito.mock(XBreakpointManager::class.java)
        val breakpoint = Mockito.mock(XLineBreakpoint::class.java)
        val userData = HashMap<Key<*>, Any?>()
        Mockito.`when`(project.getService(XDebuggerManager::class.java)).thenReturn(manager)
        Mockito.`when`(manager.breakpointManager).thenReturn(breakpointManager)
        Mockito.`when`(breakpointManager.allBreakpoints).thenReturn(arrayOf(breakpoint))
        Mockito.doAnswer { invocation ->
            userData[invocation.getArgument<Key<*>>(0)]
        }.`when`(breakpoint).getUserData(Mockito.any<Key<String>>())
        Mockito.doAnswer { invocation ->
            userData[invocation.getArgument<Key<*>>(0)] = invocation.getArgument(1)
            null
        }.`when`(breakpoint).putUserData(Mockito.any<Key<String>>(), Mockito.any())

        sse(session).use { events ->
            val listed = events.send("executeAcpTool", executeToolPayload("debug", "listBreakpoints", JsonObject()))
            assertEquals(true, listed.get("ok")?.asBoolean, listed.toString())
            val id = JsonParser.parseString(listed.getAsJsonObject("result").get("output").asString)
                .asJsonObject.getAsJsonArray("breakpoints").get(0).asJsonObject.get("id").asString

            val removed = events.send(
                "executeAcpTool",
                executeToolPayload("debug", "removeBreakpoint", JsonObject().apply { addProperty("id", id) }),
            )
            assertEquals(true, removed.get("ok")?.asBoolean, removed.toString())
            Mockito.verify(breakpointManager).removeBreakpoint(breakpoint)
        }
    }

    @Test
    fun `problem file collection keeps extensionless files and reports skipped directories`() {
        val root = Mockito.mock(VirtualFile::class.java)
        val source = Mockito.mock(VirtualFile::class.java)
        val makefile = Mockito.mock(VirtualFile::class.java)
        val build = Mockito.mock(VirtualFile::class.java)
        val hidden = Mockito.mock(VirtualFile::class.java)
        Mockito.`when`(root.children).thenReturn(arrayOf(source, makefile, build, hidden))
        Mockito.`when`(source.isDirectory).thenReturn(false)
        Mockito.`when`(source.path).thenReturn("/project/A.java")
        Mockito.`when`(makefile.isDirectory).thenReturn(false)
        Mockito.`when`(makefile.path).thenReturn("/project/Makefile")
        Mockito.`when`(build.isDirectory).thenReturn(true)
        Mockito.`when`(build.name).thenReturn("build")
        Mockito.`when`(build.path).thenReturn("/project/build")
        Mockito.`when`(hidden.isDirectory).thenReturn(true)
        Mockito.`when`(hidden.name).thenReturn(".git")
        Mockito.`when`(hidden.path).thenReturn("/project/.git")

        val collected = mutableListOf<VirtualFile>()
        val skipped = mutableListOf<String>()
        val hitLimit = collectFiles(root, collected, skipped)

        assertFalse(hitLimit)
        assertEquals(listOf("/project/A.java", "/project/Makefile"), collected.map { it.path })
        assertEquals(listOf("/project/build", "/project/.git"), skipped)
    }

    @Test
    fun `getProblems reports partial results when only skipped directories remain`() {
        val previous = resolveProblemTargetsAction
        resolveProblemTargetsAction = { _, _ -> ProblemTargets(emptyList(), true, listOf("/project/build")) }
        try {
            val session = IdeBridge.createSession(project = project())

            sse(session).use { events ->
                val reply = events.send(
                    "executeAcpTool",
                    executeToolPayload("tasks_and_problems", "getProblems", JsonObject().apply { addProperty("path", "sub") }),
                )
                assertEquals(true, reply.get("ok")?.asBoolean, reply.toString())
                val output = JsonParser.parseString(reply.getAsJsonObject("result").get("output").asString).asJsonObject
                assertEquals(true, output.get("truncated").asBoolean)
                assertEquals("/project/build", output.getAsJsonArray("skippedDirectories").get(0).asString)
            }
        } finally {
            resolveProblemTargetsAction = previous
        }
    }

    @Test
    fun `getProblems fails explicitly when no files are found`() {
        val previous = resolveProblemTargetsAction
        resolveProblemTargetsAction = { _, _ -> ProblemTargets(emptyList(), false, emptyList()) }
        try {
            val session = IdeBridge.createSession(project = project())

            sse(session).use { events ->
                val withPath = events.send(
                    "executeAcpTool",
                    executeToolPayload("tasks_and_problems", "getProblems", JsonObject().apply { addProperty("path", "missing") }),
                )
                assertEquals(false, withPath.get("ok")?.asBoolean)
                assertTrue(withPath.get("error")?.asString?.contains("No files found") == true)

                val withoutPath = events.send(
                    "executeAcpTool",
                    executeToolPayload("tasks_and_problems", "getProblems", JsonObject()),
                )
                assertEquals(false, withoutPath.get("ok")?.asBoolean)
                assertTrue(withoutPath.get("error")?.asString?.contains("No active file") == true)
            }
        } finally {
            resolveProblemTargetsAction = previous
        }
    }

    @Test
    fun `truncateOutput keeps short text and marks truncated output`() {
        assertEquals("hello", truncateOutput("hello", 10))

        val truncated = truncateOutput("a".repeat(20), 5)
        assertTrue(truncated.startsWith("aaaaa"))
        assertTrue(truncated.contains("truncated 15 characters"))
    }

    @Test
    fun `breakpoint ids stay stable when the breakpoint collection changes`() {
        val first = Mockito.mock(XBreakpoint::class.java)
        val second = Mockito.mock(XBreakpoint::class.java)
        val allocator = BreakpointIdAllocator(InMemoryBreakpointIdStore())

        val firstId = allocator.idOf(first)
        val secondId = allocator.idOf(second)
        assertTrue(firstId != secondId)
        assertEquals(firstId, allocator.idOf(first))
        assertEquals(secondId, allocator.idOf(second))

        // Removing another breakpoint must not renumber the remaining one.
        val remaining = listOf(second).map { allocator.idOf(it) }
        assertEquals(listOf(secondId), remaining)
    }

    @Test
    fun `executeAcpTool routes to hook and returns output`() {
        setNullableIdeBridgeField("executeAcpToolHook") { _: Project, category: String, toolId: String, params: Map<String, Any?> ->
            mapOf("output" to "executed $category/$toolId with ${params["actionId"]}")
        }
        val session = IdeBridge.createSession(project = project())

        sse(session).use { events ->
            val reply = events.send("executeAcpTool", JsonObject().apply {
                addProperty("category", "intellij")
                addProperty("toolId", "executeAction")
                add("parameters", JsonObject().apply {
                    addProperty("actionId", "ReformatCode")
                })
            })

            assertEquals(true, reply.get("ok")?.asBoolean)
            val result = reply.getAsJsonObject("result")
            assertEquals("executed intellij/executeAction with ReformatCode", result.get("output")?.asString)
        }
    }

    @Test
    fun `executeAcpTool missing category or toolId returns error`() {
        val session = IdeBridge.createSession(project = project())

        sse(session).use { events ->
            val reply = events.send("executeAcpTool", JsonObject().apply {
                addProperty("category", "intellij")
            })

            assertEquals(false, reply.get("ok")?.asBoolean)
            assertEquals("Missing category or toolId in executeAcpTool payload", reply.get("error")?.asString)
        }
    }
}
