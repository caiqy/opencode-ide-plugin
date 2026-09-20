package paviko.opencode.ui

import com.intellij.execution.ProgramRunnerUtil
import com.intellij.execution.RunManager
import com.intellij.execution.RunnerAndConfigurationSettings
import com.intellij.execution.executors.DefaultDebugExecutor
import com.intellij.execution.executors.DefaultRunExecutor
import com.intellij.execution.impl.ExecutionManagerImpl
import com.intellij.execution.ui.RunContentManager
import com.intellij.openapi.project.Project

internal fun listRunConfigurations(project: Project): Map<String, Any?> {
    val names = RunManager.getInstance(project).allSettings.map { it.name }
    return jsonOutput(names)
}

/**
 * Test seam: resolving platform executors requires a full IDE runtime, so unit tests
 * replace the launcher instead of constructing [ProgramRunnerUtil] inputs.
 */
internal var executeConfigurationAction: (Project, RunnerAndConfigurationSettings, Boolean) -> Unit =
    { project, settings, debug ->
        val executor = if (debug) {
            DefaultDebugExecutor.getDebugExecutorInstance()
        } else {
            DefaultRunExecutor.getRunExecutorInstance()
        }
        ProgramRunnerUtil.executeConfiguration(project, settings, executor)
    }

internal fun runRunConfiguration(project: Project, parameters: Map<String, Any?>): Map<String, Any?> {
    val name = parameters.requiredString("name")
    val settings = findRunConfiguration(project, name)
    onEdt { executeConfigurationAction(project, settings, false) }
    return textOutput("Started run configuration \"$name\" (Run)")
}

internal fun debugRunConfiguration(project: Project, parameters: Map<String, Any?>): Map<String, Any?> {
    val name = parameters.requiredString("name")
    val settings = findRunConfiguration(project, name)
    onEdt { executeConfigurationAction(project, settings, true) }
    return textOutput("Started run configuration \"$name\" (Debug)")
}

internal fun stopRunConfiguration(project: Project, parameters: Map<String, Any?>): Map<String, Any?> {
    val name = parameters.stringParam("name")?.takeIf { it.isNotBlank() }
    val candidates = onEdt { RunContentManager.getInstance(project).allDescriptors }
        .filter { it.processHandler?.isProcessTerminated == false }
        .mapNotNull { descriptor ->
            val configuration = ExecutionManagerImpl.getInstance(project).getConfigurations(descriptor)
                .firstOrNull { name == null || it.name == name }
            if (name != null && configuration == null) return@mapNotNull null
            descriptor to (configuration?.name ?: descriptor.displayName ?: "unknown")
        }

    if (candidates.isEmpty()) {
        throw IllegalStateException(
            if (name != null) "No running process found for run configuration \"$name\""
            else "No running process found"
        )
    }

    val target = candidates.maxByOrNull { it.first.executionId }
        ?: throw IllegalStateException("No running process found")
    onEdt { target.first.processHandler?.destroyProcess() }
    return jsonOutput(mapOf("stopped" to listOf(target.second)))
}

private fun findRunConfiguration(project: Project, name: String): RunnerAndConfigurationSettings =
    RunManager.getInstance(project).findConfigurationByName(name)
        ?: throw IllegalArgumentException("Run configuration not found: $name")
