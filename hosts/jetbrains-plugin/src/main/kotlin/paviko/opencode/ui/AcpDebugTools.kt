package paviko.opencode.ui

import com.intellij.debugger.ui.breakpoints.JavaExceptionBreakpointType
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Key
import com.intellij.ui.SimpleTextAttributes
import com.intellij.xdebugger.XDebugSession
import com.intellij.xdebugger.XDebuggerManager
import com.intellij.xdebugger.XDebuggerUtil
import com.intellij.xdebugger.XSourcePosition
import com.intellij.xdebugger.breakpoints.XBreakpoint
import com.intellij.xdebugger.breakpoints.XBreakpointManager
import com.intellij.xdebugger.breakpoints.XBreakpointProperties
import com.intellij.xdebugger.breakpoints.XLineBreakpoint
import com.intellij.xdebugger.breakpoints.XLineBreakpointType
import com.intellij.xdebugger.breakpoints.SuspendPolicy
import com.intellij.xdebugger.evaluation.XDebuggerEvaluator
import com.intellij.xdebugger.frame.XCompositeNode
import com.intellij.xdebugger.frame.XDebuggerTreeNodeHyperlink
import com.intellij.xdebugger.frame.XExecutionStack
import com.intellij.xdebugger.frame.XFullValueEvaluator
import com.intellij.xdebugger.frame.XNamedValue
import com.intellij.xdebugger.frame.XStackFrame
import com.intellij.xdebugger.frame.XValue
import com.intellij.xdebugger.frame.XValueChildrenList
import com.intellij.xdebugger.frame.XValueContainer
import com.intellij.xdebugger.frame.XValueNode
import com.intellij.xdebugger.frame.XValuePlace
import com.intellij.xdebugger.frame.presentation.XValuePresentation
import org.jetbrains.java.debugger.breakpoints.properties.JavaBreakpointProperties
import org.jetbrains.java.debugger.breakpoints.properties.JavaExceptionBreakpointProperties
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import javax.swing.Icon

private const val DEBUG_READ_TIMEOUT_SECONDS = 5L
private const val DEBUG_EVALUATE_TIMEOUT_SECONDS = 10L
private const val MAX_STACK_FRAMES = 200
private val JAVA_QUALIFIED_NAME = Regex("^[A-Za-z_$][A-Za-z0-9_$]*(\\.[A-Za-z_$][A-Za-z0-9_$]*)*$")

/**
 * Java debugger classes ship with the Java plugin, which not every JetBrains IDE bundles.
 * Java-specific breakpoint paths are only executed when this returns true.
 */
private val javaDebuggerSupport: Boolean by lazy {
    runCatching { Class.forName("com.intellij.debugger.ui.breakpoints.JavaExceptionBreakpointType") }.isSuccess
}

internal fun javaDebuggerAvailable(): Boolean = javaDebuggerSupport

private data class FrameCache(val context: Any?, val frames: List<XStackFrame>)

private val frameStore = ConcurrentHashMap<String, FrameCache>()

/** Keeps `XValue` objects (from frames or references) addressable by numeric reference. */
private object ValueRegistry {
    private const val MAX_ENTRIES = 500
    private data class Entry(val context: Any?, val value: XValue)

    private val values = ConcurrentHashMap<String, ConcurrentHashMap<Long, Entry>>()
    private val counters = ConcurrentHashMap<String, AtomicLong>()

    fun store(sessionKey: String, context: Any?, value: XValue): Long {
        val id = counters.getOrPut(sessionKey) { AtomicLong(0) }.incrementAndGet()
        val bucket = values.getOrPut(sessionKey) { ConcurrentHashMap() }
        if (bucket.size >= MAX_ENTRIES) bucket.clear()
        bucket[id] = Entry(context, value)
        return id
    }

    /** Returns null when the reference belongs to an earlier suspend context. */
    fun value(sessionKey: String, context: Any?, id: Long): XValue? =
        values[sessionKey]?.get(id)?.takeIf { it.context === context }?.value

    fun clear(sessionKey: String) {
        values.remove(sessionKey)
        counters.remove(sessionKey)
    }

    /** Drops entries for sessions that no longer exist. */
    fun prune(activeKeys: Set<String>) {
        values.keys.retainAll(activeKeys)
        counters.keys.retainAll(activeKeys)
    }
}

