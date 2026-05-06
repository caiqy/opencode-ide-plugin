package paviko.opencode.ui

import com.google.gson.Gson
import com.google.gson.JsonObject
import com.intellij.openapi.project.Project
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Test
import org.mockito.Mockito
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread

class IdeBridgeRestartHostTest {
    private val gson = Gson()

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
