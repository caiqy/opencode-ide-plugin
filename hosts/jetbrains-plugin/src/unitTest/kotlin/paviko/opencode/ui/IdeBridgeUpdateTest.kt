package paviko.opencode.ui

import com.google.gson.Gson
import com.google.gson.JsonObject
import com.intellij.openapi.application.Application
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.options.Configurable
import com.intellij.openapi.options.SearchableConfigurable
import com.intellij.openapi.options.ShowSettingsUtil
import com.intellij.openapi.project.Project
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
        setNullableIdeBridgeField("readUrlBytesHook", null)
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
}
