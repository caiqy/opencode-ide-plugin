package paviko.opencode.backendprocess

import com.intellij.openapi.diagnostic.Logger
import org.jetbrains.plugins.terminal.ShellTerminalWidget
import java.io.PipedOutputStream
import java.nio.charset.StandardCharsets

/**
 * Captures output from a terminal widget and provides it as an InputStream
 */
internal class TerminalOutputCapture(private val outputBuffer: PipedOutputStream) {
    private val logger = Logger.getInstance(TerminalOutputCapture::class.java)
    private var captureThread: Thread? = null
    private var isCapturing = false
    private val processedLines = LinkedHashSet<String>()
    private val processedLimit = 5000

    private val ansiRegex = Regex("\\x1B\\[[0-9;]*[mGKHF]")
    private val titleRegex = Regex("\\x1B\\]0;[^\\x07]*\\x07")
    private val controlRegex = Regex("[\\x00-\\x1F\\x7F]")
    private val maxScan = 250

    fun startCapturing(terminalWidget: ShellTerminalWidget) {
        isCapturing = true
        logger.info("Starting terminal output capture...")

        captureThread = Thread {
            try {
                // Get terminal text buffer with error handling for different IntelliJ versions
                val terminalTextBuffer = try {
                    terminalWidget.terminalTextBuffer
                } catch (e: Exception) {
                    logger.warn("Failed to access terminal text buffer: ${e.message}")
                    return@Thread
                }

                var lastNonEmptyLineIndex = -1
                
                while (isCapturing && !Thread.currentThread().isInterrupted) {
                    try {
                        val captured = ArrayList<String>(maxScan)

                        terminalTextBuffer.lock()
                        try {
                            val currentHeight = terminalTextBuffer.height

                            val tailStart = (currentHeight - maxScan).coerceAtLeast(0)
                            val startIndex = maxOf(tailStart, maxOf(0, lastNonEmptyLineIndex))

                            var lineIndex = startIndex
                            while (lineIndex < currentHeight) {
                                try {
                                    val line = terminalTextBuffer.getLine(lineIndex)
                                    var rawText = line.getText().trim()

                                    var currentIndex = lineIndex
                                    while (currentIndex < currentHeight - 1 && terminalTextBuffer.getLine(currentIndex).isWrapped) {
                                        currentIndex++
                                        val nextLine = terminalTextBuffer.getLine(currentIndex)
                                        rawText += nextLine.getText().trim()
                                    }

                                    if (rawText.isNotEmpty()) {
                                        if (currentIndex > lastNonEmptyLineIndex) lastNonEmptyLineIndex = currentIndex
                                        captured.add(rawText)
                                    }

                                    lineIndex = currentIndex + 1
                                } catch (e: Exception) {
                                    logger.debug("Error reading line $lineIndex: ${e.message}")
                                    lineIndex++
                                }
                            }
                        } finally {
                            terminalTextBuffer.unlock()
                        }

                        for (rawText in captured) {
                            val cleanText = rawText
                                .replace(ansiRegex, "")
                                .replace(titleRegex, "")
                                .replace(controlRegex, "")
                                .trim()

                            if (cleanText.isEmpty()) continue
                            if (isShellPromptOrCommand(cleanText)) continue
                            if (processedLines.contains(cleanText)) continue

                            if (processedLines.size >= processedLimit) {
                                val it = processedLines.iterator()
                                if (it.hasNext()) {
                                    it.next()
                                    it.remove()
                                }
                            }
                            processedLines.add(cleanText)

                            logger.info("Terminal output: $cleanText")

                            try {
                                outputBuffer.write("$cleanText\n".toByteArray(StandardCharsets.UTF_8))
                                outputBuffer.flush()
                            } catch (e: Exception) {
                                logger.debug("Error writing to buffer: ${e.message}")
                            }

                            if (cleanText.startsWith("{") &&
                                (cleanText.contains("\"port\"") || cleanText.contains("\"url\"") || cleanText.contains("\"uiBase\""))) {
                                logger.info("*** Found backend connection JSON: $cleanText")
                            }
                        }

                        Thread.sleep(1000) // Check every 1000ms

                    } catch (e: InterruptedException) {
                        break
                    } catch (e: Exception) {
                        logger.debug("Error in capture loop: ${e.message}")
                        Thread.sleep(1000)
                    }
                }

                logger.info("Terminal output capture stopped")
            } catch (e: InterruptedException) {
                logger.info("Terminal output capture interrupted")
            } catch (e: Exception) {
                logger.warn("Terminal output capture failed", e)
            }
        }
        captureThread?.isDaemon = true
        captureThread?.start()
    }

    private fun isShellPromptOrCommand(text: String): Boolean {
        // Skip common shell prompts and command echoes
      return !text.contains("server listening") &&
        (text.matches(Regex(".*[$#%>]\\s*$")) || // Shell prompts
          text.startsWith("cd ") ||
          text.contains("opencode") && text.contains("serve") ||
          text.matches(Regex("^[a-zA-Z0-9_-]+@[a-zA-Z0-9_-]+.*"))) // user@host patterns
    }

    fun stop() {
        isCapturing = false
        captureThread?.interrupt()
        try {
            outputBuffer.close()
        } catch (e: Exception) {
            logger.debug("Error closing output buffer", e)
        }
    }
}
