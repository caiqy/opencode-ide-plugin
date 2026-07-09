# JetBrains 空 Marketplace 更新结果处理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 JetBrains 插件在 Marketplace 查询明确返回空结果时显示“已是最新版”，同时保持网络、SSL、超时和真实元数据损坏仍然走失败路径。

**Architecture:** 只修正 JetBrains 更新服务对 Marketplace 空结果的语义解释，不改 WebGUI 状态机、不改 bridge 协议、不改 timeout。核心实现是在 `PluginUpdateService` 的 strict fallback 中，把“候选更新列表为空”与“descriptor 为空”统一收敛为 `MarketplaceLookup.NoUpdate`，然后继续复用现有 `checkForUpdates()` 将 `null` latest 映射成 `UpToDate` 的路径。

**Tech Stack:** Kotlin 1.9、IntelliJ Platform API、JUnit 5、Gradle

---

## File Structure

- `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/update/PluginUpdateService.kt`
  - 修改 Marketplace strict fallback 逻辑，把“descriptor 为空”从异常降级为 `MarketplaceLookup.NoUpdate`。
- `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/update/PluginUpdateServiceTest.kt`
  - 新增空结果回归测试，并保留版本字段缺失、网络异常仍报错的边界测试。
- `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/IdeBridgeUpdateTest.kt`
  - 可选增加 bridge roundtrip 测试，锁定 `checkForUpdates` 在无更新时返回 `status = "up-to-date"`。

### Task 1: 用 JetBrains 单测锁定“空结果算最新版”的边界

**Files:**

- Modify: `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/update/PluginUpdateServiceTest.kt`
- Test: `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/update/PluginUpdateServiceTest.kt`

- [ ] **Step 1: 先写失败测试，覆盖 descriptor 为空时不应报错**

在 `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/update/PluginUpdateServiceTest.kt` 的 `checkForUpdates fails when marketplace metadata lookup itself fails` 测试后面插入下面这个测试：

```kotlin
    @Test
    fun `checkForUpdates treats missing marketplace descriptor as up to date`() {
        val service = PluginUpdateService(
            versionSource = PluginVersionSource { "26.5.700" },
            distributionChannelProvider = { "marketplace" },
            latestProvider = null,
            marketplaceLookup = { MarketplaceLookup.NoUpdate },
            backgroundRunner = { task -> task() },
        )

        assertEquals(
            CheckForUpdatesResult.UpToDate(currentVersion = "26.5.700"),
            service.checkForUpdates(),
        )
    }
```

紧接着再补一个更贴近当前缺陷语义的测试，先为 `PluginUpdateService.kt` 预留一个新的可测试 helper（下一步实现），这里先按将要引入的 helper 写红灯测试：

```kotlin
    @Test
    fun `strict fallback returns no update when descriptor is missing`() {
        val result = loadMarketplaceDescriptorResult(
            descriptorLoader = { _, _, _ -> null },
            descriptorKey = "candidate",
        )

        assertEquals(MarketplaceLookup.NoUpdate, result)
    }
```

- [ ] **Step 2: 运行 JetBrains update service 单测，确认新测试先失败**

Run（在 `hosts/jetbrains-plugin` 目录）:

```bash
./gradlew.bat unitTest --tests "paviko.opencode.update.PluginUpdateServiceTest"
```

Expected: FAIL，并出现下面两类失败之一：

- `Unresolved reference: loadMarketplaceDescriptorResult`
- 或当前实现仍抛 `Marketplace update metadata missing`

这一步的目的不是让测试绿，而是确认我们真的锁住了“descriptor 为空不该报错”的缺陷。

- [ ] **Step 3: 保留现有边界测试，不要改掉真实异常仍报错的断言**

确认这两个现有测试保持原样，不要在实现时弱化它们：

```kotlin
    @Test
    fun `checkForUpdates propagates marketplace query failures`() {
        val service = PluginUpdateService(
            versionSource = PluginVersionSource { "26.5.501" },
            distributionChannelProvider = { "marketplace" },
            latestProvider = null,
            marketplaceLookup = {
                throw IllegalStateException("marketplace unavailable")
            },
            backgroundRunner = { task -> task() },
        )

        val error = assertThrows(IllegalStateException::class.java) {
            service.checkForUpdates()
        }

        assertEquals("marketplace unavailable", error.message)
    }
```

```kotlin
    @Test
    fun `checkForUpdates fails when marketplace update model is missing`() {
        val service = PluginUpdateService(
            versionSource = PluginVersionSource { "26.5.501" },
            distributionChannelProvider = { "marketplace" },
            latestProvider = null,
            marketplaceLookup = {
                MarketplaceLookup.Available(Any())
            },
            updateVersionProvider = { null },
            backgroundRunner = { task -> task() },
        )

        val error = assertThrows(IllegalStateException::class.java) {
            service.checkForUpdates()
        }

        assertEquals("Marketplace update version missing", error.message)
    }
```

- [ ] **Step 4: 提交测试红灯准备（只在本地，不 commit）**

这一小步只做工作区确认，不提交：

Run（在仓库根目录）:

```bash
git diff -- hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/update/PluginUpdateServiceTest.kt
```

Expected: 只看到新增测试，没有对已有异常边界测试做语义性改动。

### Task 2: 修正 `PluginUpdateService` 的 strict fallback 语义

**Files:**

- Modify: `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/update/PluginUpdateService.kt`
- Test: `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/update/PluginUpdateServiceTest.kt`

- [ ] **Step 1: 抽出 descriptor 结果归类 helper，先让测试有实现目标**

