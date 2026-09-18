package paviko.opencode.ui

import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.execution.process.CapturingProcessHandler
import com.intellij.openapi.project.Project
import org.jetbrains.plugins.terminal.TerminalToolWindowManager
import java.nio.charset.StandardCharsets

internal fun executeTerminalTool(
    project: Project,
    toolId: String,
    parameters: Map<String, Any?>,
): Map<String, Any?> = when (toolId) {
    "sendToTerminal" -> sendToTerminal(project, parameters)
    "runCommand" -> runCommand(project, parameters)
    else -> throw IllegalArgumentException("Unsupported tool in terminal category: $toolId")
}

private fun sendToTerminal(project: Project, parameters: Map<String, Any?>): Map<String, Any?> {
    val command = parameters.requiredString("command")
    val tabName = parameters.stringParam("name")?.takeIf { it.isNotBlank() } ?: "OpenCode"
    val workingDirectory = parameters.stringParam("workingDirectory")?.takeIf { it.isNotBlank() }
        ?: project.basePath

    onEdt {
        val manager = TerminalToolWindowManager.getInstance(project)
        val widget = manager.createLocalShellWidget(workingDirectory, tabName)
            ?: throw IllegalStateException("Unable to create a terminal tab")
        widget.executeCommand(command)
    }
    return textOutput("Sent command to terminal \"$tabName\": $command")
}

private fun runCommand(project: Project, parameters: Map<String, Any?>): Map<String, Any?> {
    val command = parameters.requiredString("command")
    val workingDirectory = parameters.stringParam("workingDirectory")?.takeIf { it.isNotBlank() }
        ?: project.basePath
    val timeoutMs = (parameters.intParam("timeoutMs") ?: 30000).coerceIn(1000, 55000)

    val isWindows = System.getProperty("os.name").lowercase().contains("win")
    val commandLine = if (isWindows) {
        GeneralCommandLine("cmd.exe", "/c", command)
    } else {
        GeneralCommandLine("/bin/sh", "-c", command)
    }
    if (workingDirectory != null) commandLine.withWorkDirectory(workingDirectory)
    commandLine.withCharset(StandardCharsets.UTF_8)

    val output = try {
        CapturingProcessHandler(commandLine).runProcess(timeoutMs)
    } catch (e: Exception) {
        throw IllegalStateException("Unable to start command: ${e.message ?: e}")
    }

    val stdout = truncateOutput(output.stdout)
    val stderr = truncateOutput(output.stderr)
    if (output.isTimeout) {
        throw IllegalStateException("Command timed out after ${timeoutMs}ms\nstdout:\n$stdout\nstderr:\n$stderr")
    }

    val combined = buildString {
        if (stdout.isNotEmpty()) append(stdout)
        if (stderr.isNotEmpty()) {
            if (isNotEmpty()) append('\n')
            append("stderr:\n").append(stderr)
        }
    }.trim()

    return jsonOutput(
        mapOf(
            "exitCode" to output.exitCode,
            "stdout" to stdout,
            "stderr" to stderr,
            "output" to combined
        )
    )
}
