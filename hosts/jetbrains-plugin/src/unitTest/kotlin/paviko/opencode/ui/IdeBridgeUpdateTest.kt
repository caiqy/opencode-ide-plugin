package paviko.opencode.ui

import com.google.gson.Gson
import com.google.gson.JsonObject
import com.intellij.openapi.project.Project
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.mockito.Mockito
import paviko.opencode.update.AvailablePluginUpdate
import paviko.opencode.update.PluginUpdateService
import paviko.opencode.update.UpdateRelease
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread

class IdeBridgeUpdateTest {
    private val gson = Gson()

    @AfterEach
    fun cleanup() {
        IdeBridge.installStartRunner = null
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
    fun `getUpdateInfo returns marketplace only support state`() {
        val session = IdeBridge.createSession(
            project = project(),
            updateService = PluginUpdateService(
                currentVersionProvider = { "26.5.501" },
                distributionChannelProvider = { "local" },
                latestProvider = { null },
                backgroundRunner = { task -> task() },
            ),
        )

        sse(session).use { events ->
            val reply = events.send("getUpdateInfo", JsonObject())
            val result = reply.getAsJsonObject("result")

            assertEquals(true, reply.get("ok")?.asBoolean)
            assertNotNull(result)
            assertEquals(false, result.get("supported")?.asBoolean)
            assertEquals("marketplace-only", result.get("reason")?.asString)
        }
    }

    @Test
    fun `checkForUpdates returns structured available result`() {
        val session = IdeBridge.createSession(
            project = project(),
            updateService = PluginUpdateService(
                currentVersionProvider = { "26.5.501" },
                distributionChannelProvider = { "marketplace" },
                latestProvider = {
                    AvailablePluginUpdate(
                        release = UpdateRelease(version = "26.5.502"),
                        install = {},
                    )
                },
                backgroundRunner = { task -> task() },
            ),
        )

        sse(session).use { events ->
            val reply = events.send("checkForUpdates", JsonObject())
            val result = reply.getAsJsonObject("result")

            assertEquals(true, reply.get("ok")?.asBoolean)
            assertNotNull(result)
            assertEquals("available", result.get("status")?.asString)
            assertEquals("26.5.502", result.getAsJsonObject("latest")?.get("version")?.asString)
        }
    }

    @Test
    fun `getUpdateInfo failure replies with error and later request still succeeds`() {
        val attempts = AtomicInteger(0)
        val session = IdeBridge.createSession(
            project = project(),
            updateService = PluginUpdateService(
                currentVersionProvider = {
                    if (attempts.getAndIncrement() == 0) {
                        throw IllegalStateException("boom")
                    }
                    "26.5.501"
                },
                distributionChannelProvider = { "local" },
                latestProvider = { null },
                backgroundRunner = { task -> task() },
            ),
        )

        sse(session).use { events ->
            val failure = events.send("getUpdateInfo", JsonObject())
            assertEquals(false, failure.get("ok")?.asBoolean)
            assertEquals("getUpdateInfo failed: boom", failure.get("error")?.asString)

            val success = events.send("getUpdateInfo", JsonObject())
            val result = success.getAsJsonObject("result")

            assertEquals(true, success.get("ok")?.asBoolean)
            assertEquals(false, result.get("supported")?.asBoolean)
            assertEquals("marketplace-only", result.get("reason")?.asString)
        }
    }

    @Test
    fun `installUpdate replies before starting install and emits bridge events`() {
        val installed = AtomicInteger(0)
        val replyObserved = CountDownLatch(1)
        val startRequested = CountDownLatch(1)
        val allowInstall = CountDownLatch(1)
        val startedBeforeReply = AtomicBoolean(false)

        val service = PluginUpdateService(
            currentVersionProvider = { "26.5.501" },
            distributionChannelProvider = { "marketplace" },
            latestProvider = {
                AvailablePluginUpdate(
                    release = UpdateRelease(version = "26.5.502"),
                    install = {
                        allowInstall.await(2, TimeUnit.SECONDS)
                        installed.incrementAndGet()
                    },
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
        )
        service.checkForUpdates()

        val session = IdeBridge.createSession(project = project(), updateService = service)

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
            assertEquals("installing", relevant[1].get("type")?.asString)
            assertEquals("26.5.502", relevant[1].getAsJsonObject("payload")?.get("version")?.asString)

            allowInstall.countDown()

            val success = events.awaitEvent("success")
            assertEquals("26.5.502", success.getAsJsonObject("payload")?.get("version")?.asString)
            assertEquals(1, installed.get())
        }
    }

    @Test
    fun `installUpdate missing version returns error reply`() {
        val session = IdeBridge.createSession(
            project = project(),
            updateService = PluginUpdateService(
                currentVersionProvider = { "26.5.501" },
                distributionChannelProvider = { "marketplace" },
                latestProvider = { null },
                backgroundRunner = { task -> task() },
            ),
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
            updateService = PluginUpdateService(
                currentVersionProvider = { "26.5.501" },
                distributionChannelProvider = { "marketplace" },
                latestProvider = { null },
                backgroundRunner = { task -> task() },
            ),
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
        val installed = AtomicInteger(0)
        IdeBridge.installStartRunner = {
            throw RejectedExecutionException("scheduler down")
        }

        val service = PluginUpdateService(
            currentVersionProvider = { "26.5.501" },
            distributionChannelProvider = { "marketplace" },
            latestProvider = {
                AvailablePluginUpdate(
                    release = UpdateRelease(version = "26.5.502"),
                    install = { installed.incrementAndGet() },
                )
            },
            backgroundRunner = { task -> task() },
        )
        service.checkForUpdates()

        val session = IdeBridge.createSession(project = project(), updateService = service)

        sse(session).use { events ->
            val request = events.post("installUpdate", JsonObject().apply {
                addProperty("version", "26.5.502")
            })

            val reply = events.awaitReply(request)
            assertEquals(false, reply.get("ok")?.asBoolean)
            assertEquals("installUpdate failed: scheduler down", reply.get("error")?.asString)
            events.assertRelatedCount(request, 1)
            assertEquals(0, installed.get())
        }
    }

    private fun project(): Project {
        val project = Mockito.mock(Project::class.java)
        Mockito.`when`(project.name).thenReturn("update-test-project")
        return project
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
                if (readerThread?.isAlive == false) {
                    return
                }
                error.get()?.let { throw it }
                Thread.sleep(10)
            }
            throw AssertionError("timeout waiting for SSE disconnect")
        }

        override fun close() {
            closed = true
            connection.disconnect()
            readerThread?.join(1000)
            senders.forEach { it.join(1000) }
            error.get()?.let { throw it }
            sendError.get()?.let { throw it }
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
                    msg.get("type")?.asString == "installing" ||
                    msg.get("type")?.asString == "success" ||
                    msg.get("type")?.asString == "error"
            }
        }
    }
}
