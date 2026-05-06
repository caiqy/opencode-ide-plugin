package paviko.opencode.update

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import java.util.concurrent.CountDownLatch
import kotlin.concurrent.thread

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
    fun `marketplace build with no update reports supported but empty state`() {
        val service = PluginUpdateService(
            currentVersionProvider = { "26.5.501" },
            distributionChannelProvider = { "marketplace" },
            latestProvider = null,
            marketplaceLookup = { MarketplaceLookup.NoUpdate },
            backgroundRunner = { task -> task() },
        )

        assertEquals(
            UpdateInfoResult(
                supported = true,
                reason = null,
                currentVersion = "26.5.501",
                latest = null,
                hasUpdate = false,
            ),
            service.getUpdateInfo(),
        )

        assertEquals(
            CheckForUpdatesResult.UpToDate(currentVersion = "26.5.501"),
            service.checkForUpdates(),
        )
    }

    @Test
    fun `checkForUpdates propagates marketplace query failures`() {
        val service = PluginUpdateService(
            currentVersionProvider = { "26.5.501" },
            distributionChannelProvider = { "marketplace" },
            latestProvider = null,
            marketplaceLookup = {
                throw IllegalStateException("marketplace unavailable")
            },
            backgroundRunner = { task -> task() },
        )

        val error = assertThrows(IllegalStateException::class.java) {
            service.checkForUpdates()
        }

        assertEquals("marketplace unavailable", error.message)
    }

    @Test
    fun `checkForUpdates fails when marketplace update model is missing`() {
        val service = PluginUpdateService(
            currentVersionProvider = { "26.5.501" },
            distributionChannelProvider = { "marketplace" },
            latestProvider = null,
            marketplaceLookup = {
                MarketplaceLookup.Available(Any())
            },
            updateVersionProvider = { null },
            backgroundRunner = { task -> task() },
        )

        val error = assertThrows(IllegalStateException::class.java) {
            service.checkForUpdates()
        }

        assertEquals("Marketplace update version missing", error.message)
    }

    @Test
    fun `checkForUpdates fails when marketplace metadata lookup itself fails`() {
        val service = PluginUpdateService(
            currentVersionProvider = { "26.5.501" },
            distributionChannelProvider = { "marketplace" },
            latestProvider = null,
            marketplaceLookup = {
                throw IllegalStateException("Marketplace update metadata missing")
            },
            backgroundRunner = { task -> task() },
        )

        val error = assertThrows(IllegalStateException::class.java) {
            service.checkForUpdates()
        }

        assertEquals("Marketplace update metadata missing", error.message)
    }

    @Test
    fun `default background runner does not block install preparation`() {
        val release = CountDownLatch(1)

        val service = PluginUpdateService(
            currentVersionProvider = { "26.5.501" },
            distributionChannelProvider = { "marketplace" },
            latestProvider = {
                AvailablePluginUpdate(
                    release = UpdateRelease(version = "26.5.502"),
                    install = {
                        release.await(1, java.util.concurrent.TimeUnit.SECONDS)
                    },
                )
            },
        )

        service.checkForUpdates()
        val prepared = service.prepareInstall("26.5.502")

        val caller = thread(start = true) {
            prepared.start { _, _ -> }
        }

        caller.join(500)
        assertFalse(caller.isAlive)
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

    @Test
    fun `successful install does not clear a newer cached update`() {
        var latest = AvailablePluginUpdate(
            release = UpdateRelease(version = "26.5.502"),
            install = {},
        )

        val service = PluginUpdateService(
            currentVersionProvider = { "26.5.501" },
            distributionChannelProvider = { "marketplace" },
            latestProvider = { latest },
            backgroundRunner = { task -> task() },
        )

        service.checkForUpdates()
        val prepared = service.prepareInstall("26.5.502")

        latest = AvailablePluginUpdate(
            release = UpdateRelease(version = "26.5.503"),
            install = {},
        )
        service.checkForUpdates()

        prepared.start { _, _ -> }

        assertEquals("26.5.503", service.getUpdateInfo().latest?.version)
        assertEquals(true, service.getUpdateInfo().hasUpdate)
    }

    @Test
    fun `prepared install emits error when installer fails`() {
        val events = mutableListOf<String>()
        val payloads = mutableListOf<Map<String, Any?>>()

        val service = PluginUpdateService(
            currentVersionProvider = { "26.5.501" },
            distributionChannelProvider = { "marketplace" },
            latestProvider = {
                AvailablePluginUpdate(
                    release = UpdateRelease(version = "26.5.502"),
                    install = { throw IllegalStateException("install failed") },
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

        assertEquals(listOf("installing", "error"), events)
        assertEquals("install failed", payloads.last()["error"])
        assertEquals("26.5.502", payloads.last()["version"])
    }
}
