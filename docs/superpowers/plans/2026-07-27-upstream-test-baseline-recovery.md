# Upstream Test Baseline Recovery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在不接管 clean upstream `v1.18.6` 已有失败的前提下，修复合并后所有已确认的下游测试漂移和下游引入的行为回归，同时保留 MCP、session visibility、provider catalog、WebGUI/TUI session filtering 与 `whichAll`。

**Architecture:** 先在同一台 Windows 主机和同一 vfox 工具链上建立 detached upstream A/B 基线，并把每个失败签名分类为 `upstream-known` 或 `downstream-owned`。确定性问题按根因做最小改动；资源和时序问题只有在 upstream 通过、当前分支失败时才进入实现，而且只修拥有该资源或 readiness 的生命周期边界。

**Tech Stack:** TypeScript、Bun `1.3.14`、Node.js `22.23.1`、Effect v4、Bun test、PowerShell 7、Git worktree。

---

## 执行约束

- 所有测试和 typecheck 都从具体 package 目录运行，不能从仓库根运行测试。
- 所有 Bun/Node 命令都通过 `vfox exec bun@1.3.14 nodejs@22.23.1 -- ...` 执行。
- 不增加 skip、retry、sleep、全局 timeout，也不增加仅为 Windows 绕过测试的生产分支。
- 不修改 `packages/client/src/generated` 或 `packages/client/src/generated-effect`；本计划不改变公开 Protocol/HttpApi，因此不运行生成器。
- 开始时记录起始 SHA、dirty 路径和初始 Git index；目标实现文件若已有 diff，暂停对应任务并先与用户确定归属。
- 每次提交只 stage 当前任务列出的路径并使用 `git commit --only -- <paths>`；不使用 `git add .`，不纳入 Comet 文件、生成的 workflow 文件或既有用户改动。
- 若 baseline 与当前分支在同一测试中出现不同错误，按两个失败签名分别分类，不能把整份测试文件整体排除。

### Task 1: 建立并记录 upstream/current A/B 基线

**Files:**
- Create: `docs/superpowers/reports/2026-07-27-upstream-test-baseline.md`
- Reference: `docs/superpowers/specs/2026-07-27-upstream-test-baseline-recovery-design.md`

**Step 1: 验证 ref、工具链和临时 worktree 位置**

Run from repository root:

```powershell
git rev-parse --verify "v1.18.6^{commit}"
git rev-parse HEAD
git status --short
git diff --name-only
git diff --cached --name-only
git status --short -- packages/client/test/promise.test.ts packages/opencode/test/server/httpapi-exercise/index.ts packages/opencode/test/server/httpapi-config.test.ts packages/tui/test/cli/cmd/tui/sync.test.tsx packages/core/src/util/which.ts packages/core/test/util/which.test.ts
git status --short -- packages/sdk-next/test/embedded.test.ts packages/sdk-next/src/opencode.ts packages/core/src/effect/app-node-builder.ts packages/core/src/database/sqlite.bun.ts packages/opencode/test/server/httpapi-file.test.ts packages/opencode/src/server/routes/instance/httpapi/handlers/file.ts packages/core/src/filesystem/search.ts packages/opencode/test/server/httpapi-exercise/runner.ts packages/opencode/test/server/httpapi-exercise/backend.ts packages/core/test/git.test.ts packages/core/test/move-session.test.ts packages/core/test/project.test.ts packages/core/test/repository-cache.test.ts packages/core/test/snapshot.test.ts
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun --version
vfox exec bun@1.3.14 nodejs@22.23.1 -- node --version
$baseline = "C:\Users\caiqy\AppData\Local\Temp\opencode\upstream-v1.18.6"
$current = "C:\Users\caiqy\AppData\Local\Temp\opencode\current-start"
Test-Path -LiteralPath $baseline
Test-Path -LiteralPath $current
```

Expected: tag resolves；Bun 为 `1.3.14`；Node 为 `v22.23.1`；confirmed 与 conditional candidate files 无既有状态；两个目标 worktree 路径均不存在。把起始 SHA、完整 dirty 清单和初始 staged 路径写入 baseline 报告。若目标文件已有 diff，不能用后续整文件 stage 覆盖其归属；若 worktree 路径已存在，先用 `git worktree list` 判断归属，不得直接删除未知目录。

**Step 2: 创建 detached worktree 并安装相同依赖**

Run from repository root:

```powershell
$start = git rev-parse HEAD
git worktree add --detach "C:\Users\caiqy\AppData\Local\Temp\opencode\upstream-v1.18.6" v1.18.6
git worktree add --detach "C:\Users\caiqy\AppData\Local\Temp\opencode\current-start" $start
```