internal fun executeDebugTool(
    project: Project,
    toolId: String,
    parameters: Map<String, Any?>,
): Map<String, Any?> = when (toolId) {
    "getDebugState" -> getDebugState(project)
    "getCallStack" -> getCallStack(project, parameters)
    "getVariables" -> getVariables(project, parameters)
    "listBreakpoints" -> listBreakpoints(project)
    "addLineBreakpoint" -> addLineBreakpoint(project, parameters)
    "addExceptionBreakpoint" -> addExceptionBreakpoint(project, parameters)
    "removeBreakpoint" -> removeBreakpoint(project, parameters)
    "controlExecution" -> controlExecution(project, parameters)
    "evaluateExpression" -> evaluateExpression(project, parameters)
    else -> throw IllegalArgumentException("Unsupported tool in debug category: $toolId")
}

private fun getDebugState(project: Project): Map<String, Any?> {
    val sessions = debugSessions(project)
    if (sessions.isEmpty()) throw IllegalStateException("No active debug session")
    val current = currentSession(project)
    return jsonOutput(
        mapOf(
            "sessions" to sessions.mapIndexed { index, session ->
                mapOf(
                    "sessionId" to index,
                    "name" to session.sessionName,
                    "paused" to session.isSuspended,
                    "position" to session.topFramePosition?.let { describePosition(it) },
                )
            },
            "currentSessionId" to sessions.indexOf(current).takeIf { it >= 0 },
        )
    )
}

private fun getCallStack(project: Project, parameters: Map<String, Any?>): Map<String, Any?> {
    val session = resolveSession(project, parameters)
    if (!session.isSuspended) throw IllegalStateException("Debug session is not paused")

    val frames = collectStackFrames(session)
    if (frames.isEmpty()) throw IllegalStateException("No stack frames available")
    frameStore[session.key()] = FrameCache(session.suspendContext, frames)

    return jsonOutput(
        mapOf(
            "frames" to frames.mapIndexed { index, frame ->
                mapOf(
                    "frameId" to index,
                    "file" to frame.sourcePosition?.file?.path,
                    "line" to frame.sourcePosition?.let { it.line + 1 },
                )
            }
        )
    )
}

private fun getVariables(project: Project, parameters: Map<String, Any?>): Map<String, Any?> {
    val session = resolveSession(project, parameters)
    requireSuspended(session)
    val reference = parameters.intParam("reference")
    if (reference != null) {
        val value = ValueRegistry.value(session.key(), session.suspendContext, reference.toLong())
            ?: throw IllegalArgumentException("Unknown variable reference: $reference")
        return jsonOutput(mapOf("variables" to describeChildren(session, value)))
    }

    val frameId = parameters.intParam("frameId") ?: 0
    val frame = resolveFrame(session, frameId)
    return jsonOutput(mapOf("frameId" to frameId, "variables" to describeChildren(session, frame)))
}

private fun listBreakpoints(project: Project): Map<String, Any?> {
    val breakpoints = breakpointIndex(breakpointManager(project)).map { (id, breakpoint) ->
        val properties = breakpoint.properties
        val entry = mutableMapOf<String, Any?>(
            "id" to id,
            "type" to breakpoint.type?.id,
            "enabled" to breakpoint.isEnabled,
        )
        if (breakpoint is XLineBreakpoint<*>) {
            entry["file"] = breakpoint.fileUrl
            entry["line"] = breakpoint.line + 1
        }
        breakpoint.conditionExpression?.expression?.let { entry["condition"] = it }
        if (breakpoint.isLogMessage) {
            entry["logMessage"] = true
            breakpoint.logExpressionObject?.expression?.let { entry["logExpression"] = it }
        }
        if (javaDebuggerAvailable()) {
            javaBreakpointDetails(properties)?.let { entry.putAll(it) }
        }
        entry
    }
    return jsonOutput(mapOf("breakpoints" to breakpoints))
}

/** Java-specific breakpoint details; only called when the Java debugger is available. */
private fun javaBreakpointDetails(properties: Any?): Map<String, Any?>? {
    val details = mutableMapOf<String, Any?>()
    if (properties is JavaBreakpointProperties<*> && properties.getCOUNT_FILTER() > 0) {
        details["hitCount"] = properties.getCOUNT_FILTER()
    }
    if (properties is JavaExceptionBreakpointProperties) {
        details["exceptionClass"] = properties.myQualifiedName
        details["caught"] = properties.NOTIFY_CAUGHT
        details["uncaught"] = properties.NOTIFY_UNCAUGHT
    }
    return details.takeIf { it.isNotEmpty() }
}

