# JetBrains Marketplace 站内更新 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 JetBrains Marketplace 安装版支持站内检查更新与原生安装，同时让本地 ZIP / 开发版明确降级，并保持 WebGUI 继续复用现有 `UpdateContext`。

**Architecture:** 先在 JetBrains 宿主新增独立的 `PluginUpdateService`，由它负责分发渠道判断、Marketplace 兼容版本查询和原生安装准备；再通过 `IdeBridge` 暴露 `getUpdateInfo`、`checkForUpdates`、`installUpdate` 三个请求，并保证安装动作先回包再启动。最后只对 WebGUI 做最小兼容改动：处理 `unsupported` 结果，并把成功文案从“重载 VSCode”调整为根据 `restartMode` 区分 VSCode / JetBrains。

**Tech Stack:** Kotlin 1.9、IntelliJ Platform API（`MarketplaceRequests`、`PluginDownloader`、`PluginManagerCore`）、TypeScript、React 19、Vitest、GitHub Actions YAML、Markdown

---

## File Structure

- `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/update/PluginUpdateModels.kt`
  - 新增 JetBrains 更新数据模型、事件载荷与预安装对象。
- `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/update/PluginUpdateService.kt`
  - 新增 JetBrains 更新总入口，封装分发渠道识别、Marketplace 查询、安装准备与事件发射。
- `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/update/PluginUpdateServiceTest.kt`
  - 新增 `PluginUpdateService` 的纯行为测试。
- `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt`
  - 接入更新 service，新增 `getUpdateInfo`、`checkForUpdates`、`installUpdate` bridge handler，以及结构化 reply helper。
- `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/IdeBridgeUpdateTest.kt`
  - 新增 JetBrains update bridge roundtrip 测试。
- `hosts/jetbrains-plugin/build.gradle.kts`
  - 把 `distribution.channel` 注入 `processResources`。
- `hosts/jetbrains-plugin/src/main/resources/opencode-build.properties`
  - 新增 `distribution.channel=${distributionChannel}`。
- `packages/opencode/webgui/src/state/UpdateContext.tsx`
  - 识别 JetBrains `unsupported` 结果，并让初始化读取支持宿主能力声明。
- `packages/opencode/webgui/src/state/UpdateContext.test.tsx`
  - 新增 JetBrains `unsupported` 场景测试。
- `packages/opencode/webgui/src/components/UpdateBanner.tsx`
  - 根据 `ideBridge.restartMode` 区分 VSCode / JetBrains 成功文案。
- `packages/opencode/webgui/src/components/UpdateBanner.test.tsx`
  - 新增 JetBrains success copy 测试。
- `.github/workflows/release.yml`
  - 让 JetBrains Marketplace build/sign/publish 显式注入 `-Pdistribution.channel=marketplace`，并校验产物里的 `opencode-build.properties`。
- `docs/repowiki/02-ide-bridge.md`
  - 更新 bridge 更新能力说明。
- `docs/repowiki/06-settings-update-localization.md`
  - 更新 JetBrains 更新边界说明。
- `docs/repowiki/07-host-plugins.md`
  - 更新 VSCode / JetBrains 更新能力对比与维护注意点。

### Task 1: JetBrains 更新模型、分发渠道与 Service

**Files:**

- Create: `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/update/PluginUpdateModels.kt`
- Create: `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/update/PluginUpdateService.kt`
- Test: `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/update/PluginUpdateServiceTest.kt`
- Modify: `hosts/jetbrains-plugin/build.gradle.kts`
- Modify: `hosts/jetbrains-plugin/src/main/resources/opencode-build.properties`

- [ ] **Step 1: 先写 `PluginUpdateService` 的失败测试**

在 `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/update/PluginUpdateServiceTest.kt` 写入完整测试文件：

