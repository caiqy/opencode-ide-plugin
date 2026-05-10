package paviko.opencode.ui

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ChatToolWindowFactoryCacheTest {
    @Test
    fun `webgui cache key changes url even when plugin version is unchanged`() {
        val first = webGuiUrlWithCacheBuster("http://127.0.0.1:4096/app", "26.5.1000", "build-a")
        val second = webGuiUrlWithCacheBuster("http://127.0.0.1:4096/app", "26.5.1000", "build-b")

        assertNotEquals(first, second)
        assertEquals("http://127.0.0.1:4096/app?v=26.5.1000&cache=build-a", first)
        assertEquals("http://127.0.0.1:4096/app?v=26.5.1000&cache=build-b", second)
    }

    @Test
    fun `webgui cache key preserves existing query parameters`() {
        val url = webGuiUrlWithCacheBuster("http://127.0.0.1:4096/app?foo=bar", "26.5.1000", "build-a")

        assertTrue(url.startsWith("http://127.0.0.1:4096/app?foo=bar&"))
        assertTrue(url.contains("v=26.5.1000"))
        assertTrue(url.contains("cache=build-a"))
    }
}