private fun addLineBreakpoint(project: Project, parameters: Map<String, Any?>): Map<String, Any?> {
    val file = parameters.requiredString("file")
    val line = parameters.intParam("line") ?: throw IllegalArgumentException("Missing 'line' parameter")
    if (line < 1) throw IllegalArgumentException("'line' must be >= 1")
    val condition = parameters.stringParam("condition")?.takeIf { it.isNotBlank() }
    val logMessage = parameters.stringParam("logMessage")?.takeIf { it.isNotBlank() }
    val hitCount = parameters.intParam("hitCount")
    if (parameters["hitCount"] != null && (hitCount == null || hitCount < 1)) {
        throw IllegalArgumentException("'hitCount' must be an integer >= 1")
    }

    val virtualFile = resolveVirtualFile(project, file) ?: throw IllegalArgumentException("File not found: $file")
    val lineIndex = line - 1
    val type = XDebuggerUtil.getInstance().lineBreakpointTypes
        .firstOrNull { it.canPutAt(virtualFile, lineIndex, project) }
        ?: throw IllegalArgumentException("No breakpoint type supports ${virtualFile.path}:$line")

    @Suppress("UNCHECKED_CAST")
    val lineType = type as XLineBreakpointType<XBreakpointProperties<*>>
    val properties = lineType.createBreakpointProperties(virtualFile, lineIndex)
    if (hitCount != null && !applyJavaHitCount(properties, hitCount)) {
        // Validate before creating so a rejected request leaves no breakpoint behind.
        throw IllegalStateException("Hit count is not supported by breakpoint type ${type.id}")
    }

    val manager = breakpointManager(project)
    val breakpoint = onEdt {
        manager.addLineBreakpoint(lineType, virtualFile.url, lineIndex, properties)
    } ?: throw IllegalStateException("Failed to create breakpoint")

    condition?.let { breakpoint.setCondition(it) }
    if (logMessage != null) {
        breakpoint.isLogMessage = true
        breakpoint.setLogExpression(logMessage)
        breakpoint.suspendPolicy = SuspendPolicy.NONE
    }

    return jsonOutput(
        mapOf(
            "id" to breakpointIds.idOf(breakpoint),
            "type" to type.id,
            "file" to virtualFile.path,
            "line" to line,
        )
    )
}

/** Applies the hit count to Java breakpoint properties; false when unsupported. */
private fun applyJavaHitCount(properties: Any?, hitCount: Int): Boolean {
    if (!javaDebuggerAvailable() || properties !is JavaBreakpointProperties<*>) return false
    properties.setCOUNT_FILTER(hitCount)
    properties.setCOUNT_FILTER_ENABLED(true)
    return true
}

private fun addExceptionBreakpoint(project: Project, parameters: Map<String, Any?>): Map<String, Any?> {
    val exceptionClass = parameters.stringParam("exceptionClass")?.takeIf { it.isNotBlank() }
    if (exceptionClass != null && !JAVA_QUALIFIED_NAME.matches(exceptionClass)) {
        throw IllegalArgumentException("Invalid exception class name: $exceptionClass")
    }
    if (parameters["caught"] != null && parameters.booleanParam("caught") == null) {
        throw IllegalArgumentException("'caught' must be a boolean")
    }
    if (parameters["uncaught"] != null && parameters.booleanParam("uncaught") == null) {
        throw IllegalArgumentException("'uncaught' must be a boolean")
    }
    val caught = parameters.booleanParam("caught") ?: true
    val uncaught = parameters.booleanParam("uncaught") ?: true
    if (!caught && !uncaught) {
        throw IllegalArgumentException("At least one of 'caught' or 'uncaught' must be true")
    }
    if (!javaDebuggerAvailable()) {
        throw IllegalStateException("Exception breakpoints require Java debugger support, which is not available in this IDE")
    }

    return addJavaExceptionBreakpoint(project, exceptionClass, caught, uncaught)
}

