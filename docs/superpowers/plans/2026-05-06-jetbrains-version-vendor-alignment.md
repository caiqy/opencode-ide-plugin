# JetBrains 版本显示与 vendor 对齐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 JetBrains 插件右上角版本号显示实际安装插件版本，同时把插件 vendor 统一改为 `Caiqy`，并让 release 构建出的 WebGUI fallback 版本不再滞后。

**Architecture:** 先在 JetBrains 宿主补齐 `getExtensionVersion` bridge action，并把“读取已安装插件版本”抽成宿主可复用的单一来源；这样 WebGUI Header 继续沿用现有 fallback + 异步覆盖模式，无需耦合到 `UpdateContext`。然后更新 JetBrains plugin metadata 与 Gradle group，并在 release workflow 的 JetBrains 构建链路里同步注入 WebGUI 版本，再用 workflow 内校验脚本锁住 vendor 与版本注入结果。

**Tech Stack:** Kotlin 1.9、IntelliJ Platform API、TypeScript、React 19、Vitest、Gradle、GitHub Actions YAML、Node.js

---

## File Structure

- `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/update/PluginVersion.kt`
  - 新增 JetBrains 已安装插件版本读取 helper，作为 bridge 与 update service 的共享真相源。
- `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/update/PluginUpdateService.kt`
  - 改为复用共享版本读取 helper，移除重复版本来源。
- `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt`
  - 新增 `getExtensionVersion` handler，并允许 session 注入可测试的版本 provider。
- `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/IdeBridgeUpdateTest.kt`
  - 新增 `getExtensionVersion` 成功/失败 roundtrip 测试。
- `hosts/jetbrains-plugin/src/main/resources/META-INF/plugin.xml`
  - 将 `<vendor>` 从 `qtkj` 改为 `Caiqy`。
- `hosts/jetbrains-plugin/build.gradle.kts`
  - 将 `group` 从 `qtkj.opencode` 改为 `Caiqy.opencode`。
- `.github/workflows/release.yml`
  - 在 JetBrains build job 里注入 `packages/opencode/webgui/package.json` 版本，并在 Marketplace metadata 校验中锁定 `vendor` 与注入结果。

### Task 1: 补齐 JetBrains `getExtensionVersion` bridge

**Files:**

- Create: `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/update/PluginVersion.kt`
- Modify: `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/update/PluginUpdateService.kt`
- Modify: `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt`
- Test: `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/IdeBridgeUpdateTest.kt`

- [ ] **Step 1: 先给 `IdeBridge` 写失败测试，锁定缺失的 `getExtensionVersion` 能力**

在 `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/IdeBridgeUpdateTest.kt` 的现有 `getUpdateInfo returns marketplace only support state` 测试前面，插入下面两个测试：

```kotlin
    @Test
    fun `getExtensionVersion returns installed plugin version`() {
        val session = IdeBridge.createSession(
            project = project(),
            extensionVersionProvider = { "26.5.600" },
        )

        sse(session).use { events ->
            val reply = events.send("getExtensionVersion", JsonObject())
            val result = reply.getAsJsonObject("result")

            assertEquals(true, reply.get("ok")?.asBoolean)
            assertNotNull(result)
            assertEquals("26.5.600", result.get("version")?.asString)
        }
    }

    @Test
    fun `getExtensionVersion failure replies with bridge error`() {
        val session = IdeBridge.createSession(
            project = project(),
            extensionVersionProvider = {
                throw IllegalStateException("descriptor missing")
            },
        )

        sse(session).use { events ->
            val reply = events.send("getExtensionVersion", JsonObject())

            assertEquals(false, reply.get("ok")?.asBoolean)
            assertEquals("getExtensionVersion failed: descriptor missing", reply.get("error")?.asString)
        }
    }
```

- [ ] **Step 2: 运行 JetBrains bridge 单测，确认它先失败**

Run（在 `hosts/jetbrains-plugin` 目录）:

```bash
./gradlew.bat unitTest --tests "paviko.opencode.ui.IdeBridgeUpdateTest"
```

Expected: FAIL，报错包含 `Cannot find a parameter with this name: extensionVersionProvider`，或 `getExtensionVersion` 当前返回 `not supported` / 无对应 handler，证明测试先锁定了协议缺口。

- [ ] **Step 3: 抽出共享插件版本读取 helper，并让 `PluginUpdateService` 复用它**

创建 `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/update/PluginVersion.kt`：

