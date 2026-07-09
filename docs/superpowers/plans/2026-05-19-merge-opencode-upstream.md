# Merge opencode Upstream Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `opencode/dev` 合并到 `chore/merge-upstream-20260519`，对可安全判断的冲突直接做上下游兼容合并，对无法安全判断的语义冲突整理选项交由维护者决定。

**Architecture:** 本次不是新功能开发，而是一次顺序化的上游集成。先固定 merge 基线并让 Git 暴露真实冲突面，再按四个热点区域逐层处理：核心 opencode/server/tool、WebGUI、VSCode 插件、JetBrains 插件。每个区域都遵守同一原则：优先保留上游结构，把本 fork 的 IDE/WebGUI 适配挂回新结构；只有在语义互斥且无证据可判断时才暂停并请求维护者选择。

**Tech Stack:** Git、PowerShell、Bun、Vitest、pnpm、Gradle、TypeScript、Kotlin。

---

## File Structure

- Inspect / Potentially modify after merge conflict:
  - `packages/opencode/src/project/project.ts`
  - `packages/opencode/src/server/routes/instance/generated-image.ts`
  - `packages/opencode/src/server/routes/instance/httpapi/session.ts`
  - `packages/opencode/src/session/llm.ts`
  - `packages/opencode/src/session/prompt.ts`
  - `packages/opencode/src/session/retry.ts`
  - `packages/opencode/src/tool/generate-image.ts`
  - `packages/opencode/src/tool/read.ts`
  - `packages/opencode/src/tool/registry.ts`
  - `packages/opencode/src/webgui/server/app.ts`

- Inspect / Potentially modify after merge conflict:
  - `packages/opencode/webgui/src/App.tsx`
  - `packages/opencode/webgui/src/components/CompactHeader/index.tsx`
  - `packages/opencode/webgui/src/components/MarkdownRenderer.tsx`
  - `packages/opencode/webgui/src/components/parts/ImageOverlay.tsx`
  - `packages/opencode/webgui/src/components/parts/ToolPart/index.tsx`
  - `packages/opencode/webgui/src/lib/ideBridge.ts`
  - `packages/opencode/webgui/src/state/MessagesContext.tsx`
  - `packages/opencode/webgui/src/state/ProjectContext.tsx`
  - `packages/opencode/webgui/src/state/scopedStorage.ts`
  - `packages/opencode/webgui/vite.config.ts`

- Inspect / Potentially modify after merge conflict:
  - `hosts/vscode-plugin/src/backend/BackendLauncher.ts`
  - `hosts/vscode-plugin/src/extension.ts`
  - `hosts/vscode-plugin/src/ui/IdeBridgeServer.ts`
  - `hosts/vscode-plugin/src/ui/WebviewController.ts`
  - `hosts/vscode-plugin/src/utils/extensionIdentity.ts`

- Inspect / Potentially modify after merge conflict:
  - `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/PluginIdentity.kt`
  - `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/ChatToolWindowFactory.kt`
  - `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt`
  - `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/update/MarketplaceVersionSource.kt`
  - `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/update/PluginUpdateService.kt`

- Inspect / Potentially update matching tests if conflict resolution changes observable behavior:
  - `packages/opencode/test/tool/generate-image.test.ts`
  - `packages/opencode/test/server/generated-image-route.test.ts`
  - `packages/opencode/test/project/project.test.ts`
  - `packages/opencode/test/session/retry.test.ts`
  - `packages/opencode/webgui/src/components/parts/ImageOverlay.test.tsx`
  - `packages/opencode/webgui/src/components/parts/ToolPart/index.test.tsx`
  - `packages/opencode/webgui/src/components/MarkdownRenderer.test.tsx`
  - `packages/opencode/webgui/src/state/MessagesContext.pagination.test.tsx`
  - `hosts/vscode-plugin/src/test/suite/backendLauncher.test.ts`
  - `hosts/vscode-plugin/src/test/suite/ideBridgeServer.test.ts`
  - `hosts/vscode-plugin/src/test/suite/webviewController.test.ts`
  - `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/IdeBridgeUpdateTest.kt`
  - `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/update/PluginUpdateServiceTest.kt`
  - `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/PluginIdentityTest.kt`

