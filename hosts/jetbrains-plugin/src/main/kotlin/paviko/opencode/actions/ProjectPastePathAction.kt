package paviko.opencode.actions

import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.application.ReadAction
import com.intellij.openapi.vfs.VfsUtilCore
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.util.concurrency.AppExecutorUtil
import paviko.opencode.ui.PathInserter

class ProjectPastePathAction : AnAction("OpenCode: paste path") {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT

    override fun update(e: AnActionEvent) {
        val files = e.getData(CommonDataKeys.VIRTUAL_FILE_ARRAY)
        val hasDir = files?.any { it.isDirectory } == true
        e.presentation.isEnabledAndVisible = hasDir
    }

    override fun actionPerformed(e: AnActionEvent) {
        val files = e.getData(CommonDataKeys.VIRTUAL_FILE_ARRAY) ?: return
        val dirs = files.filter { it.isDirectory }
        if (dirs.isEmpty()) return
        val project = e.project ?: return

        // Use ReadAction.nonBlocking to avoid blocking EDT with file I/O operations
        ReadAction.nonBlocking<List<String>> {
            dirs.mapNotNull { vf -> asAbsolutePath(vf) }
        }
            .expireWith(project)
            .finishOnUiThread(ModalityState.any()) { paths ->
                for (p in paths) {
                    PathInserter.pastePath(project, p)
                }
            }
            .submit(AppExecutorUtil.getAppExecutorService())
    }

    private fun asAbsolutePath(vf: VirtualFile): String? {
        return try {
            if (vf.isInLocalFileSystem) VfsUtilCore.virtualToIoFile(vf).absolutePath else vf.path
        } catch (_: Throwable) {
            null
        }
    }
}
