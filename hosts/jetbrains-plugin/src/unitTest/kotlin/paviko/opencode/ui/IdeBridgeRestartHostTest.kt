package paviko.opencode.ui

import com.google.gson.Gson
import com.google.gson.JsonObject
import com.intellij.openapi.application.Application
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.Project
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Test
import org.mockito.Mockito
import java.awt.SystemTray
import java.awt.TrayIcon
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import javax.swing.SwingUtilities
import kotlin.concurrent.thread

class IdeBridgeRestartHostTest {
    private val gson = Gson()

    private data class NotificationCall(
        val project: Project,
        val sessionID: String,
        val title: String,
        val body: String,
        val onClick: () -> Unit,
    )

    @AfterEach
    fun cleanup() {
        IdeBridge.stop()
    }

    @Test
    fun `restartHost 调用重启 hook 并返回 ok`() {
        var called = 0
        val prev = IdeBridge.restartHook
        IdeBridge.restartHook = { called += 1 }

        try {
            val project = Mockito.mock(Project::class.java)
            Mockito.`when`(project.name).thenReturn("test-project")
            val session = IdeBridge.createSession(project)

            val reply = send(session, "restartHost", JsonObject())
            assertEquals(true, reply.get("ok")?.asBoolean)
            assertEquals(1, called)
        } finally {
            IdeBridge.restartHook = prev
        }
    }

    @Test
    fun `showSystemNotification 映射字段并在点击后先激活再回传 openSession 且重复点击幂等`() {
        val calls = mutableListOf<NotificationCall>()
        val clickEvents = mutableListOf<String>()
        val prevNotificationHook = IdeBridge.notificationHook
        val prevClickHook = IdeBridge.notificationClickHook
        IdeBridge.notificationHook = { project, sessionID, title, body, onClick ->
            calls.add(NotificationCall(project, sessionID, title, body, onClick))
        }
        IdeBridge.notificationClickHook = { project, openSession ->
            clickEvents.add("activate:${project.name}")
            openSession()
        }

        try {
            val project = Mockito.mock(Project::class.java)
            Mockito.`when`(project.name).thenReturn("test-project")
            val session = IdeBridge.createSession(project)
            SseClient(session).use { sse ->
                val firstReply = send(session, "showSystemNotification", JsonObject().apply {
                    addProperty("sessionID", "s-1")
                    addProperty("title", "Agent finished")
                    addProperty("body", "Finished working.")
                })
                val secondReply = send(session, "showSystemNotification", JsonObject().apply {
                    addProperty("sessionID", "s-2")
                    addProperty("title", "Permission request")
                    addProperty("body", "Need approval.")
                })

                assertEquals(true, firstReply.get("ok")?.asBoolean)
                assertEquals(true, secondReply.get("ok")?.asBoolean)
                assertEquals(
                    listOf(
                        "test-project|s-1|Agent finished|Finished working.",
                        "test-project|s-2|Permission request|Need approval.",
                    ),
                    calls.map { "${it.project.name}|${it.sessionID}|${it.title}|${it.body}" },
                )

                calls[0].onClick()
                clickEvents.add("event:${sse.awaitMessage("openSession").getAsJsonObject("payload").get("sessionID").asString}")
                calls[0].onClick()
                sse.assertNoMessage("openSession", 200)
                calls[1].onClick()
                clickEvents.add("event:${sse.awaitMessage("openSession").getAsJsonObject("payload").get("sessionID").asString}")

                assertEquals(
                    listOf(
                        "activate:test-project",
                        "event:s-1",
                        "activate:test-project",
                        "event:s-2",
                    ),
                    clickEvents,
                )
            }
        } finally {
            IdeBridge.notificationHook = prevNotificationHook
            IdeBridge.notificationClickHook = prevClickHook
        }
    }