```kotlin
package paviko.opencode.update

import com.intellij.ide.plugins.PluginManagerCore
import com.intellij.openapi.extensions.PluginId
import paviko.opencode.JETBRAINS_PLUGIN_ID

private val pluginId = PluginId.getId(JETBRAINS_PLUGIN_ID)

internal fun readInstalledPluginVersion(): String {
    return PluginManagerCore.getPlugin(pluginId)?.version
        ?: throw IllegalStateException("Installed plugin descriptor not found")
}
```

把 `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/update/PluginUpdateService.kt` 的默认 `currentVersionProvider` 与 companion object 替换成下面这组修改：

```kotlin
class PluginUpdateService(
    private val currentVersionProvider: () -> String = ::readInstalledPluginVersion,
    private val distributionChannelProvider: () -> String = ::readDistributionChannel,
    latestProvider: (() -> AvailablePluginUpdate?)? = null,
    private val marketplaceLookup: () -> MarketplaceLookup = ::loadMarketplaceUpdate,
    private val updateVersionProvider: (Any) -> String? = { it.version() },
    private val backgroundRunner: (() -> Unit) -> Unit = { task -> ApplicationManager.getApplication().executeOnPooledThread(task) },
) {
```

并删除原 companion object 里的这段重复逻辑：

```kotlin
        private fun readInstalledVersion(): String {
            return PluginManagerCore.getPlugin(pluginId)?.version
                ?: throw IllegalStateException("Installed plugin descriptor not found")
        }
```

- [ ] **Step 4: 给 `IdeBridge` session 增加可注入版本 provider，并实现 `getExtensionVersion` handler**

把 `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt` 的 import、`Session`、`createSession()` 签名和 `when (action)` 分发修改为下面的增量代码。

先补 import：

```kotlin
import paviko.opencode.update.readInstalledPluginVersion
```

把 `Session` 数据类改成：

```kotlin
data class Session(
    val id: String,
    val token: String,
    val project: Project,
    val sseClients: MutableSet<HttpExchange> = Collections.synchronizedSet(mutableSetOf()),
    val mem: MutableMap<String, String> = ConcurrentHashMap(),
    val storage: IdeBridgeStorageBackend = IdeBridgePropertiesStorageBackend,
    val updateService: PluginUpdateService = PluginUpdateService(),
    val extensionVersionProvider: () -> String = ::readInstalledPluginVersion,
)
```

把 `createSession()` 签名和 `Session(...)` 构造改成：

```kotlin
    fun createSession(
        project: Project,
        storage: IdeBridgeStorageBackend = IdeBridgePropertiesStorageBackend,
        updateService: PluginUpdateService = PluginUpdateService(),
        extensionVersionProvider: () -> String = ::readInstalledPluginVersion,
    ): SessionInfo {
```

```kotlin
        sessions[sessionId] = Session(
            id = sessionId,
            token = token,
            project = project,
            storage = storage,
            updateService = updateService,
            extensionVersionProvider = extensionVersionProvider,
        )
```

在 `when (action)` 里、`"getUpdateInfo"` 分支之前插入：

```kotlin
                "getExtensionVersion" -> {
                    try {
                        replyResult(
                            session,
                            id,
                            mapOf("version" to session.extensionVersionProvider()),
                        )
                    } catch (e: Exception) {
                        replyError(session, id, "getExtensionVersion failed: ${e.message ?: e}")
                    }
                }

```

- [ ] **Step 5: 重跑 JetBrains bridge 单测，确认 `getExtensionVersion` 已打通**

Run（在 `hosts/jetbrains-plugin` 目录）:

```bash
./gradlew.bat unitTest --tests "paviko.opencode.ui.IdeBridgeUpdateTest"
```

Expected: PASS，包含新增两个测试通过，且现有 update bridge 测试继续通过。

- [ ] **Step 6: 运行现有 Header 版本显示测试，确认前端不需要额外改代码**

Run（在 `packages/opencode/webgui` 目录）:

```bash
bun run test:run src/components/CompactHeader/index.test.tsx
```

Expected: PASS，其中 `优先显示 IDE 扩展版本号` 和 `拿不到 IDE 扩展版本时回退显示 WebGUI 版本号` 继续通过，证明宿主补齐 bridge 后前端现有逻辑已满足设计。

- [ ] **Step 7: 提交 Task 1**

