package paviko.opencode.util

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Test

class ResourceExtractorTest {
    @Test
    fun `stable directory name changes when bundled binary bytes change`() {
        val first = resourceStableDirName("first binary".toByteArray())
        val second = resourceStableDirName("second binary".toByteArray())

        assertNotEquals(first, second)
    }

    @Test
    fun `stable directory name is deterministic for same bundled binary bytes`() {
        val first = resourceStableDirName("same binary".toByteArray())
        val second = resourceStableDirName("same binary".toByteArray())

        assertEquals(first, second)
    }

    @Test
    fun `stable directory name keeps opencode prefix for stale cleanup`() {
        val dir = resourceStableDirName("binary".toByteArray())

        assertEquals(true, dir.startsWith("opencode-bin-"))
    }
}
