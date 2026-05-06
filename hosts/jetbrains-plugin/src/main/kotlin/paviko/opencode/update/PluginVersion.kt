package paviko.opencode.update

import com.intellij.ide.plugins.PluginManagerCore
import com.intellij.openapi.extensions.PluginId
import paviko.opencode.JETBRAINS_PLUGIN_ID

private val pluginId = PluginId.getId(JETBRAINS_PLUGIN_ID)

internal fun readInstalledPluginVersion(): String {
    return PluginManagerCore.getPlugin(pluginId)?.version
        ?: throw IllegalStateException("Installed plugin descriptor not found")
}
