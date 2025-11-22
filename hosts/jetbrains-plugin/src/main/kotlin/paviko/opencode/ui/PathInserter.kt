package paviko.opencode.ui

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.ui.jcef.JBCefBrowser
import javax.swing.SwingUtilities

/**
 * Utility to send file paths (and optional :start-end ranges) to the embedded web UI.
 */
object PathInserter {
    private val logger = Logger.getInstance(PathInserter::class.java)
    private val mapper = jacksonObjectMapper()

    fun insertPaths(project: Project, paths: List<String>) {
        try {
            if (paths.isEmpty()) return
            
            IdeBridge.send(project, "insertPaths", mapOf("paths" to paths))
        } catch (e: Exception) {
            logger.error("Unexpected error inserting paths", e)
        }
    }

    fun pastePath(project: Project, path: String) {
        try {
            if (path.isEmpty()) return
            
            IdeBridge.send(project, "pastePath", mapOf("path" to path))
        } catch (e: Exception) {
            logger.error("Unexpected error pasting path", e)
        }
    }
}