```kotlin
package paviko.opencode.update

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

class PluginUpdateServiceTest {
    @Test
    fun `local build reports marketplace only support`() {
        val service = PluginUpdateService(
            currentVersionProvider = { "26.5.501" },
            distributionChannelProvider = { "local" },
            latestProvider = {
                throw AssertionError("latestProvider should not run for local builds")
            },
            backgroundRunner = { task -> task() },
        )

        assertEquals(
            UpdateInfoResult(
                supported = false,
                reason = "marketplace-only",
                currentVersion = "26.5.501",
                latest = null,
                hasUpdate = false,
            ),
            service.getUpdateInfo(),
        )

        assertEquals(
            CheckForUpdatesResult.Unsupported(
                currentVersion = "26.5.501",
                reason = "marketplace-only",
            ),
            service.checkForUpdates(),
        )
    }

    @Test
    fun `marketplace build returns available update and caches it`() {
        val service = PluginUpdateService(
            currentVersionProvider = { "26.5.501" },
            distributionChannelProvider = { "marketplace" },
            latestProvider = {
                AvailablePluginUpdate(
                    release = UpdateRelease(version = "26.5.502"),
                    install = {},
                )
            },
            backgroundRunner = { task -> task() },
        )

        assertEquals(
            CheckForUpdatesResult.Available(
                latest = UpdateRelease(version = "26.5.502"),
            ),
            service.checkForUpdates(),
        )

        assertEquals(
            UpdateInfoResult(
                supported = true,
                reason = null,
                currentVersion = "26.5.501",
                latest = UpdateRelease(version = "26.5.502"),
                hasUpdate = true,
            ),
            service.getUpdateInfo(),
        )
    }

    @Test
    fun `prepareInstall rejects a stale version`() {
        val service = PluginUpdateService(
            currentVersionProvider = { "26.5.501" },
            distributionChannelProvider = { "marketplace" },
            latestProvider = {
                AvailablePluginUpdate(
                    release = UpdateRelease(version = "26.5.502"),
                    install = {},
                )
            },
            backgroundRunner = { task -> task() },
        )

        service.checkForUpdates()

        val error = assertThrows(IllegalStateException::class.java) {
            service.prepareInstall("26.5.503")
        }

        assertEquals("Update not available: 26.5.503", error.message)
    }

    @Test
    fun `prepared install emits installing then success and clears latest`() {
        var installed = 0
        val events = mutableListOf<String>()
        val payloads = mutableListOf<Map<String, Any?>>()

        val service = PluginUpdateService(
            currentVersionProvider = { "26.5.501" },
            distributionChannelProvider = { "marketplace" },
            latestProvider = {
                AvailablePluginUpdate(
                    release = UpdateRelease(version = "26.5.502"),
                    install = { installed += 1 },
                )
            },
            backgroundRunner = { task -> task() },
        )

        service.checkForUpdates()
        val prepared = service.prepareInstall("26.5.502")
        prepared.start { type, payload ->
            events += type
            payloads += payload
        }

        assertEquals(1, installed)
        assertEquals(listOf("installing", "success"), events)
        assertEquals("26.5.502", payloads.first()["version"])
        assertNull(service.getUpdateInfo().latest)
        assertEquals(false, service.getUpdateInfo().hasUpdate)
    }
}
```

- [ ] **Step 2: 运行 JetBrains 单测，确认它先失败**

Run（在 `hosts/jetbrains-plugin` 目录）:

```bash
gradlew.bat unitTest --tests "paviko.opencode.update.PluginUpdateServiceTest"
```

Expected: FAIL，报错包含 `unresolved reference: PluginUpdateService`、`UpdateInfoResult`、`CheckForUpdatesResult` 或 `AvailablePluginUpdate`，证明测试先锁定了新能力缺口。

- [ ] **Step 3: 注入 `distribution.channel` 构建元数据**

把 `hosts/jetbrains-plugin/build.gradle.kts` 的 `processResources` 片段替换成下面这段：

```kotlin
    processResources {
        val minVersion = project.findProperty("opencode.min.version")?.toString() ?: "1.1.1"
        val distributionChannel = project.findProperty("distribution.channel")?.toString() ?: "local"
        inputs.property("opencodeMinVersion", minVersion)
        inputs.property("distributionChannel", distributionChannel)
        filesMatching("opencode-build.properties") {
            expand(
                "opencodeMinVersion" to minVersion,
                "distributionChannel" to distributionChannel,
            )
        }
    }
```

把 `hosts/jetbrains-plugin/src/main/resources/opencode-build.properties` 改成：

```properties
opencode.min.version=${opencodeMinVersion}
distribution.channel=${distributionChannel}
```

- [ ] **Step 4: 写最小 `PluginUpdateModels` 与 `PluginUpdateService` 实现**

创建 `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/update/PluginUpdateModels.kt`：

```kotlin
package paviko.opencode.update

typealias UpdateEventSink = (String, Map<String, Any?>) -> Unit

data class UpdateRelease(
    val version: String,
    val releaseUrl: String? = null,
    val notes: String? = null,
    val publishedAt: String? = null,
)

data class UpdateInfoResult(
    val supported: Boolean,
    val reason: String? = null,
    val currentVersion: String,
    val latest: UpdateRelease? = null,
    val hasUpdate: Boolean = false,
)

sealed interface CheckForUpdatesResult {
    val status: String

    data class Available(
        val latest: UpdateRelease,
        override val status: String = "available",
    ) : CheckForUpdatesResult

    data class UpToDate(
        val currentVersion: String,
        override val status: String = "up-to-date",
    ) : CheckForUpdatesResult

    data class Unsupported(
        val currentVersion: String,
        val reason: String,
        override val status: String = "unsupported",
    ) : CheckForUpdatesResult
}

data class AvailablePluginUpdate(
    val release: UpdateRelease,
    val install: () -> Unit,
)

class PreparedPluginUpdate(
    val version: String,
    private val runner: (UpdateEventSink) -> Unit,
) {
    fun start(emit: UpdateEventSink) = runner(emit)
}

fun UpdateRelease.toPayload(extra: Map<String, Any?> = emptyMap()): Map<String, Any?> = buildMap {
    put("version", version)
    releaseUrl?.let { put("releaseUrl", it) }
    notes?.let { put("notes", it) }
    publishedAt?.let { put("publishedAt", it) }
    putAll(extra)
}
```

