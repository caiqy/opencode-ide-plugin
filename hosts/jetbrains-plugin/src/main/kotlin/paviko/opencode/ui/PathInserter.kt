package paviko.opencode.ui

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.intellij.openapi.diagnostic.Logger
import com.intellij.ui.jcef.JBCefBrowser
import javax.swing.SwingUtilities

/**
 * Utility to send file paths (and optional :start-end ranges) to the embedded web UI.
 */
object PathInserter {
    private val logger = Logger.getInstance(PathInserter::class.java)
    private val mapper = jacksonObjectMapper()
    @Volatile private var browser: JBCefBrowser? = null

    fun setBrowser(browser: JBCefBrowser) {
        this.browser = browser
    }

    fun clearBrowser() {
        this.browser = null
    }

    fun insertPaths(paths: List<String>) {
        try {
            val b = browser ?: run {
                logger.warn("No browser available to insert paths")
                return
            }
            if (paths.isEmpty()) return
            
            IdeBridge.send("insertPaths", mapOf("paths" to paths))
        } catch (e: Exception) {
            logger.error("Unexpected error inserting paths", e)
        }
    }

    fun pastePath(path: String) {
        try {
            val b = browser ?: run {
                logger.warn("No browser available to paste path")
                return
            }
            if (path.isEmpty()) return
            
            IdeBridge.send("pastePath", mapOf("path" to path))
        } catch (e: Exception) {
            logger.error("Unexpected error pasting path", e)
        }
    }
}
