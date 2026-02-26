# JetBrains IdeBridge 功能补齐实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 补齐 JetBrains IdeBridge 缺失的 5 个消息类型（clipboardWrite、storageGet、storageSet、uiGetState、uiSetState），达到与 VSCode 端功能对等。

**Architecture:** 所有改动集中在 `IdeBridge.kt`。Session 数据类增加 uiState 字段；handleSend 的 when 块增加 5 个 case 分支。clipboardWrite 用 AWT Toolkit，storage 用 PropertiesComponent，uiState 用 Session 内存字段。

**Tech Stack:** Kotlin, IntelliJ Platform SDK (PropertiesComponent), AWT (Toolkit/StringSelection)

---

### Task 1: Session 数据类增加 uiState 字段

**Files:**

- Modify: `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt:25-29`

**Step 1: 修改 Session 数据类**

```kotlin
data class Session(
    val id: String,
    val token: String,
    val project: Project,
    val sseClients: MutableSet<HttpExchange> = Collections.synchronizedSet(mutableSetOf()),
    var uiState: Any? = null
)
```

**Step 2: 添加 import**

在文件顶部 import 区域添加：

```kotlin
import com.intellij.ide.util.PropertiesComponent
import java.awt.Toolkit
import java.awt.datatransfer.StringSelection
```

**Step 3: 验证编译**

Run: `gradlew compileKotlin` (from `hosts/jetbrains-plugin`)
Expected: BUILD SUCCESSFUL

**Step 4: Commit**

```bash
git add hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt
git commit -m "feat(jetbrains): add uiState field and imports for bridge parity"
```

---

### Task 2: 实现 clipboardWrite

**Files:**

- Modify: `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt` — handleSend when 块

**Step 1: 在 handleSend 的 when 块中，`else` 分支之前，添加 clipboardWrite case**

```kotlin
"clipboardWrite" -> {
    val text = payload?.get("text")?.asString
    if (text != null) {
        val clipboard = Toolkit.getDefaultToolkit().systemClipboard
        clipboard.setContents(StringSelection(text), null)
        replyOk(session, id)
    } else {
        replyError(session, id, "Missing text")
    }
}
```

**Step 2: 验证编译**

Run: `gradlew compileKotlin` (from `hosts/jetbrains-plugin`)
Expected: BUILD SUCCESSFUL

**Step 3: Commit**

```bash
git add hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt
git commit -m "feat(jetbrains): implement clipboardWrite in IdeBridge"
```

---

### Task 3: 实现 storageGet / storageSet

**Files:**

- Modify: `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt` — handleSend when 块

**Step 1: 在 when 块中添加 storageGet case**

注意：回复格式用 `result` 字段（非 `payload`），与 VSCode 端 `IdeBridgeServer.ts:385-394` 保持一致。

```kotlin
"storageGet" -> {
    val keys = payload?.getAsJsonArray("keys")
    val result = JsonObject()
    keys?.forEach { k ->
        val key = k.asString
        val value = PropertiesComponent.getInstance().getValue("opencode.$key")
        if (value != null) result.addProperty(key, value)
    }
    if (id != null) {
        broadcastSSE(session, gson.toJson(JsonObject().apply {
            addProperty("replyTo", id)
            addProperty("ok", true)
            add("result", result)
            addProperty("timestamp", System.currentTimeMillis())
        }))
    }
}
```

**Step 2: 在 when 块中添加 storageSet case**

```kotlin
"storageSet" -> {
    val key = payload?.get("key")?.asString
    val value = payload?.get("value")?.asString
    if (key != null && value != null) {
        PropertiesComponent.getInstance().setValue("opencode.$key", value)
        replyOk(session, id)
    } else {
        replyError(session, id, "Missing key or value")
    }
}
```

**Step 3: 验证编译**

Run: `gradlew compileKotlin` (from `hosts/jetbrains-plugin`)
Expected: BUILD SUCCESSFUL

**Step 4: Commit**

```bash
git add hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt
git commit -m "feat(jetbrains): implement storageGet/storageSet in IdeBridge"
```

---

### Task 4: 实现 uiGetState / uiSetState

**Files:**

- Modify: `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt` — handleSend when 块

**Step 1: 在 when 块中添加 uiGetState case**

回复格式参考 VSCode 端 `IdeBridgeServer.ts:278-296`。

```kotlin
"uiGetState" -> {
    if (id != null) {
        broadcastSSE(session, gson.toJson(JsonObject().apply {
            addProperty("replyTo", id)
            addProperty("ok", true)
            add("payload", JsonObject().apply {
                add("state", gson.toJsonTree(session.uiState))
            })
            addProperty("timestamp", System.currentTimeMillis())
        }))
    }
}
```

**Step 2: 在 when 块中添加 uiSetState case**

```kotlin
"uiSetState" -> {
    session.uiState = payload?.get("state")
    replyOk(session, id)
}
```

**Step 3: 验证编译**

Run: `gradlew compileKotlin` (from `hosts/jetbrains-plugin`)
Expected: BUILD SUCCESSFUL

**Step 4: Commit**

```bash
git add hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt
git commit -m "feat(jetbrains): implement uiGetState/uiSetState in IdeBridge"
```

---

### Task 5: 最终验证

**Step 1: 完整构建**

Run: `gradlew build` (from `hosts/jetbrains-plugin`)
Expected: BUILD SUCCESSFUL

**Step 2: 检查 when 块完整性**

确认 handleSend 的 when 块现在包含以下所有 case：

- `openFile`
- `ensureAndOpenFile`
- `openUrl`
- `reloadPath`
- `clipboardWrite`
- `kv.get`
- `kv.update`
- `model.get`
- `model.update`
- `storageGet`
- `storageSet`
- `uiGetState`
- `uiSetState`
- `else`

这与 VSCode 端完全对等。