创建 `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/update/PluginUpdateService.kt`：

```kotlin
package paviko.opencode.update

import com.intellij.ide.plugins.PluginManagerCore
import com.intellij.ide.plugins.marketplace.MarketplaceRequests
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.extensions.PluginId
import com.intellij.openapi.updateSettings.impl.PluginDownloader
import com.intellij.util.text.VersionComparatorUtil
import java.util.Properties

class PluginUpdateService(
    private val currentVersionProvider: () -> String = ::readInstalledVersion,
    private val distributionChannelProvider: () -> String = ::readDistributionChannel,
    private val latestProvider: () -> AvailablePluginUpdate? = ::loadLatestMarketplaceUpdate,
    private val backgroundRunner: (() -> Unit) -> Unit = { task ->
        ApplicationManager.getApplication().executeOnPooledThread(task)
    },
) {
    private var latest: AvailablePluginUpdate? = null

    fun getUpdateInfo(): UpdateInfoResult {
        val currentVersion = currentVersionProvider()
        if (!supportsInAppUpdate()) {
            latest = null
            return UpdateInfoResult(
                supported = false,
                reason = "marketplace-only",
                currentVersion = currentVersion,
                latest = null,
                hasUpdate = false,
            )
        }

        val release = latest?.release
        return UpdateInfoResult(
            supported = true,
            reason = null,
            currentVersion = currentVersion,
            latest = release,
            hasUpdate = release != null,
        )
    }

    fun checkForUpdates(): CheckForUpdatesResult {
        val currentVersion = currentVersionProvider()
        if (!supportsInAppUpdate()) {
            latest = null
            return CheckForUpdatesResult.Unsupported(
                currentVersion = currentVersion,
                reason = "marketplace-only",
            )
        }

        latest = latestProvider()
        val release = latest?.release
        return if (release == null) {
            CheckForUpdatesResult.UpToDate(currentVersion = currentVersion)
        } else {
            CheckForUpdatesResult.Available(latest = release)
        }
    }

    fun prepareInstall(version: String): PreparedPluginUpdate {
        if (!supportsInAppUpdate()) {
            throw IllegalStateException("Marketplace install required")
        }

        val available = latest ?: throw IllegalStateException("Update not available: $version")
        if (available.release.version != version) {
            throw IllegalStateException("Update not available: $version")
        }

        return PreparedPluginUpdate(version) { emit ->
            backgroundRunner {
                emit("installing", available.release.toPayload())
                try {
                    available.install()
                    latest = null
                    emit("success", available.release.toPayload())
                } catch (t: Throwable) {
                    emit(
                        "error",
                        available.release.toPayload(
                            mapOf("error" to (t.message ?: t.javaClass.simpleName)),
                        ),
                    )
                }
            }
        }
    }

    private fun supportsInAppUpdate(): Boolean = distributionChannelProvider() == "marketplace"

    private fun loadLatestMarketplaceUpdate(): AvailablePluginUpdate? {
        val currentVersion = currentVersionProvider()
        val model = MarketplaceRequests.getInstance()
            .getLastCompatiblePluginUpdateModel(pluginId, null, null)
            ?: return null

        if (VersionComparatorUtil.compare(model.version, currentVersion) <= 0) {
            return null
        }

        val release = UpdateRelease(version = model.version)
        return AvailablePluginUpdate(
            release = release,
            install = {
                val downloader = PluginDownloader.createDownloader(model, null, null)
                if (!downloader.prepareToInstall(null)) {
                    throw IllegalStateException("Update not available: ${model.version}")
                }
                downloader.installDynamically(null)
            },
        )
    }

    companion object {
        private val pluginId = PluginId.getId("qtkj.opencode-ui")

        private fun readInstalledVersion(): String {
            val descriptor = PluginManagerCore.getPlugin(pluginId)
                ?: throw IllegalStateException("Installed plugin descriptor not found")
            return descriptor.version
        }

        private fun readDistributionChannel(): String {
            val props = Properties()
            PluginUpdateService::class.java.getResourceAsStream("/opencode-build.properties")?.use { props.load(it) }
            return props.getProperty("distribution.channel", "local")
        }
    }
}
```

