# JetBrains Public API Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove JetBrains internal/deprecated API usage while preserving update discovery through public Marketplace metadata and a manual Plugins settings entry.

**Architecture:** Split update discovery into a public Marketplace version source, keep update state in `PluginUpdateService`, and route manual update actions through a small public settings opener. Update WebGUI to label JetBrains/manual updates as “打开插件管理” instead of pretending to install automatically, then migrate logs and Terminal startup away from deprecated APIs.

**Tech Stack:** Kotlin 1.9.23, IntelliJ Platform 2026.1 API target, Swing, Gson, Java HttpClient, React 19, Vitest, JUnit 5.

---

## File Structure

- Create `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/update/MarketplaceVersionSource.kt`
  - Owns public Marketplace HTTP lookup and JSON parsing.
  - No IntelliJ internal API imports.
- Create `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/OpenPluginSettings.kt`
  - Owns opening `Settings | Plugins` through public `ShowSettingsUtil` by display name.
- Modify `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/update/PluginUpdateModels.kt`
  - Add manual-update metadata to update payloads.
- Modify `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/update/PluginUpdateService.kt`
  - Remove `MarketplaceRequests`, `PluginDownloader`, and dynamic install logic.
  - Use `MarketplaceVersionSource` to produce `AvailablePluginUpdate` with manual update metadata.
- Modify `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt`
  - Add `openPluginManager` request.
  - Change `installUpdate` for manual updates to open settings rather than install.
- Modify `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/ChatToolWindowFactory.kt`
  - Replace `HideableTitledPanel` with public Swing components.
- Modify `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/backendprocess/BackendLauncher.kt`
  - Replace direct `TerminalToolWindowManager.createShellWidget(...)` call with the new Terminal tab builder API available after raising `sinceBuild`.
- Modify `hosts/jetbrains-plugin/build.gradle.kts`
  - Raise IntelliJ target and `sinceBuild` to `261` so the new Terminal API is available without old fallback.
- Modify WebGUI update files:
  - `packages/opencode/webgui/src/state/UpdateContext.tsx`
  - `packages/opencode/webgui/src/components/UpdateBanner.tsx`
  - related tests.
- Modify tests:
  - `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/update/PluginUpdateServiceTest.kt`
  - `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/IdeBridgeUpdateTest.kt`
  - `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/BackendLogsVisibilityControllerTest.kt` if needed
  - `packages/opencode/webgui/src/state/UpdateContext.test.tsx`
  - `packages/opencode/webgui/src/components/UpdateBanner.test.tsx`

## Commit Rule

The skill normally asks for frequent commits. In this repository, do not run `git commit` unless the user explicitly grants commit permission. Each task includes a commit checkpoint; skip it unless permission is already granted.

---

### Task 1: Add public Marketplace version source

**Files:**

- Create: `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/update/MarketplaceVersionSource.kt`
- Create: `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/update/MarketplaceVersionSourceTest.kt`

- [ ] **Step 1: Write failing tests for parsing public Marketplace update JSON**

Create `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/update/MarketplaceVersionSourceTest.kt`:

```kotlin
package paviko.opencode.update

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class MarketplaceVersionSourceTest {
    @Test
    fun `parse update detail extracts version and release url`() {
        val json = """
            {"id":1041170,"version":"26.5.700","link":"/plugin/31609-opencode-ui-unofficial-/versions/stable/1041170"}
        """.trimIndent()

        val release = parseMarketplaceUpdate(json)

        assertEquals("26.5.700", release?.version)
        assertEquals("https://plugins.jetbrains.com/plugin/31609-opencode-ui-unofficial-/versions/stable/1041170", release?.releaseUrl)
    }

    @Test
    fun `parse empty update list returns null`() {
        assertNull(parseMarketplaceUpdateList("[]"))
    }

    @Test
    fun `parse update list selects first version`() {
        val json = """
            [{"version":"26.5.701","link":"/plugin/31609-opencode-ui-unofficial-/versions/stable/1041171"}]
        """.trimIndent()

        val release = parseMarketplaceUpdateList(json)

        assertEquals("26.5.701", release?.version)
        assertEquals("https://plugins.jetbrains.com/plugin/31609-opencode-ui-unofficial-/versions/stable/1041171", release?.releaseUrl)
    }
}
```

- [ ] **Step 2: Run the new test and verify it fails**

Run from `hosts/jetbrains-plugin`:

```powershell
.\gradlew.bat unitTest --tests "paviko.opencode.update.MarketplaceVersionSourceTest"
```