/** Java debugger classes are only touched here, after [javaDebuggerAvailable] is confirmed. */
private fun addJavaExceptionBreakpoint(
    project: Project,
    exceptionClass: String?,
    caught: Boolean,
    uncaught: Boolean,
): Map<String, Any?> {
    val properties = if (exceptionClass != null) {
        JavaExceptionBreakpointProperties(exceptionClass)
    } else {
        JavaExceptionBreakpointProperties()
    }
    properties.NOTIFY_CAUGHT = caught
    properties.NOTIFY_UNCAUGHT = uncaught

    val manager = breakpointManager(project)
    val breakpoint = onEdt { manager.addBreakpoint(JavaExceptionBreakpointType(), properties) }
    return jsonOutput(
        mapOf(
            "id" to breakpointIds.idOf(breakpoint),
            "exceptionClass" to exceptionClass,
            "caught" to caught,
            "uncaught" to uncaught,
        )
    )
}

private fun removeBreakpoint(project: Project, parameters: Map<String, Any?>): Map<String, Any?> {
    val id = parameters.requiredString("id")
    val manager = breakpointManager(project)
    val breakpoint = breakpointIndex(manager)[id]
        ?: throw IllegalArgumentException("Breakpoint not found: $id")
    onEdt { manager.removeBreakpoint(breakpoint) }
    return textOutput("Removed breakpoint $id")
}

private fun controlExecution(project: Project, parameters: Map<String, Any?>): Map<String, Any?> {
    val action = parameters.requiredString("action")
    val normalized = action.trim().lowercase()
    if (normalized !in setOf("resume", "pause", "stepover", "stepinto", "stepout")) {
        throw IllegalArgumentException("Unsupported action: $action")
    }

    val session = resolveSession(project, parameters)
    if (normalized == "pause") {
        if (session.isSuspended) throw IllegalStateException("Debug session is already paused")
    } else {
        requireSuspended(session)
    }

    onEdt {
        when (normalized) {
            "resume" -> session.resume()
            "pause" -> session.pause()
            "stepover" -> session.stepOver(false)
            "stepinto" -> session.stepInto()
            "stepout" -> session.stepOut()
        }
    }

    // Frames and value references describe the previous suspend context.
    frameStore.remove(session.key())
    ValueRegistry.clear(session.key())

    return textOutput("Execution control \"$action\" sent to debug session \"${session.sessionName}\"")
}

