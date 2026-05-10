package paviko.opencode.backendprocess

import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import java.io.InputStream
import java.io.PipedInputStream
import java.io.PipedOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

internal typealias TerminalBackendLauncher = (
    Project,
    List<String>,
    String,
    String,
    PipedOutputStream,
    () -> Boolean,
    (BackendProcess?, Exception?) -> Unit,
) -> Unit

/**
 * Internal async BackendProcess implementation that waits for terminal availability.
 * Returned by `BackendLauncher.launchBackend()` as a `BackendProcess`.
 * It exposes an `inputStream` that provides merged backend logs from the IDE terminal.
 */
internal class TerminalBackendProcess(
    private val project: Project,
    private val args: List<String>,
    private val baseDir: String,
    private val customCommand: String,
    val command: BackendLauncher.BackendCommand? = null,
    private val launchBackend: TerminalBackendLauncher = BackendLauncher::launchBackendWithTerminalCheck,
) : BackendProcess {

    private val logger = Logger.getInstance(TerminalBackendProcess::class.java)
    private val actualProcess = AtomicReference<BackendProcess?>(null)
    private val isReady = AtomicBoolean(false)
    private val isFailed = AtomicBoolean(false)
    private val isCancelled = AtomicBoolean(false)
    private val failureException = AtomicReference<Exception?>(null)
    private val readyLatch = CountDownLatch(1)
    private val outputBuffer = PipedOutputStream()
    private val inputStreamBuffer = PipedInputStream(outputBuffer)

    init {
        // Start the async terminal waiting and backend launch
        launchBackend(
            project,
            args,
            baseDir,
            customCommand,
            outputBuffer,
            { isCancelled.get() },
        ) { process, exception ->
            if (process != null) {
                actualProcess.set(process)
                if (isCancelled.get()) {
                    process.destroy()
                    closePipe()
                    logger.info("TerminalBackendProcess received backend after cancellation; destroyed immediately")
                } else {
                    isReady.set(true)
                    logger.info("TerminalBackendProcess is now ready")
                }
            } else {
                isFailed.set(true)
                failureException.set(exception)
                closePipe()
                logger.warn("TerminalBackendProcess failed to initialize", exception)
            }

            readyLatch.countDown()
        }
        logger.info("TerminalBackendProcess created, waiting for terminal availability...")
    }

    override val inputStream: InputStream
        get() = inputStreamBuffer

    override fun waitFor(): Int {
        try {
            readyLatch.await()
        } catch (e: InterruptedException) {
            Thread.currentThread().interrupt()
            return -1
        }

        if (isFailed.get()) {
            val exception = failureException.get()
            logger.warn("TerminalBackendProcess failed", exception)
            return -1
        }

        if (isCancelled.get()) {
            return -1
        }

        return actualProcess.get()?.waitFor() ?: 0
    }

    override fun destroy() {
        isCancelled.set(true)
        val process = actualProcess.get()
        if (process != null) {
            process.destroy()
            closePipe()
        } else {
            // The launcher checks this cancellation flag and may intentionally stop without invoking
            // its callback. Count down here so waiters do not depend on a post-cancel callback.
            closePipe()
            readyLatch.countDown()
            logger.info("TerminalBackendProcess destroy called before process was ready")
        }
    }

    override fun isAlive(): Boolean {
        if (isCancelled.get()) {
            return false
        }

        val process = actualProcess.get()
        return if (process != null) {
            process.isAlive()
        } else {
            !isFailed.get()
        }
    }

    override fun stopCapture() {
        val process = actualProcess.get()
        process?.stopCapture()
    }

    private fun closePipe() {
        try {
            outputBuffer.close()
        } catch (_: Exception) {
        }
    }
}
