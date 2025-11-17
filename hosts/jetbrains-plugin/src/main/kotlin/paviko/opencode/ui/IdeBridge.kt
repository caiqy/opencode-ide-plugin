package paviko.opencode.ui

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.editor.LogicalPosition
import com.intellij.openapi.editor.ScrollType
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.OpenFileDescriptor
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefJSQuery
import javax.swing.SwingUtilities

object IdeBridge {
    private val logger = Logger.getInstance(IdeBridge::class.java)
    private val mapper = jacksonObjectMapper()
    @Volatile private var browser: JBCefBrowser? = null
    @Volatile private var query: JBCefJSQuery? = null
    @Volatile private var ready = false
    private val outbox: MutableList<Map<String, Any?>> = mutableListOf()

    fun install(browser: JBCefBrowser, project: Project) {
        this.browser = browser
        val q = try { JBCefJSQuery.create(browser) } catch (_: Throwable) { null }
        query = q
        if (q != null) {
            try {
                q.addHandler { payload ->
                    try {
                        handleInbound(payload ?: "{}", project)
                    } catch (t: Throwable) {
                        logger.warn("ideBridge inbound error", t)
                    }
                    null
                }
            } catch (_: Throwable) {}
        }
        try {
            val sendInvoke = try { q?.inject("String(json)") } catch (_: Throwable) { null } ?: "void 0"
            val js = (
                "(function(){" +
                "if(!window.ideBridge){" +
                "  var q=[];" +
                "  window.ideBridge={ready:false,send:function(m){try{var s=(typeof m==='string')?m:JSON.stringify(m); if(typeof window.__ideBridgeSend==='function'){window.__ideBridgeSend(s);} else {q.push(s);}}catch(e){}},request:function(m){return new Promise(function(res,rej){try{var id=String(Date.now())+Math.random().toString(36).slice(2); m.id=id; var r=function(msg){try{if(msg && msg.replyTo===id){window.removeEventListener('message',rWrap); res(msg);} }catch(e){} }; var rWrap=function(ev){try{ r(ev.data||ev); }catch(e){} }; window.addEventListener('message', rWrap); window.ideBridge.send(m);}catch(e){rej(e)}});},onMessage:function(h){window.__ideBridgeOnMessage=h}};" +
                "  window.__ideBridgeSend=function(json){$sendInvoke};" +
                "  window.__ideBridgeDeliver=function(s){try{var m=(typeof s==='string')?JSON.parse(s):s; if(typeof window.__ideBridgeOnMessage==='function'){window.__ideBridgeOnMessage(m);} else {window.postMessage(m,'*');}}catch(e){}};" +
                "  window.ideBridge._flush=function(){try{window.ideBridge.ready=true; var a=q.splice(0,q.length); for(var i=0;i<a.length;i++){try{window.__ideBridgeSend(a[i])}catch(e){}}}catch(e){}};" +
                "}" +
                "})();"
            )
            browser.cefBrowser.executeJavaScript(js, browser.cefBrowser.url, 0)
            SwingUtilities.invokeLater { flushOutbox() }
        } catch (t: Throwable) {
            logger.warn("Failed to inject ideBridge", t)
        }
    }

    private fun handleInbound(json: String, project: Project) {
        val obj = try { mapper.readTree(json) } catch (_: Throwable) { null } ?: return
        val id = obj.get("id")?.asText()
        val type = obj.get("type")?.asText() ?: return
        when (type) {
            "openFile" -> {
                val payload = obj.get("payload")
                val rawPath = payload?.get("path")?.asText() ?: return replyError(id, "missing path")
                val lineFromPayload1Based = payload.get("line")?.asInt() ?: -1
                val rangeRegex = Regex(":(\\d+)(?:-(\\d+))?$")
                val match = rangeRegex.find(rawPath)
                val startFromPath1Based = try {
                    match?.groupValues?.getOrNull(1)?.toInt()
                } catch (_: Throwable) { null }
                val endFromPath1Based = try {
                    match?.groupValues?.getOrNull(2)?.toInt()
                } catch (_: Throwable) { null }
                val cleanedPath = rawPath.replace(rangeRegex, "")

                val startLine1Based = if (lineFromPayload1Based > 0) lineFromPayload1Based else startFromPath1Based ?: -1
                val endLine1Based = endFromPath1Based ?: -1

                val startLine0Based = if (startLine1Based > 0) startLine1Based - 1 else -1
                val endLine0Based = if (endLine1Based > 0) endLine1Based - 1 else -1

                openFile(project, cleanedPath, startLine0Based, endLine0Based)
                replyOk(id)
            }
            else -> replyOk(id)
        }
    }