实际需要修改的最终文件，以 merge 后 `git diff --name-only --diff-filter=U` 输出为准；上述列表是本次基于交集分析得到的高风险热点。

---

### Task 1: 固定基线并执行 merge

**Files:**

- Inspect: `docs/superpowers/specs/2026-05-19-merge-opencode-upstream-design.md`
- Inspect: `docs/upstream-sync-checklist.md`
- Inspect: `packages/opencode/src/tool/generate-image.ts`
- Inspect: `packages/opencode/webgui/src/state/MessagesContext.tsx`
- Inspect: `hosts/vscode-plugin/src/ui/IdeBridgeServer.ts`
- Inspect: `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt`

- [ ] **Step 1: 确认工作树只有计划/设计文档未提交变更**

Run:

```powershell
git status --short
```

Expected: 只看到本次设计/计划文档等可预期未跟踪文件；不能有意外业务改动混入本次 merge。

- [ ] **Step 2: 抓取上游并记录 ahead/behind 基线**

Run:

```powershell
git fetch opencode
git rev-list --left-right --count HEAD...opencode/dev
git merge-base HEAD opencode/dev
```

Expected: 成功更新 `opencode/dev`，输出当前分支与上游的左右提交数，以及共同基线 SHA。

- [ ] **Step 3: 记录上游差异热点，供冲突时快速定位**

Run:

```powershell
git diff --name-only HEAD..opencode/dev
$base = git merge-base HEAD opencode/dev; $ours = git diff --name-only "$base..HEAD"; $theirs = git diff --name-only "HEAD..opencode/dev"; $oursSet = @{}; foreach ($f in $ours) { if ($f) { $oursSet[$f] = $true } }; foreach ($f in $theirs) { if ($f -and $oursSet.ContainsKey($f)) { $f } } | Sort-Object -Unique
```

Expected: 第一条命令显示上游变更文件列表；第二条命令显示“本地与上游都改过”的交集文件，作为优先冲突面。

- [ ] **Step 4: 执行普通 merge，让 Git 暴露真实冲突**

Run:

```powershell
git merge --no-ff opencode/dev
```

Expected:

- 如果无冲突：Git 输出 merge 成功信息，进入 Task 5 验证。
- 如果有冲突：Git 输出 `CONFLICT`，工作树进入未完成 merge 状态，继续 Step 5。

- [ ] **Step 5: 列出真实冲突文件清单**

仅在 Step 4 出现冲突时运行：

```powershell
git diff --name-only --diff-filter=U
```

Expected: 输出本次真实冲突文件列表；后续任务只处理这份清单中的文件，不对无冲突文件做无关修改。

---

### Task 2: 处理 opencode core / server / tool 冲突

**Files:**

- Modify if conflicted: `packages/opencode/src/project/project.ts`
- Modify if conflicted: `packages/opencode/src/server/routes/instance/generated-image.ts`
- Modify if conflicted: `packages/opencode/src/server/routes/instance/httpapi/session.ts`
- Modify if conflicted: `packages/opencode/src/session/llm.ts`
- Modify if conflicted: `packages/opencode/src/session/prompt.ts`
- Modify if conflicted: `packages/opencode/src/session/retry.ts`
- Modify if conflicted: `packages/opencode/src/tool/generate-image.ts`
- Modify if conflicted: `packages/opencode/src/tool/read.ts`
- Modify if conflicted: `packages/opencode/src/tool/registry.ts`
- Modify if conflicted: `packages/opencode/src/webgui/server/app.ts`
- Test: `packages/opencode/test/tool/generate-image.test.ts`
- Test: `packages/opencode/test/server/generated-image-route.test.ts`
- Test: `packages/opencode/test/project/project.test.ts`
- Test: `packages/opencode/test/session/retry.test.ts`

- [ ] **Step 1: 优先处理本 fork 有明确契约证据的核心冲突**

按以下顺序打开冲突文件并清理 conflict markers：

