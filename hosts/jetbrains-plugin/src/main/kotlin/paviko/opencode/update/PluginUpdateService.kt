package paviko.opencode.update

import com.intellij.ide.plugins.marketplace.MarketplaceRequests
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.extensions.PluginId
import com.intellij.openapi.updateSettings.impl.PluginDownloader
import com.intellij.util.text.VersionComparatorUtil
import paviko.opencode.JETBRAINS_PLUGIN_ID
import java.lang.reflect.InvocationTargetException
import java.util.Properties

private val pluginId = PluginId.getId(JETBRAINS_PLUGIN_ID)

sealed interface MarketplaceLookup {
    data object NoUpdate : MarketplaceLookup

    data class Available(
        val model: Any,
    ) : MarketplaceLookup
}

private fun loadLatestMarketplaceUpdate(
    versionSource: PluginVersionSource,
    marketplaceLookup: () -> MarketplaceLookup,
    updateVersionProvider: (Any) -> String?,
): AvailablePluginUpdate? {
    val currentVersion = versionSource.currentVersion()
    val lookup = marketplaceLookup()
    if (lookup === MarketplaceLookup.NoUpdate) {
        return null
    }

    val update = (lookup as MarketplaceLookup.Available).model

    val version = updateVersionProvider(update)
        ?: throw IllegalStateException("Marketplace update version missing")

    if (VersionComparatorUtil.compare(version, currentVersion) <= 0) {
        return null
    }

    val release = UpdateRelease(version = version)
    return AvailablePluginUpdate(
        release = release,
        install = {
            val downloader = createDownloader(update)
            if (!downloader.prepareToInstall(null)) {
                throw IllegalStateException("Update not available: $version")
            }
            downloader.installDynamically(null)
        },
    )
}

private fun loadMarketplaceUpdate(): MarketplaceLookup {
    val requests = MarketplaceRequests.getInstance()

    // Newer IDEs expose getLastCompatiblePluginUpdateModel(), but the 2024.3 compile stubs in this repo do not.
    // We reflectively prefer that API when present, then use the strict fallback below to disambiguate its null result.
    // The fragile point is JetBrains renaming these methods or changing the parameter shapes.
    val modern = requests.javaClass.methods.firstOrNull { method ->
        method.name == "getLastCompatiblePluginUpdateModel" &&
            method.parameterTypes.size == 3
    }

    if (modern != null) {
        val model = modern.invoke(requests, pluginId, null, null)
        if (model != null) {
            return MarketplaceLookup.Available(model)
        }
    }

    return loadMarketplaceUpdateStrict(requests)
}

private fun loadMarketplaceUpdateStrict(requests: MarketplaceRequests): MarketplaceLookup {
    val legacy = requests.javaClass.methods.firstOrNull { method ->
        method.name == "getLastCompatiblePluginUpdate" &&
            method.parameterTypes.size == 3
    }

    if (legacy != null) {
        val result = runCatching {
            legacy.invoke(requests, pluginId, null, null)
        }.getOrElse(::unwrapReflectionFailure)

        return if (result == null) MarketplaceLookup.NoUpdate else MarketplaceLookup.Available(result)
    }

    val listMethod = requests.javaClass.methods.firstOrNull { method ->
        method.name == "loadLastCompatiblePluginUpdate" &&
            method.parameterTypes.size == 3
    } ?: throw IllegalStateException("Marketplace update lookup method not found")

    val updates = runCatching {
        listMethod.invoke(requests, setOf(pluginId), null, true) as? List<*>
    }.getOrElse(::unwrapReflectionFailure) ?: throw IllegalStateException("Marketplace update metadata missing")

    val first = updates.firstOrNull() ?: return MarketplaceLookup.NoUpdate

    val descriptor = requests.javaClass.methods.firstOrNull { method ->
        method.name == "loadPluginDescriptor" &&
            method.parameterTypes.size == 3
    } ?: throw IllegalStateException("Marketplace descriptor loader not found")

    val model = runCatching {
        descriptor.invoke(requests, pluginId.idString, first, null)
    }.getOrElse(::unwrapReflectionFailure) ?: throw IllegalStateException("Marketplace update metadata missing")

    return MarketplaceLookup.Available(model)
}

