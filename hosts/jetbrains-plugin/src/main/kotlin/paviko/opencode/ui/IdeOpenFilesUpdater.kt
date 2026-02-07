package paviko.opencode.ui

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

class IdeOpenFilesUpdater(private val project: Project, private val browser: JBCefBrowser, private val sessionId: String) : Disposable {
    private var scheduled: ScheduledFuture<*>? = null

    fun install() {
        // Observe tab/file changes and push to webview
        val bus = project.messageBus.connect(this)
        val fem = com.intellij.openapi.fileEditor.FileEditorManager.getInstance(project)

        // Perform path computation on background thread to avoid blocking EDT with NIO operations
        fun pushAsync() {
            AppExecutorUtil.getAppExecutorService().execute {
                try {
                    // Snapshot open files on EDT like before.
                    val openFiles = mutableListOf<VirtualFile>()
                    var selectedFile: VirtualFile? = null

                    val latch = java.util.concurrent.CountDownLatch(1)
                    ApplicationManager.getApplication().invokeLater {
                        try {
                            openFiles.addAll(fem.openFiles)
                            selectedFile = fem.selectedEditor?.file
                        } finally {
                            latch.countDown()
                        }
                    }

                    try {
                        latch.await()
                    } catch (_: InterruptedException) {
                        Thread.currentThread().interrupt()
                        return@execute
                    }

                    if (project.isDisposed) return@execute
                    
                    // Compute paths on background thread (NIO operations)
                    val opened = openFiles.mapNotNull { vf -> vfPath(vf) }
                    val current = selectedFile?.let { vf -> vfPath(vf) }
                    
                    // Send result (IdeBridge.send already handles threading)
                    IdeBridge.send(sessionId, "updateOpenedFiles", mapOf("openedFiles" to opened, "currentFile" to current))
                } catch (e: Exception) {
                    e.printStackTrace()
                }
            }
        }

        fun pushSafe() {
            pushAsync()
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