1. `packages/opencode/src/tool/generate-image.ts`
2. `packages/opencode/src/server/routes/instance/generated-image.ts`
3. `packages/opencode/src/project/project.ts`
4. `packages/opencode/src/session/retry.ts`

保留规则：

- 上游若拆分了模块、提取了 helper 或调整了参数结构，优先保留上游结构。
- 本 fork 的 generated-image 落盘、项目内路由限制、non-git project identity、`stream_timeout` 自动重试等本地契约必须重新挂回上游结构。
- 不保留纯旧结构的重复实现；把本地逻辑迁移到上游新入口。

Expected: 以上文件不再包含 `<<<<<<<` / `=======` / `>>>>>>>`。

- [ ] **Step 2: 处理剩余 core/server/tool 冲突文件**

如果以下文件也在冲突清单中，继续清理：

- `packages/opencode/src/server/routes/instance/httpapi/session.ts`
- `packages/opencode/src/session/llm.ts`
- `packages/opencode/src/session/prompt.ts`
- `packages/opencode/src/tool/read.ts`
- `packages/opencode/src/tool/registry.ts`
- `packages/opencode/src/webgui/server/app.ts`

保留规则：

- 优先接受上游通用协议、schema、事件流、路由组织变化。
- 只把本 fork 依赖的本地扩展点重新接到新结构上。
- 若同一行为出现互斥语义，先保留冲突现场备注，不要猜测式删除任一侧语义。

Expected: core/server/tool 区域冲突全部清理完成。

- [ ] **Step 3: 检查核心区域是否仍有未解决冲突**

Run:

```powershell
git diff --name-only --diff-filter=U -- "packages/opencode/src" "packages/opencode/test"
```

Expected: 无输出；如果仍有输出，继续回到 Step 1/2。

- [ ] **Step 4: 运行最小 core 回归**

Run from `packages/opencode`:

```powershell
bun test test/tool/generate-image.test.ts test/server/generated-image-route.test.ts test/project/project.test.ts test/session/retry.test.ts --timeout 30000
```

Expected: PASS。若失败，优先修正刚处理过的冲突文件，不扩散到无关模块。

---

### Task 3: 处理 WebGUI 冲突

**Files:**

- Modify if conflicted: `packages/opencode/webgui/src/App.tsx`
- Modify if conflicted: `packages/opencode/webgui/src/components/CompactHeader/index.tsx`
- Modify if conflicted: `packages/opencode/webgui/src/components/MarkdownRenderer.tsx`
- Modify if conflicted: `packages/opencode/webgui/src/components/parts/ImageOverlay.tsx`
- Modify if conflicted: `packages/opencode/webgui/src/components/parts/ToolPart/index.tsx`
- Modify if conflicted: `packages/opencode/webgui/src/lib/ideBridge.ts`
- Modify if conflicted: `packages/opencode/webgui/src/state/MessagesContext.tsx`
- Modify if conflicted: `packages/opencode/webgui/src/state/ProjectContext.tsx`
- Modify if conflicted: `packages/opencode/webgui/src/state/scopedStorage.ts`
- Modify if conflicted: `packages/opencode/webgui/vite.config.ts`
- Test: `packages/opencode/webgui/src/components/MarkdownRenderer.test.tsx`
- Test: `packages/opencode/webgui/src/components/parts/ImageOverlay.test.tsx`
- Test: `packages/opencode/webgui/src/components/parts/ToolPart/index.test.tsx`
- Test: `packages/opencode/webgui/src/state/MessagesContext.pagination.test.tsx`

- [ ] **Step 1: 先保住本 fork 的高价值 UI 契约**

如果这些文件在冲突清单中，优先处理：

1. `packages/opencode/webgui/src/lib/ideBridge.ts`
2. `packages/opencode/webgui/src/components/MarkdownRenderer.tsx`
3. `packages/opencode/webgui/src/components/parts/ImageOverlay.tsx`
4. `packages/opencode/webgui/src/components/parts/ToolPart/index.tsx`

保留规则：

