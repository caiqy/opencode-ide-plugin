# JetBrains 轻量测试最小清理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除 JetBrains 轻量测试迁移后残留的重复旧测试文件，并把当前仍会误导维护者的入口说明修正到最新状态。

**Architecture:** 这轮只做最小清理：代码层仅删除已经被 `unitTest` 真入口替代的 `src/test` 重复文件；文档层只改会被当作“当前状态”阅读的说明，不改历史计划中的 `Move:` / `Delete:` 迁移动作记录。

**Tech Stack:** Kotlin 测试目录结构、Gradle `unitTest` 任务、Markdown 文档

---

### Task 1: 删除重复的旧测试文件

**Files:**

- Delete: `hosts/jetbrains-plugin/src/test/kotlin/paviko/opencode/ui/IdeBridgeUpdateTest.kt`
- Verify: `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/IdeBridgeUpdateTest.kt`

- [ ] **Step 1: 先验证重复文件确实存在**

Run（在仓库根目录，PowerShell）：

```powershell
Test-Path "hosts/jetbrains-plugin/src/test/kotlin/paviko/opencode/ui/IdeBridgeUpdateTest.kt"
```

Expected: `True`

- [ ] **Step 2: 确认当前真入口仍在 unitTest**

Run（在仓库根目录，PowerShell）：

```powershell
Test-Path "hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/IdeBridgeUpdateTest.kt"
```

Expected: `True`

- [ ] **Step 3: 删除旧测试文件**

执行删除后，目录状态应满足：

```text
src/test/kotlin/paviko/opencode/ui/ 下不再存在 IdeBridgeUpdateTest.kt
src/unitTest/kotlin/paviko/opencode/ui/ 下保留 IdeBridgeUpdateTest.kt
```

- [ ] **Step 4: 运行最小回归验证**

Run（在 `hosts/jetbrains-plugin` 目录）：

```powershell
.\gradlew.bat unitTest --tests "paviko.opencode.ui.IdeBridgeUpdateTest"
```

Expected: `BUILD SUCCESSFUL`

### Task 2: 修正文档里的当前入口说明

**Files:**

- Modify: `docs/superpowers/specs/2026-05-06-jetbrains-test-layering-design.md`
- Modify: `docs/repowiki/07-host-plugins.md`（仅当当前说明需要补一句“旧重复文件已清理”时才修改）

- [ ] **Step 1: 修正“当前测试现状”里的旧路径描述**

把 `docs/superpowers/specs/2026-05-06-jetbrains-test-layering-design.md` 中这段当前状态：

```md
- `hosts/jetbrains-plugin/src/test/kotlin/paviko/opencode/ui/IdeBridgeUpdateTest.kt`
```

改成“`src/test/kotlin` 已不再保留轻量 `IdeBridgeUpdateTest`，当前真入口位于 `src/unitTest/kotlin`”的表述，避免继续把它描述成现存入口。

- [ ] **Step 2: 明确保留历史迁移记录不改**

确认以下类型内容**不修改**：

```text
- docs/superpowers/plans/* 中的 Move:
- docs/superpowers/plans/* 中的 Delete:
- 纯历史实施记录中的旧路径
```

- [ ] **Step 3: 如有必要，在 repowiki 补一句当前收口状态**

如果 `docs/repowiki/07-host-plugins.md` 中需要一句更明确的当前状态说明，则补如下风格内容：

```md
- `src/test/kotlin` 仅保留真实 IntelliJ 集成测试；已迁移的轻量 JetBrains 测试不再保留重复旧文件。
```

- [ ] **Step 4: 回扫确保当前文档不再把旧文件当成现存入口**

Run（在仓库根目录）：

```powershell
Select-String -Path "docs/**/*.md" -Pattern "src/test/kotlin/paviko/opencode/ui/IdeBridgeUpdateTest.kt"
```

Expected: 只允许命中历史 `Delete:` / `Move:` 记录；不应再命中“当前现状”“当前入口”“当前文件列表”之类说明。

### Task 3: 最终组合验证

**Files:**

- Verify: `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/IdeBridgeUpdateTest.kt`
- Verify: `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/update/PluginUpdateServiceTest.kt`
- Verify: `docs/superpowers/specs/2026-05-06-jetbrains-test-layering-design.md`

- [ ] **Step 1: 运行组合 unitTest 验证**

Run（在 `hosts/jetbrains-plugin` 目录）：

```powershell
.\gradlew.bat unitTest --tests "paviko.opencode.ui.IdeBridgeUpdateTest" --tests "paviko.opencode.update.PluginUpdateServiceTest"
```

Expected: `BUILD SUCCESSFUL`

- [ ] **Step 2: 人工核对目录收口结果**

完成后应满足：

```text
1. src/test/kotlin 不再残留 IdeBridgeUpdateTest.kt
2. src/unitTest/kotlin 继续保留 IdeBridgeUpdateTest.kt
3. 当前状态文档不再把旧文件当成现存入口
4. 历史 Move/Delete 记录保持不变
```