- [ ] **Step 5: 再跑 JetBrains 单测，确认变绿**

Run（在 `hosts/jetbrains-plugin` 目录）:

```bash
gradlew.bat unitTest --tests "paviko.opencode.update.PluginUpdateServiceTest"
```

Expected: PASS，`PluginUpdateServiceTest` 4 个用例全部通过。

- [ ] **Step 6: 提交 Task 1**

```bash
git add hosts/jetbrains-plugin/build.gradle.kts hosts/jetbrains-plugin/src/main/resources/opencode-build.properties hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/update/PluginUpdateModels.kt hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/update/PluginUpdateService.kt hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/update/PluginUpdateServiceTest.kt
git commit -m "feat(jetbrains): add marketplace update service"
```

### Task 2: JetBrains IdeBridge 更新协议接线

**Files:**

- Modify: `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt`
- Test: `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/IdeBridgeUpdateTest.kt`

- [ ] **Step 1: 先写 bridge roundtrip 的失败测试**

创建 `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/IdeBridgeUpdateTest.kt`：

```kotlin
package paviko.opencode.ui

import com.google.gson.Gson
import com.google.gson.JsonObject
import com.intellij.openapi.project.Project
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Test
import org.mockito.Mockito
import paviko.opencode.update.AvailablePluginUpdate
import paviko.opencode.update.PluginUpdateService
import paviko.opencode.update.UpdateRelease
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread

class IdeBridgeUpdateTest {
    private val gson = Gson()

    @AfterEach
    fun cleanup() {
        IdeBridge.stop()
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

        val reply = send(session, "getUpdateInfo", JsonObject())
        val result = reply.getAsJsonObject("result")

        assertEquals(true, reply.get("ok")?.asBoolean)
        assertEquals(false, result.get("supported")?.asBoolean)
        assertEquals("marketplace-only", result.get("reason")?.asString)
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

        val reply = send(session, "checkForUpdates", JsonObject())
        val result = reply.getAsJsonObject("result")

        assertEquals(true, reply.get("ok")?.asBoolean)
        assertEquals("available", result.get("status")?.asString)
        assertEquals("26.5.502", result.getAsJsonObject("latest")?.get("version")?.asString)
    }

    @Test
    fun `installUpdate returns ok and starts prepared install`() {
        var installed = 0
        val service = PluginUpdateService(
            currentVersionProvider = { "26.5.501" },
            distributionChannelProvider = { "marketplace" },
            latestProvider = {
                AvailablePluginUpdate(
                    release = UpdateRelease(version = "26.5.502"),
                    install = { installed += 1 },
                )
            },
            backgroundRunner = { task -> task() },
        )
        service.checkForUpdates()

        val session = IdeBridge.createSession(project = project(), updateService = service)
        val reply = send(session, "installUpdate", JsonObject().apply {
            addProperty("version", "26.5.502")
        })

        assertEquals(true, reply.get("ok")?.asBoolean)
        assertEquals(1, installed)
    }

    private fun project(): Project {
        val project = Mockito.mock(Project::class.java)
        Mockito.`when`(project.name).thenReturn("update-test-project")
        return project
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
```

- [ ] **Step 2: 运行 bridge roundtrip 测试，确认它先失败**

Run（在 `hosts/jetbrains-plugin` 目录）:

```bash
gradlew.bat unitTest --tests "paviko.opencode.ui.IdeBridgeUpdateTest"
```

Expected: FAIL，报错包含 `No value passed for parameter 'updateService'`、`unsupported message type`，或 `result` 结构断言失败。

- [ ] **Step 3: 修改 `IdeBridge`，接入 update service 与结构化 reply**

先给 `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt` 增加 import：

```kotlin
import paviko.opencode.update.PluginUpdateService
```

把 `Session` 数据类改成：

```kotlin
data class Session(
    val id: String,
    val token: String,
    val project: Project,
    val sseClients: MutableSet<HttpExchange> = Collections.synchronizedSet(mutableSetOf()),
    val mem: MutableMap<String, String> = ConcurrentHashMap(),
    val storage: IdeBridgeStorageBackend = IdeBridgePropertiesStorageBackend,
    val updateService: PluginUpdateService = PluginUpdateService(),
)
```

把 `createSession` 签名和 `sessions[sessionId]` 写入改成：