Expected: FAIL because `MarketplaceVersionSourceTest`, `parseMarketplaceUpdate`, and `parseMarketplaceUpdateList` are not implemented yet.

- [ ] **Step 3: Implement public Marketplace version parsing and lookup**

Create `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/update/MarketplaceVersionSource.kt`:

```kotlin
package paviko.opencode.update

import com.google.gson.Gson
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import paviko.opencode.JETBRAINS_PLUGIN_ID
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration

private const val MARKETPLACE_BASE = "https://plugins.jetbrains.com"
private const val MARKETPLACE_NUMERIC_PLUGIN_ID = "31609"

data class MarketplacePluginRelease(
    val version: String,
    val releaseUrl: String,
)

fun interface MarketplaceVersionSource {
    fun latest(): MarketplacePluginRelease?
}

internal fun defaultMarketplaceVersionSource(): MarketplaceVersionSource {
    val client = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(5))
        .build()

    return MarketplaceVersionSource {
        val request = HttpRequest.newBuilder()
            .uri(URI.create("$MARKETPLACE_BASE/api/plugins/$MARKETPLACE_NUMERIC_PLUGIN_ID/updates"))
            .timeout(Duration.ofSeconds(8))
            .GET()
            .build()

        val body = client.send(request, HttpResponse.BodyHandlers.ofString()).body()
        parseMarketplaceUpdateList(body)
    }
}

internal fun parseMarketplaceUpdateList(body: String): MarketplacePluginRelease? {
    val root = Gson().fromJson(body, JsonElement::class.java) ?: return null
    if (!root.isJsonArray) return parseMarketplaceUpdate(body)
    return root.asJsonArray.firstOrNull()?.let { parseMarketplaceUpdate(it.toString()) }
}

internal fun parseMarketplaceUpdate(body: String): MarketplacePluginRelease? {
    val root = Gson().fromJson(body, JsonObject::class.java) ?: return null
    val version = root.get("version")?.asString?.trim().orEmpty()
    if (version.isEmpty()) return null

    val raw = root.get("link")?.asString?.trim().orEmpty()
    val releaseUrl = when {
        raw.startsWith("https://") || raw.startsWith("http://") -> raw
        raw.startsWith("/") -> "$MARKETPLACE_BASE$raw"
        else -> "$MARKETPLACE_BASE/plugin/31609-opencode-ui-unofficial-"
    }

    return MarketplacePluginRelease(version = version, releaseUrl = releaseUrl)
}

internal fun marketplacePluginPage(): String = "$MARKETPLACE_BASE/plugin/31609-opencode-ui-unofficial-"

internal fun marketplacePluginXmlId(): String = JETBRAINS_PLUGIN_ID
```

- [ ] **Step 4: Run parser tests and verify they pass**

Run:

```powershell
.\gradlew.bat unitTest --tests "paviko.opencode.update.MarketplaceVersionSourceTest"
```

Expected: PASS.

- [ ] **Step 5: Commit checkpoint if authorized**

If the user has explicitly authorized commits:

```powershell
git add hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/update/MarketplaceVersionSource.kt hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/update/MarketplaceVersionSourceTest.kt
git commit -m "feat(jetbrains): add public marketplace version source"
```

If commit permission has not been granted, skip this step.

---

### Task 2: Replace internal update service logic with manual update metadata

**Files:**

- Modify: `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/update/PluginUpdateModels.kt`
- Modify: `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/update/PluginUpdateService.kt`
- Modify: `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/update/PluginUpdateServiceTest.kt`

- [ ] **Step 1: Replace update service tests with manual-update expectations**

In `PluginUpdateServiceTest.kt`, remove tests that mention `MarketplaceLookup`, `descriptorToMarketplaceLookup`, missing Marketplace descriptor failures, dynamic install success, and dynamic install failure. Add these tests:

