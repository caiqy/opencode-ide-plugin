package paviko.opencode.backendprocess

import com.intellij.terminal.ui.TerminalWidget
import com.intellij.ui.content.Content
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.mockito.kotlin.mock
import java.util.ArrayDeque
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

class BackendLauncherTest {
    @Test
    fun `terminal widget resolver retries until widget is ready`() {
        val content = mock<Content>()
        val widget = mock<TerminalWidget>()
        val attempts = AtomicInteger(0)
        val scheduled = ArrayDeque<() -> Unit>()
        val result = AtomicReference<TerminalWidget?>()
        val error = AtomicReference<Exception?>()

        BackendLauncher.waitForTerminalWidget(
            content = content,
            terminalName = "Opencode Backend",
            isCancelled = { false },
            findWidget = {
                if (attempts.incrementAndGet() < 3) null else widget
            },
            schedule = { task, _ -> scheduled.add(task) },
            callback = { resolved, exception ->
                result.set(resolved)
                error.set(exception)
            },
        )

        assertNull(result.get())
        assertEquals(1, scheduled.size)

        scheduled.removeFirst().invoke()
        assertNull(result.get())
        assertEquals(1, scheduled.size)

        scheduled.removeFirst().invoke()

        assertSame(widget, result.get())
        assertNull(error.get())
        assertEquals(3, attempts.get())
    }

    @Test
    fun `terminal widget resolver stops when launch is cancelled`() {
        val content = mock<Content>()
        val scheduled = ArrayDeque<() -> Unit>()
        val cancelled = AtomicReference(false)
        val error = AtomicReference<Exception?>()

        BackendLauncher.waitForTerminalWidget(
            content = content,
            terminalName = "Opencode Backend",
            isCancelled = { cancelled.get() },
            findWidget = { null },
            schedule = { task, _ -> scheduled.add(task) },
            callback = { _, exception -> error.set(exception) },
        )

        cancelled.set(true)
        scheduled.removeFirst().invoke()

        assertTrue(error.get()?.message?.contains("cancelled") == true)
    }

    @Test
    fun `terminal startup uses builder shell command instead of typed send`() {
        val args = listOf("C:/opencode/opencode.exe", "serve")

        val startup = BackendLauncher.terminalStartup(args)

        assertEquals(args, startup.shellCommand)
        assertFalse(startup.requiresTypedSend)
        assertFalse(startup.reuseExistingTab)
    }

    @Test
    fun `backend command appends explicit IDE host and port after custom args`() {
        val command = BackendLauncher.backendCommand(
            bin = "C:/opencode/opencode.exe",
            customCommand = "--log-level debug --port 9999",
            port = 41017,
        )

        assertEquals(
            listOf(
                "C:/opencode/opencode.exe",
                "serve",
                "--log-level",
                "debug",
                "--port",
                "9999",
                "--hostname",
                "127.0.0.1",
                "--port",
                "41017",
            ),
            command.args,
        )
        assertEquals("http://127.0.0.1:41017", command.baseUrl)
        assertEquals("http://127.0.0.1:41017/app", command.appUrl)
    }
}
