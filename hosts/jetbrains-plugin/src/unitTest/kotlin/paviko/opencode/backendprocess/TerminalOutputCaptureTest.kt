package paviko.opencode.backendprocess

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class TerminalOutputCaptureTest {
    @Test
    fun `cleanCapturedLine strips terminal control sequences from backend json`() {
        val raw = "\u001B]0;opencode\u0007\u001B[32m{\"port\":4096,\"url\":\"http://127.0.0.1\"}\u001B[0m"

        assertEquals("{\"port\":4096,\"url\":\"http://127.0.0.1\"}", cleanCapturedLine(raw))
    }

    @Test
    fun `cleanCapturedLine ignores prompts and echoed opencode serve command`() {
        assertNull(cleanCapturedLine("PS D:\\repo>"))
        assertNull(cleanCapturedLine("opencode serve --port 4096"))
    }
}
