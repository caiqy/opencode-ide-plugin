# JetBrains Plugin ID Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 JetBrains 插件技术 ID 从 `qtkj.opencode-ui` 对齐为 `caiqy.opencode-ui`，并同步更新运行时代码与维护文档。

**Architecture:** 先在 JetBrains Kotlin 侧引入一个单一真相源常量 `JETBRAINS_PLUGIN_ID`，让运行时代码不再写死旧字符串；再把 `plugin.xml` 的 `<id>` 改成同一个值，并用单元测试校验 Kotlin 常量与 XML 元数据一致。最后补充维护文档，明确 `qtkj.opencode-ui` 只剩历史迁移语义，不应再回流到运行时代码或 Marketplace 更新查询。

**Tech Stack:** Kotlin 1.9、IntelliJ Platform、JUnit 5、Gradle、XML、Markdown

---

## File Structure

- `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/PluginIdentity.kt`
  - 新增 JetBrains 插件技术 ID 的 Kotlin 单一真相源。
- `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/PluginIdentityTest.kt`
  - 新增围绕插件 ID 常量与 `plugin.xml` 对齐关系的回归测试。
- `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/update/PluginUpdateService.kt`
  - 改为复用共享 `JETBRAINS_PLUGIN_ID`，避免继续写死旧 ID。
- `hosts/jetbrains-plugin/src/main/resources/META-INF/plugin.xml`
  - 将 JetBrains 插件主技术 ID 改为 `caiqy.opencode-ui`。
- `docs/repowiki/07-host-plugins.md`
  - 记录 JetBrains 当前技术 ID 已对齐到 VSCode Unique Identifier，并保留旧 ID 的迁移提示。

### Task 1: 在 JetBrains Kotlin 运行时中集中定义插件 ID

**Files:**

- Create: `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/PluginIdentity.kt`
- Create: `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/PluginIdentityTest.kt`
- Modify: `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/update/PluginUpdateService.kt`

- [ ] **Step 1: 先写失败测试，锁定新的 JetBrains 插件 ID 常量**

在 `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/PluginIdentityTest.kt` 新建下面这个测试文件：

```kotlin
package paviko.opencode

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class PluginIdentityTest {
    @Test
    fun `JetBrains plugin id matches the VSCode unique identifier`() {
        assertEquals("caiqy.opencode-ui", JETBRAINS_PLUGIN_ID)
    }
}
```

- [ ] **Step 2: 运行测试，确认它先失败**

Run（在 `hosts/jetbrains-plugin` 目录）:

```bash
gradlew.bat unitTest --tests "paviko.opencode.PluginIdentityTest"
```

Expected: FAIL，报错包含 `Unresolved reference 'JETBRAINS_PLUGIN_ID'`，证明测试先锁定了缺失的共享常量。

- [ ] **Step 3: 写最小实现，引入共享常量并让更新服务复用它**

新建 `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/PluginIdentity.kt`：

```kotlin
package paviko.opencode

internal const val JETBRAINS_PLUGIN_ID = "caiqy.opencode-ui"
```

把 `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/update/PluginUpdateService.kt` 的文件头改成下面这样：

```kotlin
package paviko.opencode.update

import com.intellij.ide.plugins.PluginManagerCore
import com.intellij.ide.plugins.marketplace.MarketplaceRequests
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.extensions.PluginId
import com.intellij.openapi.updateSettings.impl.PluginDownloader
import com.intellij.util.text.VersionComparatorUtil
import paviko.opencode.JETBRAINS_PLUGIN_ID
import java.lang.reflect.InvocationTargetException
import java.util.Properties

private val pluginId = PluginId.getId(JETBRAINS_PLUGIN_ID)
```

除了新增 `import paviko.opencode.JETBRAINS_PLUGIN_ID` 和最后这行 `PluginId.getId(JETBRAINS_PLUGIN_ID)`，其余逻辑不要改。

- [ ] **Step 4: 运行测试，确认新常量与更新服务编译通过**

Run（在 `hosts/jetbrains-plugin` 目录）:

