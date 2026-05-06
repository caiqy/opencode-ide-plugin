package paviko.opencode

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.nio.file.Files
import java.nio.file.Path
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

    @Test
    fun `source metadata uses Caiqy vendor and Gradle group`() {
        val pluginXml = Files.readString(Path.of("src", "main", "resources", "META-INF", "plugin.xml"))
        val buildGradle = Files.readString(Path.of("build.gradle.kts"))

        assertTrue(pluginXml.contains("<vendor>Caiqy</vendor>"))
        assertTrue(buildGradle.contains("group = \"Caiqy.opencode\""))
    }
}
