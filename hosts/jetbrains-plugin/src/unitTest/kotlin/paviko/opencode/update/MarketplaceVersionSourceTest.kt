package paviko.opencode.update

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class MarketplaceVersionSourceTest {
    @Test
    fun `parse update detail extracts version and release url`() {
        val json = """
            {"id":1041170,"version":"26.5.700","link":"/plugin/31609-opencode-ui-unofficial-/versions/stable/1041170"}
        """.trimIndent()

        val release = parseMarketplaceUpdate(json)

        assertEquals("26.5.700", release?.version)
        assertEquals("https://plugins.jetbrains.com/plugin/31609-opencode-ui-unofficial-/versions/stable/1041170", release?.releaseUrl)
    }

    @Test
    fun `parse empty update list returns null`() {
        assertNull(parseMarketplaceUpdateList("[]"))
    }

    @Test
    fun `parse invalid update detail returns null`() {
        assertNull(parseMarketplaceUpdate("{"))
    }

    @Test
    fun `parse invalid update list returns null`() {
        assertNull(parseMarketplaceUpdateList("{"))
    }

    @Test
    fun `parse update detail with missing version returns null`() {
        assertNull(parseMarketplaceUpdate("""{"link":"/plugin/31609-opencode-ui-unofficial-/versions/stable/1041170"}"""))
    }

    @Test
    fun `parse update detail with empty version returns null`() {
        assertNull(parseMarketplaceUpdate("""{"version":"","link":"/plugin/31609-opencode-ui-unofficial-/versions/stable/1041170"}"""))
    }

    @Test
    fun `parse update detail with blank version returns null`() {
        assertNull(parseMarketplaceUpdate("""{"version":"   ","link":"/plugin/31609-opencode-ui-unofficial-/versions/stable/1041170"}"""))
    }

    @Test
    fun `parse update detail keeps absolute release url`() {
        val release = parseMarketplaceUpdate("""{"version":"26.5.700","link":"https://example.com/releases/26.5.700"}""")

        assertEquals("26.5.700", release?.version)
        assertEquals("https://example.com/releases/26.5.700", release?.releaseUrl)
    }

    @Test
    fun `parse update detail without link falls back to plugin page`() {
        val release = parseMarketplaceUpdate("""{"version":"26.5.700"}""")

        assertEquals("26.5.700", release?.version)
        assertEquals(marketplacePluginPage(), release?.releaseUrl)
    }

    @Test
    fun `parse update detail rejects non object response`() {
        assertNull(parseMarketplaceUpdate("[]"))
    }

    @Test
    fun `parse update list rejects non array response`() {
        assertNull(parseMarketplaceUpdateList("{}"))
    }

    @Test
    fun `parse update list selects first version`() {
        val json = """
            [
                {"version":"26.5.701","link":"/plugin/31609-opencode-ui-unofficial-/versions/stable/1041171"},
                {"version":"26.5.702","link":"/plugin/31609-opencode-ui-unofficial-/versions/stable/1041172"}
            ]
        """.trimIndent()

        val release = parseMarketplaceUpdateList(json)

        assertEquals("26.5.701", release?.version)
        assertEquals("https://plugins.jetbrains.com/plugin/31609-opencode-ui-unofficial-/versions/stable/1041171", release?.releaseUrl)
    }
}
