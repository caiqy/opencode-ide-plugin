package paviko.opencode.ui

import com.intellij.codeInspection.InspectionEngine
import com.intellij.codeInspection.InspectionManager
import com.intellij.codeInspection.ProblemDescriptor
import com.intellij.codeInspection.ProblemHighlightType
import com.intellij.codeInspection.ex.LocalInspectionToolWrapper
import com.intellij.openapi.editor.Document
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.progress.EmptyProgressIndicator
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.profile.codeInspection.InspectionProjectProfileManager
import com.intellij.psi.PsiDocumentManager
import com.intellij.psi.PsiManager

private const val PROBLEM_LIMIT = 300
private const val MAX_PROBLEM_FILES = 100
private const val PROBLEM_SCAN_BUDGET_MS = 30000L
private val SKIPPED_DIRECTORIES = setOf("build", "out", "node_modules", ".gradle", ".git", "target")

internal fun getProblems(project: Project, parameters: Map<String, Any?>): Map<String, Any?> {
    val rawPath = parameters.stringParam("path")?.takeIf { it.isNotBlank() }
    val targets = resolveProblemTargetsAction(project, rawPath)
    if (targets.files.isEmpty()) {
        if (targets.skippedDirectories.isNotEmpty()) {
            // Nothing left to scan because the whole range was skipped: report the partial
            // result (with the skipped directories) instead of failing.
            return jsonOutput(
                mapOf(
                    "problems" to emptyList<Map<String, Any?>>(),
                    "truncated" to true,
                    "scanned" to emptyList<String>(),
                    "skippedDirectories" to targets.skippedDirectories,
                )
            )
        }
        throw IllegalStateException(
            if (rawPath == null) "No active file to inspect" else "No files found for path: $rawPath"
        )
    }

    val deadline = System.currentTimeMillis() + PROBLEM_SCAN_BUDGET_MS
    val problems = mutableListOf<Map<String, Any?>>()
    val scanned = mutableListOf<String>()
    val indicator = EmptyProgressIndicator()
    var truncated = targets.truncated

    for (file in targets.files) {
        if (System.currentTimeMillis() > deadline || problems.size >= PROBLEM_LIMIT) {
            truncated = true
            break
        }
        scanned += file.path
        try {
            onReadAction { inspectFile(project, file, indicator, problems) }
        } catch (t: Throwable) {
            // The 30s budget only stops starting new files. A failing inspection — or a
            // cancellation coming from anywhere else — is reported explicitly instead of
            // being silently converted into empty or partial results.
            throw IllegalStateException(
                "Inspection failed for ${file.path}: ${t.message ?: t.javaClass.simpleName}",
                t,
            )
        }
    }
    if (problems.size >= PROBLEM_LIMIT) truncated = true

    return jsonOutput(
        mapOf(
            "problems" to problems.take(PROBLEM_LIMIT),
            "truncated" to truncated,
            "scanned" to scanned,
            "skippedDirectories" to targets.skippedDirectories
        )
    )
}

internal data class ProblemTargets(
    val files: List<VirtualFile>,
    val truncated: Boolean,
    val skippedDirectories: List<String>,
)

/** Test seam: resolving targets needs the IDE virtual file system and editor state. */
internal var resolveProblemTargetsAction: (Project, String?) -> ProblemTargets = ::resolveProblemTargets

private fun resolveProblemTargets(project: Project, rawPath: String?): ProblemTargets {
    if (rawPath == null) {
        val editor = FileEditorManager.getInstance(project).selectedTextEditor
            ?: return ProblemTargets(emptyList(), false, emptyList())
        val file = FileDocumentManager.getInstance().getFile(editor.document)
            ?: return ProblemTargets(emptyList(), false, emptyList())
        return ProblemTargets(listOf(file), false, emptyList())
    }

    val virtualFile = resolveVirtualFile(project, rawPath) ?: return ProblemTargets(emptyList(), false, emptyList())
    if (!virtualFile.isDirectory) return ProblemTargets(listOf(virtualFile), false, emptyList())

    val collected = mutableListOf<VirtualFile>()
    val skipped = mutableListOf<String>()
    val hitFileLimit = collectFiles(virtualFile, collected, skipped)
    return ProblemTargets(collected, hitFileLimit || skipped.isNotEmpty(), skipped)
}