private fun unwrapReflectionFailure(error: Throwable): Nothing {
    val cause = (error as? InvocationTargetException)?.targetException ?: error.cause ?: error
    throw cause
}

private fun Any.version(): String? {
    return javaClass.methods.firstOrNull { method -> method.name == "getVersion" && method.parameterTypes.isEmpty() }
        ?.invoke(this) as? String
}

private fun createDownloader(model: Any): PluginDownloader {
    val method = PluginDownloader::class.java.methods.firstOrNull { candidate ->
        candidate.name == "createDownloader" && candidate.parameterTypes.size == 3
    } ?: throw IllegalStateException("PluginDownloader.createDownloader not found")

    return method.invoke(null, model, null, null) as PluginDownloader
}

class PluginUpdateService(
    private val versionSource: PluginVersionSource = installedPluginVersionSource(),
    private val distributionChannelProvider: () -> String = ::readDistributionChannel,
    latestProvider: (() -> AvailablePluginUpdate?)? = null,
    private val marketplaceLookup: () -> MarketplaceLookup = ::loadMarketplaceUpdate,
    private val updateVersionProvider: (Any) -> String? = { it.version() },
    private val backgroundRunner: (() -> Unit) -> Unit = { task -> ApplicationManager.getApplication().executeOnPooledThread(task) },
) {
    private val lock = Any()

    fun currentVersion(): String = versionSource.currentVersion()

    private val latestProvider = latestProvider ?: {
        loadLatestMarketplaceUpdate(
            versionSource = versionSource,
            marketplaceLookup = marketplaceLookup,
            updateVersionProvider = updateVersionProvider,
        )
    }

    private var latest: AvailablePluginUpdate? = null

    fun getUpdateInfo(): UpdateInfoResult {
        val currentVersion = currentVersion()
        if (!supportsInAppUpdate()) {
            synchronized(lock) {
                latest = null
            }
            return UpdateInfoResult(
                supported = false,
                reason = "marketplace-only",
                currentVersion = currentVersion,
                latest = null,
                hasUpdate = false,
            )
        }

        val release = synchronized(lock) {
            latest?.release
        }
        return UpdateInfoResult(
            supported = true,
            reason = null,
            currentVersion = currentVersion,
            latest = release,
            hasUpdate = release != null,
        )
    }

    fun checkForUpdates(): CheckForUpdatesResult {
        val currentVersion = currentVersion()
        if (!supportsInAppUpdate()) {
            synchronized(lock) {
                latest = null
            }
            return CheckForUpdatesResult.Unsupported(
                currentVersion = currentVersion,
                reason = "marketplace-only",
            )
        }

        val available = latestProvider()
        synchronized(lock) {
            latest = available
        }
        val release = available?.release
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

        val available = synchronized(lock) {
            val current = latest ?: throw IllegalStateException("Update not available: $version")
            if (current.release.version != version) {
                throw IllegalStateException("Update not available: $version")
            }
            current
        }

        return PreparedPluginUpdate(version) { emit ->
            backgroundRunner {
                emit("installing", available.release.toPayload())
                runCatching {
                    available.install()
                }.onSuccess {
                    synchronized(lock) {
                        if (latest === available) {
                            latest = null
                        }
                    }
                    emit("success", available.release.toPayload())
                }.onFailure { error ->
                    emit(
                        "error",
                        available.release.toPayload(
                            mapOf("error" to (error.message ?: error.javaClass.simpleName)),
                        ),
                    )
                }
            }
        }
    }

    private fun supportsInAppUpdate(): Boolean = distributionChannelProvider() == "marketplace"

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
