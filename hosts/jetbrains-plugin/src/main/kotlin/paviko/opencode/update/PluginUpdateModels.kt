package paviko.opencode.update

typealias UpdateEventSink = (String, Map<String, Any?>) -> Unit

data class UpdateRelease(
    val version: String,
    val manualUpdate: Boolean = false,
    val releaseUrl: String? = null,
    val notes: String? = null,
    val publishedAt: String? = null,
)

data class UpdateInfoResult(
    val supported: Boolean,
    val reason: String? = null,
    val currentVersion: String,
    val latest: UpdateRelease? = null,
    val hasUpdate: Boolean = false,
)

sealed interface CheckForUpdatesResult {
    val status: String

    data class Available(
        val latest: UpdateRelease,
        override val status: String = "available",
    ) : CheckForUpdatesResult

    data class UpToDate(
        val currentVersion: String,
        override val status: String = "up-to-date",
    ) : CheckForUpdatesResult

    data class ManualCheck(
        val currentVersion: String,
        val reason: String,
        val releaseUrl: String = marketplacePluginPage(),
        override val status: String = "manual-check",
    ) : CheckForUpdatesResult

    data class Unsupported(
        val currentVersion: String,
        val reason: String,
        override val status: String = "unsupported",
    ) : CheckForUpdatesResult
}

class PreparedPluginUpdate(
    val version: String,
    private val runner: (UpdateEventSink) -> Unit,
) {
    fun start(emit: UpdateEventSink) = runner(emit)
}

fun UpdateRelease.toPayload(extra: Map<String, Any?> = emptyMap()): Map<String, Any?> = buildMap {
    put("version", version)
    put("manualUpdate", manualUpdate)
    releaseUrl?.let { put("releaseUrl", it) }
    notes?.let { put("notes", it) }
    publishedAt?.let { put("publishedAt", it) }
    putAll(extra)
}