```bash
git add hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/update/PluginVersion.kt hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/update/PluginUpdateService.kt hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/IdeBridgeUpdateTest.kt
git commit -m "fix(jetbrains): expose installed plugin version to webgui"
```

### Task 2: 对齐 JetBrains plugin vendor metadata

**Files:**

- Modify: `hosts/jetbrains-plugin/src/main/resources/META-INF/plugin.xml`
- Modify: `hosts/jetbrains-plugin/build.gradle.kts`

- [ ] **Step 1: 先写一个本地校验命令，确认当前 metadata 还没有对齐到 `Caiqy`**

Run（在仓库根目录）:

```bash
node -e "const fs=require('fs');const xml=fs.readFileSync('hosts/jetbrains-plugin/src/main/resources/META-INF/plugin.xml','utf8');const gradle=fs.readFileSync('hosts/jetbrains-plugin/build.gradle.kts','utf8');if(!xml.includes('<vendor>Caiqy</vendor>')) throw new Error('vendor not updated');if(!gradle.includes('group = \"Caiqy.opencode\"')) throw new Error('group not updated');console.log('jetbrains vendor metadata ok')"
```

Expected: FAIL，至少报 `vendor not updated` 或 `group not updated`。

- [ ] **Step 2: 修改 `plugin.xml` 与 Gradle group**

把 `hosts/jetbrains-plugin/src/main/resources/META-INF/plugin.xml` 的头部改成：

```xml
<idea-plugin>
  <vendor>Caiqy</vendor>
  <id>caiqy.opencode-ui</id>
  <name>OpenCode UI (unofficial)</name>
  <description>Run a local OpenCode backend inside JetBrains IDEs with a chat-based AI coding interface.</description>
```

把 `hosts/jetbrains-plugin/build.gradle.kts` 的开头 group/version 行改成：

```kotlin
group = "Caiqy.opencode"
version = findProperty("plugin.version")?.toString() ?: "26.2.15"
```

- [ ] **Step 3: 重跑本地 metadata 校验命令，确认 vendor 已对齐**

Run（在仓库根目录）:

```bash
node -e "const fs=require('fs');const xml=fs.readFileSync('hosts/jetbrains-plugin/src/main/resources/META-INF/plugin.xml','utf8');const gradle=fs.readFileSync('hosts/jetbrains-plugin/build.gradle.kts','utf8');if(!xml.includes('<vendor>Caiqy</vendor>')) throw new Error('vendor not updated');if(!gradle.includes('group = \"Caiqy.opencode\"')) throw new Error('group not updated');console.log('jetbrains vendor metadata ok')"
```

Expected: PASS，输出 `jetbrains vendor metadata ok`。

- [ ] **Step 4: 运行 JetBrains 轻量单测，确认 metadata 改动未破坏已有 update 测试入口**

Run（在 `hosts/jetbrains-plugin` 目录）:

```bash
./gradlew.bat unitTest --tests "paviko.opencode.update.PluginUpdateServiceTest" --tests "paviko.opencode.ui.IdeBridgeUpdateTest"
```

Expected: PASS。

- [ ] **Step 5: 提交 Task 2**

```bash
git add hosts/jetbrains-plugin/src/main/resources/META-INF/plugin.xml hosts/jetbrains-plugin/build.gradle.kts
git commit -m "fix(jetbrains): align vendor metadata with Caiqy"
```

### Task 3: 在 release workflow 注入 WebGUI fallback 版本并锁定 Marketplace metadata

**Files:**

- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: 先写一个本地 workflow 约束校验命令，确认当前 release.yml 还缺少 WebGUI 版本注入与 vendor 校验**

Run（在仓库根目录）:

```bash
node -e "const fs=require('fs');const text=fs.readFileSync('.github/workflows/release.yml','utf8');if(!text.includes('Inject WebGUI version for JetBrains build')) throw new Error('missing webgui injection step');if(!text.includes('packages/opencode/webgui/package.json')) throw new Error('missing webgui package mutation');if(!text.includes('<vendor>Caiqy</vendor>')) throw new Error('missing vendor assertion');console.log('release workflow metadata guards ok')"
```

Expected: FAIL，报 `missing webgui injection step`、`missing webgui package mutation` 或 `missing vendor assertion`。

- [ ] **Step 2: 在 JetBrains build job 中注入 WebGUI 版本**

在 `.github/workflows/release.yml` 的 `Inject JetBrains version` 之后、`Build single-target backend binary` 之前插入新步骤：

