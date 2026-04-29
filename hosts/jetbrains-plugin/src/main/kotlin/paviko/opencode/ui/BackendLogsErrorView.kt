package paviko.opencode.ui

import java.awt.BorderLayout
import javax.swing.JLabel
import javax.swing.JPanel

internal object BackendLogsErrorView {
    fun show(mainPanel: JPanel, logsVisibility: BackendLogsVisibilityController, message: String) {
        mainPanel.removeAll()
        mainPanel.add(JPanel(BorderLayout()).apply {
            add(JLabel("<html><center>$message</center></html>"), BorderLayout.CENTER)
        }, BorderLayout.CENTER)
        logsVisibility.reveal()
        mainPanel.revalidate()
        mainPanel.repaint()
    }
}
