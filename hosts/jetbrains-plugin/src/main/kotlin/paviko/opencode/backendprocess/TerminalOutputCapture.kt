package paviko.opencode.backendprocess

import com.intellij.openapi.diagnostic.Logger
import com.intellij.terminal.frontend.view.TerminalView
import org.jetbrains.plugins.terminal.view.TerminalLineIndex
import org.jetbrains.plugins.terminal.view.TerminalOutputModelSnapshot
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

    fun startCapturing(terminalView: TerminalView) {
        isCapturing = true
        logger.info("Starting terminal output capture...")

        captureThread = Thread {
            try {
                var lastProcessedLine = -1L
                
                while (isCapturing && !Thread.currentThread().isInterrupted) {
                    try {
                        val snapshot = terminalView.outputModels.active.value.takeSnapshot()
                        val lines = readNewLines(snapshot, lastProcessedLine)
                        if (lines.isNotEmpty()) {
                            lastProcessedLine = lines.last().first
                        }

                        for ((_, rawText) in lines) {
                            val cleanText = cleanCapturedLine(rawText) ?: continue

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

    private fun readNewLines(snapshot: TerminalOutputModelSnapshot, lastProcessedLine: Long): List<Pair<Long, String>> {
        val lineCount = snapshot.lineCount
        if (lineCount <= 0) return emptyList()

        val startLine = maxOf((lineCount - maxScan).toLong(), lastProcessedLine + 1, 0)
        val lines = ArrayList<Pair<Long, String>>()
        var index = startLine
        while (index < lineCount.toLong()) {
            try {
                val lineIndex = TerminalLineIndex.of(index)
                val startOffset = snapshot.getStartOfLine(lineIndex)
                val endOffset = snapshot.getEndOfLine(lineIndex, false)
                val text = snapshot.getText(startOffset, endOffset).toString().trim()
                if (text.isNotEmpty()) {
                    lines.add(index to text)
                }
            } catch (e: Exception) {
                logger.debug("Error reading line $index: ${e.message}")
            }
            index++
        }
        return lines
    }
}

internal fun cleanCapturedLine(rawText: String): String? {
    val cleanText = rawText
        .replace(Regex("\\x1B\\[[0-9;]*[mGKHF]"), "")
        .replace(Regex("\\x1B\\]0;[^\\x07]*\\x07"), "")
        .replace(Regex("[\\x00-\\x1F\\x7F]"), "")
        .trim()

    if (cleanText.isEmpty()) return null
    if (!cleanText.contains("server listening") &&
        (cleanText.matches(Regex(".*[$#%>]\\s*$")) ||
            cleanText.startsWith("cd ") ||
            cleanText.contains("opencode") && cleanText.contains("serve") ||
            cleanText.matches(Regex("^[a-zA-Z0-9_-]+@[a-zA-Z0-9_-]+.*")))) {
        return null
    }

    return cleanText
}