```yml
- name: Inject WebGUI version for JetBrains build
  run: |
    RAW_VERSION="${{ needs.preflight.outputs.version }}"
    CLEAN_VERSION="${RAW_VERSION#v}"
    node -e '
      const fs = require("fs");
      const path = "packages/opencode/webgui/package.json";
      const pkg = JSON.parse(fs.readFileSync(path, "utf8"));
      pkg.version = process.argv[1];
      fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n");
      console.log("Updated " + path + " to version " + process.argv[1]);
    ' "$CLEAN_VERSION"
```

- [ ] **Step 3: 把 Marketplace metadata 校验扩展到 vendor，并新增 WebGUI 版本注入校验**

先在现有 `Verify Marketplace plugin metadata` 的 python 脚本里，在 `plugin_xml is None` 检查后插入：

```python
          if "<vendor>Caiqy</vendor>" not in plugin_xml:
              raise SystemExit("Marketplace package vendor must be Caiqy")
```

再在 `Verify Marketplace distribution channel metadata` 之前插入一个新步骤，并直接使用 tag clean version 作为校验值：

```yml
- name: Verify JetBrains build WebGUI version injection
  run: |
    RAW_VERSION="${{ needs.preflight.outputs.version }}"
    CLEAN_VERSION="${RAW_VERSION#v}"
    node -e '
      const fs = require("fs");
      const expected = process.argv[1];
      const pkg = JSON.parse(fs.readFileSync("packages/opencode/webgui/package.json", "utf8"));
      if (pkg.version !== expected) {
        throw new Error(`webgui version ${pkg.version} does not match ${expected}`)
      }
      console.log("jetbrains webgui version injection ok")
    ' "$CLEAN_VERSION"
```

- [ ] **Step 4: 重跑本地 workflow 约束校验命令，确认 release.yml 已覆盖新要求**

Run（在仓库根目录）:

```bash
node -e "const fs=require('fs');const text=fs.readFileSync('.github/workflows/release.yml','utf8');if(!text.includes('Inject WebGUI version for JetBrains build')) throw new Error('missing webgui injection step');if(!text.includes('packages/opencode/webgui/package.json')) throw new Error('missing webgui package mutation');if(!text.includes('<vendor>Caiqy</vendor>')) throw new Error('missing vendor assertion');console.log('release workflow metadata guards ok')"
```

Expected: PASS，输出 `release workflow metadata guards ok`。

- [ ] **Step 5: 运行一次 repo 侧快速验证，确认 Header / JetBrains / workflow 三块都同时满足**

Run（在仓库根目录，按顺序执行）:

```bash
./hosts/jetbrains-plugin/gradlew.bat unitTest --tests "paviko.opencode.ui.IdeBridgeUpdateTest"; if ($?) { bun --cwd packages/opencode/webgui run test:run src/components/CompactHeader/index.test.tsx }; if ($?) { node -e "const fs=require('fs');const xml=fs.readFileSync('hosts/jetbrains-plugin/src/main/resources/META-INF/plugin.xml','utf8');const gradle=fs.readFileSync('hosts/jetbrains-plugin/build.gradle.kts','utf8');const workflow=fs.readFileSync('.github/workflows/release.yml','utf8');if(!xml.includes('<vendor>Caiqy</vendor>')) throw new Error('vendor missing');if(!gradle.includes('group = \"Caiqy.opencode\"')) throw new Error('group missing');if(!workflow.includes('Inject WebGUI version for JetBrains build')) throw new Error('workflow injection missing');console.log('jetbrains version/vendor alignment quick check ok')" }
```

Expected: 全部 PASS，最后输出 `jetbrains version/vendor alignment quick check ok`。

- [ ] **Step 6: 提交 Task 3**

```bash
git add .github/workflows/release.yml
git commit -m "fix(release): align jetbrains webgui version metadata"
```

## Self-Review Checklist

- [ ] `getExtensionVersion` 在 JetBrains 宿主中已真正实现，而不是只改测试 mock
- [ ] JetBrains 与 `PluginUpdateService` 没有再各自维护两套“已安装插件版本”读取逻辑
- [ ] `plugin.xml` 的 vendor 与 `build.gradle.kts` 的 group 都已从 `qtkj` 切到 `Caiqy`
- [ ] release workflow 的 WebGUI 版本注入使用的是 tag clean version，而不是 `packages/opencode/package.json` 的内核版本
- [ ] 现有 `CompactHeader` 版本显示测试仍通过，证明前端无需额外状态机改造
