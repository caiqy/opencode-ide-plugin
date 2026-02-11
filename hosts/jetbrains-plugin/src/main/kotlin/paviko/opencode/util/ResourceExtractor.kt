package paviko.opencode.util

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import java.io.File
import java.io.InputStream

object ResourceExtractor {
    private const val STABLE_DIR = "opencode-bin"
    private const val STALE_PREFIX = "opencode-"
    private val logger = Logger.getInstance(ResourceExtractor::class.java)
    private val lock = Any()
    @Volatile
    private var cached: String? = null

    /**
     * Extracts a resource to a deterministic temporary location.
     * On the first call per IDE session the entire stable directory is
     * deleted so the new bundled binary always replaces the old one.
     * Subsequent calls (e.g. from other project windows) return the
     * cached path without re-extracting.
     * IMPORTANT: This method performs heavy I/O (file copy) and must NOT be called from EDT.
     */
    fun extractToTemp(resourcePath: String, targetName: String): String? {
        require(!ApplicationManager.getApplication().isDispatchThread) {
            "extractToTemp must not be called from EDT - it performs heavy file I/O operations"
        }

        cached?.let {
            logger.info("ResourceExtractor: skipping extraction, using cached binary at $it")
            return it
        }

        synchronized(lock) {
            cached?.let {
                logger.info("ResourceExtractor: skipping extraction inside lock, using cached binary at $it")
                return it
            }

            val stream: InputStream = javaClass.classLoader.getResourceAsStream(resourcePath) ?: return null
            val bytes = stream.use { it.readBytes() }

            val stableDir = File(System.getProperty("java.io.tmpdir"), STABLE_DIR)

            // Wipe the previous directory so a stale binary is never reused
            logger.info("ResourceExtractor: deleting stable directory $stableDir")
            val deleted = if (stableDir.exists()) {
                stableDir.deleteRecursively()
            } else {
                true
            }
            logger.info("ResourceExtractor: delete result for $stableDir = $deleted")
            stableDir.mkdirs()

            val dest = File(stableDir, targetName)
            logger.info("ResourceExtractor: writing bundled binary to ${dest.absolutePath}")
            runCatching {
                dest.writeBytes(bytes)
            }.onSuccess {
                logger.info("ResourceExtractor: successfully wrote binary to ${dest.absolutePath}")
            }.onFailure {
                logger.warn("ResourceExtractor: failed writing binary to ${dest.absolutePath}", it)
                throw it
            }
            dest.setExecutable(true)

            // Best-effort cleanup of stale random temp dirs from previous versions
            cleanupStaleTempDirs()

            cached = dest.absolutePath
            logger.info("ResourceExtractor: extraction complete, cached path ${cached}")
            return cached
        }
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