```bash
gradlew.bat unitTest --tests "paviko.opencode.PluginIdentityTest" --tests "paviko.opencode.update.PluginUpdateServiceTest"
```

Expected: PASS，`PluginIdentityTest` 通过，`PluginUpdateServiceTest` 继续通过，说明运行时路径已经改为复用共享常量且未破坏更新服务行为。

- [ ] **Step 5: 提交这一小步**

```bash
git add hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/PluginIdentity.kt hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/update/PluginUpdateService.kt hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/PluginIdentityTest.kt
git commit -m "refactor(jetbrains): centralize plugin id"
```

### Task 2: 让 `plugin.xml` 与共享插件 ID 对齐

**Files:**

- Modify: `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/PluginIdentityTest.kt`
- Modify: `hosts/jetbrains-plugin/src/main/resources/META-INF/plugin.xml`

- [ ] **Step 1: 扩展失败测试，要求 `plugin.xml` 也使用同一个 ID**

把 `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/PluginIdentityTest.kt` 改成下面这个完整版本：

```kotlin
package paviko.opencode

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import javax.xml.parsers.DocumentBuilderFactory

class PluginIdentityTest {
    @Test
    fun `JetBrains plugin id matches the VSCode unique identifier`() {
        assertEquals("caiqy.opencode-ui", JETBRAINS_PLUGIN_ID)
    }

    @Test
    fun `plugin xml uses the shared JetBrains plugin id`() {
        val stream = checkNotNull(javaClass.getResourceAsStream("/META-INF/plugin.xml")) {
            "plugin.xml resource missing"
        }
        val document = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(stream)
        val pluginId = document.getElementsByTagName("id").item(0).textContent.trim()

        assertEquals(JETBRAINS_PLUGIN_ID, pluginId)
    }
}
```

- [ ] **Step 2: 运行测试，确认它因 `plugin.xml` 里的旧 ID 而失败**

Run（在 `hosts/jetbrains-plugin` 目录）:

```bash
gradlew.bat unitTest --tests "paviko.opencode.PluginIdentityTest"
```

Expected: FAIL，断言消息包含 `expected: <caiqy.opencode-ui> but was: <qtkj.opencode-ui>`，证明 source plugin metadata 仍是旧值。

- [ ] **Step 3: 修改 `plugin.xml` 中的 JetBrains 插件主身份**

把 `hosts/jetbrains-plugin/src/main/resources/META-INF/plugin.xml` 的开头改成下面这样：

```xml
<idea-plugin>
  <vendor>qtkj</vendor>
  <id>caiqy.opencode-ui</id>
  <name>OpenCode UI (unofficial)</name>
  <description>Run a local OpenCode backend inside JetBrains IDEs with a chat-based AI coding interface.</description>

  <depends>com.intellij.modules.platform</depends>
  <depends>org.jetbrains.plugins.terminal</depends>
```

这一小步只改 `<id>`，不要顺手改 `<vendor>`、`<name>` 或其他元数据。

- [ ] **Step 4: 重新运行单测，确认 Kotlin 常量与 XML 元数据现在一致**

Run（在 `hosts/jetbrains-plugin` 目录）:

```bash
gradlew.bat unitTest --tests "paviko.opencode.PluginIdentityTest"
```

Expected: PASS，两个测试都通过。

- [ ] **Step 5: 打包 JetBrains 插件，确认新 ID 没有破坏插件元数据产物**

Run（在 `hosts/jetbrains-plugin` 目录）:

```bash
gradlew.bat buildPlugin
```

Expected: `BUILD SUCCESSFUL`，说明新的 `<id>` 可以正常参与 JetBrains 插件打包。

- [ ] **Step 6: 提交这一小步**

```bash
git add hosts/jetbrains-plugin/src/main/resources/META-INF/plugin.xml hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/PluginIdentityTest.kt
git commit -m "fix(jetbrains): align plugin xml id"
```

### Task 3: 补充维护文档并完成静态回归验证

**Files:**

- Modify: `docs/repowiki/07-host-plugins.md`

- [ ] **Step 1: 在宿主维护文档中记录新旧插件 ID 的边界**

