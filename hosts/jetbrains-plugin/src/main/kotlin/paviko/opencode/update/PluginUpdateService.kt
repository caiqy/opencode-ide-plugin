package paviko.opencode.update

import com.intellij.openapi.application.ApplicationManager
import com.intellij.util.text.VersionComparatorUtil
import java.util.Properties

class PluginUpdateService(
    private val versionSource: PluginVersionSource = installedPluginVersionSource(),
    private val distributionChannelProvider: () -> String = ::readDistributionChannel,
    private val marketplaceVersionSource: MarketplaceVersionSource = defaultMarketplaceVersionSource(),
    private val backgroundRunner: (() -> Unit) -> Unit = { task -> ApplicationManager.getApplication().executeOnPooledThread(task) },
) {
    private val lock = Any()

    private var latest: UpdateRelease? = null
    private var reason: String? = null

    fun currentVersion(): String = versionSource.currentVersion()

    fun getUpdateInfo(): UpdateInfoResult {
        val currentVersion = currentVersion()
        val state = synchronized(lock) {
            latest to reason
        }

        return UpdateInfoResult(
            supported = true,
            reason = state.second,
            currentVersion = currentVersion,
            latest = state.first,
            hasUpdate = state.first != null,
        )
    }

    fun checkForUpdates(): CheckForUpdatesResult {
        val currentVersion = currentVersion()
        val unavailableReason = "marketplace update unavailable"

        return runCatching {
            marketplaceVersionSource.latest()
        }.fold(
            onSuccess = { marketplaceRelease ->
                when {
                    marketplaceRelease == null -> {
                        synchronized(lock) {
                            latest = null
                            reason = unavailableReason
                        }

                        CheckForUpdatesResult.ManualCheck(
                            currentVersion = currentVersion,
                            reason = unavailableReason,
                        )
                    }

                    VersionComparatorUtil.compare(marketplaceRelease.version, currentVersion) <= 0 -> {
                        synchronized(lock) {
                            latest = null
                            reason = null
                        }

                        CheckForUpdatesResult.UpToDate(currentVersion = currentVersion)
                    }

                    else -> {
                        val release = marketplaceRelease.toUpdateRelease()

                        synchronized(lock) {
                            latest = release
                            reason = null
                        }

                        CheckForUpdatesResult.Available(latest = release)
                    }
                }
            },
            onFailure = { error ->
                val failureReason = error.message ?: error.javaClass.simpleName

                synchronized(lock) {
                    latest = null
                    reason = failureReason
                }

                CheckForUpdatesResult.ManualCheck(
                    currentVersion = currentVersion,
                    reason = failureReason,
                )
            },
        )
    }

    fun prepareInstall(version: String): PreparedPluginUpdate {
        val release = synchronized(lock) {
            val current = latest ?: throw IllegalStateException("Update not available: $version")
            if (current.version != version) {
                throw IllegalStateException("Update not available: $version")
            }
            current
        }

        return PreparedPluginUpdate(version) { emit ->
            backgroundRunner {
                emit("manualUpdate", release.toPayload())
            }
        }
    }

    private fun MarketplacePluginRelease.toUpdateRelease(): UpdateRelease {
        return UpdateRelease(
            version = version,
            manualUpdate = true,
            releaseUrl = releaseUrl,
        )
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
