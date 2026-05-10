package paviko.opencode.backendprocess

import com.intellij.openapi.project.Project
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.mockito.kotlin.mock
import java.io.ByteArrayInputStream
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

class TerminalBackendProcessTest {
    @Test
    fun `launcher failure closes input stream and marks process failed`() {
        val process = TerminalBackendProcess(
            project = mock<Project>(),
            args = emptyList(),
            baseDir = ".",
            customCommand = "",
            launchBackend = { _, _, _, _, _, _, callback ->
                callback(null, IllegalStateException("boom"))
            },
        )

        assertEquals(-1, readWithoutBlocking(process, 500))
        assertEquals(-1, process.waitFor())
        assertFalse(process.isAlive())
    }

    @Test
    fun `destroy before ready marks process cancelled and destroys late backend`() {
        val callbackRef = AtomicReference<(BackendProcess?, Exception?) -> Unit>()
        val process = TerminalBackendProcess(
            project = mock<Project>(),
            args = emptyList(),
            baseDir = ".",
            customCommand = "",
            launchBackend = { _, _, _, _, _, _, callback ->
                callbackRef.set(callback)
            },
        )
        val lateProcess = FakeBackendProcess()

        process.destroy()

        assertFalse(process.isAlive())
        assertEquals(-1, process.waitFor())
        assertEquals(-1, readWithoutBlocking(process, 500))

        checkNotNull(callbackRef.get()).invoke(lateProcess, null)

        assertTrue(lateProcess.destroyCalled.get())
        assertFalse(process.isAlive())
    }

    @Test
    fun `destroy before ready exposes cancellation to launcher`() {
        val cancellationRef = AtomicReference<() -> Boolean>()
        val process = TerminalBackendProcess(
            project = mock<Project>(),
            args = emptyList(),
            baseDir = ".",
            customCommand = "",
            launchBackend = { _, _, _, _, _, isCancelled, _ ->
                cancellationRef.set(isCancelled)
            },
        )

        val isCancelled = checkNotNull(cancellationRef.get())
        assertFalse(isCancelled())

        process.destroy()

        assertTrue(isCancelled())
        assertEquals(-1, process.waitFor())
    }

    private fun readWithoutBlocking(process: TerminalBackendProcess, timeoutMillis: Long): Int {
        val executor = Executors.newSingleThreadExecutor()
        return try {
            val future = executor.submit<Int> { process.inputStream.read() }
            try {
                future.get(timeoutMillis, TimeUnit.MILLISECONDS)
            } catch (e: TimeoutException) {
                process.inputStream.close()
                future.cancel(true)
                throw AssertionError("inputStream.read() blocked past ${timeoutMillis}ms", e)
            }
        } finally {
            executor.shutdownNow()
        }
    }

    private class FakeBackendProcess : BackendProcess {
        val destroyCalled = AtomicBoolean(false)

        override val inputStream = ByteArrayInputStream(byteArrayOf())

        override fun waitFor() = 0

        override fun destroy() {
            destroyCalled.set(true)
        }

        override fun isAlive() = !destroyCalled.get()

        override fun stopCapture() = Unit
    }
}
