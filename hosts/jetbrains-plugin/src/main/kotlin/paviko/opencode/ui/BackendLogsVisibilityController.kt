package paviko.opencode.ui

import java.awt.BorderLayout
import javax.swing.JComponent
import javax.swing.JPanel

internal class BackendLogsVisibilityController(
    private val mainPanel: JPanel,
    private val logsPanel: JComponent,
) {
    private var revealed = false

    fun reveal() {
        if (logsPanel.parent !== mainPanel) {
            mainPanel.add(logsPanel, BorderLayout.SOUTH)
            mainPanel.revalidate()
            mainPanel.repaint()
        }

        revealed = true
    }

    fun wasRevealed(): Boolean = revealed
}
