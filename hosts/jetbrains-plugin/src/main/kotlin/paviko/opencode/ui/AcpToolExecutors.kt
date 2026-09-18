package paviko.opencode.ui

import com.google.gson.Gson
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.vfs.VirtualFile
import java.io.File

private val gson = Gson()
private val LOG = Logger.getInstance("paviko.opencode.ui.AcpToolExecutors")

/**
 * Dispatches `executeAcpTool` requests to the per-capability implementations.
 *
 * All tools return `{ "output": <text> }`; structured results are serialized
 * into `output` because the IDE bridge only forwards that field to the model.
 */
internal fun defaultExecuteAcpTool(
    project: Project,
    category: String,
    toolId: String,
    parameters: Map<String, Any?>,
): Map<String, Any?> {
    return try {
        when (category) {
            "intellij" -> executeIntellijTool(project, toolId, parameters)
            "tasks_and_problems" -> executeTasksAndProblemsTool(project, toolId, parameters)
            "terminal" -> executeTerminalTool(project, toolId, parameters)
            "debug" -> executeDebugTool(project, toolId, parameters)
            else -> throw IllegalArgumentException("Unsupported category: $category")
        }
    } catch (e: Exception) {
        throw e
    } catch (t: Throwable) {
        throw IllegalStateException(t.message ?: t.javaClass.simpleName, t)
    }
}

private fun executeIntellijTool(project: Project, toolId: String, parameters: Map<String, Any?>): Map<String, Any?> {
    return when (toolId) {
        "executeAction" -> {
            val actionId = parameters.stringParam("actionId")
            if (actionId.isNullOrBlank()) throw IllegalArgumentException("Missing actionId parameter")
            val actionManager = com.intellij.openapi.actionSystem.ActionManager.getInstance()
            val action = actionManager.getAction(actionId) ?: throw IllegalArgumentException("Action not found: $actionId")
            ApplicationManager.getApplication().invokeLater {
                try {
                    val dataContext = com.intellij.ide.DataManager.getInstance().getDataContext()
                    val event = com.intellij.openapi.actionSystem.AnActionEvent.createFromAnAction(
                        action,
                        null,
                        com.intellij.openapi.actionSystem.ActionPlaces.UNKNOWN,
                        dataContext
                    )
                    com.intellij.openapi.actionSystem.ex.ActionUtil.performActionDumbAwareWithCallbacks(action, event)
                } catch (t: Throwable) {
                    LOG.warn("Failed to perform action $actionId", t)
                }
            }
            mapOf("output" to "Action $actionId scheduled on event dispatch thread")
        }

        "listActions" -> {
            val prefix = parameters.stringParam("prefix") ?: ""
            val actionManager = com.intellij.openapi.actionSystem.ActionManager.getInstance()
            val ids = actionManager.getActionIdList(prefix).take(100)
            mapOf("output" to gson.toJson(ids))
        }

        "editor" -> {
            val path = parameters.stringParam("path") ?: throw IllegalArgumentException("Missing path parameter")
            val line = parameters.intParam("line") ?: 1
            val resolved = resolvePath(project, path) ?: path
            IdeBridge.openFile(project, resolved, if (line > 0) line - 1 else -1, -1)
            mapOf("output" to "Opened $path at line $line")
        }

        else -> throw IllegalArgumentException("Unsupported tool in intellij category: $toolId")
    }
}

private fun executeTasksAndProblemsTool(
    project: Project,
    toolId: String,
    parameters: Map<String, Any?>,
): Map<String, Any?> {
    return when (toolId) {
        "listRunConfigurations" -> listRunConfigurations(project)
        "runConfiguration" -> runRunConfiguration(project, parameters)
        "debugConfiguration" -> debugRunConfiguration(project, parameters)
        "stopRunConfiguration" -> stopRunConfiguration(project, parameters)
        "getProblems" -> getProblems(project, parameters)
        else -> throw IllegalArgumentException("Unsupported tool in tasks_and_problems category: $toolId")
    }
}

/** Runs [action] on the EDT and rethrows failures in the calling thread. */
internal fun <T> onEdt(action: () -> T): T {
    val application = ApplicationManager.getApplication()
    if (application == null || application.isDispatchThread) return action()

    var result: T? = null
    var failure: Throwable? = null
    application.invokeAndWait {
        try {
            result = action()
        } catch (t: Throwable) {
            failure = t
        }
    }
    failure?.let { throw it }

    @Suppress("UNCHECKED_CAST")
    return result as T
}

/** Runs [action] inside a read action (platform reads require it). */
internal fun <T> onReadAction(action: () -> T): T =
    com.intellij.openapi.application.ReadAction.compute<T, RuntimeException> { action() }

/** Resolves a user supplied path to an absolute, forward-slash path. */
internal fun resolvePath(project: Project, rawPath: String): String? {
    val normalized = rawPath.trim().replace('\\', '/')
    if (normalized.isEmpty()) return null
    if (File(normalized).isAbsolute) return normalized
    val base = project.basePath ?: return normalized
    return "$base/$normalized"
}

/** Resolves a user supplied path to a VirtualFile; directories are returned as-is. */
internal fun resolveVirtualFile(project: Project, rawPath: String): VirtualFile? {
    val absolute = resolvePath(project, rawPath) ?: return null
    val lfs = LocalFileSystem.getInstance()
    return lfs.findFileByPath(absolute) ?: lfs.refreshAndFindFileByPath(absolute)
}

internal fun Map<String, Any?>.stringParam(name: String): String? = when (val value = this[name]) {
    null -> null
    is String -> value
    else -> value.toString()
}

internal fun Map<String, Any?>.intParam(name: String): Int? = when (val value = this[name]) {
    null -> null
    is Number -> value.toInt()
    is String -> value.trim().toIntOrNull()
    else -> null
}

internal fun Map<String, Any?>.booleanParam(name: String): Boolean? = when (val value = this[name]) {
    null -> null
    is Boolean -> value
    is String -> when {
        value.equals("true", ignoreCase = true) -> true
        value.equals("false", ignoreCase = true) -> false
        else -> null
    }
    else -> null
}

internal fun Map<String, Any?>.requiredString(name: String): String =
    stringParam(name)?.takeIf { it.isNotBlank() } ?: throw IllegalArgumentException("Missing '$name' parameter")

internal fun textOutput(text: String): Map<String, Any?> = mapOf("output" to text)

internal fun jsonOutput(value: Any): Map<String, Any?> = mapOf("output" to gson.toJson(value))

internal fun truncateOutput(text: String, maxChars: Int = 20000): String {
    if (text.length <= maxChars) return text
    val dropped = text.length - maxChars
    return text.take(maxChars) + "\n…[truncated $dropped characters]"
}
