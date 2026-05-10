package paviko.opencode.ui

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.awt.BorderLayout
import javax.swing.JLabel
import javax.swing.JPanel

class BackendLogsVisibilityControllerTest {
    @Test
    fun `初始状态不挂载日志面板`() {
        val mainPanel = JPanel(BorderLayout())
        val logsPanel = JPanel()

        val controller = BackendLogsVisibilityController(mainPanel, logsPanel)

        assertFalse(controller.wasRevealed())
        assertEquals(0, mainPanel.componentCount)
        assertEquals(null, logsPanel.parent)
    }

    @Test
    fun `首次 reveal 时把日志面板挂到底部且只挂一次`() {
        val mainPanel = JPanel(BorderLayout())
        val logsPanel = JPanel()

        val controller = BackendLogsVisibilityController(mainPanel, logsPanel)

        controller.reveal()
        controller.reveal()

        assertTrue(controller.wasRevealed())
        assertEquals(1, mainPanel.componentCount)
        assertSame(mainPanel, logsPanel.parent)
    }

    @Test
    fun `error 布局 removeAll 后再次 reveal 会重新挂载日志面板`() {
        val mainPanel = JPanel(BorderLayout())
        val logsPanel = JPanel()
        val controller = BackendLogsVisibilityController(mainPanel, logsPanel)

        controller.reveal()
        mainPanel.removeAll()
        mainPanel.add(JLabel("Backend connection timeout"), BorderLayout.CENTER)

        controller.reveal()

        assertTrue(controller.wasRevealed())
        assertEquals(2, mainPanel.componentCount)
        assertSame(mainPanel, logsPanel.parent)
    }

    @Test
    fun `普通 Swing 日志面板在错误页场景下会 reveal 到底部`() {
        val mainPanel = JPanel(BorderLayout()).apply {
            add(JLabel("Starting backend..."), BorderLayout.CENTER)
        }
        val middlePanel = JPanel()
        val logsPanel = JPanel(BorderLayout()).apply {
            add(JLabel("Backend logs (merged stdout/stderr)"), BorderLayout.NORTH)
            add(middlePanel, BorderLayout.CENTER)
        }
        val controller = BackendLogsVisibilityController(mainPanel, logsPanel)

        mainPanel.removeAll()
        mainPanel.add(JLabel("Backend connection timeout"), BorderLayout.CENTER)
        controller.reveal()

        val layout = mainPanel.layout as BorderLayout

        assertTrue(controller.wasRevealed())
        assertEquals(2, mainPanel.componentCount)
        assertSame(mainPanel, logsPanel.parent)
        assertSame(logsPanel, layout.getLayoutComponent(BorderLayout.SOUTH))
        assertTrue(logsPanel.getComponent(0) is JLabel)
        assertSame(middlePanel, logsPanel.getComponent(1))
    }
}
