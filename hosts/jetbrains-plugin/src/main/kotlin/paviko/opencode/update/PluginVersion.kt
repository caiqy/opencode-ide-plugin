package paviko.opencode.update

import com.intellij.ide.plugins.PluginManagerCore
import com.intellij.openapi.extensions.PluginId
import paviko.opencode.JETBRAINS_PLUGIN_ID

private val pluginId = PluginId.getId(JETBRAINS_PLUGIN_ID)

fun interface PluginVersionSource {
    fun currentVersion(): String
}

internal fun installedPluginVersionSource(): PluginVersionSource = PluginVersionSource(::readInstalledPluginVersion)

internal fun readInstalledPluginVersion(): String {
    // The packaged plugin descriptor version is the version JetBrains installs, displays, and updates against.
    return PluginManagerCore.getPlugin(pluginId)?.version
        ?: throw IllegalStateException("Installed plugin descriptor not found")
}