    private fun openFile(project: Project, rawPath: String, startLine: Int, endLine: Int) {
        try {
            val lfs = LocalFileSystem.getInstance()
            val vf = lfs.findFileByPath(rawPath) ?: lfs.refreshAndFindFileByPath(rawPath)
            if (vf != null) {
                ApplicationManager.getApplication().invokeLater {
                    val fm = FileEditorManager.getInstance(project)
                    if (startLine >= 0) {
                        try {
                            val desc = OpenFileDescriptor(project, vf, startLine, 0)
                            try { desc.isUseCurrentWindow = true } catch (_: Throwable) {}
                            val ed = try { fm.openTextEditor(desc, true) } catch (_: Throwable) { null }
                            if (ed == null) fm.openFile(vf, true) else try {
                                val doc = ed.document
                                val lineCount = doc.lineCount
                                val clampedStart = startLine.coerceIn(0, (lineCount - 1).coerceAtLeast(0))
                                val targetEnd = if (endLine >= 0) endLine else startLine
                                val clampedEnd = targetEnd.coerceIn(clampedStart, (lineCount - 1).coerceAtLeast(0))

                                val pos = LogicalPosition(clampedStart.coerceAtLeast(0), 0)
                                ed.caretModel.moveToLogicalPosition(pos)

                                if (clampedEnd > clampedStart) {
                                    val startOffset = doc.getLineStartOffset(clampedStart)
                                    val endOffset = doc.getLineEndOffset(clampedEnd)
                                    ed.selectionModel.setSelection(startOffset, endOffset)
                                } else {
                                    ed.selectionModel.removeSelection()
                                }

                                ed.scrollingModel.scrollToCaret(ScrollType.CENTER)
                            } catch (_: Throwable) {}
                        } catch (_: Throwable) {
                            fm.openFile(vf, true)
                        }
                    } else {
                        fm.openFile(vf, true)
                    }
                }
            }
        } catch (t: Throwable) {
            logger.warn("openFile failed", t)
        }
    }

    private fun replyOk(replyTo: String?) { sendRaw(mapOf("replyTo" to replyTo, "ok" to true)) }
    private fun replyError(replyTo: String?, error: String) { sendRaw(mapOf("replyTo" to replyTo, "ok" to false, "error" to error)) }

    fun send(type: String, payload: Map<String, Any?> = emptyMap()) {
        val message = mutableMapOf<String, Any?>("type" to type, "timestamp" to System.currentTimeMillis())
        if (payload.isNotEmpty()) message["payload"] = payload
        sendRaw(message)
    }

    private fun sendRaw(message: Map<String, Any?>) {
        val b = browser
        if (b == null) {
            outbox.add(message)
            return
        }
        val json = try { mapper.writeValueAsString(message) } catch (_: Throwable) { return }
        val script = "(function(){ try { if(window.__ideBridgeDeliver){ window.__ideBridgeDeliver(" + mapper.writeValueAsString(json) + "); } else { window.postMessage(" + json + ", '*'); } } catch(e){} })();"
        try {
            b.cefBrowser.executeJavaScript(script, b.cefBrowser.url, 0)
            ready = true
        } catch (t: Throwable) {
            outbox.add(message)
        }
    }

    private fun flushOutbox() {
        if (ready) {
            val pending = ArrayList(outbox)
            outbox.clear()
            for (m in pending) sendRaw(m)
        }
    }
}