```kotlin
    fun createSession(
        project: Project,
        storage: IdeBridgeStorageBackend = IdeBridgePropertiesStorageBackend,
        updateService: PluginUpdateService = PluginUpdateService(),
    ): SessionInfo {
        start()

        projectToSession[project]?.let { oldId ->
            removeSession(oldId)
        }

        val sessionId = UUID.randomUUID().toString()
        val token = UUID.randomUUID().toString()
        sessions[sessionId] = Session(
            id = sessionId,
            token = token,
            project = project,
            storage = storage,
            updateService = updateService,
        )
        projectToSession[project] = sessionId

        if (keepaliveTimer == null) {
            keepaliveTimer = java.util.Timer("IdeBridge-Keepalive", true).apply {
                scheduleAtFixedRate(object : java.util.TimerTask() {
                    override fun run() {
                        sendKeepaliveToAll()
                    }
                }, 15000, 15000)
            }
        }

        val baseUrl = "http://127.0.0.1:$port/idebridge/$sessionId"
        return SessionInfo(baseUrl, token, sessionId)
    }
```

在 `replyOk` 后面新增 `replyResult` helper：

```kotlin
    private fun replyResult(session: Session, id: String?, result: Any) {
        if (id == null) return
        val msg = JsonObject().apply {
            addProperty("replyTo", id)
            addProperty("ok", true)
            add("result", gson.toJsonTree(result))
            addProperty("timestamp", System.currentTimeMillis())
        }
        broadcastSSE(session, gson.toJson(msg))
    }
```

把 `handleSend` 的 `when (type)` 增加这三个分支：

```kotlin
                "getUpdateInfo" -> {
                    replyResult(session, id, session.updateService.getUpdateInfo())
                }

                "checkForUpdates" -> {
                    replyResult(session, id, session.updateService.checkForUpdates())
                }

                "installUpdate" -> {
                    val version = payload?.get("version")?.asString?.trim()
                    if (version.isNullOrEmpty()) {
                        replyError(session, id, "Missing version")
                    } else {
                        try {
                            val prepared = session.updateService.prepareInstall(version)
                            replyOk(session, id)
                            prepared.start { eventType, eventPayload ->
                                send(session.id, eventType, eventPayload)
                            }
                        } catch (e: Exception) {
                            replyError(session, id, "installUpdate failed: ${e.message ?: e}")
                        }
                    }
                }
```

- [ ] **Step 4: 再跑 bridge roundtrip 测试，确认变绿**

Run（在 `hosts/jetbrains-plugin` 目录）:

```bash
gradlew.bat unitTest --tests "paviko.opencode.ui.IdeBridgeUpdateTest"
```

Expected: PASS，3 个 update bridge 用例全部通过。

- [ ] **Step 5: 提交 Task 2**

```bash
git add hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/IdeBridgeUpdateTest.kt
git commit -m "feat(jetbrains): wire update requests through ide bridge"
```

### Task 3: WebGUI 兼容 JetBrains `unsupported` 与 IDE 重启文案

**Files:**

- Modify: `packages/opencode/webgui/src/state/UpdateContext.tsx`
- Modify: `packages/opencode/webgui/src/state/UpdateContext.test.tsx`
- Modify: `packages/opencode/webgui/src/components/UpdateBanner.tsx`
- Modify: `packages/opencode/webgui/src/components/UpdateBanner.test.tsx`

- [ ] **Step 1: 先补 WebGUI 的失败测试**

在 `packages/opencode/webgui/src/state/UpdateContext.test.tsx` 追加下面这个用例：

```tsx
it("JetBrains 返回 unsupported 时提示仅 Marketplace 安装版支持", async () => {
  mocks.request.mockResolvedValueOnce({
    result: {
      supported: false,
      reason: "marketplace-only",
      latest: null,
      hasUpdate: false,
    },
  })
  mocks.request.mockResolvedValueOnce({
    result: {
      status: "unsupported",
      reason: "marketplace-only",
      currentVersion: "26.5.501",
    },
  })

  const { result } = renderHook(() => useUpdate(), { wrapper })

  await waitFor(() => {
    expect(mocks.request).toHaveBeenCalledWith("getUpdateInfo", undefined)
  })

  await act(async () => {
    await result.current.checkForUpdates()
  })

  expect(mocks.showToast).toHaveBeenCalledWith("当前安装包不支持站内更新，请使用 JetBrains Marketplace 安装版")
  expect(result.current.status).toBe("idle")
  expect(result.current.confirmOpen).toBe(false)
  expect(result.current.confirmVersion).toBe(null)
  expect(result.current.latest).toBe(null)
})
```

把 `packages/opencode/webgui/src/components/UpdateBanner.test.tsx` 顶部 mock 改成这样，并新增 JetBrains success copy 用例：