```kotlin
@Test
fun `public marketplace release newer than current is reported as manual update`() {
    val service = PluginUpdateService(
        versionSource = PluginVersionSource { "26.5.501" },
        marketplaceVersionSource = MarketplaceVersionSource {
            MarketplacePluginRelease(
                version = "26.5.700",
                releaseUrl = "https://plugins.jetbrains.com/plugin/31609-opencode-ui-unofficial-/versions/stable/1041170",
            )
        },
        backgroundRunner = { task -> task() },
    )

    assertEquals(
        CheckForUpdatesResult.Available(
            latest = UpdateRelease(
                version = "26.5.700",
                releaseUrl = "https://plugins.jetbrains.com/plugin/31609-opencode-ui-unofficial-/versions/stable/1041170",
                manualUpdate = true,
            ),
        ),
        service.checkForUpdates(),
    )

    assertEquals(true, service.getUpdateInfo().hasUpdate)
    assertEquals(true, service.getUpdateInfo().latest?.manualUpdate)
}

@Test
fun `public marketplace release same as current is up to date`() {
    val service = PluginUpdateService(
        versionSource = PluginVersionSource { "26.5.700" },
        marketplaceVersionSource = MarketplaceVersionSource {
            MarketplacePluginRelease(
                version = "26.5.700",
                releaseUrl = "https://plugins.jetbrains.com/plugin/31609-opencode-ui-unofficial-",
            )
        },
        backgroundRunner = { task -> task() },
    )

    assertEquals(CheckForUpdatesResult.UpToDate(currentVersion = "26.5.700"), service.checkForUpdates())
    assertEquals(false, service.getUpdateInfo().hasUpdate)
}

@Test
fun `marketplace query failure returns manual check result instead of throwing`() {
    val service = PluginUpdateService(
        versionSource = PluginVersionSource { "26.5.501" },
        marketplaceVersionSource = MarketplaceVersionSource {
            throw IllegalStateException("marketplace unavailable")
        },
        backgroundRunner = { task -> task() },
    )

    assertEquals(
        CheckForUpdatesResult.ManualCheck(
            currentVersion = "26.5.501",
            reason = "marketplace unavailable",
        ),
        service.checkForUpdates(),
    )
}

@Test
fun `prepare manual update emits open plugin manager event`() {
    val service = PluginUpdateService(
        versionSource = PluginVersionSource { "26.5.501" },
        marketplaceVersionSource = MarketplaceVersionSource {
            MarketplacePluginRelease(
                version = "26.5.700",
                releaseUrl = "https://plugins.jetbrains.com/plugin/31609-opencode-ui-unofficial-",
            )
        },
        backgroundRunner = { task -> task() },
    )

    service.checkForUpdates()
    val prepared = service.prepareInstall("26.5.700")
    val events = mutableListOf<String>()
    val payloads = mutableListOf<Map<String, Any?>>()

    prepared.start { type, payload ->
        events += type
        payloads += payload
    }

    assertEquals(listOf("manualUpdate"), events)
    assertEquals("26.5.700", payloads.single()["version"])
    assertEquals(true, payloads.single()["manualUpdate"])
}
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```powershell
.\gradlew.bat unitTest --tests "paviko.opencode.update.PluginUpdateServiceTest"
```

Expected: FAIL because `manualUpdate`, `MarketplaceVersionSource`, and `CheckForUpdatesResult.ManualCheck` are not wired into the service yet.

- [ ] **Step 3: Update models**

Modify `PluginUpdateModels.kt`:

```kotlin
package paviko.opencode.update

typealias UpdateEventSink = (String, Map<String, Any?>) -> Unit

