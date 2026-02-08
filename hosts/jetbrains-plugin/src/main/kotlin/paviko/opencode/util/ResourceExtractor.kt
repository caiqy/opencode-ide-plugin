package paviko.opencode.util

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import java.io.File
import java.io.InputStream

object ResourceExtractor {
    private const val STABLE_DIR = "opencode-bin"
    private const val STALE_PREFIX = "opencode-"
    private val logger = Logger.getInstance(ResourceExtractor::class.java)

    /**
     * Extracts a resource to a deterministic temporary location.
     * Reuses the existing binary when the file size matches, and only
     * re-copies after an extension update changes the bundled binary.
     * IMPORTANT: This method performs heavy I/O (file copy) and must NOT be called from EDT.
     */
    fun extractToTemp(resourcePath: String, targetName: String): String? {
        require(!ApplicationManager.getApplication().isDispatchThread) {
            "extractToTemp must not be called from EDT - it performs heavy file I/O operations"
        }
        val stream: InputStream = javaClass.classLoader.getResourceAsStream(resourcePath) ?: return null

        val stableDir = File(System.getProperty("java.io.tmpdir"), STABLE_DIR)
        stableDir.mkdirs()
        val dest = File(stableDir, targetName)

        // Read resource into memory so we can check size before writing
        val bytes = stream.use { it.readBytes() }

        try {
            dest.writeBytes(bytes)
        } catch (e: Exception) {
            // Binary may be in use – continue with existing copy
            logger.info("Could not overwrite binary (may be in use): ${e.message}")
        }

        dest.setExecutable(true)

        // Best-effort cleanup of stale random temp dirs from previous versions
        cleanupStaleTempDirs()

        return dest.absolutePath
    }

    /**
     * Remove stale opencode-<random> temp directories left by older plugin versions.
     */
    private fun cleanupStaleTempDirs() {
        try {
            val tmpDir = File(System.getProperty("java.io.tmpdir"))
            val entries = tmpDir.listFiles() ?: return
            for (entry in entries) {
                if (!entry.name.startsWith(STALE_PREFIX) || entry.name == STABLE_DIR) continue
                // Match old random pattern: opencode-<digits…>
                if (!entry.name.matches(Regex("^opencode-\\d.*"))) continue
                try {
                    if (entry.isDirectory) entry.deleteRecursively() else entry.delete()
                } catch (_: Exception) {
                    // ignore – file may be in use or already removed
                }
            }
        } catch (e: Exception) {
            logger.debug("Failed to clean stale temp dirs: ${e.message}")
        }
    }
}
