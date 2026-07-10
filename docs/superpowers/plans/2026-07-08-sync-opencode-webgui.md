---
change: sync-opencode-webgui
design-doc: docs/superpowers/specs/2026-07-08-sync-opencode-webgui-design.md
base-ref: c6924271f49262720161cc273c5a24bf70dc0027
archived-with: 2026-07-10-sync-opencode-webgui
---

# sync-opencode-webgui 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 将上游 `opencode/dev` 普通 merge 到 `ide-plugin`，同时保留 IDE-hosted WebGUI 和 VSCode/JetBrains bridge 行为。

**架构：** 先记录 baseline 与上游热点，再执行普通 `git merge`。合并后按真实代码审计 SDK/API、SSE event、selection、project/path 与 IDE bridge，仅在破损路径上做最小兼容修复。

**Tech Stack：** Git、Bun、React WebGUI、opencode SDK/server、VSCode extension、JetBrains Gradle plugin。

## 全局约束

- 默认 merge target 为 `opencode/dev`；用户指定其他 ref 时才替换。
- 使用普通 `git merge`，保留真实 ancestry；不使用 rebase 代替。
- 不引入新框架、不做无关上游清理、不重建 WebGUI 架构。
- 冲突或上游合同变化若迫使上游行为与 WebGUI/IDE bridge 行为二选一，必须停止并询问用户。
- Windows 下运行 `gradlew.bat` 命令必须追加 `--no-daemon --console=plain`。

archived-with: 2026-07-10-sync-opencode-webgui
---

## 预计涉及文件

- 可能被 merge 修改：`packages/opencode/**`
- 重点审计：`packages/opencode/webgui/**`
- 重点审计：`hosts/vscode-plugin/**`
- 重点审计：`hosts/jetbrains-plugin/**`
- 记录证据：`openspec/changes/sync-opencode-webgui/.comet/build/merge-evidence.md`

## Task 1: 上游 fetch 与热点分析

**产出：** 已确认 target、baseline、上游差异热点，并写入 evidence。

- [x] **Step 1: 确认工作区状态**

Run:

```powershell
git status --short
git rev-parse HEAD
```

Expected: 记录当前变更；`HEAD` 应为 `c6924271f49262720161cc273c5a24bf70dc0027`。若不是该 commit，先记录实际值并询问用户是否继续以当前 HEAD 作为 merge baseline。

- [x] **Step 2: 确认 merge target**

Run:

```powershell
git remote -v
git symbolic-ref refs/remotes/opencode/HEAD
```

Expected: target 使用 `opencode/dev`。若 remote HEAD 或用户要求不是 `opencode/dev`，停止确认 target 后再继续。

- [x] **Step 3: Fetch 上游 refs**

Run:

```powershell
git fetch opencode --prune
```

Expected: fetch 成功，无未解决的网络或认证错误。

- [x] **Step 4: 生成差异热点清单**

Run:

```powershell
git diff --name-status HEAD..opencode/dev -- packages/opencode packages/opencode/webgui hosts/vscode-plugin hosts/jetbrains-plugin
git log --oneline --left-right --cherry-pick HEAD...opencode/dev -- packages/opencode packages/opencode/webgui hosts/vscode-plugin hosts/jetbrains-plugin
```

Expected: 标记 server route、SDK/schema、event definition、session/config/provider/project/path、WebGUI SDK wrapper/state/event bridge、VSCode/JetBrains bridge 和 packaging 相关改动。

- [x] **Step 5: 写入准备阶段 evidence**

Create or update `openspec/changes/sync-opencode-webgui/.comet/build/merge-evidence.md` with:

```markdown
# sync-opencode-webgui merge evidence

## Baseline

- Local baseline: c6924271f49262720161cc273c5a24bf70dc0027
- Actual baseline: <git rev-parse HEAD 输出>
- Merge target: opencode/dev

## Pre-merge hotspots

- packages/opencode: <server/API/SDK/schema/event/build 热点摘要>
- packages/opencode/webgui: <SDK wrapper/state/event/permission/question/bridge 热点摘要>
- hosts/vscode-plugin: <hosting/storage/reload/package 热点摘要>
- hosts/jetbrains-plugin: <hosting/storage/reload/package 热点摘要>
```

## Task 2: 普通 merge 与冲突处理

**产出：** `opencode/dev` 已 merge，冲突被解决或明确停在用户决策点。

- [x] **Step 1: 执行普通 merge**

Run:

```powershell
git merge opencode/dev
```

Expected: merge 成功，或进入冲突状态。

- [x] **Step 2: 列出冲突文件**

Run when conflicted:

```powershell
git diff --name-only --diff-filter=U
```

Expected: 只处理列出的冲突文件，不顺手整理无关代码。

- [x] **Step 3: 按决策规则解决冲突**

Apply this rule per conflicted file:

```text
1. 能同时保留上游 opencode 行为和下游 WebGUI/IDE bridge 行为：直接解决。
2. 上游提供更好的共享结构：把 WebGUI/IDE bridge 适配挂到新结构。
3. 小型 adapter 能保留旧 WebGUI 合同：放在现有 SDK wrapper 或 event translation 附近。
4. 必须删除或削弱任一侧行为：停止，写下选项，等待用户决定。
```

- [x] **Step 4: 停点检查**

Before staging conflict resolutions, verify none of these are true:

```text
- WebGUI 仍依赖的 endpoint/event shape 被删除或改变，且小型 adapter 无法保留行为。
- 冲突要求在上游行为和 IDE bridge 行为之间二选一。
- packaging 变化导致 VSCode、JetBrains 或上游 opencode output 之间不兼容。
```

Expected: 若任一项为 true，停止并向用户给出可选方案；不要自行选择。

- [x] **Step 5: 记录 merge 结果**

