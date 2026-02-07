package paviko.opencode.util

import com.intellij.openapi.application.ApplicationManager
import java.io.File
import java.io.InputStream

object ResourceExtractor {
    /**
     * Extracts a resource to a temporary file. 
     * IMPORTANT: This method performs heavy I/O (file copy) and must NOT be called from EDT.
     */
    fun extractToTemp(resourcePath: String, targetName: String): String? {
        require(!ApplicationManager.getApplication().isDispatchThread) {
            "extractToTemp must not be called from EDT - it performs heavy file I/O operations"
        }
        val stream: InputStream = javaClass.classLoader.getResourceAsStream(resourcePath) ?: return null
        // Create a unique temporary directory and place the file with its original name inside it.
        // This preserves the executable extension (e.g., .exe on Windows) at the end of the filename.
        val tempDir = java.nio.file.Files.createTempDirectory("opencode-").toFile()
        tempDir.deleteOnExit()
        val tmp = File(tempDir, targetName)
        stream.use { input -> tmp.outputStream().use { input.copyTo(it) } }
        tmp.setExecutable(true)
        tmp.deleteOnExit()
        return tmp.absolutePath
    }
}
