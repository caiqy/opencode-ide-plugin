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

class ProjectAddToContextAction : AnAction("OpenCode: Add to context") {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT
    override fun update(e: AnActionEvent) {
        val files = e.getData(CommonDataKeys.VIRTUAL_FILE_ARRAY)
        e.presentation.isEnabledAndVisible = files != null && files.isNotEmpty()
    }

    override fun actionPerformed(e: AnActionEvent) {
        val files = e.getData(CommonDataKeys.VIRTUAL_FILE_ARRAY) ?: return
        val project = e.project ?: return

        ReadAction.nonBlocking<List<String>> {
            val paths = ArrayList<String>(1024)
            for (vf in files) {
                collectFilePaths(vf, paths)
            }
            paths
        }
            .expireWith(project)
            .finishOnUiThread(ModalityState.any()) { paths ->
                if (paths.isNotEmpty()) PathInserter.insertPaths(project, paths)
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

    private fun collectFilePaths(vf: VirtualFile, out: MutableList<String>) {
        try {
            if (vf.isDirectory) {
                val children = vf.children
                if (children != null) {
                    for (child in children) {
                        collectFilePaths(child, out)
                    }
                }
            } else {
                val p = asAbsolutePath(vf)
                if (!p.isNullOrEmpty()) out.add(p)
            }
        } catch (_: Throwable) {
            // ignore broken VFS entries
        }
    }
}