在 `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/update/PluginUpdateService.kt` 中、`unwrapReflectionFailure(...)` 之后插入下面这个 helper：

```kotlin
internal fun loadMarketplaceDescriptorResult(
    descriptorLoader: (String, Any, Nothing?) -> Any?,
    descriptorKey: Any,
): MarketplaceLookup {
    val model = descriptorLoader(pluginId.idString, descriptorKey, null)
    return if (model == null) {
        MarketplaceLookup.NoUpdate
    } else {
        MarketplaceLookup.Available(model)
    }
}
```

这个 helper 的职责非常单一：

- descriptor 为 `null` -> `NoUpdate`
- descriptor 非 `null` -> `Available`

不要在这里混入网络异常处理；异常继续由调用方抛出。

- [ ] **Step 2: 用新 helper 改写 strict fallback 的 descriptor 分支**

把 `loadMarketplaceUpdateStrict(requests)` 里现有这段代码：

```kotlin
    val model = runCatching {
        descriptor.invoke(requests, pluginId.idString, first, null)
    }.getOrElse(::unwrapReflectionFailure) ?: throw IllegalStateException("Marketplace update metadata missing")

    return MarketplaceLookup.Available(model)
```

替换成：

```kotlin
    return runCatching {
        loadMarketplaceDescriptorResult(
            descriptorLoader = { id, update, extra ->
                descriptor.invoke(requests, id, update, extra)
            },
            descriptorKey = first,
        )
    }.getOrElse(::unwrapReflectionFailure)
```

这样修改后，行为边界会变成：

- `descriptor.invoke(...)` 抛异常 -> 继续向上抛
- `descriptor.invoke(...)` 返回 `null` -> `NoUpdate`
- `descriptor.invoke(...)` 返回对象 -> `Available`

- [ ] **Step 3: 重跑 update service 单测，确认空结果转为最新版，异常边界不回归**

Run（在 `hosts/jetbrains-plugin` 目录）:

```bash
./gradlew.bat unitTest --tests "paviko.opencode.update.PluginUpdateServiceTest"
```

Expected: PASS，至少包含下面这些断言同时成立：

- `marketplace build with no update reports supported but empty state`
- `checkForUpdates treats missing marketplace descriptor as up to date`
- `checkForUpdates propagates marketplace query failures`
- `checkForUpdates fails when marketplace update model is missing`

- [ ] **Step 4: 如有需要补 bridge roundtrip 测试，锁定最终返回状态**

如果你在 review 时希望 bridge 层也有直接保护，在 `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/IdeBridgeUpdateTest.kt` 的 `checkForUpdates returns structured available result` 后面增加：

```kotlin
    @Test
    fun `checkForUpdates returns structured up to date result`() {
        val session = IdeBridge.createSession(
            project = project(),
            versionSource = PluginVersionSource { "26.5.700" },
            updateServiceFactory = { source ->
                PluginUpdateService(
                    versionSource = source,
                    distributionChannelProvider = { "marketplace" },
                    latestProvider = null,
                    marketplaceLookup = { MarketplaceLookup.NoUpdate },
                    backgroundRunner = { task -> task() },
                )
            },
        )

        sse(session).use { events ->
            val reply = events.send("checkForUpdates", JsonObject())
            val result = reply.getAsJsonObject("result")

            assertEquals(true, reply.get("ok")?.asBoolean)
            assertNotNull(result)
            assertEquals("up-to-date", result.get("status")?.asString)
            assertEquals("26.5.700", result.get("currentVersion")?.asString)
        }
    }
```

- [ ] **Step 5: 运行 bridge 单测（如果加了上一步）**

Run（在 `hosts/jetbrains-plugin` 目录）:

```bash
./gradlew.bat unitTest --tests "paviko.opencode.ui.IdeBridgeUpdateTest"
```

Expected: PASS，新增 `up-to-date` 测试通过，已有 `available` / `installUpdate` 测试不回归。

- [ ] **Step 6: 做最小回归验证，确认前端现有语义无需改动**

Run（在 `packages/opencode/webgui` 目录）:

```bash
bun run test:run src/state/UpdateContext.test.tsx
```

Expected: PASS，尤其要保留这两类测试：

- `手动检查更新发现已是最新版时提示 toast`
- `手动检查更新失败时会提示失败 toast`

这说明我们只需要修正 JetBrains 返回语义，前端无需改代码。

- [ ] **Step 7: 提交 Task 2**

```bash
git add hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/update/PluginUpdateService.kt hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/update/PluginUpdateServiceTest.kt hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/IdeBridgeUpdateTest.kt
git commit -m "fix(jetbrains): treat empty marketplace result as up to date"
```

## Plan Self-Review

- **Spec coverage:** 已覆盖 spec 的唯一核心需求：空 Marketplace 结果视为最新版，同时保留真实异常为失败；也覆盖了测试与 bridge 可选保护。
- **Placeholder scan:** 没有使用 TBD / TODO / “类似前一步” 之类占位描述；每个代码步骤都给了明确片段或命令。
- **Type consistency:** 计划中新增 helper 名称统一为 `loadMarketplaceDescriptorResult`，返回值统一为 `MarketplaceLookup`，没有在后续步骤中切换命名。

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-07-jetbrains-empty-marketplace-update-result.md`. Two execution options:

**1. Subagent-Driven (recommended)** - 我 dispatch 一个 fresh subagent per task，task 间做 review，迭代更快

**2. Inline Execution** - 我在当前会话直接按计划执行

你选哪种？
