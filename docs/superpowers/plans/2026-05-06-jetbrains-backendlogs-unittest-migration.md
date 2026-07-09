# JetBrains BackendLogs UnitTest Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将不依赖 IntelliJ sandbox 的 JetBrains `BackendLogs*` 轻量测试迁移到 `unitTest`，绕开 `TestIdeTask` 已知性能/卡顿问题。

**Architecture:** 保持生产代码不变，只迁移测试文件位置，并沿用现有 `unitTest` + `friendPaths` 机制访问 `main` 中的 `internal` 类。文档中凡是单独验证这两个测试的命令改为 `unitTest`，混合命令则拆分为轻量与重型两条。

**Tech Stack:** Kotlin、JUnit 5、Swing、Gradle

---

### Task 1: 先验证现有 `test` 路径是重型入口

**Files:**

- Verify: `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/BackendLogsVisibilityControllerTest.kt`
- Verify: `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/BackendLogsErrorViewTest.kt`

- [ ] **Step 1: 确认测试只依赖 Swing 与本地类**

检查点：

```text
- 仅使用 JPanel/JLabel/BorderLayout 等 Swing 类型
- 不访问 ApplicationManager、ToolWindow、JBCef、Alarm
- 不依赖真实 IDE sandbox
```

- [ ] **Step 2: 记录迁移目标**

目标文件：

```text
hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/BackendLogsVisibilityControllerTest.kt
hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/BackendLogsErrorViewTest.kt
```

### Task 2: 迁移测试文件到 `unitTest`

**Files:**

- Move: `hosts/jetbrains-plugin/src/test/kotlin/paviko/opencode/ui/BackendLogsVisibilityControllerTest.kt`
- Move: `hosts/jetbrains-plugin/src/test/kotlin/paviko/opencode/ui/BackendLogsErrorViewTest.kt`

- [ ] **Step 1: 移动两个测试文件**

要求：

```text
- 包名保持 paviko.opencode.ui
- 测试内容不改语义
- 不新增 production test hook
```

- [ ] **Step 2: 运行迁移后的轻量测试**

Run: `gradlew.bat unitTest --tests "paviko.opencode.ui.BackendLogsVisibilityControllerTest" --tests "paviko.opencode.ui.BackendLogsErrorViewTest"`

Expected: PASS

### Task 3: 更新文档中的命令与路径引用

**Files:**

- Modify: `docs/superpowers/plans/2026-04-29-jetbrains-backend-logs-lazy-reveal.md`

- [ ] **Step 1: 将单独验证 BackendLogs 的命令改为 unitTest**

示例：

```text
./gradlew unitTest --tests "paviko.opencode.ui.BackendLogsVisibilityControllerTest" --tests "paviko.opencode.ui.BackendLogsErrorViewTest"
```

- [ ] **Step 2: 若命令混合了 IdeBridge 轻量测试，也统一放进 unitTest**

示例：

```text
./gradlew unitTest --tests "paviko.opencode.ui.BackendLogsVisibilityControllerTest" --tests "paviko.opencode.ui.BackendLogsErrorViewTest" --tests "paviko.opencode.ui.IdeBridgeStorageScopeTest" --tests "paviko.opencode.ui.IdeBridgeRestartHostTest"
```

### Task 4: 最终验证

**Files:**

- Verify: `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/BackendLogsVisibilityControllerTest.kt`
- Verify: `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/BackendLogsErrorViewTest.kt`

- [ ] **Step 1: 运行最终命令**

Run: `gradlew.bat unitTest --tests "paviko.opencode.ui.BackendLogsVisibilityControllerTest" --tests "paviko.opencode.ui.BackendLogsErrorViewTest" --tests "paviko.opencode.ui.IdeBridgeStorageScopeTest" --tests "paviko.opencode.ui.IdeBridgeRestartHostTest"`

Expected: BUILD SUCCESSFUL