Run once from each detached worktree root:

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun install --frozen-lockfile
git rev-parse HEAD
git status --porcelain
```

Expected: upstream HEAD 等于 Step 1 解析出的 tag commit；current-start HEAD 等于记录的起始 SHA；两个 `git status --porcelain` 均无输出。后续 A/B 只使用这两个 clean worktrees，不使用 dirty primary worktree 采集 baseline。

**Step 3: 在 upstream worktree 运行最小失败矩阵**

在对应 baseline package 目录逐条运行；某个文件或 package 不存在时记录 `absent-upstream`，不要补文件。

```text
packages/client
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun test test/promise.test.ts --timeout 5000

packages/httpapi-codegen
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun test test/generate.test.ts test/write.test.ts --timeout 5000 --only-failures

packages/tui
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun test test/runtime.test.tsx test/cli/cmd/tui/sync.test.tsx --timeout 30000 --only-failures

packages/core
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun test test/git.test.ts test/move-session.test.ts test/project.test.ts test/repository-cache.test.ts test/snapshot.test.ts test/util/which.test.ts --only-failures

packages/sdk-next
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun test test/embedded.test.ts --timeout 5000

packages/opencode
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun test test/server/httpapi-config.test.ts test/server/httpapi-file.test.ts --timeout 30000 --only-failures
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run script/httpapi-exercise.ts --mode effect --fail-on-missing --fail-on-skip --progress
```

对每条命令记录 exit code、测试名、首个稳定错误和是否留下 Bun/Node 进程。资源类命令后立即运行进程查询；若有测试进程残留，把本次及后续受污染结果标为 `unresolved`，待进程按正常生命周期退出后再继续。不要用扩大 timeout 的第二次运行替代第一次结果。

**Step 4: 在 clean current-start worktree 运行同一最小矩阵**

Run the same commands from the matching package directories under `current-start`. Downstream-only routes/tests additionally run:

```text
packages/opencode
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run script/httpapi-exercise.ts --mode coverage --fail-on-missing --fail-on-skip
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run script/httpapi-exercise.ts --mode auth --fail-on-missing --fail-on-skip
```

Expected confirmed current signatures:

- Client exposes unexpected `mcp` relative to its stale expected list.
- `PUT /session/visibility` is the only missing HttpApi scenario.
- Provider catalog test is coupled to `claude-sonnet-4-20250514`.
- TUI disabled directory filter sends `scope=project` while the test expects null.
- Core `which` returns the multi-result path casing instead of single-result casing on Windows.

**Step 5: 写 baseline 报告并应用硬门控**

Create a table with these columns:

```markdown
| Candidate | Upstream command/result | Current command/result | Classification | Action |
|---|---|---|---|---|
```

Classification rules:

- 相同测试名和相同错误语义：`upstream-known`，Action=`none`。
- upstream pass、current fail：`downstream-owned`，进入对应条件任务。
- upstream 不存在且 current 为下游 API/test/package：`downstream-owned`。
- 无结果、进程被外层终止或错误签名不同：`unresolved`，不能改代码，先在对应条件任务中定位首个阻塞边界。

报告还必须记录起始 SHA、初始 dirty/staged 路径和两个 detached worktree 路径。任何 `unresolved` 在进入代码修改前，都要在保留的 upstream 与 current-start worktree 上用同一过滤命令完成分类。

Expected exclusions when signatures match: HttpApi Codegen path tests、TUI home abbreviation、Core RepositoryCache/Snapshot/MoveSession。

**Step 6: 检查残留进程并决定是否保留 baseline worktree**

Run from repository root:

```powershell
Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(bun|node)(\.exe)?$' -and $_.CommandLine -match '(bun test|httpapi-exercise|bun run test)' }
```

Expected: process query 无输出。若报告还有 `unresolved`，保留两个 worktrees 至 Task 7-10 完成同命令 A/B 分类；若已全部分类，可分别运行 `git worktree remove <path>` 后 `git worktree prune`。若 removal 被资源占用，先记录 owning process/handle，不能强删。

**Step 7: Commit baseline report**

```powershell
git add docs/superpowers/reports/2026-07-27-upstream-test-baseline.md
git diff --cached -- docs/superpowers/reports/2026-07-27-upstream-test-baseline.md
git commit --only -m "docs(test): record v1.18.6 Windows baseline" -- docs/superpowers/reports/2026-07-27-upstream-test-baseline.md
git diff --cached --name-only
```

Expected: commit 仅包含 baseline report；命令后 staged 路径恢复为 Step 1 记录的初始集合。

### Task 2: 对齐 Promise Client 的下游 MCP 契约

**Files:**
- Modify: `packages/client/test/promise.test.ts:4`
- Reference only: `packages/protocol/src/groups/mcp.ts`
- Do not modify: `packages/client/src/generated/**`

**Step 1: 确认现有契约测试为红**

Run from `packages/client`:

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun test test/promise.test.ts --timeout 5000
```

Expected: `exposes every standard HTTP API group` fails because actual keys contain `mcp`.

**Step 2: 更新精确公开 surface 断言**

Insert `"mcp"` after `"skills"` in the group list and add:

```ts
expect(Object.keys(client.mcp)).toEqual(["setEnabled", "setToolEnabled"])
```

Do not remove `mcp` from Protocol or generated clients.

**Step 3: 运行 focused test 和 typecheck**

Run from `packages/client`:

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun test test/promise.test.ts --timeout 5000
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun typecheck
```

Expected: focused tests pass；typecheck exit 0；generated directories remain unchanged.

**Step 4: Commit**

```powershell
git add packages/client/test/promise.test.ts
git diff --cached -- packages/client/test/promise.test.ts
git commit --only -m "test(client): include downstream MCP group" -- packages/client/test/promise.test.ts
git diff --cached --name-only
```

Expected: commit 仅包含 Client test；初始 staged 路径仍保留。

### Task 3: 为 session visibility 增加 HttpApi exercise 场景

**Files:**
- Modify: `packages/opencode/test/server/httpapi-exercise/index.ts:1278`
- Reference only: `packages/opencode/src/server/routes/instance/httpapi/groups/session.ts:135`
- Reference only: `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts:86`
- Existing side-effect coverage: `packages/opencode/test/session/summary-scheduler.test.ts:270`
- Existing WebGUI coverage: `packages/opencode/webgui/src/hooks/useSessionVisibilitySync.test.tsx:70`

**Step 1: 确认 route coverage 为红**

Run from `packages/opencode`:

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run script/httpapi-exercise.ts --mode coverage --include session.visibility --fail-on-missing --fail-on-skip
```

Expected: exit 1，missing route 为 `PUT /session/visibility`。

**Step 2: 在 session list/status 场景附近加入最小 protected mutating scenario**

Add this shape:

```ts
http.protected
  .put("/session/visibility", "session.visibility")
  .mutating()
  .seeded((ctx) => ctx.session({ title: "Visible session" }))
  .at((ctx) => ({
    path: "/session/visibility",
    headers: ctx.headers(),
    body: { sessionIDs: [ctx.state.id, ctx.state.id] },
  }))
  .json(200, (body, ctx) => {
    object(body)
    array(body.sessionIDs)
    check(body.sessionIDs.length === 1, "visible session IDs should be deduplicated")
    check(body.sessionIDs[0] === ctx.state.id, "response should contain the visible session")
  }),
```

The duplicate ID verifies the handler normalization and exact response. The existing scheduler test remains the direct behavioral proof that `syncVisible` changes scheduling; do not duplicate that orchestration in the route exerciser.

**Step 3: 运行三个 exercise modes 与现有 scheduler behavior test**

Run from `packages/opencode`:

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run script/httpapi-exercise.ts --mode coverage --include session.visibility --fail-on-missing --fail-on-skip
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run script/httpapi-exercise.ts --mode auth --include session.visibility --fail-on-missing --fail-on-skip
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run script/httpapi-exercise.ts --mode effect --include session.visibility --fail-on-missing --fail-on-skip
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun test test/session/summary-scheduler.test.ts --timeout 30000 --only-failures
```

Expected: all commands exit 0；no missing route；no generated source change.

**Step 4: 验证 WebGUI 仍调用 visibility contract**

Run from `packages/opencode/webgui`:

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run test:run src/hooks/useSessionVisibilitySync.test.tsx
```

Expected: hook tests pass and still send `{ body: { sessionIDs } }` through `sdk.session.syncVisible`.

**Step 5: Commit**

```powershell
git add packages/opencode/test/server/httpapi-exercise/index.ts
git diff --cached -- packages/opencode/test/server/httpapi-exercise/index.ts
git commit --only -m "test(opencode): cover session visibility route" -- packages/opencode/test/server/httpapi-exercise/index.ts
git diff --cached --name-only
```

Expected: commit 仅包含 exerciser scenario；WebGUI source/test 无 diff；初始 staged 路径仍保留。

### Task 4: 移除 provider catalog 测试的易变模型 ID

**Files:**
- Modify: `packages/opencode/test/server/httpapi-config.test.ts:324`

**Step 1: 确认旧模型断言为红**

Run from `packages/opencode`:

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun test test/server/httpapi-config.test.ts --timeout 30000 --only-failures
```

Expected: `serves provider catalog models without applying config whitelist` fails because catalog no longer contains `claude-sonnet-4-20250514`.

**Step 2: 让 fixture 测试稳定契约而不是 catalog 快照**

Change the configured whitelist to a deliberately nonexistent sentinel:

```ts
whitelist: ["missing-model-for-httpapi-test"],
```

Delete the historical ID assertion:

```ts
expect(body.models.some((model) => model.id === "claude-sonnet-4-20250514")).toBe(true)
```

Keep these assertions:

```ts
expect(body.providerID).toBe("anthropic")
expect(body.models.length).toBeGreaterThan(1)
```

If the endpoint incorrectly applies the nonexistent whitelist, the length assertion fails; no production provider behavior changes.

**Step 3: 运行 focused test**

Run from `packages/opencode`:

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun test test/server/httpapi-config.test.ts --timeout 30000 --only-failures
```

Expected: test file passes.

**Step 4: Commit**

```powershell
git add packages/opencode/test/server/httpapi-config.test.ts
git diff --cached -- packages/opencode/test/server/httpapi-config.test.ts
git commit --only -m "test(opencode): stabilize provider catalog assertion" -- packages/opencode/test/server/httpapi-config.test.ts
git diff --cached --name-only
```

Expected: commit 仅包含 provider catalog test；初始 staged 路径仍保留。

### Task 5: 恢复 TUI project scope 的真实期望

**Files:**
- Modify: `packages/tui/test/cli/cmd/tui/sync.test.tsx:20`
- Do not modify: `packages/tui/src/context/sync.tsx`

**Step 1: 确认 stale expectation 为红**

Run from `packages/tui`:

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun test test/cli/cmd/tui/sync.test.tsx --timeout 30000 --only-failures
```

Expected: disabled directory filter case expects null but request contains `scope=project`.

**Step 2: 只修测试期望**

Change:

```ts
expect(session.at(-1)?.searchParams.get("scope")).toBeNull()
```

to:

```ts
expect(session.at(-1)?.searchParams.get("scope")).toBe("project")
```

Only change the assertion after `session_directory_filter_enabled` is set to false. Keep the initial path-scoped assertions unchanged.

**Step 3: 运行 focused test 与 typecheck**

Run from `packages/tui`:

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun test test/cli/cmd/tui/sync.test.tsx --timeout 30000 --only-failures
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun typecheck
```

Expected: focused tests pass；typecheck exit 0.

**Step 4: Commit**

```powershell
git add packages/tui/test/cli/cmd/tui/sync.test.tsx
git diff --cached -- packages/tui/test/cli/cmd/tui/sync.test.tsx
git commit --only -m "test(tui): restore project session scope expectation" -- packages/tui/test/cli/cmd/tui/sync.test.tsx
git diff --cached --name-only
```

Expected: commit 仅包含 TUI test；`src/context/sync.tsx` 无 diff；初始 staged 路径仍保留。

### Task 6: 恢复 Core `which` 单结果语义并保留 `whichAll`

**Files:**
- Modify: `packages/core/src/util/which.ts:5`
- Modify: `packages/core/test/util/which.test.ts:1`

**Step 1: 确认现有 Windows regression 为红**

Run from `packages/core`:

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun test test/util/which.test.ts --only-failures
```

Expected on Windows: `uses PATHEXT on windows` reports expected `.CMD` but actual `.cmd`.

**Step 2: 先给 downstream `whichAll` 补一条保留行为检查**

Import both exports:

```ts
import { which, whichAll } from "@opencode-ai/core/util/which"
```

Add a test that creates the same command in two PATH directories, repeats the first PATH entry, and checks that `whichAll` returns two unique matches in PATH order. On Windows, repeat the first directory with different casing to cover case-insensitive deduplication. Normalize only comparison casing; do not alter returned production values.

```ts
test("whichAll returns every PATH match", async () => {
  await using tmp = await tmpdir()
  const a = path.join(tmp.path, "a")
  const b = path.join(tmp.path, "b")
  await fs.mkdir(a)
  await fs.mkdir(b)
  const first = await cmd(a, "all")
  const second = await cmd(b, "all")
  const normalize = (item: string) => (process.platform === "win32" ? item.toLowerCase() : item)
  const duplicate = process.platform === "win32" ? a.toUpperCase() : a

  expect(whichAll("all", env([a, duplicate, b].join(path.delimiter))).map(normalize)).toEqual(
    [first, second].map(normalize),
  )
})
```

Run the focused test once. Expected: the new `whichAll` check passes while the existing PATHEXT exact-casing check remains red.

**Step 3: 分离 single-result 与 all-result 调用**

Extract only the shared option construction, then call the dependency without `all: true` from `which`:

```ts
export function which(cmd: string, env?: NodeJS.ProcessEnv) {
  const result = whichPkg.sync(cmd, options(env))
  return typeof result === "string" ? result : null
}

export function whichAll(cmd: string, env?: NodeJS.ProcessEnv) {
  const result = whichPkg.sync(cmd, { ...options(env), all: true })
  if (!Array.isArray(result)) return []
  return Array.from(
    new Map(result.map((item) => [process.platform === "win32" ? item.toLowerCase() : item, item])).values(),
  )
}

function options(env?: NodeJS.ProcessEnv) {
  const base = env?.PATH ?? env?.Path ?? process.env.PATH ?? process.env.Path ?? ""
  return {
    nothrow: true as const,
    path: base ? base + path.delimiter + Global.Path.bin : Global.Path.bin,
    pathExt: env?.PATHEXT ?? env?.PathExt ?? process.env.PATHEXT ?? process.env.PathExt,
  }
}
```

Keep case-insensitive deduplication exclusively in `whichAll`.

**Step 4: 运行 focused test 与 typecheck**

Run from `packages/core`:

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun test test/util/which.test.ts --only-failures
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun typecheck
```

Expected: exact PATHEXT casing and all-result order tests pass；typecheck exit 0.

**Step 5: Commit**

```powershell
git add packages/core/src/util/which.ts packages/core/test/util/which.test.ts
git diff --cached -- packages/core/src/util/which.ts packages/core/test/util/which.test.ts
git commit --only -m "fix(core): preserve single command lookup semantics" -- packages/core/src/util/which.ts packages/core/test/util/which.test.ts
git diff --cached --name-only
```

Expected: commit 仅包含 Core lookup source/test；初始 staged 路径仍保留。

### Task 7: 条件修复 sdk-next SQLite `EBUSY`

**Gate:** 仅当 Task 1 报告为 upstream pass/current `EBUSY` 时执行。若为 `upstream-known`，在报告 Action 中写 `none` 并跳过本任务，不创建提交。

If Task 1 left this signature `unresolved`, first run the same focused command in the retained upstream and current-start worktrees. Do not edit until the upstream run exits cleanly and current-start reproduces `EBUSY`.

**Candidate files:**
- Existing regression: `packages/sdk-next/test/embedded.test.ts:9`
- Likely owner: `packages/sdk-next/src/opencode.ts:10`
- Inspect only unless evidence points here: `packages/core/src/effect/app-node-builder.ts`
- Inspect only unless evidence points here: `packages/core/src/database/sqlite.bun.ts:154`

**Step 1: 用现有 test 复现资源未释放**

Run from `packages/sdk-next`:

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun test test/embedded.test.ts --timeout 5000
```

Expected gate signature: test body completes or reaches finalization, then `rm(directory, { recursive: true, force: true })` fails with Windows `EBUSY` on the embedded DB directory.

The existing immediate `rm` is already the regression check. Do not add delete retry or sleep.

**Step 2: 定位 owning scope before editing**

Confirm which resource remains alive after `Effect.scoped(program)`:

- `HttpRouter.toWebHandler(...).dispose`
- the `Layer.makeMemoMap` graph built in `OpenCode.create`
- SQLite native finalizer
- an instance/location watcher or child process

Add temporary scoped logging only if the current trace cannot distinguish finalizer order; remove it before committing. The fix belongs at the first owner whose finalizer has not completed before `create`'s caller scope exits.

**Step 3: 实施最小 lifecycle fix**

- If `OpenCode.create` owns the resource, register/await its finalizer in the caller's `Scope.Scope`.
- If a Layer is built outside that scope, move that build into the existing caller scope; do not expose a second ad hoc `dispose()` API unless no scoped ownership is possible.
- If SQLite close runs but a higher owner still retains it, fix the higher owner. Do not add `rm` retries, `Bun.sleep`, forced process termination, or a Windows-only bypass.

Modify the existing test only when needed to assert the corrected owner boundary; keep deletion immediate.

**Step 4: Verify repeatedly as separate fresh processes**

Run from `packages/sdk-next` three times as separate commands:

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun test test/embedded.test.ts --timeout 5000
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun test test/embedded.test.ts --timeout 5000
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun test test/embedded.test.ts --timeout 5000
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun typecheck
```

Expected: three clean exits, no `EBUSY`, typecheck exit 0, no residual Bun/Node process.

**Step 5: Commit only the proven owner fix**

```powershell
git status --short -- <exact sdk-next/core owner files and focused test>
git add <exact sdk-next/core owner files and focused test>
git diff --cached -- <exact sdk-next/core owner files and focused test>
git commit --only -m "fix(sdk): close embedded resources before cleanup" -- <exact sdk-next/core owner files and focused test>
git diff --cached --name-only
```

Expected: target files had no pre-task diff；commit excludes the initial staged set.

### Task 8: 条件修复 OpenCode file-search readiness

**Gate:** 仅当 Task 1 为 upstream pass/current `file search index was not ready` 时执行。相同 upstream failure 直接跳过。

If unresolved, run this exact file test in the retained upstream and current-start worktrees before editing. Only upstream pass/current-start fail opens the gate.

**Candidate files:**
- Existing regression: `packages/opencode/test/server/httpapi-file.test.ts:55`
- HTTP boundary: `packages/opencode/src/server/routes/instance/httpapi/handlers/file.ts:43`
- Owning service: `packages/core/src/filesystem/search.ts`

**Step 1: 用现有 test 确认 current-only failure**

Run from `packages/opencode`:

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun test test/server/httpapi-file.test.ts --timeout 30000 --only-failures
```

Expected gate signature: `serves search endpoints` reaches the existing readiness poll but never sees `hello.txt`.

**Step 2: 确认实际启用的 search layer**

Record whether the failing run uses `ripgrepLayer` or `fffLayer`. Do not modify the HTTP test timeout.

- For `ripgrepLayer`, retain the initial indexing fiber/readiness completion inside `FileSystemSearch.Service` and make `find` await that completion before reading `state.files`.
- For `fffLayer`, use the dependency's actual ready/status signal at service construction or first `find`; do not add application polling if the dependency exposes no readiness contract. If no deterministic signal exists, stop and mark the task blocked with evidence rather than inventing a sleep.

The readiness wait belongs in `FileSystemSearch`, not in `FileHttpApi` and not in the test.

**Step 3: Keep the existing test as the regression check**

The test already writes a file before the first search and waits for an observable result. Add no duplicate test unless the root-cause branch requires a lower-level service assertion.

**Step 4: Verify focused test and both owning packages**

Run from `packages/opencode`:

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun test test/server/httpapi-file.test.ts --timeout 30000 --only-failures
```

Run from `packages/core`:

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun typecheck
```

Run from `packages/opencode`:

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun typecheck
```

Expected: focused test passes without timeout changes; both typechecks exit 0.

**Step 5: Commit**

```powershell
git status --short -- packages/core/src/filesystem/search.ts <focused regression test only if changed>
git add packages/core/src/filesystem/search.ts <focused regression test only if changed>
git diff --cached -- packages/core/src/filesystem/search.ts <focused regression test only if changed>
git commit --only -m "fix(core): await file search readiness" -- packages/core/src/filesystem/search.ts <focused regression test only if changed>
git diff --cached --name-only
```

### Task 9: 条件修复 HttpApi effect-mode stall

**Gate:** 仅当 upstream effect mode completes and current effect mode stalls. 若两边同样 stall，记录 `upstream-known` 并跳过。

If unresolved, keep both detached worktrees and run the same filtered/progress command on both refs. A current-start-only blocked phase is required before editing.

**Candidate files:**
- `packages/opencode/test/server/httpapi-exercise/index.ts`
- `packages/opencode/test/server/httpapi-exercise/runner.ts`
- `packages/opencode/test/server/httpapi-exercise/backend.ts`
- First blocked production handler/service identified by trace

**Step 1: 定位第一个阻塞场景而不是扩大外层时间**

Run from `packages/opencode`:

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run script/httpapi-exercise.ts --mode effect --fail-on-missing --fail-on-skip --progress --trace
```

Record the last printed `RUN` and existing trace phase. Then use `--include`, `--start-at`, or `--stop-at` once to isolate that scenario.

The existing trace covers context acquisition, runtime, instance load, seed, request, assertion, and tmpdir cleanup, but not all reset/app/final cleanup boundaries. If the last existing phase cannot identify the owner, temporarily add trace lines around:

- `resetState` start/done in `runner.ts`;
- `disposeApps` start/done in `backend.ts`;
- `disposeAllInstances` start/done and `resetDatabase` start/done inside `resetState`;
- the top-level `disposeApps` and `cleanupExercisePaths` finalizer in `index.ts`.

Run the isolated command once with those phases, record the first missing `done`, then remove temporary tracing before the implementation commit.

**Step 2: Add one focused lifecycle regression**

Use the smallest existing harness level that can observe the blocked boundary:

- runner/backend test for app cache or finalizer ownership;
- route-specific HttpApi test for a handler/service stall;
- existing scenario itself when its timeout reports the exact blocked phase.

Do not add a global watchdog, ten-minute timeout increase, skip, or forced `process.exit` before finalizers finish.

**Step 3: Fix the owning boundary**

Await the actual setup readiness, request completion, child process exit, or scoped finalizer identified in Step 1. Do not refactor unrelated scenarios.

**Step 4: Verify isolated scenario, then full effect mode**

Run from `packages/opencode`:

```text
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run script/httpapi-exercise.ts --mode effect --include <scenario> --fail-on-missing --fail-on-skip --progress
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run script/httpapi-exercise.ts --mode effect --fail-on-missing --fail-on-skip --progress
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun typecheck
```

Expected: isolated and full effect runs exit 0 and finalizers complete; no residual process.

**Step 5: Commit**

```powershell
git status --short -- <one focused regression and owning lifecycle files>
git add <one focused regression and owning lifecycle files>
git diff --cached -- <one focused regression and owning lifecycle files>
git commit --only -m "fix(opencode): complete HttpApi effect lifecycle" -- <one focused regression and owning lifecycle files>
git diff --cached --name-only
```

### Task 10: 条件修复 Core child-process/worktree cleanup

**Gate:** 逐失败签名执行。只有 upstream 对同一用例通过、current 出现 timeout、`ChildProcess.exitCode` 或 worktree removal failure 时才修；RepositoryCache/Snapshot/MoveSession 相同 upstream failure 不修改。

Every unresolved signature must first be rerun with the same single-file/filter command in the retained upstream and current-start worktrees. Do not infer upstream pass from source similarity.

**Candidate tests:**
- `packages/core/test/git.test.ts`
- `packages/core/test/move-session.test.ts`
- `packages/core/test/project.test.ts`
- `packages/core/test/repository-cache.test.ts`
- `packages/core/test/snapshot.test.ts`

**Step 1: 单文件、默认 timeout 复现 downstream-owned signature**

Run from `packages/core`, one file at a time:

```text
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun test <one-test-file> --only-failures
```

Do not batch unrelated files while locating the first leaked child/worktree owner.

**Step 2: Capture one regression at the owning boundary**

Use the existing failing test when it already proves cleanup. Add one focused assertion only if needed to show that the child exited or the temporary worktree can be removed immediately after scope close.

**Step 3: Fix lifecycle ownership**

Await the spawned process's real exit and close its Effect scope before running `git worktree remove` or fixture disposal. Keep assertions and default timeout unchanged. Do not add cleanup retries, sleeps, `--force`, or swallowed exit errors.

**Step 4: Verify in fresh processes**

Run the focused file three times with its default timeout, then:

```powershell
Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(bun|node|git)(\.exe)?$' -and $_.CommandLine -match '(opencode-test|bun test)' }
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun typecheck
```

Expected: all runs have the same clean result; no test-owned process/worktree remains.

**Step 5: Commit each independent owner separately**

```powershell
git status --short -- <focused test and exact owner files>
git add <focused test and exact owner files>
git diff --cached -- <focused test and exact owner files>
git commit --only -m "fix(core): await <resource> cleanup" -- <focused test and exact owner files>
git diff --cached --name-only
```

### Task 11: 完成 package-level 与最终矩阵验证

**Files:**
- Modify: `docs/superpowers/reports/2026-07-27-upstream-test-baseline.md`

**Step 1: 运行所有确定性 focused checks**

Run each command from its package:

```text
packages/client
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun test test/promise.test.ts --timeout 5000

packages/tui
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun test test/cli/cmd/tui/sync.test.tsx --timeout 30000 --only-failures

packages/core
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun test test/util/which.test.ts --only-failures

packages/opencode
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun test test/server/httpapi-config.test.ts --timeout 30000 --only-failures
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run script/httpapi-exercise.ts --mode coverage --fail-on-missing --fail-on-skip
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run script/httpapi-exercise.ts --mode auth --fail-on-missing --fail-on-skip
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run script/httpapi-exercise.ts --mode effect --fail-on-missing --fail-on-skip --progress

packages/opencode/webgui
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run test:run src/hooks/useSessionVisibilitySync.test.tsx
```

Expected: all downstream-owned focused checks pass; all HttpApi modes have zero missing/skip/fail.

**Step 2: 运行 owning package default suites**

Run from each package directory:

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run test
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun typecheck
```

Required packages: `packages/client`, `packages/tui`, `packages/core`, `packages/opencode`; add `packages/sdk-next` only if Task 7 executed. A non-zero package result is acceptable only when every remaining signature is already recorded as identical `upstream-known`; any new signature reopens its task.

Untouched Codemode、Effect Drizzle SQLite、HTTP Recorder 和 LLM suites 不重复运行；它们不拥有本计划的改动。若条件任务实际修改其 runtime dependency，再把对应 suite 加回验证矩阵。

**Step 3: 检查进程、完整提交范围与禁止项**

Run from repository root:

```powershell
$start = "<Task 1 report start SHA>"
Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(bun|node)(\.exe)?$' -and $_.CommandLine -match '(bun test|httpapi-exercise|bun run test)' }
git diff --check "$start..HEAD"
git diff --check
git status --short
git diff --name-only "$start..HEAD"
git diff "$start..HEAD" -- packages/client/src/generated packages/client/src/generated-effect
git diff -- packages/client/src/generated packages/client/src/generated-effect
$committed = git diff --unified=0 "$start..HEAD" -- packages
$committed | rg '^\+.*(\.skip\(|\.only\(|retry|Bun\.sleep|Effect\.sleep|setTimeout|--timeout|timeout\s*[:=(])'
if ($LASTEXITCODE -eq 1) { $LASTEXITCODE = 0 } elseif ($LASTEXITCODE -gt 1) { exit $LASTEXITCODE }
$working = git diff --unified=0 -- packages
$working | rg '^\+.*(\.skip\(|\.only\(|retry|Bun\.sleep|Effect\.sleep|setTimeout|--timeout|timeout\s*[:=(])'
if ($LASTEXITCODE -eq 1) { $LASTEXITCODE = 0 } elseif ($LASTEXITCODE -gt 1) { exit $LASTEXITCODE }
```

Expected: no residual process；committed and working-tree `diff --check` exit 0；changed-file list matches report；generated diffs empty；scanner output has no prohibited workaround（`rg` exit 1 means no match and is normalized to success；若命中合法局部 timeout，逐条记录人工判定）；status contains only initial dirty paths plus intended plan/report changes；staged paths equal Task 1 initial set.

**Step 4: 移除保留的 baseline worktree**

Only after every signature is classified and no conditional task needs upstream evidence, run from repository root:

```powershell
git worktree remove "C:\Users\caiqy\AppData\Local\Temp\opencode\upstream-v1.18.6"
git worktree remove "C:\Users\caiqy\AppData\Local\Temp\opencode\current-start"
git worktree prune
```

Expected: clean removal. Do not use `--force`; an occupied worktree reopens its lifecycle investigation.

**Step 5: 更新报告为最终验证证据**

For each candidate record:

- final focused command and exit code;
- package suite result;
- retained `upstream-known` signatures;
- conditional tasks executed or skipped and why;
- residual process check;
- exact final changed-file list.

**Step 6: Commit final report update**

```powershell
git add docs/superpowers/reports/2026-07-27-upstream-test-baseline.md
git diff --cached -- docs/superpowers/reports/2026-07-27-upstream-test-baseline.md
git commit --only -m "docs(test): record downstream recovery verification" -- docs/superpowers/reports/2026-07-27-upstream-test-baseline.md
git diff --cached --name-only
```

**Step 7: 重新检查最终提交边界**

Run from repository root with the same `$start`:

```powershell
git diff --check "$start..HEAD"
git diff --name-only "$start..HEAD"
git status --short
git diff --cached --name-only
```

Expected: full committed range passes whitespace validation；changed files exactly match the report；working tree and staged paths differ from the Task 1 snapshot only by intentionally uncommitted plan/design docs。

## 完成判定

- 所有 `downstream-owned` focused tests 通过。
- package suites 除报告中的相同 `upstream-known` 签名外无失败。
- HttpApi coverage/auth/effect 均完整结束，且 downstream routes 无 missing/skip。
- MCP、session visibility、provider catalog、TUI/WebGUI session filtering 和 `whichAll` 仍存在且有 focused coverage。
- 无残留 Bun/Node 测试进程，无删除 retry/sleep、全局 timeout 增长或 Windows-only production shim。
- 每个提交只包含对应根因文件，不包含 Comet、generated workflow 或既有用户改动。
