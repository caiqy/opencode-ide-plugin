package paviko.opencode.actions

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.vfs.VfsUtilCore
import paviko.opencode.ui.PathInserter

class EditorAddLinesToContextAction : AnAction("OpenCode: Add lines to context") {
    override fun update(e: AnActionEvent) {
        val editor: Editor? = e.getData(CommonDataKeys.EDITOR)
        val hasSelection = editor?.selectionModel?.hasSelection() == true
        e.presentation.isEnabledAndVisible = hasSelection
    }

    override fun actionPerformed(e: AnActionEvent) {
        val editor = e.getData(CommonDataKeys.EDITOR) ?: return
        val file = e.getData(CommonDataKeys.VIRTUAL_FILE) ?: return

        val sel = editor.selectionModel
        if (!sel.hasSelection()) return

        val doc = editor.document
        val startOffset = sel.selectionStart
        val endOffset = sel.selectionEnd - 1
        val startLine = doc.getLineNumber(startOffset) + 1 // 1-based
        val endLine = doc.getLineNumber(endOffset) + 1 // 1-based, inclusive

        val basePath = try {
            if (file.isInLocalFileSystem) VfsUtilCore.virtualToIoFile(file).absolutePath else file.path
        } catch (_: Throwable) { null } ?: return

        val pathWithRange = "$basePath:$startLine-$endLine"
        val project = e.project ?: return
        PathInserter.insertPaths(project, listOf(pathWithRange))
    }
}