    @Test
    fun `showSystemNotification 在不同 project session 间隔离 click 回传`() {
        val calls = mutableListOf<NotificationCall>()
        val prevNotificationHook = IdeBridge.notificationHook
        val prevClickHook = IdeBridge.notificationClickHook
        IdeBridge.notificationHook = { project, sessionID, title, body, onClick ->
            calls.add(NotificationCall(project, sessionID, title, body, onClick))
        }
        IdeBridge.notificationClickHook = { _, openSession -> openSession() }

        try {
            val projectA = Mockito.mock(Project::class.java)
            Mockito.`when`(projectA.name).thenReturn("project-a")
            val projectB = Mockito.mock(Project::class.java)
            Mockito.`when`(projectB.name).thenReturn("project-b")
            val sessionA = IdeBridge.createSession(projectA)
            val sessionB = IdeBridge.createSession(projectB)

            SseClient(sessionA).use { sseA ->
                SseClient(sessionB).use { sseB ->
                    assertEquals(true, send(sessionA, "showSystemNotification", JsonObject().apply {
                        addProperty("sessionID", "session-a")
                        addProperty("title", "Agent finished")
                        addProperty("body", "Finished A.")
                    }).get("ok")?.asBoolean)
                    assertEquals(true, send(sessionB, "showSystemNotification", JsonObject().apply {
                        addProperty("sessionID", "session-b")
                        addProperty("title", "Permission request")
                        addProperty("body", "Finished B.")
                    }).get("ok")?.asBoolean)

                    assertEquals(listOf("project-a", "project-b"), calls.map { it.project.name })

                    calls.first { it.project.name == "project-a" }.onClick()
                    assertEquals("session-a", sseA.awaitMessage("openSession").getAsJsonObject("payload").get("sessionID").asString)
                    sseB.assertNoMessage("openSession", 200)

                    calls.first { it.project.name == "project-b" }.onClick()
                    assertEquals("session-b", sseB.awaitMessage("openSession").getAsJsonObject("payload").get("sessionID").asString)
                    sseA.assertNoMessage("openSession", 200)
                }
            }
        } finally {
            IdeBridge.notificationHook = prevNotificationHook
            IdeBridge.notificationClickHook = prevClickHook
        }
    }

    @Test
    fun `showSystemNotification 拒绝缺失空白和非字符串字段`() {
        val calls = mutableListOf<NotificationCall>()
        val prev = IdeBridge.notificationHook
        IdeBridge.notificationHook = { project, sessionID, title, body, onClick ->
            calls.add(NotificationCall(project, sessionID, title, body, onClick))
        }

        try {
            val project = Mockito.mock(Project::class.java)
            Mockito.`when`(project.name).thenReturn("test-project")
            val session = IdeBridge.createSession(project)
            val payloads = listOf(
                JsonObject().apply {
                    addProperty("title", "Agent finished")
                    addProperty("body", "Finished working.")
                },
                JsonObject().apply {
                    addProperty("sessionID", " ")
                    addProperty("title", "Agent finished")
                    addProperty("body", "Finished working.")
                },
                JsonObject().apply {
                    addProperty("sessionID", 123)
                    addProperty("title", "Agent finished")
                    addProperty("body", "Finished working.")
                },
                JsonObject().apply {
                    addProperty("sessionID", "s-1")
                    addProperty("body", "Finished working.")
                },
                JsonObject().apply {
                    addProperty("sessionID", "s-1")
                    addProperty("title", " ")
                    addProperty("body", "Finished working.")
                },
                JsonObject().apply {
                    addProperty("sessionID", "s-1")
                    addProperty("title", 123)
                    addProperty("body", "Finished working.")
                },
                JsonObject().apply {
                    addProperty("sessionID", "s-1")
                    addProperty("title", "Agent finished")
                },
                JsonObject().apply {
                    addProperty("sessionID", "s-1")
                    addProperty("title", "Agent finished")
                    addProperty("body", " ")
                },
                JsonObject().apply {
                    addProperty("sessionID", "s-1")
                    addProperty("title", "Agent finished")
                    addProperty("body", 123)
                },
            )

            payloads.forEach { payload ->
                assertEquals(false, send(session, "showSystemNotification", payload).get("ok")?.asBoolean)
            }
            assertEquals(emptyList<NotificationCall>(), calls)
        } finally {
            IdeBridge.notificationHook = prev
        }
    }

    @Test
    fun `stop 清理仍在显示的系统通知托盘图标`() {
        val tray = Mockito.mock(SystemTray::class.java)
        val trayIcon = Mockito.mock(TrayIcon::class.java)
        val field = IdeBridge::class.java.getDeclaredField("activeTrayIcons").apply { isAccessible = true }
        @Suppress("UNCHECKED_CAST")
        val activeTrayIcons = field.get(IdeBridge) as MutableMap<TrayIcon, SystemTray>
        activeTrayIcons[trayIcon] = tray

        IdeBridge.stop()

        assertEquals(emptyMap<TrayIcon, SystemTray>(), activeTrayIcons)
        Mockito.verify(tray).remove(trayIcon)
    }