data class UpdateRelease(
    val version: String,
    val releaseUrl: String? = null,
    val notes: String? = null,
    val publishedAt: String? = null,
    val manualUpdate: Boolean = false,
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

    data class ManualCheck(
        val currentVersion: String,
        val reason: String,
        val releaseUrl: String = marketplacePluginPage(),
        override val status: String = "manual-check",
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
    put("manualUpdate", manualUpdate)
    releaseUrl?.let { put("releaseUrl", it) }
    notes?.let { put("notes", it) }
    publishedAt?.let { put("publishedAt", it) }
    putAll(extra)
}
```

- [ ] **Step 4: Replace `PluginUpdateService.kt` internal API implementation**

Replace imports and internal Marketplace lookup code in `PluginUpdateService.kt` with this shape:

```kotlin
package paviko.opencode.update

import com.intellij.openapi.application.ApplicationManager
import com.intellij.util.text.VersionComparatorUtil
import java.util.Properties

private fun loadLatestMarketplaceUpdate(
    versionSource: PluginVersionSource,
    marketplaceVersionSource: MarketplaceVersionSource,
): AvailablePluginUpdate? {
    val currentVersion = versionSource.currentVersion()
    val release = marketplaceVersionSource.latest() ?: return null

    if (VersionComparatorUtil.compare(release.version, currentVersion) <= 0) {
        return null
    }

    val update = UpdateRelease(
        version = release.version,
        releaseUrl = release.releaseUrl,
        manualUpdate = true,
    )

    return AvailablePluginUpdate(
        release = update,
        install = {},
    )
}

class PluginUpdateService(
    private val versionSource: PluginVersionSource = installedPluginVersionSource(),
    private val distributionChannelProvider: () -> String = ::readDistributionChannel,
    latestProvider: (() -> AvailablePluginUpdate?)? = null,
    private val marketplaceVersionSource: MarketplaceVersionSource = defaultMarketplaceVersionSource(),
    private val backgroundRunner: (() -> Unit) -> Unit = { task -> ApplicationManager.getApplication().executeOnPooledThread(task) },
) {
    private val lock = Any()

    fun currentVersion(): String = versionSource.currentVersion()

    private val latestProvider = latestProvider ?: {
        loadLatestMarketplaceUpdate(
            versionSource = versionSource,
            marketplaceVersionSource = marketplaceVersionSource,
        )
    }

    private var latest: AvailablePluginUpdate? = null
    private var lastReason: String? = null

    fun getUpdateInfo(): UpdateInfoResult {
        val currentVersion = currentVersion()
        val release = synchronized(lock) { latest?.release }
        return UpdateInfoResult(
            supported = true,
            reason = synchronized(lock) { lastReason },
            currentVersion = currentVersion,
            latest = release,
            hasUpdate = release != null,
        )
    }

    fun checkForUpdates(): CheckForUpdatesResult {
        val currentVersion = currentVersion()
        val available = runCatching { latestProvider() }
            .onFailure { error ->
                synchronized(lock) {
                    latest = null
                    lastReason = error.message ?: error.javaClass.simpleName
                }
            }
            .getOrElse { error ->
                return CheckForUpdatesResult.ManualCheck(
                    currentVersion = currentVersion,
                    reason = error.message ?: error.javaClass.simpleName,
                )
            }

        synchronized(lock) {
            latest = available
            lastReason = if (available == null) null else null
        }

        val release = available?.release
        return if (release == null) {
            CheckForUpdatesResult.UpToDate(currentVersion = currentVersion)
        } else {
            CheckForUpdatesResult.Available(latest = release)
        }
    }

    fun prepareInstall(version: String): PreparedPluginUpdate {
        val available = synchronized(lock) {
            val current = latest ?: throw IllegalStateException("Update not available: $version")
            if (current.release.version != version) {
                throw IllegalStateException("Update not available: $version")
            }
            current
        }

        return PreparedPluginUpdate(version) { emit ->
            backgroundRunner {
                emit("manualUpdate", available.release.toPayload())
            }
        }
    }

    companion object {
        private fun readDistributionChannel(): String {
            return runCatching {
                val props = Properties()
                PluginUpdateService::class.java.getResourceAsStream("/opencode-build.properties")?.use(props::load)
                props.getProperty("distribution.channel", "local")
            }.getOrDefault("local")
        }
    }
}
```

Keep `distributionChannelProvider` for compatibility with existing tests/factory calls, even if the service now supports manual Marketplace checks for all channels.

- [ ] **Step 5: Run service tests**

Run:

```powershell
.\gradlew.bat unitTest --tests "paviko.opencode.update.PluginUpdateServiceTest" --tests "paviko.opencode.update.MarketplaceVersionSourceTest"
```

Expected: PASS after removing obsolete dynamic install/internal API tests.

- [ ] **Step 6: Commit checkpoint if authorized**

If commits are authorized:

```powershell
git add hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/update hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/update
git commit -m "refactor(jetbrains): use public marketplace update metadata"
```

Otherwise skip.

---

### Task 3: Add public Plugins settings opener and bridge action

**Files:**

- Create: `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/OpenPluginSettings.kt`
- Modify: `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt`
- Modify: `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/IdeBridgeUpdateTest.kt`

- [ ] **Step 1: Write failing bridge test for opening Plugins settings**

Add to `IdeBridgeUpdateTest.kt`:

```kotlin
@Test
fun `openPluginManager delegates to settings opener`() {
    val opened = AtomicInteger(0)
    IdeBridge.openPluginSettingsHook = {
        opened.incrementAndGet()
    }

    val session = IdeBridge.createSession(
        project = project(),
        versionSource = PluginVersionSource { "26.5.501" },
    )

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

    val session = IdeBridge.createSession(
        project = project(),
        versionSource = PluginVersionSource { "26.5.501" },
    )

    sse(session).use { events ->
        val reply = events.send("openPluginManager", JsonObject())

        assertEquals(false, reply.get("ok")?.asBoolean)
        assertEquals("openPluginManager failed: settings unavailable", reply.get("error")?.asString)
    }
}
```

Also reset the hook in `cleanup()`:

```kotlin
IdeBridge.openPluginSettingsHook = null
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```powershell
.\gradlew.bat unitTest --tests "paviko.opencode.ui.IdeBridgeUpdateTest.openPluginManager*"
```

Expected: FAIL because `openPluginSettingsHook` and `openPluginManager` action do not exist yet.

- [ ] **Step 3: Implement public settings opener**

Create `OpenPluginSettings.kt`:

```kotlin
package paviko.opencode.ui

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.options.ShowSettingsUtil
import com.intellij.openapi.project.Project

internal object OpenPluginSettings {
    fun open(project: Project) {
        val app = ApplicationManager.getApplication()
        val task = Runnable {
            ShowSettingsUtil.getInstance().showSettingsDialog(project, "Plugins")
        }

        if (app.isDispatchThread) {
            task.run()
        } else {
            app.invokeLater(task)
        }
    }
}
```

This intentionally avoids importing `com.intellij.ide.plugins.PluginManagerConfigurable`, because that class is marked `@ApiStatus.Internal`.

- [ ] **Step 4: Wire bridge action**

In `IdeBridge.kt`, add near `installStartRunner`:

```kotlin
@Volatile
internal var openPluginSettingsHook: (() -> Unit)? = null
```

Add a `when` branch before `installUpdate`:

```kotlin
"openPluginManager" -> {
    try {
        val hook = openPluginSettingsHook
        if (hook != null) {
            hook()
        } else {
            OpenPluginSettings.open(session.project)
        }
        replyOk(session, id)
    } catch (e: Exception) {
        replyError(session, id, "openPluginManager failed: ${e.message ?: e}")
    }
}
```

Update `cleanup()` in `IdeBridgeUpdateTest.kt`:

```kotlin
IdeBridge.openPluginSettingsHook = null
```

- [ ] **Step 5: Change manual `installUpdate` bridge behavior**

Inside the `prepared.start` callback in `IdeBridge.kt`, detect `manualUpdate` events and open settings:

```kotlin
prepared.start { eventType, eventPayload ->
    if (eventType == "manualUpdate") {
        val hook = openPluginSettingsHook
        if (hook != null) {
            hook()
        } else {
            OpenPluginSettings.open(session.project)
        }
    }
    send(session.id, eventType, eventPayload)
}
```

- [ ] **Step 6: Run bridge tests**

Run:

```powershell
.\gradlew.bat unitTest --tests "paviko.opencode.ui.IdeBridgeUpdateTest"
```

Expected: PASS after updating old install tests to expect `manualUpdate` instead of `installing`/`success`.

- [ ] **Step 7: Commit checkpoint if authorized**

If commits are authorized:

```powershell
git add hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/OpenPluginSettings.kt hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/IdeBridgeUpdateTest.kt
git commit -m "feat(jetbrains): open plugins settings for manual updates"
```

Otherwise skip.

---

### Task 4: Update WebGUI banner for manual JetBrains updates

**Files:**

- Modify: `packages/opencode/webgui/src/state/UpdateContext.tsx`
- Modify: `packages/opencode/webgui/src/components/UpdateBanner.tsx`
- Modify: `packages/opencode/webgui/src/state/UpdateContext.test.tsx`
- Modify: `packages/opencode/webgui/src/components/UpdateBanner.test.tsx`

- [ ] **Step 1: Add failing UpdateContext tests for manual update**

In `UpdateContext.test.tsx`, add a test near existing `checkForUpdates` tests:

```tsx
it("手动更新结果会展示最新版本并打开插件管理", async () => {
  mocks.request.mockImplementation(async (type: string) => {
    if (type === "getUpdateInfo") return { ok: true, result: { supported: true, hasUpdate: false } }
    if (type === "checkForUpdates")
      return {
        ok: true,
        result: {
          status: "available",
          latest: {
            version: "26.5.700",
            releaseUrl: "https://plugins.jetbrains.com/plugin/31609-opencode-ui-unofficial-",
            manualUpdate: true,
          },
        },
      }
    if (type === "openPluginManager") return { ok: true }
    throw new Error(`unexpected request ${type}`)
  })

  const { result } = renderHook(() => useUpdate(), { wrapper })

  await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("getUpdateInfo", undefined))
  await act(async () => {
    await result.current.checkForUpdates()
  })

  expect(result.current.latest?.version).toBe("26.5.700")
  expect(result.current.latest?.manualUpdate).toBe(true)

  await act(async () => {
    await result.current.installUpdate("26.5.700")
  })

  expect(mocks.request).toHaveBeenLastCalledWith("openPluginManager", { version: "26.5.700" })
})
```

- [ ] **Step 2: Add failing UpdateBanner test for button label**

In `UpdateBanner.test.tsx`, add:

```tsx
it("手动更新时按钮显示打开插件管理", () => {
  mocks.update.latest = {
    version: "26.5.700",
    releaseUrl: "https://plugins.jetbrains.com/plugin/31609-opencode-ui-unofficial-",
    manualUpdate: true,
  }
  mocks.update.status = "available"

  render(<UpdateBanner />)

  expect(screen.getByRole("button", { name: "打开插件管理" })).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "立即更新" })).not.toBeInTheDocument()
})
```

- [ ] **Step 3: Run WebGUI tests and verify they fail**

Run from `packages/opencode/webgui`:

```powershell
bun test src/state/UpdateContext.test.tsx src/components/UpdateBanner.test.tsx
```

Expected: FAIL because `manualUpdate` is not parsed and button label still says `立即更新`.

- [ ] **Step 4: Update `UpdateContext.tsx` types and behavior**

Modify `UpdateRelease`:

```ts
type UpdateRelease = {
  version: string
  releaseUrl?: string
  notes?: string
  publishedAt?: string
  vsixUrl?: string
  manualUpdate?: boolean
}
```

Update `toRelease()` and `mergeRelease()` to copy `manualUpdate`:

```ts
manualUpdate: data.manualUpdate === true,
```

In `installUpdate`, route manual updates to `openPluginManager`:

```ts
const installUpdate = useCallback(
  async (version: string) => {
    clearInstallConfirm()
    setDismissedVersion(null)
    void scopedStateSetJSON("global", "update.dismissedVersion", null)
    const release = latest
    if (release?.manualUpdate) {
      try {
        await ideBridge.request("openPluginManager", { version })
        showToast("请在 JetBrains 插件管理页面完成更新")
      } catch {
        showToast("无法打开插件管理页面，请手动打开 Settings | Plugins")
      }
      return
    }

    setStatus("downloading")
    try {
      await ideBridge.request("installUpdate", { version })
    } catch {
      setStatus("error")
    }
  },
  [clearInstallConfirm, latest, showToast],
)
```

Handle `manual-check` in `checkForUpdates()`:

```ts
if (result?.status === "manual-check") {
  clearInstallConfirm()
  showToast("无法确认最新版本，请到 JetBrains 插件管理页面手动检查更新")
  return
}
```

- [ ] **Step 5: Update `UpdateBanner.tsx` label and status copy**

Add:

```tsx
const isManual = update.latest.manualUpdate === true
```

Change title/status copy:

```tsx
const title = isManual && update.status === "available" ? "发现新版本，请到插件管理页面更新" : titleText[update.status]
```

Change button text:

```tsx
{
  isManual ? "打开插件管理" : "立即更新"
}
```

Keep the click handler calling `update.installUpdate(update.latest!.version)` so VSCode/automatic paths still share the existing button wiring.

- [ ] **Step 6: Run WebGUI tests**

Run:

```powershell
bun test src/state/UpdateContext.test.tsx src/components/UpdateBanner.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit checkpoint if authorized**

If commits are authorized:

```powershell
git add packages/opencode/webgui/src/state/UpdateContext.tsx packages/opencode/webgui/src/components/UpdateBanner.tsx packages/opencode/webgui/src/state/UpdateContext.test.tsx packages/opencode/webgui/src/components/UpdateBanner.test.tsx
git commit -m "feat(webgui): support manual plugin update prompts"
```

Otherwise skip.

---

### Task 5: Replace deprecated `HideableTitledPanel`

**Files:**

- Modify: `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/ChatToolWindowFactory.kt`
- Modify: `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/BackendLogsVisibilityControllerTest.kt`

- [ ] **Step 1: Add test for plain Swing log panel compatibility**

Add to `BackendLogsVisibilityControllerTest.kt`:

```kotlin
@Test
fun `普通 Swing 日志面板可以被 reveal 到底部`() {
    val mainPanel = JPanel(BorderLayout())
    val logsPanel = JPanel(BorderLayout()).apply {
        add(JLabel("Backend logs (merged stdout stderr)"), BorderLayout.NORTH)
        add(JPanel(), BorderLayout.CENTER)
    }

    val controller = BackendLogsVisibilityController(mainPanel, logsPanel)

    controller.reveal()

    assertSame(mainPanel, logsPanel.parent)
    assertEquals(1, mainPanel.componentCount)
}
```

- [ ] **Step 2: Run test and verify current controller still passes**

Run:

```powershell
.\gradlew.bat unitTest --tests "paviko.opencode.ui.BackendLogsVisibilityControllerTest"
```

Expected: PASS. This confirms the controller already accepts plain Swing panels.

- [ ] **Step 3: Replace `HideableTitledPanel` in `ChatToolWindowFactory.kt`**

Replace lines creating `hideableLogs` with:

```kotlin
val logsPanel = JPanel(BorderLayout()).apply {
    border = JBUI.Borders.empty(4)
    add(JLabel("Backend logs (merged stdout/stderr)"), BorderLayout.NORTH)
    add(logScroll, BorderLayout.CENTER)
}
val logsVisibility = BackendLogsVisibilityController(mainPanel, logsPanel)
```

Remove:

```kotlin
val hideableLogs = com.intellij.ui.HideableTitledPanel("Backend logs (merged stdout/stderr)", false)
hideableLogs.setContentComponent(logsPanel)
val logsVisibility = BackendLogsVisibilityController(mainPanel, hideableLogs)
```

- [ ] **Step 4: Verify no deprecated component reference remains**

Run from repo root:

```powershell
Select-String -Path "hosts/jetbrains-plugin/src/main/kotlin/**/*.kt" -Pattern "HideableTitledPanel"
```

Expected: no matches.

- [ ] **Step 5: Run JetBrains unit tests**

Run:

```powershell
.\gradlew.bat unitTest --tests "paviko.opencode.ui.BackendLogsVisibilityControllerTest"
```

Expected: PASS.

- [ ] **Step 6: Commit checkpoint if authorized**

If commits are authorized:

```powershell
git add hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/ChatToolWindowFactory.kt hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/BackendLogsVisibilityControllerTest.kt
git commit -m "refactor(jetbrains): replace deprecated logs panel"
```

Otherwise skip.

---

### Task 6: Raise IntelliJ target and migrate Terminal tab creation

**Files:**

- Modify: `hosts/jetbrains-plugin/build.gradle.kts`
- Modify: `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/backendprocess/BackendLauncher.kt`

- [ ] **Step 1: Raise IntelliJ Platform target**

Modify `build.gradle.kts`:

```kotlin
dependencies {
    intellijPlatform {
        intellijIdeaCommunity("2026.1.2")
        bundledPlugin("com.intellij.java")
        bundledPlugin("org.jetbrains.plugins.terminal")

        pluginVerifier()
        zipSigner()
    }
}

intellijPlatform {
    pluginConfiguration {
        ideaVersion {
            sinceBuild.set("261")
        }
    }
}

tasks {
    patchPluginXml {
        untilBuild.set("261.*")
    }
}
```

Keep existing description, change notes, signing, and publishing blocks unchanged.

- [ ] **Step 2: Run compile to surface API names**

Run:

```powershell
.\gradlew.bat compileKotlin
```

Expected: current code may still compile, but verifier later still reports deprecated `createShellWidget`. This step also downloads the new IntelliJ Platform target.

- [ ] **Step 3: Replace direct `createShellWidget` usage with new tab builder**

In `BackendLauncher.kt`, remove the direct call:

```kotlin
terminalManager.createShellWidget(workingDir, terminalName, false, !minimized)
```

Create a new helper near the old `createShellWidget` function:

```kotlin
private fun createBackendTerminalTab(
    project: Project,
    workingDir: String,
    terminalName: String,
    command: String,
): TerminalWidget {
    val manager = com.intellij.terminal.frontend.toolwindow.TerminalToolWindowTabsManager.getInstance(project)
    return manager.createTabBuilder()
        .workingDirectory(workingDir)
        .tabName(terminalName)
        .shellCommand(command)
        .createTab()
}
```

Then change `launchInTerminal()` so command construction happens before terminal creation:

```kotlin
val adjustedArgs = args.toList()
val command = (listOf(quoteIfNeeded(adjustedArgs.first())) + adjustedArgs.drop(1)).joinToString(" ")
val (shellWidget, selection) = createShellWidget(project, workingDir, "Opencode Backend", command, isVisible, minimized)
val backendProcess = RunningTerminalBackendProcess(shellWidget, adjustedArgs.joinToString(" "), outputBuffer)
```

Update `createShellWidget` signature:

```kotlin
private fun createShellWidget(
    project: Project,
    workingDir: String,
    terminalName: String,
    command: String,
    isVisible: Boolean,
    minimized: Boolean,
): Pair<ShellTerminalWidget, TerminalSelection>
```

For the new terminal branch, call `createBackendTerminalTab(project, workingDir, terminalName, command)` and remove the later `shellWidget.executeCommand(command)` call, because the builder starts the command.

- [ ] **Step 4: Compile and adjust only to public API signatures**

Run:

```powershell
.\gradlew.bat compileKotlin
```

Expected: if the exact package or method names differ, use the compiler errors and IntelliJ Platform SDK docs/source to adjust. Do not reintroduce `TerminalToolWindowManager.createShellWidget(...)` and do not use internal APIs.

- [ ] **Step 5: Verify deprecated call is gone**

Run from repo root:

```powershell
Select-String -Path "hosts/jetbrains-plugin/src/main/kotlin/**/*.kt" -Pattern "createShellWidget"
```

Expected: no direct call to `TerminalToolWindowManager.createShellWidget(...)`. A local helper named `createShellWidget` may still appear; rename it to `createBackendTerminalWidget` if this search is ambiguous.

- [ ] **Step 6: Run JetBrains build**

Run:

```powershell
.\gradlew.bat unitTest
.\gradlew.bat build
```

Expected: PASS.

- [ ] **Step 7: Commit checkpoint if authorized**

If commits are authorized:

```powershell
git add hosts/jetbrains-plugin/build.gradle.kts hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/backendprocess/BackendLauncher.kt
git commit -m "refactor(jetbrains): migrate terminal tab creation"
```

Otherwise skip.

---

### Task 7: Remove internal API imports and run final verifier

**Files:**

- Verify all modified files.
- Modify tests only if final compile exposes legitimate type mismatches.

- [ ] **Step 1: Search for forbidden API references**

Run from repo root:

```powershell
Select-String -Path "hosts/jetbrains-plugin/src/main/kotlin/**/*.kt" -Pattern "MarketplaceRequests|PluginDownloader|HideableTitledPanel|createShellWidget|PluginManagerConfigurable"
```

Expected: no matches. If a helper name `createShellWidget` remains, rename it to `createBackendTerminalWidget` and rerun.

- [ ] **Step 2: Run JetBrains unit tests**

Run from `hosts/jetbrains-plugin`:

```powershell
.\gradlew.bat unitTest
```

Expected: PASS.

- [ ] **Step 3: Run WebGUI focused tests**

Run from `packages/opencode/webgui`:

```powershell
bun test src/state/UpdateContext.test.tsx src/components/UpdateBanner.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Run JetBrains build**

Run from `hosts/jetbrains-plugin`:

```powershell
.\gradlew.bat build
```

Expected: PASS.

- [ ] **Step 5: Run Plugin Verifier**

Run from `hosts/jetbrains-plugin`:

```powershell
.\gradlew.bat verifyPlugin
```

Expected: PASS and no internal API usages for `MarketplaceRequests`/`PluginDownloader`. If verifier still reports Terminal API warnings, inspect the reported class and replace only with public API from the 2026.1 target.

- [ ] **Step 6: Commit checkpoint if authorized**

If commits are authorized:

```powershell
git add hosts/jetbrains-plugin packages/opencode/webgui docs/superpowers/specs/2026-05-09-jetbrains-public-api-migration-design.md docs/superpowers/plans/2026-05-09-jetbrains-public-api-migration.md
git commit -m "fix(jetbrains): remove internal api usage"
```

Otherwise skip.

---

## Self-Review

- Spec coverage: Tasks cover public Marketplace version display, manual Plugins settings entry, removal of internal update install APIs, deprecated logs panel replacement, Terminal API migration, tests, and verifier.
- Placeholder scan: The plan contains concrete files, commands, and code snippets. Terminal API compile adjustment is bounded to public API names surfaced by the raised SDK target and explicitly forbids reintroducing old/internal APIs.
- Type consistency: `UpdateRelease.manualUpdate`, `CheckForUpdatesResult.ManualCheck`, `MarketplaceVersionSource`, `MarketplacePluginRelease`, and `openPluginManager` are introduced before downstream tasks use them.
