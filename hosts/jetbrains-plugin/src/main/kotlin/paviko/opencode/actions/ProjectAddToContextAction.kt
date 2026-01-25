package paviko.opencode.actions

import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.ProgressManager
import com.intellij.openapi.progress.Task
import com.intellij.openapi.vfs.VfsUtilCore
import com.intellij.openapi.vfs.VirtualFile
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

        ProgressManager.getInstance().run(object : Task.Backgroundable(project, "OpenCode: Collecting files", true) {
            override fun run(indicator: ProgressIndicator) {
                indicator.isIndeterminate = true
                val paths = ArrayList<String>(1024)
                for (vf in files) {
                    if (indicator.isCanceled) return
                    collectFilePaths(vf, paths, indicator)
                }

                if (paths.isEmpty()) return
                ApplicationManager.getApplication().invokeLater {
                    PathInserter.insertPaths(project, paths)
                }
            }
        })
    }

    private fun asAbsolutePath(vf: VirtualFile): String? {
        return try {
            if (vf.isInLocalFileSystem) VfsUtilCore.virtualToIoFile(vf).absolutePath else vf.path
        } catch (_: Throwable) {
            null
        }
    }

    private fun collectFilePaths(vf: VirtualFile, out: MutableList<String>, indicator: ProgressIndicator?) {
        try {
            if (indicator?.isCanceled == true) return
            if (vf.isDirectory) {
                val children = vf.children
                if (children != null) {
                    for (child in children) {
                        if (indicator?.isCanceled == true) return
                        collectFilePaths(child, out, indicator)
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