把 `docs/repowiki/07-host-plugins.md` 的 `Marketplace 规则` 与 `维护注意点` 补成下面这些内容：

```md
Marketplace 规则：

- VSCode 只发 Visual Studio Marketplace，不发 Open VSX。
- VSCode 继续发布 5 个平台定向包，不引入通用 fallback 包。
- VSCode 对外 Unique Identifier 为 `caiqy.opencode-ui`（`publisher/name`）。
- JetBrains 当前技术插件 ID 也使用 `caiqy.opencode-ui`；旧 `qtkj.opencode-ui` 只作为历史迁移标识保留，不应再出现在运行时代码或更新查询中。
- JetBrains Marketplace 额外发布一个组合包：先从既有平台插件产物中提取 backend binary，再重新构建并签名一个 Marketplace 专用插件包。
- JetBrains Marketplace build/sign/publish 的 Gradle 命令都必须注入 `-Pdistribution.channel="marketplace"`，并保留产物内 `distribution.channel=marketplace` 元数据校验。
- 当前 JetBrains Marketplace 组合包只包含 3 个 binary：Windows x64、macOS ARM64、Linux x64。
- 任一 Marketplace job 失败时，整个 Release workflow 应失败；但 GitHub Release 可能已先创建，这是允许的流程结果，不做自动回滚。
```

以及：

```md
## 维护注意点

- WebGUI 新增宿主能力时，必须明确 VSCode 和 JetBrains 是否都支持。
- `getUpdateInfo` / `checkForUpdates` / `installUpdate` 现已由 VSCode 与 JetBrains 共同支持，但 JetBrains 只对 Marketplace 安装版开放站内更新。
- 不要删除 VSCode 的 SW/CSP/Remote 兼容代码；这些看似“包装细节”，实际是插件可用性的关键。
- 调整 JetBrains backend 启动 UI 时，不要把“日志面板懒显示”改回默认常驻，也不要移除监听地址解析所需的日志采集链路。
- JetBrains 站内更新只对 Marketplace 包生效；调整构建链路时不要移除 `distribution.channel=marketplace` 注入。
- 调整 JetBrains 发布或更新逻辑时，不要把运行时 plugin ID 改回 `qtkj.opencode-ui`；若需提及旧 ID，只能放在迁移说明中。
- 修改发布流程时，要同时检查共享内容真源、release workflow 职责边界，以及 VSCode / JetBrains Marketplace 是否仍消费已有 artifact。
```

按现有文档顺序直接插入/替换对应 bullet，不要额外改写无关章节。

- [ ] **Step 2: 静态搜索，确认旧 ID 已从 JetBrains 运行时源码里移除**

Run（在仓库根目录）:

```bash
rg -n "qtkj\.opencode-ui" hosts/jetbrains-plugin/src
```

Expected: 无输出，说明旧 ID 已不再出现在 JetBrains 运行时源码与资源中。

- [ ] **Step 3: 静态搜索，确认新 ID 已覆盖 JetBrains 主运行时路径**

Run（在仓库根目录）:

```bash
rg -n "caiqy\.opencode-ui" hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/PluginIdentity.kt hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/update/PluginUpdateService.kt hosts/jetbrains-plugin/src/main/resources/META-INF/plugin.xml
```

Expected: 这 3 个文件都有匹配，分别对应共享常量、更新服务和 `plugin.xml` 主技术 ID。

- [ ] **Step 4: 提交文档与验证收尾**

```bash
git add docs/repowiki/07-host-plugins.md
git commit -m "docs(jetbrains): record plugin id alignment"
```

## Self-Review Checklist

- 规格里的 4 个核心要求都已覆盖：改 JetBrains 技术 ID、同步更新查询、保留最小范围、记录迁移约束。
- 计划没有保留占位词或“之后再补”的延后实现提示。
- 所有后续步骤都统一使用同一个标识：`caiqy.opencode-ui`。
- 旧 `qtkj.opencode-ui` 只在测试失败预期和文档迁移说明中被引用，不再出现在 JetBrains 运行时代码目标状态中。