- 上游若重组组件结构，优先沿用上游结构。
- 本 fork 的 generated-image 预览路由、overlay 保存/关闭交互、tool 图片附件展示、bridge 能力接入必须保留。
- 不为保留旧 UI 结构而回退上游更通用的组件分层。

Expected: 上述文件 conflict markers 清理完成，且本地图片链路相关入口仍存在。

- [ ] **Step 2: 处理状态层与启动层冲突**

如果这些文件在冲突清单中，继续处理：

- `packages/opencode/webgui/src/App.tsx`
- `packages/opencode/webgui/src/components/CompactHeader/index.tsx`
- `packages/opencode/webgui/src/state/MessagesContext.tsx`
- `packages/opencode/webgui/src/state/ProjectContext.tsx`
- `packages/opencode/webgui/src/state/scopedStorage.ts`
- `packages/opencode/webgui/vite.config.ts`

保留规则：

- 非 git 项目按目录隔离、dev project path override、消息分页 retry、状态展示语义优先保留。
- 上游若引入新的状态拆分或 hook，优先把本地行为接入新状态层。
- 如果某个本地行为已经被上游同等能力覆盖，保留一份实现即可，避免双写。

Expected: 状态层冲突全部清理完成，且没有重复状态源。

- [ ] **Step 3: 检查 WebGUI 区域是否仍有未解决冲突**

Run:

```powershell
git diff --name-only --diff-filter=U -- "packages/opencode/webgui"
```

Expected: 无输出；如果仍有输出，继续回到 Step 1/2。

- [ ] **Step 4: 运行最小 WebGUI 回归**

Run from `packages/opencode/webgui`:

```powershell
bun test src/components/MarkdownRenderer.test.tsx src/components/parts/ImageOverlay.test.tsx src/components/parts/ToolPart/index.test.tsx src/state/MessagesContext.pagination.test.tsx
```

Expected: PASS。若失败，先修正当前冲突处理引入的问题，再决定是否扩大检查面。

---

### Task 4: 处理 VSCode 与 JetBrains 宿主冲突

**Files:**

- Modify if conflicted: `hosts/vscode-plugin/src/backend/BackendLauncher.ts`
- Modify if conflicted: `hosts/vscode-plugin/src/extension.ts`
- Modify if conflicted: `hosts/vscode-plugin/src/ui/IdeBridgeServer.ts`
- Modify if conflicted: `hosts/vscode-plugin/src/ui/WebviewController.ts`
- Modify if conflicted: `hosts/vscode-plugin/src/utils/extensionIdentity.ts`
- Modify if conflicted: `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/PluginIdentity.kt`
- Modify if conflicted: `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/ChatToolWindowFactory.kt`
- Modify if conflicted: `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt`
- Modify if conflicted: `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/update/MarketplaceVersionSource.kt`
- Modify if conflicted: `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/update/PluginUpdateService.kt`
- Test: `hosts/vscode-plugin/src/test/suite/backendLauncher.test.ts`
- Test: `hosts/vscode-plugin/src/test/suite/ideBridgeServer.test.ts`
- Test: `hosts/vscode-plugin/src/test/suite/webviewController.test.ts`
- Test: `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/IdeBridgeUpdateTest.kt`
- Test: `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/update/PluginUpdateServiceTest.kt`
- Test: `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/PluginIdentityTest.kt`

- [ ] **Step 1: 先处理 VSCode bridge 与版本注入冲突**

按以下顺序处理冲突文件：

1. `hosts/vscode-plugin/src/backend/BackendLauncher.ts`
2. `hosts/vscode-plugin/src/ui/IdeBridgeServer.ts`
3. `hosts/vscode-plugin/src/ui/WebviewController.ts`
4. `hosts/vscode-plugin/src/utils/extensionIdentity.ts`
5. `hosts/vscode-plugin/src/extension.ts`

保留规则：

- `OPENCODE_UI_VERSION` 注入、`getExtensionVersion`、`saveImage`、webview bridge 生命周期等本地宿主契约必须保留。
- 上游若改变 backend 启动或 bridge 消息结构，优先兼容上游结构，不把插件代码锁死在旧协议。

