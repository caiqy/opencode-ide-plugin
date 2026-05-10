package paviko.opencode.update

import com.google.gson.Gson
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import paviko.opencode.JETBRAINS_PLUGIN_ID
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration

private const val MARKETPLACE_BASE = "https://plugins.jetbrains.com"
private const val MARKETPLACE_NUMERIC_PLUGIN_ID = "31609"

data class MarketplacePluginRelease(
    val version: String,
    val releaseUrl: String,
)

fun interface MarketplaceVersionSource {
    fun latest(): MarketplacePluginRelease?
}

internal fun defaultMarketplaceVersionSource(): MarketplaceVersionSource {
    val client = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(5))
        .build()

    return MarketplaceVersionSource {
        val request = HttpRequest.newBuilder()
            .uri(URI.create("$MARKETPLACE_BASE/api/plugins/$MARKETPLACE_NUMERIC_PLUGIN_ID/updates"))
            .timeout(Duration.ofSeconds(8))
            .GET()
            .build()

        val body = client.send(request, HttpResponse.BodyHandlers.ofString()).body()
        parseMarketplaceUpdateList(body)
    }
}

internal fun parseMarketplaceUpdateList(body: String): MarketplacePluginRelease? {
    val root = parseJson(body) ?: return null
    if (!root.isJsonArray) {
        return null
    }

    return root.asJsonArray.firstOrNull()?.let { parseMarketplaceUpdate(it.toString()) }
}

internal fun parseMarketplaceUpdate(body: String): MarketplacePluginRelease? {
    val root = parseJson(body)?.takeIf(JsonElement::isJsonObject)?.asJsonObject ?: return null
    val version = root.string("version").orEmpty()
    if (version.isEmpty()) {
        return null
    }

    val raw = root.string("link").orEmpty()
    val releaseUrl = when {
        raw.startsWith("https://") || raw.startsWith("http://") -> raw
        raw.startsWith("/") -> "$MARKETPLACE_BASE$raw"
        else -> marketplacePluginPage()
    }

    return MarketplacePluginRelease(version = version, releaseUrl = releaseUrl)
}

internal fun marketplacePluginPage(): String = "$MARKETPLACE_BASE/plugin/31609-opencode-ui-unofficial-"

internal fun marketplacePluginXmlId(): String = JETBRAINS_PLUGIN_ID

private fun parseJson(body: String): JsonElement? = runCatching {
    Gson().fromJson(body, JsonElement::class.java)
}.getOrNull()

private fun JsonObject.string(name: String): String? {
    val value = get(name) ?: return null
    if (!value.isJsonPrimitive) {
        return null
    }

    return runCatching { value.asString.trim() }.getOrNull()
}
