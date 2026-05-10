package paviko.opencode.update

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

class PluginUpdateServiceTest {
    @Test
    fun `service reports current version from injected version source`() {
        var version = "26.5.501"
        val service = PluginUpdateService(
            versionSource = PluginVersionSource { version },
            distributionChannelProvider = { "local" },
            marketplaceVersionSource = MarketplaceVersionSource {
                throw AssertionError("marketplaceVersionSource should not run for currentVersion")
            },
            backgroundRunner = { task -> task() },
        )

        assertEquals("26.5.501", service.getUpdateInfo().currentVersion)

        version = "26.5.502"

        assertEquals("26.5.502", service.getUpdateInfo().currentVersion)
    }

    @Test
    fun `newer public marketplace release returns available manual update and caches it`() {
        val release = MarketplacePluginRelease(
            version = "26.5.502",
            releaseUrl = "https://plugins.jetbrains.com/plugin/31609-opencode-ui-unofficial-/versions/stable/123456",
        )
        val service = PluginUpdateService(
            versionSource = PluginVersionSource { "26.5.501" },
            distributionChannelProvider = { "marketplace" },
            marketplaceVersionSource = MarketplaceVersionSource { release },
            backgroundRunner = { task -> task() },
        )

        assertEquals(
            CheckForUpdatesResult.Available(
                latest = UpdateRelease(
                    version = "26.5.502",
                    releaseUrl = release.releaseUrl,
                    manualUpdate = true,
                ),
            ),
            service.checkForUpdates(),
        )

        assertEquals(
            UpdateInfoResult(
                supported = true,
                currentVersion = "26.5.501",
                latest = UpdateRelease(
                    version = "26.5.502",
                    releaseUrl = release.releaseUrl,
                    manualUpdate = true,
                ),
                hasUpdate = true,
            ),
            service.getUpdateInfo(),
        )
    }

    @Test
    fun `null marketplace release returns manual check and clears cached update`() {
        var latestRelease: MarketplacePluginRelease? = MarketplacePluginRelease(
            version = "26.5.502",
            releaseUrl = "https://plugins.jetbrains.com/plugin/31609-opencode-ui-unofficial-/versions/stable/123456",
        )
        val service = PluginUpdateService(
            versionSource = PluginVersionSource { "26.5.501" },
            distributionChannelProvider = { "marketplace" },
            marketplaceVersionSource = MarketplaceVersionSource { latestRelease },
            backgroundRunner = { task -> task() },
        )

        assertEquals("available", service.checkForUpdates().status)
        latestRelease = null

        assertEquals(
            CheckForUpdatesResult.ManualCheck(
                currentVersion = "26.5.501",
                reason = "marketplace update unavailable",
            ),
            service.checkForUpdates(),
        )

        assertEquals(
            UpdateInfoResult(
                supported = true,
                reason = "marketplace update unavailable",
                currentVersion = "26.5.501",
                latest = null,
                hasUpdate = false,
            ),
            service.getUpdateInfo(),
        )
    }

    @Test
    fun `same current version returns up to date and clears cached update`() {
        var currentVersion = "26.5.501"
        var latestRelease = MarketplacePluginRelease(
            version = "26.5.502",
            releaseUrl = "https://plugins.jetbrains.com/plugin/31609-opencode-ui-unofficial-/versions/stable/123456",
        )
        val service = PluginUpdateService(
            versionSource = PluginVersionSource { currentVersion },
            distributionChannelProvider = { "local" },
            marketplaceVersionSource = MarketplaceVersionSource { latestRelease },
            backgroundRunner = { task -> task() },
        )

        assertEquals("available", service.checkForUpdates().status)

        currentVersion = "26.5.502"
        latestRelease = latestRelease.copy(version = "26.5.502")

        assertEquals(
            CheckForUpdatesResult.UpToDate(currentVersion = "26.5.502"),
            service.checkForUpdates(),
        )

        assertEquals(
            UpdateInfoResult(
                supported = true,
                currentVersion = "26.5.502",
                latest = null,
                hasUpdate = false,
            ),
            service.getUpdateInfo(),
        )
    }