    @Test
    fun `默认通知点击在 EDT 外回传 openSession`() {
        val project = Mockito.mock(Project::class.java)
        val app = Mockito.mock(Application::class.java)
        val onEdt = AtomicReference<Boolean?>(null)
        val called = CountDownLatch(1)
        IdeBridge.start()
        Mockito.doAnswer {
            SwingUtilities.invokeLater(it.arguments[0] as Runnable)
            null
        }.`when`(app).invokeLater(Mockito.any(Runnable::class.java))

        Mockito.mockStatic(ApplicationManager::class.java).use { applicationManager ->
            applicationManager.`when`<Application> { ApplicationManager.getApplication() }.thenReturn(app)
            IdeBridge.notificationClickHook(project) {
                onEdt.set(SwingUtilities.isEventDispatchThread())
                called.countDown()
            }

            assertEquals(true, called.await(2, TimeUnit.SECONDS))
            assertEquals(false, onEdt.get())
        }
    }

    private inner class SseClient(session: SessionInfo) : AutoCloseable {
        private val messages = LinkedBlockingQueue<JsonObject>()
        private val error = AtomicReference<Throwable?>(null)
        private val connected = CountDownLatch(1)
        private val closing = AtomicBoolean(false)
        private val connection = (URL("${session.baseUrl}/events?token=${session.token}").openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 2000
            readTimeout = 10000
        }
        private val readerThread = thread(start = true) {
            try {
                connection.inputStream.bufferedReader().use { reader ->
                    connected.countDown()
                    var event = "message"
                    var dataLine: String? = null
                    while (true) {
                        val line = reader.readLine() ?: break
                        if (line.startsWith("event:")) {
                            event = line.removePrefix("event:").trim()
                            continue
                        }
                        if (line.startsWith("data:")) {
                            dataLine = line.removePrefix("data:").trim()
                            continue
                        }
                        if (line.isNotEmpty() || dataLine == null) continue
                        if (event == "message") {
                            messages.put(gson.fromJson(dataLine, JsonObject::class.java))
                        }
                        event = "message"
                        dataLine = null
                    }
                }
            } catch (e: Throwable) {
                if (!closing.get()) error.set(e)
            } finally {
                connected.countDown()
            }
        }

        init {
            assertEquals(true, connected.await(2, TimeUnit.SECONDS), "timeout waiting for sse connect")
        }

        fun awaitMessage(type: String): JsonObject {
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3)
            while (true) {
                val err = error.get()
                if (err != null) throw err

                val remaining = deadline - System.nanoTime()
                if (remaining <= 0) break

                val msg = messages.poll(remaining, TimeUnit.NANOSECONDS)
                if (msg?.get("type")?.asString == type) {
                    return msg
                }
            }
            throw AssertionError("timeout waiting for $type message")
        }

        fun assertNoMessage(type: String, timeoutMs: Long) {
            val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs)
            while (true) {
                val err = error.get()
                if (err != null) throw err

                val remaining = deadline - System.nanoTime()
                if (remaining <= 0) return

                val msg = messages.poll(remaining, TimeUnit.NANOSECONDS) ?: return
                if (msg.get("type")?.asString == type) {
                    throw AssertionError("unexpected $type message: $msg")
                }
            }
        }

        override fun close() {
            closing.set(true)
            connection.disconnect()
            readerThread.join(1000)
        }
    }

    private fun send(session: SessionInfo, type: String, payload: JsonObject): JsonObject {
        val id = "msg-${System.currentTimeMillis()}-${(0..9999).random()}"
        val result = AtomicReference<JsonObject?>(null)
        val error = AtomicReference<Throwable?>(null)
        val ready = CountDownLatch(1)
        val connected = CountDownLatch(1)

        val sseUrl = URL("${session.baseUrl}/events?token=${session.token}")
        val sseConn = sseUrl.openConnection() as HttpURLConnection
        sseConn.requestMethod = "GET"
        sseConn.connectTimeout = 2000
        sseConn.readTimeout = 10000

        val readerThread = thread(start = true) {
            try {
                sseConn.inputStream.bufferedReader().use { reader ->
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
                        if (msg.get("replyTo")?.asString != id) continue
                        result.set(msg)
                        ready.countDown()
                        break
                    }
                }
            } catch (e: Throwable) {
                error.set(e)
                connected.countDown()
                ready.countDown()
            }
        }

        assertEquals(true, connected.await(2, TimeUnit.SECONDS), "timeout waiting for sse connect")

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
        sendConn.outputStream.use { out ->
            out.write(gson.toJson(body).toByteArray())
        }
        assertEquals(204, sendConn.responseCode)

        val ok = ready.await(3, TimeUnit.SECONDS)
        sseConn.disconnect()
        readerThread.join(1000)

        val err = error.get()
        if (err != null) throw err
        assertEquals(true, ok, "timeout waiting for $type reply")
        val msg = result.get()
        assertNotNull(msg)
        return msg!!
    }
}
