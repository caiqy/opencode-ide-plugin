# JetBrains Test Layering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 继续把明显轻量的 JetBrains 测试迁移到 `unitTest`，并把测试分层规则写入仓库长期文档。

**Architecture:** 保持生产代码不变，沿用现有 `unitTest` + `friendPaths` 机制，只迁移 `PluginUpdateServiceTest` 这类纯 JVM service 测试；同时在 `docs/repowiki/07-host-plugins.md` 写入“轻量测试走 unitTest / 重型测试走 test”的分层约定。

**Tech Stack:** Kotlin、JUnit 5、Gradle、Markdown

---

### Task 1: 用失败命令锁定下一批迁移目标

**Files:**

- Verify: `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/update/PluginUpdateServiceTest.kt`

- [ ] **Step 1: 运行 unitTest 过滤命令，确认当前先失败**

Run: `gradlew.bat unitTest --tests "paviko.opencode.update.PluginUpdateServiceTest"`

Expected: FAIL with `No tests found for given includes`

### Task 2: 迁移 PluginUpdateServiceTest 到 unitTest

**Files:**

- Move: `hosts/jetbrains-plugin/src/test/kotlin/paviko/opencode/update/PluginUpdateServiceTest.kt`
- Create: `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/update/PluginUpdateServiceTest.kt`

- [ ] **Step 1: 迁移测试文件位置**

要求：

```text
- 包名保持 paviko.opencode.update
- 测试内容不改语义
- 不新增 production test hook
```

- [ ] **Step 2: 运行迁移后的单测确认通过**

Run: `gradlew.bat unitTest --tests "paviko.opencode.update.PluginUpdateServiceTest"`

Expected: PASS

### Task 3: 写入仓库长期分层规则

**Files:**

- Modify: `docs/repowiki/07-host-plugins.md`

- [ ] **Step 1: 新增 JetBrains 测试分层约定小节**

内容至少包含：

```text
- unitTest：纯 JVM / Swing / Mockito / 注入型测试
- test：真实 IntelliJ sandbox / JCEF / ToolWindow / ApplicationManager 集成测试
- 目录约定
- 常用命令
```

### Task 4: 最终验证

**Files:**

- Verify: `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/update/PluginUpdateServiceTest.kt`
- Verify: `docs/repowiki/07-host-plugins.md`

- [ ] **Step 1: 运行组合验证命令**

Run: `gradlew.bat unitTest --tests "paviko.opencode.update.PluginUpdateServiceTest" --tests "paviko.opencode.ui.IdeBridgeUpdateTest" --tests "paviko.opencode.ui.BackendLogsVisibilityControllerTest"`

Expected: BUILD SUCCESSFUL