Expected: VSCode 相关冲突清理完成。

- [ ] **Step 2: 再处理 JetBrains 身份、更新与 bridge 冲突**

按以下顺序处理冲突文件：

1. `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/PluginIdentity.kt`
2. `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt`
3. `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/update/MarketplaceVersionSource.kt`
4. `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/update/PluginUpdateService.kt`
5. `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/ChatToolWindowFactory.kt`

保留规则：

- plugin id / vendor / version source 一致性、public Marketplace 查询、空结果处理、`getExtensionVersion` 等本地契约必须保留。
- 上游若清理了 UI/更新服务结构，优先把本地语义接回新结构，而不是恢复旧类职责。

Expected: JetBrains 相关冲突清理完成。

- [ ] **Step 3: 检查宿主区域是否仍有未解决冲突**

Run:

```powershell
git diff --name-only --diff-filter=U -- "hosts/vscode-plugin" "hosts/jetbrains-plugin"
```

Expected: 无输出；如果仍有输出，继续回到 Step 1/2。

- [ ] **Step 4: 运行 VSCode 最小验证**

Run from `hosts/vscode-plugin`:

```powershell
pnpm test -- --grep "BackendLauncher|IdeBridgeServer|WebviewController"
```

Expected: 相关测试通过；如果当前测试脚本不接受 `--grep`，改为运行仓库现有等价 focused test 命令，但不要扩大到整套发布流程。

- [ ] **Step 5: 运行 JetBrains 最小验证**

Run from `hosts/jetbrains-plugin`:

```powershell
.\gradlew.bat test "-PtestFilter=**/PluginIdentityTest,**/PluginUpdateServiceTest,**/IdeBridgeUpdateTest" --no-daemon --console=plain
```

Expected: 对应单测通过；如果当前 Gradle 配置不支持该过滤参数，则切换到仓库内可用的最小等价测试命令，但仍需保留 `--no-daemon --console=plain`。

---

### Task 5: 完成 merge、验证并整理需要维护者决策的事项

**Files:**

- Inspect: `packages/opencode/src/**`
- Inspect: `packages/opencode/webgui/src/**`
- Inspect: `hosts/vscode-plugin/src/**`
- Inspect: `hosts/jetbrains-plugin/src/**`

- [ ] **Step 1: 确认整个仓库已无冲突标记文件**

Run:

```powershell
git diff --name-only --diff-filter=U
```

Expected: 无输出。如果仍有输出，本次 merge 还不能进入收尾。

- [ ] **Step 2: 查看 merge 后状态**

Run:

```powershell
git status --short --branch
```

Expected: 如果 merge 已完成，会显示已修改/新增文件但无 unmerged paths；如果还在 merge 中，会明确提示需要 `git commit` 完成 merge。由于当前会话未收到“创建 commit”指令，停在已解决冲突、已验证通过的工作树即可。

- [ ] **Step 3: 运行一轮面向本次风险面的聚焦验证**

Run from repo root:

```powershell
bun test packages/opencode/test/tool/generate-image.test.ts packages/opencode/test/project/project.test.ts packages/opencode/test/session/retry.test.ts
```

Expected: PASS。若根目录命令不可用，则分别回到对应包目录执行等价命令，但至少要覆盖 generated-image、non-git identity、retry 三类本地契约。

- [ ] **Step 4: 归纳无法安全自动判断的冲突并形成用户选项**

如果在前四个任务中遇到以下任一情况，向维护者输出 2-3 个清晰选项，并说明推荐项：

- 上下游对同一行为给出互斥语义
- 删除本地逻辑是否安全没有文档/测试证据支撑
- 合并某一侧会改变发布、版本或宿主兼容边界
- 架构迁移过大，简单拼接会留下高风险技术债

Expected: 用户能基于你的建议直接做选择，而不是重新自己读 conflict markers。

- [ ] **Step 5: 不创建 commit，等待维护者下一条指令**

不要运行 `git commit`。只有当维护者明确要求提交时，才单独进入提交流程。

Expected: 仓库保留已解决冲突、已验证的 merge 结果，等待下一步指令。
