package paviko.opencode.update

import com.intellij.ide.plugins.cl.PluginAwareClassLoader

fun interface PluginVersionSource {
    fun currentVersion(): String
}

internal fun installedPluginVersionSource(): PluginVersionSource = PluginVersionSource(::readInstalledPluginVersion)

internal fun readInstalledPluginVersion(): String {
    // The packaged plugin descriptor version is the version JetBrains installs, displays, and updates against.
    return (PluginVersionSource::class.java.classLoader as? PluginAwareClassLoader)?.pluginDescriptor?.version
        ?: throw IllegalStateException("Installed plugin descriptor not found")
}
