package paviko.opencode

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import javax.xml.parsers.DocumentBuilderFactory

class PluginIdentityTest {
    @Test
    fun `JetBrains plugin id matches the VSCode unique identifier`() {
        assertEquals("caiqy.opencode-ui", JETBRAINS_PLUGIN_ID)
    }

    @Test
    fun `plugin xml uses the shared JetBrains plugin id`() {
        val stream = checkNotNull(javaClass.getResourceAsStream("/META-INF/plugin.xml")) {
            "plugin.xml resource missing"
        }
        val document = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(stream)
        val pluginId = document.getElementsByTagName("id").item(0).textContent.trim()

        assertEquals(JETBRAINS_PLUGIN_ID, pluginId)
    }
}