private fun evaluateExpression(project: Project, parameters: Map<String, Any?>): Map<String, Any?> {
    val expression = parameters.requiredString("expression")
    val session = resolveSession(project, parameters)
    requireSuspended(session)
    val frame = resolveFrame(session, parameters.intParam("frameId") ?: 0)
    val evaluator = frame.evaluator
        ?: throw IllegalStateException("Expression evaluation is not supported in the current frame")

    val latch = CountDownLatch(1)
    var evaluated: XValue? = null
    var error: String? = null
    evaluator.evaluate(
        expression,
        object : XDebuggerEvaluator.XEvaluationCallback {
            override fun evaluated(value: XValue) {
                evaluated = value
                latch.countDown()
            }

            override fun errorOccurred(errorMessage: String) {
                error = errorMessage
                latch.countDown()
            }
        },
        frame.sourcePosition,
    )

    if (!latch.await(DEBUG_EVALUATE_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
        throw IllegalStateException("Timed out while evaluating expression")
    }
    error?.let { throw IllegalStateException(it) }
    val value = evaluated ?: throw IllegalStateException("Expression evaluation returned no value")

    val presentation = readPresentation(value)
    return jsonOutput(mapOf("result" to presentation.text, "type" to presentation.type))
}

private fun debugSessions(project: Project): List<XDebugSession> {
    val manager = try {
        XDebuggerManager.getInstance(project)
    } catch (t: Throwable) {
        throw IllegalStateException(t.message ?: "Debugger is not available", t)
    } ?: throw IllegalStateException("Debugger is not available")
    val sessions = manager.debugSessions.toList()

    // Drop caches of sessions that were terminated outside this tool surface.
    val activeKeys = sessions.map { it.key() }.toSet()
    frameStore.keys.retainAll(activeKeys)
    ValueRegistry.prune(activeKeys)

    return sessions
}

private fun currentSession(project: Project): XDebugSession? =
    try {
        XDebuggerManager.getInstance(project)?.currentSession
    } catch (_: Throwable) {
        null
    }

private fun resolveSession(project: Project, parameters: Map<String, Any?>): XDebugSession {
    val sessions = debugSessions(project)
    if (sessions.isEmpty()) throw IllegalStateException("No active debug session")
    if (parameters["sessionId"] == null) return currentSession(project) ?: sessions.first()
    val index = parameters.intParam("sessionId") ?: throw IllegalArgumentException("Invalid sessionId parameter")
    return sessions.getOrNull(index) ?: throw IllegalArgumentException("Debug session not found: $index")
}

private fun breakpointManager(project: Project): XBreakpointManager {
    val manager = try {
        XDebuggerManager.getInstance(project)
    } catch (t: Throwable) {
        throw IllegalStateException(t.message ?: "Debugger is not available", t)
    }
    return manager?.breakpointManager ?: throw IllegalStateException("Debugger is not available")
}

private fun requireSuspended(session: XDebugSession) {
    if (!session.isSuspended) throw IllegalStateException("Debug session is not paused")
}

private fun XDebugSession.key(): String = "${sessionName}#${System.identityHashCode(this)}"

private fun describePosition(position: XSourcePosition): Map<String, Any?> = mapOf(
    "file" to position.file.path,
    "line" to position.line + 1,
)

private fun collectStackFrames(session: XDebugSession): List<XStackFrame> {
    val context = session.suspendContext ?: return emptyList()
    val stack = context.activeExecutionStack ?: context.executionStacks?.firstOrNull() ?: return emptyList()

    val latch = CountDownLatch(1)
    val frames = CopyOnWriteArrayList<XStackFrame>()
    var error: String? = null
    val container = object : XExecutionStack.XStackFrameContainer {
        override fun addStackFrames(stackFrames: MutableList<out XStackFrame>, last: Boolean) {
            frames.addAll(stackFrames)
            if (last || frames.size >= MAX_STACK_FRAMES) latch.countDown()
        }

        override fun errorOccurred(errorMessage: String) {
            error = errorMessage
            latch.countDown()
        }

        override fun isObsolete(): Boolean = false
    }
    stack.computeStackFrames(0, container)
    latch.await(DEBUG_READ_TIMEOUT_SECONDS, TimeUnit.SECONDS)
    error?.let { throw IllegalStateException("Failed to read stack frames: $it") }
    return frames.take(MAX_STACK_FRAMES)
}

private fun resolveFrame(session: XDebugSession, index: Int): XStackFrame {
    val context = session.suspendContext
    val cached = frameStore[session.key()]
    if (cached != null && cached.context === context && index in cached.frames.indices) {
        return cached.frames[index]
    }
    val frames = collectStackFrames(session)
    frameStore[session.key()] = FrameCache(context, frames)
    return frames.getOrNull(index)
        ?: throw IllegalArgumentException("Stack frame not found: $index; call getCallStack after the session suspends again")
}

private fun describeChildren(session: XDebugSession, container: XValueContainer): List<Map<String, Any?>> {
    val latch = CountDownLatch(1)
    val children = CopyOnWriteArrayList<Pair<String, XValue?>>()
    var error: String? = null
    val node = object : XCompositeNode {
        override fun addChildren(childrenList: XValueChildrenList, last: Boolean) {
            for (i in 0 until childrenList.size()) {
                children += (childrenList.getName(i) ?: "") to childrenList.getValue(i)
            }
            if (last) latch.countDown()
        }

        override fun tooManyChildren(remaining: Int) {
            latch.countDown()
        }

        override fun setAlreadySorted(alreadySorted: Boolean) {}

        override fun setErrorMessage(errorMessage: String) {
            error = errorMessage
            latch.countDown()
        }

        override fun setErrorMessage(errorMessage: String, link: XDebuggerTreeNodeHyperlink?) {
            error = errorMessage
            latch.countDown()
        }

        override fun setMessage(
            message: String,
            icon: Icon?,
            attributes: SimpleTextAttributes,
            link: XDebuggerTreeNodeHyperlink?,
        ) {}

        override fun isObsolete(): Boolean = false
    }

    container.computeChildren(node)
    if (!latch.await(DEBUG_READ_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
        throw IllegalStateException("Timed out while reading variables")
    }
    error?.let { throw IllegalStateException(it) }

    return children.mapNotNull { (name, value) ->
        value?.let { describeValue(session.key(), session.suspendContext, name, it) }
    }
}

private fun describeValue(sessionKey: String, context: Any?, name: String?, value: XValue): Map<String, Any?> {
    val presentation = readPresentation(value)
    val entry = mutableMapOf<String, Any?>(
        "name" to (name?.takeIf { it.isNotEmpty() } ?: (value as? XNamedValue)?.name ?: ""),
        "value" to presentation.text,
        "type" to presentation.type,
    )
    if (presentation.hasChildren) entry["reference"] = ValueRegistry.store(sessionKey, context, value)
    return entry
}

private data class ValuePresentation(val text: String?, val type: String?, val hasChildren: Boolean)

private fun readPresentation(value: XValue): ValuePresentation {
    val latch = CountDownLatch(1)
    val node = PresentationNode(latch)
    try {
        value.computePresentation(node, XValuePlace.TREE)
    } catch (t: Throwable) {
        // Never report an empty value as a successful read: failures must be explicit.
        throw IllegalStateException("Failed to read value presentation: ${t.message ?: t.javaClass.simpleName}", t)
    }
    if (!latch.await(DEBUG_READ_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
        throw IllegalStateException("Timed out while reading value presentation")
    }
    return ValuePresentation(node.text, node.type, node.hasChildren)
}

private class PresentationNode(private val latch: CountDownLatch) : XValueNode {
    var text: String? = null
    var type: String? = null
    var hasChildren: Boolean = false

    override fun setPresentation(icon: Icon?, value: String?, type: String, hasChildren: Boolean) {
        this.text = value
        this.type = type
        this.hasChildren = hasChildren
        latch.countDown()
    }

    override fun setPresentation(icon: Icon?, presentation: XValuePresentation, hasChildren: Boolean) {
        this.text = renderPresentation(presentation)
        this.type = presentation.type
        this.hasChildren = hasChildren
        latch.countDown()
    }

    override fun setFullValueEvaluator(fullValueEvaluator: XFullValueEvaluator) {}

    override fun isObsolete(): Boolean = false
}

private fun renderPresentation(presentation: XValuePresentation): String {
    val renderer = TextRenderer()
    presentation.renderValue(renderer)
    return renderer.text()
}

private class TextRenderer : XValuePresentation.XValueTextRenderer {
    private val builder = StringBuilder()

    fun text(): String = builder.toString()

    override fun renderValue(value: String) {
        builder.append(value)
    }

    override fun renderStringValue(value: String) {
        builder.append(value)
    }

    override fun renderNumericValue(value: String) {
        builder.append(value)
    }

    override fun renderKeywordValue(value: String) {
        builder.append(value)
    }

    override fun renderValue(value: String, key: com.intellij.openapi.editor.colors.TextAttributesKey) {
        builder.append(value)
    }

    override fun renderStringValue(value: String, additionalSpecialCharsToHighlight: String?, maxLength: Int) {
        builder.append(if (maxLength > 0 && value.length > maxLength) value.take(maxLength) else value)
    }

    override fun renderComment(comment: String) {
        builder.append(comment)
    }

    override fun renderSpecialSymbol(symbol: String) {
        builder.append(symbol)
    }

    override fun renderError(error: String) {
        builder.append(error)
    }
}

/** Stable breakpoint identifiers shared by listing, adding and removing. */
internal interface BreakpointIdStore {
    fun read(breakpoint: XBreakpoint<*>): String?
    fun write(breakpoint: XBreakpoint<*>, id: String)
}

private object UserDataBreakpointIdStore : BreakpointIdStore {
    private val KEY = Key.create<String>("paviko.opencode.acp.breakpointId")

    override fun read(breakpoint: XBreakpoint<*>): String? = breakpoint.getUserData(KEY)

    override fun write(breakpoint: XBreakpoint<*>, id: String) {
        breakpoint.putUserData(KEY, id)
    }
}

/**
 * Assigns each breakpoint a session-stable identifier stored on the breakpoint
 * itself, so identifiers survive additions and removals in the same session.
 */
internal class BreakpointIdAllocator(private val store: BreakpointIdStore = UserDataBreakpointIdStore) {
    private val counter = AtomicLong(0)

    @Synchronized
    fun idOf(breakpoint: XBreakpoint<*>): String {
        store.read(breakpoint)?.let { return it }
        val id = "bp" + counter.incrementAndGet()
        store.write(breakpoint, id)
        return id
    }
}

private val breakpointIds = BreakpointIdAllocator()

private fun breakpointIndex(manager: XBreakpointManager): Map<String, XBreakpoint<*>> =
    manager.allBreakpoints.associateBy { breakpointIds.idOf(it) }
