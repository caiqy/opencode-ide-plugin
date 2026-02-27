package paviko.opencode.ui

import com.intellij.ide.util.PropertiesComponent
import com.intellij.openapi.project.Project

interface IdeBridgeStorageBackend {
    fun getGlobal(key: String): String?

    fun setGlobal(key: String, value: String)

    fun getWorkspace(project: Project, key: String): String?

    fun setWorkspace(project: Project, key: String, value: String)
}

object IdeBridgePropertiesStorageBackend : IdeBridgeStorageBackend {
    override fun getGlobal(key: String): String? = PropertiesComponent.getInstance().getValue(key)

    override fun setGlobal(key: String, value: String) {
        PropertiesComponent.getInstance().setValue(key, value)
    }

    override fun getWorkspace(project: Project, key: String): String? =
        PropertiesComponent.getInstance(project).getValue(key)

    override fun setWorkspace(project: Project, key: String, value: String) {
        PropertiesComponent.getInstance(project).setValue(key, value)
    }
}
