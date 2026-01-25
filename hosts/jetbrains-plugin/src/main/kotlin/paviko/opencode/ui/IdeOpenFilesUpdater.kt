package paviko.opencode.ui

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.util.concurrency.AppExecutorUtil
import org.cef.browser.CefBrowser
import org.cef.handler.CefLifeSpanHandlerAdapter
import java.nio.file.Paths
import java.util.concurrent.ScheduledFuture

class IdeOpenFilesUpdater(private val project: Project, private val browser: JBCefBrowser) : Disposable {
    private val mapper = jacksonObjectMapper()
    private var scheduled: ScheduledFuture<*>? = null

    fun install() {
        // Observe tab/file changes and push to webview
        val bus = project.messageBus.connect(this)
        val fem = com.intellij.openapi.fileEditor.FileEditorManager.getInstance(project)

        fun push() {
            try {
                val opened = fem.openFiles.mapNotNull { vf -> vfPath(vf) }
                val current = fem.selectedEditor?.file?.let { vf -> vfPath(vf) }
                IdeBridge.send(project, "updateOpenedFiles", mapOf("openedFiles" to opened, "currentFile" to current))
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }

        fun pushSafe() {
            val app = ApplicationManager.getApplication()
            if (app.isDispatchThread) {
                push()
                return
            }
            app.invokeLater { push() }
        }

        // Initial push when page loads
        browser.jbCefClient.addLifeSpanHandler(object : CefLifeSpanHandlerAdapter() {
            override fun onAfterCreated(browser: CefBrowser?) {
                pushSafe()
            }
        }, browser.cefBrowser)

        // Listen to tab changes
        bus.subscribe(
            com.intellij.openapi.fileEditor.FileEditorManagerListener.FILE_EDITOR_MANAGER,
            object : com.intellij.openapi.fileEditor.FileEditorManagerListener {
                override fun selectionChanged(event: com.intellij.openapi.fileEditor.FileEditorManagerEvent) {
                    pushSafe()
                }

                override fun fileOpened(source: com.intellij.openapi.fileEditor.FileEditorManager, file: VirtualFile) {
                    pushSafe()
                }

                override fun fileClosed(source: com.intellij.openapi.fileEditor.FileEditorManager, file: VirtualFile) {
                    pushSafe()
                }
            })

        // Also push periodically as a fallback
        scheduled = AppExecutorUtil.getAppScheduledExecutorService()
            .scheduleWithFixedDelay({ pushSafe() }, 2, 5, java.util.concurrent.TimeUnit.SECONDS)
    }

    private fun vfPath(vf: VirtualFile?): String? {
        if (vf == null) return null
        val projBase = project.basePath ?: return try {
            vf.toNioPath().toAbsolutePath().normalize().toString()
        } catch (_: Throwable) {
            vf.path
        }
        return try {
            val filePath = vf.toNioPath().toAbsolutePath().normalize()
            val base = Paths.get(projBase).toAbsolutePath().normalize()
            val rel = if (filePath.startsWith(base)) base.relativize(filePath) else filePath
            val s = rel.toString()
            if (s.isEmpty()) vf.name else s
        } catch (_: Throwable) {
            val abs = try {
                vf.toNioPath().toAbsolutePath().normalize().toString()
            } catch (_: Throwable) {
                vf.path
            }
            try {
                val base = java.io.File(projBase).absoluteFile.normalize().path
                val rel = if (abs.startsWith(base + java.io.File.separator)) abs.substring(base.length + 1) else abs
                if (rel.isEmpty()) vf.name else rel
            } catch (_: Throwable) {
                abs
            }
        }
    }

    override fun dispose() {
        try { scheduled?.cancel(false) } catch (_: Throwable) {}
        scheduled = null
    }
}