    @Test
    fun `higher current version than marketplace returns up to date and clears cached update`() {
        var currentVersion = "26.5.501"
        var latestRelease = MarketplacePluginRelease(
            version = "26.5.502",
            releaseUrl = "https://plugins.jetbrains.com/plugin/31609-opencode-ui-unofficial-/versions/stable/123456",
        )
        val service = PluginUpdateService(
            versionSource = PluginVersionSource { currentVersion },
            distributionChannelProvider = { "local" },
            marketplaceVersionSource = MarketplaceVersionSource { latestRelease },
            backgroundRunner = { task -> task() },
        )

        assertEquals("available", service.checkForUpdates().status)

        currentVersion = "26.5.503"
        latestRelease = latestRelease.copy(version = "26.5.502")

        assertEquals(
            CheckForUpdatesResult.UpToDate(currentVersion = "26.5.503"),
            service.checkForUpdates(),
        )

        assertEquals(
            UpdateInfoResult(
                supported = true,
                currentVersion = "26.5.503",
                latest = null,
                hasUpdate = false,
            ),
            service.getUpdateInfo(),
        )
    }

    @Test
    fun `marketplace exception returns manual check instead of throwing`() {
        var fail = false
        val service = PluginUpdateService(
            versionSource = PluginVersionSource { "26.5.501" },
            distributionChannelProvider = { "marketplace" },
            marketplaceVersionSource = MarketplaceVersionSource {
                if (fail) {
                    throw IllegalStateException("marketplace unavailable")
                }
                MarketplacePluginRelease(
                    version = "26.5.502",
                    releaseUrl = "https://plugins.jetbrains.com/plugin/31609-opencode-ui-unofficial-/versions/stable/123456",
                )
            },
            backgroundRunner = { task -> task() },
        )

        assertEquals("available", service.checkForUpdates().status)
        fail = true

        assertEquals(
            CheckForUpdatesResult.ManualCheck(
                currentVersion = "26.5.501",
                reason = "marketplace unavailable",
                releaseUrl = marketplacePluginPage(),
            ),
            service.checkForUpdates(),
        )
        assertFalse(service.getUpdateInfo().hasUpdate)
        assertEquals(null, service.getUpdateInfo().latest)
        assertEquals("marketplace unavailable", service.getUpdateInfo().reason)
    }

    @Test
    fun `prepareInstall emits manualUpdate only`() {
        val release = MarketplacePluginRelease(
            version = "26.5.502",
            releaseUrl = "https://plugins.jetbrains.com/plugin/31609-opencode-ui-unofficial-/versions/stable/123456",
        )
        val events = mutableListOf<String>()
        val payloads = mutableListOf<Map<String, Any?>>()
        val service = PluginUpdateService(
            versionSource = PluginVersionSource { "26.5.501" },
            distributionChannelProvider = { "marketplace" },
            marketplaceVersionSource = MarketplaceVersionSource { release },
            backgroundRunner = { task -> task() },
        )

        service.checkForUpdates()
        val prepared = service.prepareInstall("26.5.502")
        prepared.start { type, payload ->
            events += type
            payloads += payload
        }

        assertEquals(listOf("manualUpdate"), events)
        assertEquals(
            mapOf(
                "version" to "26.5.502",
                "releaseUrl" to release.releaseUrl,
                "manualUpdate" to true,
            ),
            payloads.single(),
        )
    }

    @Test
    fun `prepareInstall rejects a stale version`() {
        val service = PluginUpdateService(
            versionSource = PluginVersionSource { "26.5.501" },
            distributionChannelProvider = { "marketplace" },
            marketplaceVersionSource = MarketplaceVersionSource {
                MarketplacePluginRelease(
                    version = "26.5.502",
                    releaseUrl = "https://plugins.jetbrains.com/plugin/31609-opencode-ui-unofficial-/versions/stable/123456",
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
}
