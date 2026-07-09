# IdeBridge Stop SSE Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 JetBrains `IdeBridge.stop()` 未关闭 SSE 客户端导致测试结束后 JVM 仍残留的问题。

**Architecture:** 在 `IdeBridge` 内统一抽取 session SSE 客户端关闭逻辑，让 `removeSession()` 与 `stop()` 共享同一套资源回收路径；同时为 executor 增加短暂等待，确保停机后的后台线程更稳定地退出。

**Tech Stack:** Kotlin、JetBrains HttpServer、JUnit 5

---

### Task 1: 用失败测试锁定 stop 行为

**Files:**

- Modify: `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/IdeBridgeUpdateTest.kt`

- [ ] **Step 1: 添加 SSE 断开测试**

```kotlin
@Test
fun `stop closes server side sse clients`() {
    val session = IdeBridge.createSession(project = project())
    val events = sse(session)

    try {
        IdeBridge.stop()
        events.awaitDisconnected()
    } finally {
        events.close()
    }
}
```

- [ ] **Step 2: 运行单测确认先失败**

Run: `gradlew.bat unitTest --tests "paviko.opencode.ui.IdeBridgeUpdateTest.stop closes server side sse clients"`
Expected: FAIL，表现为 SSE reader 未在 `stop()` 后及时退出。

### Task 2: 修复 stop 资源回收

**Files:**

- Modify: `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt`

- [ ] **Step 1: 抽取 session 客户端关闭 helper**

```kotlin
private fun closeSessionClients(session: Session) {
    synchronized(session.sseClients) {
        session.sseClients.forEach {
            try { it.close() } catch (_: Throwable) {}
        }
        session.sseClients.clear()
    }
}
```

- [ ] **Step 2: 让 removeSession/stop 复用 helper**

```kotlin
fun removeSession(sessionId: String) {
    sessions.remove(sessionId)?.let { session ->
        projectToSession.remove(session.project)
        closeSessionClients(session)
    }
}

@Synchronized
fun stop() {
    keepaliveTimer?.cancel()
    keepaliveTimer = null
    sessions.keys.toList().forEach(::removeSession)
    server?.stop(0)
    server = null
    try {
        executor.shutdownNow()
        executor.awaitTermination(1, TimeUnit.SECONDS)
    } catch (_: Throwable) {}
}
```

- [ ] **Step 3: 运行目标测试确认通过**

Run: `gradlew.bat unitTest --tests "paviko.opencode.ui.IdeBridgeUpdateTest.stop closes server side sse clients"`
Expected: PASS

### Task 3: 回归验证相关 IdeBridge 测试

**Files:**

- Test: `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/IdeBridgeUpdateTest.kt`
- Test: `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/IdeBridgeRestartHostTest.kt`
- Test: `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/IdeBridgeStorageScopeTest.kt`

- [ ] **Step 1: 运行相关测试集合**

Run: `gradlew.bat unitTest --tests "paviko.opencode.ui.IdeBridgeUpdateTest" --tests "paviko.opencode.ui.IdeBridgeRestartHostTest" --tests "paviko.opencode.ui.IdeBridgeStorageScopeTest"`
Expected: BUILD SUCCESSFUL

- [ ] **Step 2: 人工确认无残留 java 进程**

检查任务管理器或 `jcmd` 输出，确认测试结束后不再出现因本轮 IdeBridge 测试残留的 JVM。

### Task 4: 将轻量 IdeBridge 测试迁出 TestIdeTask

**Files:**

- Modify: `hosts/jetbrains-plugin/build.gradle.kts`
- Create: `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/IdeBridgeUpdateTest.kt`
- Create: `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/IdeBridgeRestartHostTest.kt`
- Create: `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/IdeBridgeStorageScopeTest.kt`
- Delete: `hosts/jetbrains-plugin/src/test/kotlin/paviko/opencode/ui/IdeBridgeUpdateTest.kt`
- Delete: `hosts/jetbrains-plugin/src/test/kotlin/paviko/opencode/ui/IdeBridgeRestartHostTest.kt`
- Delete: `hosts/jetbrains-plugin/src/test/kotlin/paviko/opencode/ui/IdeBridgeStorageScopeTest.kt`

- [ ] **Step 1: 先验证现有 unitTest 路径不支持 `--tests`**

Run: `gradlew.bat unitTest --tests "paviko.opencode.ui.IdeBridgeUpdateTest"`
Expected: FAIL with `Unknown command-line option '--tests'`

- [ ] **Step 2: 将 unitTest 改为标准 JUnit Test 任务**

```kotlin
val unitTest = register<Test>("unitTest") {
    description = "Runs standalone JVM unit tests without IntelliJ sandbox"
    group = LifecycleBasePlugin.VERIFICATION_GROUP
    testClassesDirs = sourceSets["unitTest"].output.classesDirs
    classpath = sourceSets["unitTest"].runtimeClasspath
    useJUnitPlatform()
    systemProperty("java.awt.headless", "true")
    jvmArgs(
        "-Djava.awt.headless=true",
        "--add-opens=java.base/java.lang=ALL-UNNAMED",
        "--add-opens=java.base/java.util=ALL-UNNAMED",
    )
}

build {
    dependsOn(unitTest)
}
```

- [ ] **Step 3: 将 3 个 IdeBridge 测试迁到 `src/unitTest/kotlin/paviko/opencode/ui/`**

要求：

- 包名保持 `paviko.opencode.ui`
- 测试内容保持一致
- 继续使用 JUnit 5 + Mockito
- `StandaloneMessageTest.kt` 可保留，但不再作为 `unitTest` 主入口

- [ ] **Step 4: 运行迁移后的轻量测试**

Run: `gradlew.bat unitTest --tests "paviko.opencode.ui.IdeBridgeUpdateTest" --tests "paviko.opencode.ui.IdeBridgeRestartHostTest" --tests "paviko.opencode.ui.IdeBridgeStorageScopeTest"`
Expected: BUILD SUCCESSFUL