Append to `openspec/changes/sync-opencode-webgui/.comet/build/merge-evidence.md`:

```markdown
## Merge result

- Command: git merge opencode/dev
- Conflicted files: <冲突文件列表或 none>
- Resolution summary: <每类冲突如何同时保留双方行为>
- User decision required: <yes/no；若 yes，附选项与用户选择>
```

## Task 3: WebGUI compatibility audit

**产出：** 合并后真实代码的兼容审计结果。

- [x] **Step 1: 审计 SDK/API calls**

Inspect `packages/opencode/webgui/**` against merged `packages/opencode/**` for:

```text
- sdk.session.*: list/create/update/delete/select/send prompt
- sdk.config.*: config load/save and fallback
- provider/model/agent/variant loading and persisted selection fallback
- sdk.project.* and sdk.path.* startup context
- permission/question reply and reject routes
```

Expected: 每项标为 `pass` 或 `broken: <文件:原因>`。

- [x] **Step 2: 审计 SSE event handling**

Inspect event definitions and WebGUI consumers for:

```text
- /event authentication and connection lifecycle
- message.* events to MessagesContext
- session.* events to SessionContext
- permission.* and question.* pending request updates
- file/edit/tool-result path data for host reload
```

Expected: payload shape 变化都被记录；没有凭类型通过假设运行时兼容。

- [x] **Step 3: 审计 IDE bridge**

Inspect `packages/opencode/webgui/**`, `hosts/vscode-plugin/**`, and `hosts/jetbrains-plugin/**` for:

```text
- bridge token and URL initialization
- storageGet/storageSet persistence path
- write/edit/apply_patch 后 reloadPath message
- server restart、bridge reconnect、host restart/update tolerance
- WebGUI asset embedding and host packaging assumptions
```

Expected: VSCode 与 JetBrains 各自有结论。

- [x] **Step 4: 写入 audit evidence**

Append to `openspec/changes/sync-opencode-webgui/.comet/build/merge-evidence.md`:

```markdown
## WebGUI compatibility audit

- SDK/API: <pass 或 broken 列表>
- SSE events: <pass 或 broken 列表>
- Provider/model/agent/variant and project/path: <pass 或 broken 列表>
- IDE bridge VSCode: <pass 或 broken 列表>
- IDE bridge JetBrains: <pass 或 broken 列表>
```

## Task 4: 最小兼容修复

**产出：** 只修复 audit 证明破损的 call path。

- [x] **Step 1: 为每个 broken 项选择最小位置**

Use this placement rule:

```text
- 单个 WebGUI call site 破损：在该 call site 适配。
- 多个 call site 同一种 API/event shape 变化：在现有 SDK wrapper 或 event translation 中适配。
- SDK/build artifact 与 merged schema 不一致：只重新生成或更新受影响 artifact。
- 无关重命名、格式化、fork 清理：不做。
```

- [x] **Step 2: 应用修复并保持范围可审计**

For each fix, record:

```markdown
### Compatibility fix: <短名称>

- Broken path: <文件和行为>
- Fix location: <文件>
- Reason this is minimal: <一句话>
- Verification command: <后续 Task 5 中会运行的命令>
```

- [x] **Step 3: 若需要生成 SDK/build artifacts，仅运行仓库已有生成命令**

Run only if merge/audit proves generated artifacts stale. Use scripts already present in the merged repo; do not add a generator framework.

Expected: 生成内容只覆盖受影响 SDK/schema/build output。

## Task 5: 尽量全量验证

**产出：** opencode、WebGUI、VSCode、JetBrains 验证证据，或记录不可运行原因与最近等价命令。

- [x] **Step 1: 发现 merge 后可用脚本**

Run:

```powershell
bun pm pkg get scripts
```

Expected: 根据实际 scripts 选择最接近的 typecheck/test/build 命令；不要因为脚本名变化而跳过整类验证。

- [x] **Step 2: 验证 opencode package**

Run available equivalents for:

```text
- packages/opencode typecheck
- packages/opencode tests
- packages/opencode build
```

Expected: PASS；若命令不存在，记录实际替代命令或不可运行原因。

- [x] **Step 3: 验证 WebGUI flows**

Run available equivalents for:

```text
- WebGUI typecheck
- WebGUI tests
- WebGUI build
- session workflow
- streamed message handling
- provider/model/agent/variant selection
- permission/question handling
- IDE bridge storage/reloadPath/reconnect path
```

Expected: PASS；若某项没有自动化测试，用最小手动检查记录步骤和结果。

- [x] **Step 4: 验证 VSCode host**

Run the repository's compile/package or nearest bridge/package check for `hosts/vscode-plugin`.

Expected: PASS；若上游 build layout 改变，记录替代命令。

- [x] **Step 5: 验证 JetBrains host**

Run available Gradle checks, preserving Windows flags:

```powershell
.\gradlew.bat test --no-daemon --console=plain
.\gradlew.bat buildPlugin --no-daemon --console=plain
```

Expected: PASS；若 task 名称或 project layout 变化，运行最近等价 Gradle task 并记录原因。

- [x] **Step 6: 写入最终 evidence 与剩余风险**

Append to `openspec/changes/sync-opencode-webgui/.comet/build/merge-evidence.md`:

```markdown
## Verification

- opencode typecheck/test/build: <commands and results>
- WebGUI typecheck/test/build/flow checks: <commands and results>
- VSCode host compile/package or bridge check: <commands and results>
- JetBrains test/buildPlugin or equivalent: <commands and results>
- Skipped or substituted commands: <command, reason, replacement>

## Remaining compatibility risk before verify

- <risk or none>
```

Expected: 进入 verify 阶段前，所有跳过项都有原因，所有剩余风险都有明确描述。
