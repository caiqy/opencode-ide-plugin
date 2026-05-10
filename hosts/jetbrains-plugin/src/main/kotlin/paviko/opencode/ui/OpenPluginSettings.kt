package paviko.opencode.ui

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.options.SearchableConfigurable
import com.intellij.openapi.options.ShowSettingsUtil
import com.intellij.openapi.project.Project

private const val PLUGIN_MANAGER_CONFIGURABLE_ID = "preferences.pluginManager"

internal object OpenPluginSettings {
    fun open(project: Project) {
        val app = ApplicationManager.getApplication()
        val task = Runnable {
            ShowSettingsUtil.getInstance().showSettingsDialog(
                project,
                { configurable ->
                    configurable is SearchableConfigurable && configurable.id == PLUGIN_MANAGER_CONFIGURABLE_ID
                },
                null,
            )
        }
        if (app.isDispatchThread) task.run() else app.invokeAndWait(task)
    }
}
