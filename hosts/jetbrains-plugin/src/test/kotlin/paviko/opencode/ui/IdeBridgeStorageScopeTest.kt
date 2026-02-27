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

class IdeBridgeStorageScopeTest {
    private val gson = Gson()

    @AfterEach
    fun cleanup() {
        IdeBridge.stop()
    }

    @Test
    fun `only storageGet and storageSet are accepted`() {
        val project = Mockito.mock(Project::class.java)
        Mockito.`when`(project.name).thenReturn("test-project")
        val session = IdeBridge.createSession(project)

        val key = "opencode:webgui:mem:runtime:v1"
        val setRes = send(session, "storageSet", JsonObject().apply {
            addProperty("scope", "mem")
            addProperty("key", key)
            addProperty("value", "{}")
        })
        assertEquals(true, setRes.get("ok")?.asBoolean)

        val getRes = send(session, "storageGet", JsonObject().apply {
            addProperty("scope", "mem")
            add("keys", gson.toJsonTree(listOf(key)))
        })
        assertEquals(true, getRes.get("ok")?.asBoolean)
        assertEquals("{}", getRes.getAsJsonObject("result")?.get(key)?.asString)

        val uiRes = send(session, "uiGetState", JsonObject())
        assertEquals(false, uiRes.get("ok")?.asBoolean)

        val kvRes = send(session, "kv.get", JsonObject())
        assertEquals(false, kvRes.get("ok")?.asBoolean)

        val modelRes = send(session, "model.get", JsonObject())
        assertEquals(false, modelRes.get("ok")?.asBoolean)
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
