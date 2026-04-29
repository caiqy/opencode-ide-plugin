package paviko.opencode.ui

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.awt.BorderLayout
import javax.swing.JPanel

class BackendLogsErrorViewTest {
    @Test
    fun `显示错误页时会挂载并保留日志面板`() {
        val mainPanel = JPanel(BorderLayout()).apply {
            add(JPanel(), BorderLayout.CENTER)
        }
        val logsPanel = JPanel()
        val logsVisibility = BackendLogsVisibilityController(mainPanel, logsPanel)

        BackendLogsErrorView.show(mainPanel, logsVisibility, "Backend connection timeout")
        BackendLogsErrorView.show(mainPanel, logsVisibility, "Backend communication error")

        assertTrue(logsVisibility.wasRevealed())
        assertEquals(2, mainPanel.componentCount)
        assertSame(mainPanel, logsPanel.parent)
    }
}
