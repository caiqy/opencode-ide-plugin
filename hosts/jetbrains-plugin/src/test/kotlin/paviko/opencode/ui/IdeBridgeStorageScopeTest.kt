package paviko.opencode.ui

import com.google.gson.Gson
import com.google.gson.JsonObject
import com.intellij.openapi.project.Project
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test
import org.mockito.Mockito
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
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
    fun `storage routes by scope and legacy writes are rejected`() {
        val backend = InMemoryStorageBackend()

        val project = Mockito.mock(Project::class.java)
        Mockito.`when`(project.name).thenReturn("test-project")
        val first = IdeBridge.createSession(project, backend)

        val memKey = "opencode:webgui:mem:runtime:v1"
        val globalKey = "opencode:webgui:global:theme:v1"
        val workspaceKey = "opencode:webgui:workspace:tabs:v1"

        val setMemRes = send(first, "storageSet", JsonObject().apply {
            addProperty("scope", "mem")
            addProperty("key", memKey)
            addProperty("value", "{}")
        })
        assertEquals(true, setMemRes.get("ok")?.asBoolean)
        assertNull(backend.global[memKey])
        assertNull(backend.workspace[project]?.get(memKey))

        val getMemRes = send(first, "storageGet", JsonObject().apply {
            addProperty("scope", "mem")
            add("keys", gson.toJsonTree(listOf(memKey)))
        })
        assertEquals(true, getMemRes.get("ok")?.asBoolean)
        assertEquals("{}", getMemRes.getAsJsonObject("result")?.get(memKey)?.asString)

        val setGlobalRes = send(first, "storageSet", JsonObject().apply {
            addProperty("scope", "global")
            addProperty("key", globalKey)
            addProperty("value", "\"dark\"")
        })
        assertEquals(true, setGlobalRes.get("ok")?.asBoolean)
        assertEquals("\"dark\"", backend.global[globalKey])

        val getGlobalRes = send(first, "storageGet", JsonObject().apply {
            addProperty("scope", "global")
            add("keys", gson.toJsonTree(listOf(globalKey)))
        })
        assertEquals(true, getGlobalRes.get("ok")?.asBoolean)
        assertEquals("\"dark\"", getGlobalRes.getAsJsonObject("result")?.get(globalKey)?.asString)

        val setWorkspaceRes = send(first, "storageSet", JsonObject().apply {
            addProperty("scope", "workspace")
            addProperty("key", workspaceKey)
            addProperty("value", "{\"active\":\"tab-1\"}")
        })
        assertEquals(true, setWorkspaceRes.get("ok")?.asBoolean)
        assertEquals("{\"active\":\"tab-1\"}", backend.workspace[project]?.get(workspaceKey))

        val getWorkspaceRes = send(first, "storageGet", JsonObject().apply {
            addProperty("scope", "workspace")
            add("keys", gson.toJsonTree(listOf(workspaceKey)))
        })
        assertEquals(true, getWorkspaceRes.get("ok")?.asBoolean)
        assertEquals("{\"active\":\"tab-1\"}", getWorkspaceRes.getAsJsonObject("result")?.get(workspaceKey)?.asString)

        IdeBridge.removeSession(first.sessionId)
        val second = IdeBridge.createSession(project, backend)

        val globalAfterNewSession = send(second, "storageGet", JsonObject().apply {
            addProperty("scope", "global")
            add("keys", gson.toJsonTree(listOf(globalKey)))
        })
        assertEquals("\"dark\"", globalAfterNewSession.getAsJsonObject("result")?.get(globalKey)?.asString)

        val workspaceAfterNewSession = send(second, "storageGet", JsonObject().apply {
            addProperty("scope", "workspace")
            add("keys", gson.toJsonTree(listOf(workspaceKey)))
        })
        assertEquals("{\"active\":\"tab-1\"}", workspaceAfterNewSession.getAsJsonObject("result")?.get(workspaceKey)?.asString)

        val memAfterNewSession = send(second, "storageGet", JsonObject().apply {
            addProperty("scope", "mem")
            add("keys", gson.toJsonTree(listOf(memKey)))
        })
        assertFalse(memAfterNewSession.getAsJsonObject("result")?.has(memKey) ?: true)

        val uiRes = send(second, "uiGetState", JsonObject())
        assertEquals(false, uiRes.get("ok")?.asBoolean)

        val uiSetRes = send(second, "uiSetState", JsonObject())
        assertEquals(false, uiSetRes.get("ok")?.asBoolean)

        val kvRes = send(second, "kv.get", JsonObject())
        assertEquals(false, kvRes.get("ok")?.asBoolean)

        val kvUpdateRes = send(second, "kv.update", JsonObject())
        assertEquals(false, kvUpdateRes.get("ok")?.asBoolean)

        val modelRes = send(second, "model.get", JsonObject())
        assertEquals(false, modelRes.get("ok")?.asBoolean)

        val modelUpdateRes = send(second, "model.update", JsonObject())
        assertEquals(false, modelUpdateRes.get("ok")?.asBoolean)
    }

    private class InMemoryStorageBackend : IdeBridgeStorageBackend {
        val global = ConcurrentHashMap<String, String>()
        val workspace = ConcurrentHashMap<Project, MutableMap<String, String>>()

        override fun getGlobal(key: String): String? = global[key]

        override fun setGlobal(key: String, value: String) {
            global[key] = value
        }

        override fun getWorkspace(project: Project, key: String): String? = workspace[project]?.get(key)

        override fun setWorkspace(project: Project, key: String, value: String) {
            workspace.computeIfAbsent(project) { ConcurrentHashMap() }[key] = value
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