```tsx
const bridge = vi.hoisted(() => ({
  restartMode: "window" as "window" | "ide" | null,
}))

const mocks = vi.hoisted(() => ({
  installUpdate: vi.fn(),
  openRelease: vi.fn(),
  dismissUpdate: vi.fn(),
  update: {
    currentVersion: "26.4.1405",
    latest: {
      version: "26.4.1406",
      releaseUrl: "https://example.test/releases/26.4.1406",
    } as { version: string; releaseUrl?: string },
    status: "available" as "available" | "downloading" | "installing" | "success" | "error" | "idle",
    dismissed: false,
  },
}))

vi.mock("../lib/ideBridge", () => ({
  ideBridge: bridge,
}))
```

```tsx
it("JetBrains success 状态提示按 IDE 提示重启", () => {
  bridge.restartMode = "ide"
  mocks.update.status = "success"

  render(<UpdateBanner />)

  expect(screen.getByText("更新已安装完成，请按 IDE 提示重启")).toBeInTheDocument()
  expect(screen.getByText("状态：安装完成，请按 IDE 提示重启")).toBeInTheDocument()
})
```

- [ ] **Step 2: 运行 WebGUI 测试，确认它们先失败**

Run（在 `packages/opencode/webgui` 目录）:

```bash
bun run test:run src/state/UpdateContext.test.tsx src/components/UpdateBanner.test.tsx
```

Expected: FAIL，`unsupported` toast 用例与 JetBrains success copy 用例至少各失败 1 个。

- [ ] **Step 3: 修改 `UpdateContext` 与 `UpdateBanner` 的最小实现**

把 `packages/opencode/webgui/src/state/UpdateContext.tsx` 顶部类型改成：

```tsx
type UpdateInfoResult = {
  latest?: unknown
  hasUpdate?: unknown
  supported?: unknown
  reason?: unknown
}

type CheckForUpdatesResult = {
  status?: unknown
  latest?: unknown
  currentVersion?: unknown
  reason?: unknown
}
```

把初始化读取逻辑里读取 `message` 与 `savedDismissed` 的回调整段替换成：

```tsx
      .then(([message, savedDismissed]) => {
        if (disposed) return
        if (savedDismissed) {
          setDismissedVersion(savedDismissed)
        }

        if (message.result?.supported === false) {
          setLatest(null)
          setStatus("idle")
          return
        }

        const next = toRelease(message.result?.latest)
        setLatest(next)
        const initialStatus = getInitialStatus(message.result, next)
        setStatus(initialStatus)
      })
```

把 `checkForUpdates` 里的结果分支改成：

```tsx
if (result?.status === "unsupported") {
  setLatest(null)
  setStatus("idle")
  clearInstallConfirm()
  showToast("当前安装包不支持站内更新，请使用 JetBrains Marketplace 安装版")
  return
}

if (result?.status === "up-to-date") {
  setLatest(null)
  setStatus("idle")
  clearInstallConfirm()
  showToast("已是最新版")
  return
}
```

把 `packages/opencode/webgui/src/components/UpdateBanner.tsx` 改成下面这种按 `restartMode` 生成 copy 的写法：