/**
 * Collects every file below [directory]; returns true when the file limit cut the scan short.
 * Skipped build/hidden directories are reported via [skipped] because their files are not
 * inspected, which makes the scan result partial.
 */
internal fun collectFiles(
    directory: VirtualFile,
    out: MutableList<VirtualFile>,
    skipped: MutableList<String>,
): Boolean {
    for (child in directory.children) {
        if (out.size >= MAX_PROBLEM_FILES) return true
        if (child.isDirectory) {
            if (child.name.startsWith('.') || SKIPPED_DIRECTORIES.contains(child.name)) {
                skipped += child.path
                continue
            }
            if (collectFiles(child, out, skipped)) return true
        } else {
            out += child
        }
    }
    return false
}

private fun inspectFile(
    project: Project,
    file: VirtualFile,
    indicator: EmptyProgressIndicator,
    out: MutableList<Map<String, Any?>>,
) {
    val psiFile = PsiManager.getInstance(project).findFile(file) ?: return
    val profile = InspectionProjectProfileManager.getInstance(project).currentProfile ?: return
    val tools = profile.getInspectionTools(psiFile).filterIsInstance<LocalInspectionToolWrapper>()
    if (tools.isEmpty()) return

    val document = PsiDocumentManager.getInstance(project).getDocument(psiFile)
    val results = InspectionEngine.inspectEx(
        tools,
        psiFile,
        InspectionManager.getInstance(project),
        false,
        indicator,
    )

    results.forEach { (toolName, descriptors) ->
        for (descriptor in descriptors) {
            if (out.size >= PROBLEM_LIMIT) break
            out += describeProblem(project, toolName, descriptor, document)
        }
    }
}

private fun describeProblem(
    project: Project,
    toolName: String,
    descriptor: ProblemDescriptor,
    document: Document?,
): Map<String, Any?> {
    val element = descriptor.psiElement
    val file = element?.containingFile?.virtualFile
    val lineIndex = descriptor.lineNumber
    val documentForFile = document
        ?: element?.containingFile?.let { PsiDocumentManager.getInstance(project).getDocument(it) }
    // No silent catch here: a failing PSI/document read (including a cancellation) must
    // surface through the caller as an explicit error instead of an empty column.
    val column = if (documentForFile == null || element == null) {
        null
    } else {
        val offset = element.textOffset + (descriptor.textRangeInElement?.startOffset ?: 0)
        offset - documentForFile.getLineStartOffset(documentForFile.getLineNumber(offset)) + 1
    }

    return mapOf(
        "tool" to toolName,
        "severity" to severityOf(descriptor.highlightType),
        "message" to descriptor.descriptionTemplate,
        "file" to (file?.path ?: ""),
        "line" to (if (lineIndex >= 0) lineIndex + 1 else null),
        "column" to column,
    )
}

private fun severityOf(highlightType: ProblemHighlightType): String = when (highlightType) {
    ProblemHighlightType.ERROR,
    ProblemHighlightType.GENERIC_ERROR,
    ProblemHighlightType.LIKE_UNKNOWN_SYMBOL -> "error"

    ProblemHighlightType.WARNING,
    ProblemHighlightType.GENERIC_ERROR_OR_WARNING,
    ProblemHighlightType.LIKE_DEPRECATED,
    ProblemHighlightType.POSSIBLE_PROBLEM -> "warning"

    ProblemHighlightType.WEAK_WARNING,
    ProblemHighlightType.LIKE_UNUSED_SYMBOL,
    ProblemHighlightType.LIKE_MARKED_FOR_REMOVAL -> "weak_warning"

    ProblemHighlightType.INFORMATION,
    ProblemHighlightType.INFO -> "info"

    else -> "info"
}