```tsx
import { ideBridge } from "../lib/ideBridge"
import { useUpdate } from "../state/UpdateContext"

function successCopy() {
  return ideBridge.restartMode === "ide" ? "安装完成，请按 IDE 提示重启" : "安装完成，请重载 VSCode"
}

export function UpdateBanner() {
  const update = useUpdate()
  const successText = successCopy()

  const statusText = {
    available: "待更新",
    downloading: "下载中",
    installing: "安装中",
    success: successText,
    error: "更新失败",
    idle: "空闲",
  } as const

  const titleText = {
    available: "发现新版本可更新",
    downloading: "正在下载更新",
    installing: "正在安装更新",
    success: ideBridge.restartMode === "ide" ? "更新已安装完成，请按 IDE 提示重启" : "更新已安装完成，请重载 VSCode",
    error: "更新失败，请重试",
    idle: "",
  } as const

  if (!update.latest || update.status === "idle" || update.dismissed) return null

  const title = titleText[update.status]
  const disabled = update.status === "downloading" || update.status === "installing" || update.status === "success"

  return (
    <div
      className="w-full border-b border-blue-200 bg-blue-50 px-4 py-2 text-blue-950 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100"
      role="status"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-semibold">{title}</p>
          <div className="text-xs opacity-90">
            <p>当前版本：{update.currentVersion}</p>
            <p>最新版本：{update.latest.version}</p>
            <p>状态：{statusText[update.status]}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={disabled}
            onClick={() => {
              void update.installUpdate(update.latest!.version)
            }}
          >
            立即更新
          </button>
          {update.latest.releaseUrl ? (
            <button
              className="rounded border border-blue-300 px-3 py-1 text-sm font-medium transition-colors hover:bg-blue-100 dark:border-blue-700 dark:hover:bg-blue-900"
              onClick={() => {
                void update.openRelease()
              }}
            >
              查看 Release
            </button>
          ) : null}
          <button
            className="rounded border border-dashed border-blue-300 px-3 py-1 text-sm font-medium transition-colors hover:bg-blue-100 dark:border-blue-700 dark:hover:bg-blue-900 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={disabled}
            onClick={() => {
              update.dismissUpdate()
            }}
          >
            暂不更新
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 再跑 WebGUI 测试，确认变绿**

Run（在 `packages/opencode/webgui` 目录）:

```bash
bun run test:run src/state/UpdateContext.test.tsx src/components/UpdateBanner.test.tsx
```

Expected: PASS，`UpdateContext.test.tsx` 与 `UpdateBanner.test.tsx` 全部通过。

- [ ] **Step 5: 提交 Task 3**

```bash
git add packages/opencode/webgui/src/state/UpdateContext.tsx packages/opencode/webgui/src/state/UpdateContext.test.tsx packages/opencode/webgui/src/components/UpdateBanner.tsx packages/opencode/webgui/src/components/UpdateBanner.test.tsx
git commit -m "fix(webgui): handle jetbrains marketplace update states"
```

### Task 4: Marketplace 构建标记、RepoWiki 与最终验证

**Files:**

- Modify: `.github/workflows/release.yml`
- Modify: `docs/repowiki/02-ide-bridge.md`
- Modify: `docs/repowiki/06-settings-update-localization.md`
- Modify: `docs/repowiki/07-host-plugins.md`

- [ ] **Step 1: 先跑失败断言，锁定 workflow 和文档缺口**

Run（在仓库根目录）:

```bash
node -e "const fs=require('fs'); const text=fs.readFileSync('.github/workflows/release.yml','utf8'); if (!text.includes('-Pdistribution.channel=\"marketplace\"')) throw new Error('missing marketplace distribution flag'); console.log('workflow already marks marketplace distribution');"
```

Expected: FAIL，报错包含 `missing marketplace distribution flag`。

Run（在仓库根目录）:

```bash
node -e "const fs=require('fs'); const docs=['docs/repowiki/02-ide-bridge.md','docs/repowiki/06-settings-update-localization.md','docs/repowiki/07-host-plugins.md']; const text=docs.map((p)=>fs.readFileSync(p,'utf8')).join('\n'); if (!text.includes('Marketplace 安装版支持站内更新')) throw new Error('docs missing JetBrains marketplace update note'); console.log('docs already mention JetBrains marketplace update support');"
```

Expected: FAIL，报错包含 `docs missing JetBrains marketplace update note`。

- [ ] **Step 2: 修改 release workflow 与 RepoWiki**

把 `.github/workflows/release.yml` 的 Marketplace build / publish 两段 Gradle 命令改成：

```yml
- name: Build Marketplace plugin package
  working-directory: hosts/jetbrains-plugin
  run: |
    VERSION="${{ needs.preflight.outputs.version }}"
    CLEAN_VERSION="${VERSION#v}"
    chmod +x gradlew
    ./gradlew clean buildPlugin \
      -Pplugin.version="$CLEAN_VERSION" \
      -Pdistribution.channel="marketplace" \
      -x test \
      -x unitTest
```

```yml
- name: Sign and publish Marketplace plugin
  working-directory: hosts/jetbrains-plugin
  run: |
    VERSION="${{ needs.preflight.outputs.version }}"
    CLEAN_VERSION="${VERSION#v}"
    chmod +x gradlew
    ./gradlew signPlugin publishPlugin \
      -Pplugin.version="$CLEAN_VERSION" \
      -Pdistribution.channel="marketplace" \
      -x test \
      -x unitTest
```

紧接着 `Verify Marketplace plugin metadata` 后面加一个新的校验 step：

```yml
- name: Verify Marketplace distribution channel metadata
  run: |
    python <<'PY'
    import io
    import zipfile
    from pathlib import Path

    archives = sorted(Path("hosts/jetbrains-plugin/build/distributions").glob("*.zip"))
    if len(archives) != 1:
        raise SystemExit(f"Expected exactly one Marketplace zip, found {len(archives)}")

    props = None
    with zipfile.ZipFile(archives[0]) as plugin_zip:
        for member in plugin_zip.namelist():
            if not member.endswith('.jar'):
                continue
            payload = plugin_zip.read(member)
            with zipfile.ZipFile(io.BytesIO(payload)) as jar_zip:
                try:
                    props = jar_zip.read('opencode-build.properties').decode('utf-8')
                    break
                except KeyError:
                    continue

    if props is None:
        raise SystemExit('Could not find opencode-build.properties inside Marketplace package')
    if 'distribution.channel=marketplace' not in props:
        raise SystemExit(f'Marketplace package has wrong distribution channel: {props!r}')

    print('marketplace distribution channel ok')
    PY
```

把 `docs/repowiki/02-ide-bridge.md` 的更新段落替换为：

```md
VSCode 与 JetBrains 共同支持的更新请求：

- `getUpdateInfo`
- `checkForUpdates`
- `installUpdate`

JetBrains 更新限制：

- 只对 JetBrains Marketplace 安装版开放站内更新
- 本地 ZIP / 开发版返回 `unsupported`
- 更新成功后的生效方式以 IDE 原生提示为准
```

把 `docs/repowiki/06-settings-update-localization.md` 里 JetBrains 更新说明替换为：

```md
JetBrains 现已补齐同名更新 API，但有明确边界：

- 只以 JetBrains Marketplace 为版本来源
- 只对 Marketplace 安装版开放站内更新
- 本地 ZIP / 开发版返回 `unsupported`
- 更新成功后的生效方式以 IDE 原生提示为准
```

把 `docs/repowiki/07-host-plugins.md` 的对比表和维护提示改成：

```md
| 更新 | 支持 GitHub Release `.vsix` 更新 | JetBrains Marketplace 安装版支持站内更新；本地 ZIP / 开发版仅提示 |
```

```md
- JetBrains 站内更新只对 Marketplace 包生效；调整构建链路时不要移除 `distribution.channel=marketplace` 注入。
```

- [ ] **Step 3: 回归验证 workflow、文档与定向测试**

Run（在仓库根目录）:

```bash
node -e "const fs=require('fs'); const text=fs.readFileSync('.github/workflows/release.yml','utf8'); if (!text.includes('-Pdistribution.channel=\"marketplace\"')) throw new Error('missing marketplace distribution flag'); if (!text.includes('Verify Marketplace distribution channel metadata')) throw new Error('missing distribution metadata verification step'); console.log('release workflow marketplace distribution metadata ok');"
```

Expected: PASS，并输出 `release workflow marketplace distribution metadata ok`。

Run（在仓库根目录）:

```bash
node -e "const fs=require('fs'); const docs=['docs/repowiki/02-ide-bridge.md','docs/repowiki/06-settings-update-localization.md','docs/repowiki/07-host-plugins.md']; const text=docs.map((p)=>fs.readFileSync(p,'utf8')).join('\n'); if (!text.includes('Marketplace 安装版支持站内更新')) throw new Error('docs missing JetBrains marketplace update note'); if (!text.includes('distribution.channel=marketplace')) throw new Error('docs missing distribution channel maintenance note'); console.log('repowiki update docs ok');"
```

Expected: PASS，并输出 `repowiki update docs ok`。

Run（在 `hosts/jetbrains-plugin` 目录）:

```bash
gradlew.bat unitTest --tests "paviko.opencode.update.PluginUpdateServiceTest"
gradlew.bat unitTest --tests "paviko.opencode.ui.IdeBridgeUpdateTest" --tests "paviko.opencode.ui.IdeBridgeRestartHostTest"
```

Expected: PASS，JetBrains 相关更新测试与已有 `restartHost` 回归测试全部通过。

Run（在 `packages/opencode/webgui` 目录）:

```bash
bun run test:run src/state/UpdateContext.test.tsx src/components/UpdateBanner.test.tsx
```

Expected: PASS，WebGUI 更新状态与 banner 文案测试全部通过。

- [ ] **Step 4: 提交 Task 4**

```bash
git add .github/workflows/release.yml docs/repowiki/02-ide-bridge.md docs/repowiki/06-settings-update-localization.md docs/repowiki/07-host-plugins.md
git commit -m "chore(jetbrains): mark marketplace builds for in-app updates"
```

## Self-Review

- **Spec coverage:**
  - JetBrains 独立 update service：Task 1
  - `IdeBridge` 的 `getUpdateInfo` / `checkForUpdates` / `installUpdate`：Task 2
  - 先回包再安装的时序约束：Task 1 `PreparedPluginUpdate` + Task 2 handler
  - WebGUI `unsupported` 处理与 JetBrains success 文案：Task 3
  - Marketplace 构建标记与 RepoWiki 更新：Task 4
  - VSCode 零回归与 JetBrains 回归验证：Task 4
- **Placeholder scan:** 已去掉占位表述与“留到后面再补”的描述；每个代码步骤都给出实际片段。
- **Type consistency:** `UpdateInfoResult`、`CheckForUpdatesResult`、`AvailablePluginUpdate`、`PreparedPluginUpdate`、`UpdateRelease` 全程统一；bridge 和 WebGUI 统一使用 `status: "available" | "up-to-date" | "unsupported"`。
