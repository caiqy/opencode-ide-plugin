# non-git 项目身份与 worktree 语义重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 non-git 目录拥有独立稳定的项目身份与真实 `worktree`，并把历史 `project_id = global` 的 non-git session 迁移到按目录隔离的新项目下。

**Architecture:** 先用测试锁定 non-git 目录的稳定 `ProjectID`、generated image 落点、config 边界和 legacy global session 迁移行为，再在 `project` 层引入目录级 non-git id 生成与运行时兜底迁移，最后清理所有依赖 `worktree === "/"` 的哨兵分支。数据库侧的 SQL migration 保持安全 no-op，不直接生成 hashed non-git project id；真正的 legacy non-git 一次性迁移在 `packages/opencode/src/storage/db.ts` 的数据库打开路径执行，并在迁移完成后清理孤立的 `global` project 占位行。

**Tech Stack:** TypeScript、Effect v4、Bun test、SQLite migration、`@opencode-ai/core/filesystem`、`@opencode-ai/core/util/hash`

---

## 文件结构与职责

- Modify: `packages/opencode/src/project/schema.ts` — 定义 non-git 稳定 `ProjectID` 生成与判定 helper。
- Modify: `packages/opencode/src/project/project.ts` — 把 `!dotgit` fallback 改成目录级身份，并加入 legacy global session 运行时兜底迁移。
- Modify: `packages/opencode/src/project/instance.ts` — 去掉 `worktree === "/"` 特判，直接基于真实目录判断包含关系。
- Modify: `packages/opencode/src/lsp/lsp.ts` — 改写 non-git 边界判断，停止依赖 `"/"` 哨兵。
- Modify: `packages/opencode/src/plugin/install.ts` — 改写 plugin patch 目录是否视为 git 项目的判定。
- Modify: `packages/opencode/src/cli/cmd/tui/plugin/runtime.ts` — 改写 TUI plugin runtime 的 `vcs` 推断逻辑。
- Modify: `packages/opencode/src/config/paths.ts` — 保持 `stop = worktree`，但用测试锁住 non-git 边界收敛后的行为。
- Create: `packages/opencode/migration/20260512170000_non_git_project_identity/migration.sql` — 一次性迁移 legacy `project_id = global` 的 non-git session。
- Modify: `packages/opencode/src/storage/db.ts` — 在启动期迁移后清理孤立 `global` project 占位行，并记录这一策略。
- Modify: `packages/opencode/test/project/project.test.ts` — 锁定 non-git 目录稳定 `ProjectID` 与 `worktree = directory`。
- Modify: `packages/opencode/test/server/global-session-list.test.ts` — 锁定 non-git session 的 project metadata 分离行为。
- Modify: `packages/opencode/test/server/httpapi-instance.test.ts` — 锁定 `/project` 不返回迁移后残留的 legacy `global` 占位项目。
- Modify: `packages/opencode/test/server/generated-image-route.test.ts` — 锁定 non-git 下 generated image 路由从当前目录读取。
- Modify: `packages/opencode/test/config/config.test.ts` — 锁定 non-git config upward search 不再越过目录边界。

---

### Task 1: 先锁定 non-git 项目身份与会话归属

**Files:**

- Modify: `packages/opencode/test/project/project.test.ts`
- Modify: `packages/opencode/test/server/global-session-list.test.ts`

- [ ] **Step 1: 在 `project.test.ts` 中新增 non-git 稳定身份失败测试**

把下面两个测试追加到 `describe("Project.fromDirectory", ...)` 里，放在现有 `returns global for non-git directory` 用例附近，并删除旧断言 `expect(project.id).toBe(ProjectID.global)`：

```ts
test("returns a stable non-git project id for plain directories", async () => {
  await using tmp = await tmpdir()

  const { project: a, sandbox: sandboxA } = await run((svc) => svc.fromDirectory(tmp.path))
  const { project: b, sandbox: sandboxB } = await run((svc) => svc.fromDirectory(tmp.path))

  expect(a.id).not.toBe(ProjectID.global)
  expect(b.id).toBe(a.id)
  expect(a.worktree).toBe(tmp.path)
  expect(b.worktree).toBe(tmp.path)
  expect(sandboxA).toBe(tmp.path)
  expect(sandboxB).toBe(tmp.path)
  expect(a.vcs).toBeUndefined()
})

test("assigns different non-git project ids to different directories", async () => {
  await using first = await tmpdir()
  await using second = await tmpdir()

  const { project: a } = await run((svc) => svc.fromDirectory(first.path))
  const { project: b } = await run((svc) => svc.fromDirectory(second.path))

  expect(a.id).not.toBe(ProjectID.global)
  expect(b.id).not.toBe(ProjectID.global)
  expect(a.id).not.toBe(b.id)
})
```

- [ ] **Step 2: 在 `global-session-list.test.ts` 中新增 non-git 会话隔离失败测试**

把下面测试追加到 `describe("session.listGlobal", ...)` 末尾：

```ts
test("keeps non-git sessions attached to different project metadata per directory", async () => {
  await using first = await tmpdir()
  await using second = await tmpdir()

  const firstSession = await Instance.provide({
    directory: first.path,
    fn: async () => svc.create({ title: "plain-first" }),
  })
  const secondSession = await Instance.provide({
    directory: second.path,
    fn: async () => svc.create({ title: "plain-second" }),
  })

  const sessions = [...svc.listGlobal({ limit: 200 })]
  const firstItem = sessions.find((session) => session.id === firstSession.id)
  const secondItem = sessions.find((session) => session.id === secondSession.id)

  expect(firstItem?.project?.id).toBe(firstSession.projectID)
  expect(secondItem?.project?.id).toBe(secondSession.projectID)
  expect(firstItem?.project?.id).not.toBe(secondItem?.project?.id)
  expect(firstItem?.project?.worktree).toBe(first.path)
  expect(secondItem?.project?.worktree).toBe(second.path)
})
```

- [ ] **Step 3: 运行测试，确认它们先失败**

Run: `bun test test/project/project.test.ts test/server/global-session-list.test.ts`

Expected: FAIL，至少出现以下一种失败：

- `Expected: not "global"`
- `Expected project ids to differ`
- `Expected worktree to be <tmp.path> but received "/"`

- [ ] **Step 4: 提交只包含测试的失败保护**

```bash
git add packages/opencode/test/project/project.test.ts packages/opencode/test/server/global-session-list.test.ts
git commit -m "test: lock non-git project identity semantics"
```

---

### Task 2: 锁定 non-git 下的 generated image 与 config 边界

**Files:**

- Modify: `packages/opencode/test/server/generated-image-route.test.ts`
- Modify: `packages/opencode/test/config/config.test.ts`

- [ ] **Step 1: 在 generated image 路由测试中新增 non-git 目录场景**

把下面测试追加到 `describe("generated image route", ...)` 里，放在“serves generated images from the worktree root when instance directory is a project subdirectory”后面：

```ts
test("serves generated images from the current directory for non-git projects", async () => {
  await using tmp = await tmpdir()
  const relativePath = ".opencode/generated-images/generated-image-msg_plain-1.png"
  const absolutePath = path.join(tmp.path, ".opencode", "generated-images", "generated-image-msg_plain-1.png")

  await fs.mkdir(path.dirname(absolutePath), { recursive: true })
  await Bun.write(absolutePath, pngBytes)

  const response = await request(tmp.path, relativePath)

  expect(response.status).toBe(200)
  expect(response.headers.get("content-type")).toContain("image/png")
  expect(Buffer.from(await response.arrayBuffer())).toEqual(pngBytes)
})
```

- [ ] **Step 2: 在 `config.test.ts` 中新增 non-git upward-search 边界失败测试**

把下面测试追加到文件里靠近现有 config discovery 测试的位置：

```ts
test("non-git config discovery stops at the current directory instead of climbing to drive root", async () => {
  await using root = await tmpdir()
  const parent = path.join(root.path, "parent")
  const child = path.join(parent, "child")
  await fs.mkdir(path.join(parent, ".opencode"), { recursive: true })
  await fs.mkdir(child, { recursive: true })

  await writeConfig(path.join(parent, ".opencode"), {
    $schema: "https://opencode.ai/config.json",
    model: "parent/model",
  })

  await Instance.provide({
    directory: child,
    fn: async () => {
      const dirs = await listDirs()
      const localParent = path.join(parent, ".opencode")
      expect(dirs).not.toContain(localParent)
    },
  })
})
```

- [ ] **Step 3: 运行测试，确认它们在实现前失败**

Run: `bun test test/server/generated-image-route.test.ts test/config/config.test.ts`

Expected: FAIL，至少出现以下一种失败：

- generated image route 返回 `404`
- `dirs` 里仍然包含父目录 `.opencode`

- [ ] **Step 4: 提交这组边界测试**

```bash
git add packages/opencode/test/server/generated-image-route.test.ts packages/opencode/test/config/config.test.ts
git commit -m "test: lock non-git path boundaries"
```

---

### Task 3: 实现 non-git 稳定 `ProjectID` 与 legacy global session 迁移

**Files:**

- Modify: `packages/opencode/src/project/schema.ts`
- Modify: `packages/opencode/src/project/project.ts`
- Create: `packages/opencode/migration/20260512170000_non_git_project_identity/migration.sql`

补充：当前实现采用 `src/storage/db.ts` 启动期迁移 + 清理 trigger/兜底删除孤立 `global` 行，而不是在 SQL migration 内直接生成 hashed non-git project id；原因是当前 Bun/SQLite 环境无法可靠复现 `ProjectID.nonGit()` 的运行时哈希算法。

- [ ] **Step 1: 在 `schema.ts` 中添加 non-git 项目 id helper**

将文件内容改成下面这样，保留现有 `ProjectID.global`，并新增稳定 non-git id 生成与判定 helper：

```ts
import { Schema } from "effect"
import { Hash } from "@opencode-ai/core/util/hash"
import { AppFileSystem } from "@opencode-ai/core/filesystem"

import { zod } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"

const projectIdSchema = Schema.String.pipe(Schema.brand("ProjectID"))
const NON_GIT_PREFIX = "local_"

export type ProjectID = typeof projectIdSchema.Type

function normalizeNonGitDirectory(directory: string) {
  const resolved = AppFileSystem.resolve(directory)
  const normalized = process.platform === "win32" ? AppFileSystem.normalizePath(resolved).toLowerCase() : resolved
  const root = AppFileSystem.resolve(process.platform === "win32" ? normalized.slice(0, 3) : "/")
  if (normalized === root) return normalized
  return normalized.replace(/[\\/]+$/, "")
}

export const ProjectID = projectIdSchema.pipe(
  withStatics((schema: typeof projectIdSchema) => ({
    global: schema.make("global"),
    nonGit(directory: string) {
      return schema.make(`${NON_GIT_PREFIX}${Hash.fast(normalizeNonGitDirectory(directory))}`)
    },
    isNonGit(value: ProjectID) {
      return value.startsWith(NON_GIT_PREFIX)
    },
    zod: zod(schema),
  })),
)
```

- [ ] **Step 2: 在 `project.ts` 中把 `!dotgit` fallback 改成目录级身份**

把 `fromDirectory()` 里 `!dotgit` 分支从：

```ts
if (!dotgit) {
  return {
    id: ProjectID.global,
    worktree: "/",
    sandbox: "/",
    vcs: fakeVcs,
  }
}
```

改成：

```ts
if (!dotgit) {
  return {
    id: ProjectID.nonGit(directory),
    worktree: directory,
    sandbox: directory,
    vcs: fakeVcs,
  }
}
```

并在 `fromDirectory()` 的 `db` helper 下方新增运行时兜底迁移函数：

```ts
const migrateLegacyGlobalSessions = Effect.fn("Project.migrateLegacyGlobalSessions")(function* (input: {
  directory: string
  projectID: ProjectID
}) {
  const directory = AppFileSystem.resolve(input.directory)
  yield* db((d) =>
    d
      .update(SessionTable)
      .set({ project_id: input.projectID })
      .where(and(eq(SessionTable.project_id, ProjectID.global), eq(SessionTable.directory, directory)))
      .run(),
  )
})
```

然后在 `yield* db((d) => d.insert(ProjectTable) ... )` 之后、`emitUpdated(result)` 之前，补上：

```ts
if (ProjectID.isNonGit(result.id)) {
  yield *
    migrateLegacyGlobalSessions({
      directory: data.sandbox,
      projectID: result.id,
    })
}
```

保留原有：

```ts
if (data.id !== ProjectID.global) {
  // git init / root-commit migration branch
}
```

不要把 no-commit git repo 的 `ProjectID.global` 行为一起改掉。

- [ ] **Step 3: 新增一次性 SQL migration，拆分 legacy global non-git session**

创建 `packages/opencode/migration/20260512170000_non_git_project_identity/migration.sql`，写入下面内容：

```sql
INSERT INTO project (
  id,
  worktree,
  vcs,
  name,
  icon_url,
  icon_url_override,
  icon_color,
  time_created,
  time_updated,
  time_initialized,
  sandboxes,
  commands
)
SELECT
  'local_' || lower(hex(sha3_256(lower(replace(directory, '\\', '/'))))),
  directory,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  MIN(time_created),
  MAX(time_updated),
  NULL,
  '[]',
  NULL
FROM session
WHERE project_id = 'global'
  AND directory IS NOT NULL
  AND directory != ''
  AND directory NOT LIKE '%/.git%'
GROUP BY directory
ON CONFLICT(id) DO UPDATE SET
  worktree = excluded.worktree,
  time_updated = excluded.time_updated;

UPDATE session
SET project_id = 'local_' || lower(hex(sha3_256(lower(replace(directory, '\\', '/')))))
WHERE project_id = 'global'
  AND directory IS NOT NULL
  AND directory != ''
  AND directory NOT LIKE '%/.git%';
```

如果本地 SQLite 不支持 `sha3_256`，在实现时不要拍脑袋改 SQL；先运行 migration 命令确认能力，再按仓库现有 migration 机制调整为可执行的等价表达（例如运行时代码兜底覆盖）。

- [ ] **Step 4: 运行聚焦测试，确认实现通过**

Run: `bun test test/project/project.test.ts test/server/global-session-list.test.ts test/server/generated-image-route.test.ts test/config/config.test.ts`

Expected: PASS

- [ ] **Step 5: 提交身份模型与迁移实现**

```bash
git add packages/opencode/src/project/schema.ts packages/opencode/src/project/project.ts packages/opencode/migration/20260512170000_non_git_project_identity/migration.sql
git commit -m "feat: give non-git directories stable project identities"
```

### 测试隔离结论

- 包级测试默认用 `resetDatabase()` 清理 `Database.Client()` 单例、WAL 文件和实例缓存。
- 涉及 `OPENCODE_DB`/XDG 环境切换、冷启动迁移和模块单例初始化顺序的回归，必须用 `Bun.spawn(...)` 启动独立进程验证；同进程内重复开关数据库会被已加载模块和打开句柄污染，容易把迁移问题测成假绿。

---

### Task 4: 清理 `"/"` 哨兵消费者并完成全链路回归

**Files:**

- Modify: `packages/opencode/src/project/instance.ts`
- Modify: `packages/opencode/src/lsp/lsp.ts`
- Modify: `packages/opencode/src/plugin/install.ts`
- Modify: `packages/opencode/src/cli/cmd/tui/plugin/runtime.ts`
- Modify: `packages/opencode/test/config/config.test.ts`

- [ ] **Step 1: 在 `instance.ts` 中删除 `worktree === "/"` 特判**

把：

```ts
if (AppFileSystem.contains(instance.directory, filepath)) return true
// Non-git projects set worktree to "/" which would match ANY absolute path.
// Skip worktree check in this case to preserve external_directory permissions.
if (instance.worktree === "/") return false
return AppFileSystem.contains(instance.worktree, filepath)
```

改成：

```ts
if (AppFileSystem.contains(instance.directory, filepath)) return true
return AppFileSystem.contains(instance.worktree, filepath)
```

并把注释改成：

```ts
/**
 * Returns true if path is inside Instance.directory OR Instance.worktree.
 * For non-git projects, directory and worktree are the same real directory.
 * For git worktrees opened from subdirectories, worktree stays anchored at the repo root.
 */
```

- [ ] **Step 2: 在 `lsp.ts`、`plugin/install.ts`、`runtime.ts` 中移除路径哨兵判断**

把 `lsp.ts` 的判断从：

```ts
if (
  !AppFileSystem.contains(ctx.directory, file) &&
  (ctx.worktree === "/" || !AppFileSystem.contains(ctx.worktree, file))
) {
  return [] as LSPClient.Info[]
}
```

改成：

```ts
if (!AppFileSystem.contains(ctx.directory, file) && !AppFileSystem.contains(ctx.worktree, file)) {
  return [] as LSPClient.Info[]
}
```

把 `plugin/install.ts` 的：

```ts
const git = input.vcs === "git" && input.worktree !== "/"
```

改成：

```ts
const git = input.vcs === "git"
```

把 `cli/cmd/tui/plugin/runtime.ts` 的：

```ts
vcs: dir.worktree && dir.worktree !== "/" ? "git" : undefined,
```

改成：

```ts
vcs: dir.vcs === "git" ? "git" : undefined,
```

如果 `dir` 当前没有 `vcs` 字段，就在构造该对象的上游把 `project.vcs` 显式透传下来，不要继续从 `worktree` 推断 git。

- [ ] **Step 3: 运行全量相关测试**

在运行测试前，先把 `packages/opencode/test/config/config.test.ts` 中依赖“non-git 会继续向上合并父目录 config”的旧断言改成符合新设计的语义。

需要调整的失败用例包括：

- `merges plugin arrays from global and local configs`
- `merges instructions arrays from global and local configs`
- `deduplicates duplicate instructions from global and local configs`
- `deduplicates duplicate plugins from global and local configs`
- `keeps plugin origins aligned with merged plugin list`
- `deduplicatePluginOrigins > loads auto-discovered local plugins as file urls`

调整原则：

1. **不要恢复旧生产语义。** non-git 项目的 config discovery 现在必须以当前目录为边界收敛。
2. 这些测试若想继续验证“global + local merge”，就必须把所谓 global 层改为真实 global config 位置（`Global.Path.config`），而不是放在 non-git 父目录。
3. 若测试只是想验证 local 合并 / 去重，就把夹具收敛到当前 non-git 项目目录边界内，不再依赖父目录参与发现。

完成这些断言调整后，再运行下面的测试命令。

- [ ] **Step 4: 运行全量相关测试**

Run: `bun test test/project/project.test.ts test/server/global-session-list.test.ts test/server/generated-image-route.test.ts test/config/config.test.ts test/tool/generate-image.test.ts test/tool/lsp.test.ts`

Expected: PASS

- [ ] **Step 5: 运行 package 级回归检查**

Run: `bun test`

Expected: 全部 PASS；如果存在与旧 `ProjectID.global` / `worktree === "/"` 语义绑定的测试快照，按新设计更新断言，不要用跳过测试掩盖行为变化。

- [ ] **Step 6: 提交哨兵清理与回归调整**

```bash
git add packages/opencode/src/project/instance.ts packages/opencode/src/lsp/lsp.ts packages/opencode/src/plugin/install.ts packages/opencode/src/cli/cmd/tui/plugin/runtime.ts packages/opencode/test/project/project.test.ts packages/opencode/test/server/global-session-list.test.ts packages/opencode/test/server/generated-image-route.test.ts packages/opencode/test/config/config.test.ts packages/opencode/test/tool/generate-image.test.ts packages/opencode/test/tool/lsp.test.ts
git commit -m "refactor: remove non-git worktree sentinel paths"
```

---

## Plan Self-Review

- **Spec coverage:** 已覆盖 non-git 稳定身份、`worktree = directory`、legacy global session 迁移、generated image 路径、config 边界、`"/"` 哨兵消费者清理。
- **Placeholder scan:** 没有 `TBD`、`TODO`、`implement later`、`similar to task N` 之类占位描述。
- **Type consistency:** 计划中统一使用 `ProjectID.nonGit(...)`、`ProjectID.isNonGit(...)`、`migrateLegacyGlobalSessions(...)` 三个命名；后续任务引用保持一致。

---

### Task 5: 补齐 non-git plan 路径与 legacy 一次性迁移缺口

**Files:**

- Modify: `packages/opencode/src/session/session.ts`
- Modify: `packages/opencode/test/session/session.test.ts`
- Modify: `packages/opencode/migration/20260512170000_non_git_project_identity/migration.sql`
- Modify: `packages/opencode/test/server/global-session-list.test.ts`

- [ ] **Step 1: 先补 non-git plan 路径失败测试**

在 `packages/opencode/test/session/session.test.ts` 中新增一条 non-git 回归测试，验证 `Session.plan()` 不再把 non-git plan 写到 `Global.Path.data/plans`，而是落到当前目录 `.opencode/plans`。

```ts
test("stores non-git plans inside the current directory .opencode/plans", async () => {
  await using tmp = await tmpdir()

  const output = await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const filepath = Session.plan({
        slug: "plain-plan",
        time: { created: 123 },
      })
      return filepath
    },
  })

  expect(output).toBe(path.join(tmp.path, ".opencode", "plans", "123-plain-plan.md"))
})
```

- [ ] **Step 2: 再补 legacy non-git 一次性迁移可见性失败测试**

在 `packages/opencode/test/server/global-session-list.test.ts` 中新增一条测试：仅依赖数据库 migration / 启动后的稳定状态，而不是 reopen 目录触发 runtime fallback，验证 legacy non-git session 能在 `listGlobal()` 里脱离 `project_id = global` 视图。

```ts
test("does not leave legacy non-git sessions attached to global project metadata after migration", async () => {
  await using tmp = await tmpdir()

  const session = await Instance.provide({
    directory: tmp.path,
    fn: async () => svc.create({ title: "legacy-visible" }),
  })

  expect(session.projectID).not.toBe(ProjectID.global)

  const items = [...svc.listGlobal({ directory: tmp.path, limit: 50 })]
  const match = items.find((item) => item.id === session.id)

  expect(match?.project?.id).toBe(session.projectID)
  expect(match?.project?.worktree).toBe(tmp.path)
  expect(match?.project?.id).not.toBe(ProjectID.global)
})
```

如果测试证明当前覆盖不足，则在此基础上把 fixture 再收紧成直接写 legacy row 的形式，但不要先写生产代码。

- [ ] **Step 3: 运行测试，确认至少一条在当前实现下失败**

Run: `bun test test/session/session.test.ts test/server/global-session-list.test.ts`

Expected: 在修复前，至少看到非 git plan 路径仍落到 `Global.Path.data/plans` 或 legacy 可见性断言不满足。

- [ ] **Step 4: 修复 `Session.plan()` 的 non-git 路径**

把 `packages/opencode/src/session/session.ts` 中：

```ts
const base = Instance.project.vcs
  ? path.join(Instance.worktree, ".opencode", "plans")
  : path.join(Global.Path.data, "plans")
```

改成：

```ts
const base = path.join(Instance.worktree, ".opencode", "plans")
```

不要再按 `project.vcs` 把 non-git plan 分流到全局目录。

- [ ] **Step 5: 把 migration 从 no-op 提升为真正的一次性迁移实现**

如果 SQLite 侧无法稳定复现 `ProjectID.nonGit(directory)` 的哈希算法，就不要继续尝试纯 SQL 哈希。

改用“**最小正确方案**”：

1. 在 migration 文件中只完成可以安全执行的数据准备步骤；
2. 若仓库 migration 机制无法在 SQL 中调用同一套 hash helper，则把一次性迁移逻辑迁回 TypeScript 启动路径，并补一个**全库扫描的一次性迁移入口**，确保历史 legacy non-git session 不需要 reopen 目录也能被处理；
3. 该入口必须幂等，并在首次数据库打开阶段运行。

此步骤允许你根据仓库现有 migration 机制，把 `migration.sql` 保持为安全 no-op，同时在 TypeScript 启动/数据库初始化路径中新增“全量 legacy non-git session 迁移”逻辑；但无论采用哪种落点，都必须满足“无需 reopen 目录即可从 global 语义中脱离”的要求。

- [ ] **Step 6: 重新运行聚焦测试**

Run: `bun test test/session/session.test.ts test/server/global-session-list.test.ts test/project/project.test.ts test/server/generated-image-route.test.ts test/config/config.test.ts test/tool/generate-image.test.ts test/tool/lsp.test.ts test/file/path-traversal.test.ts`

Expected: PASS

- [ ] **Step 7: 再跑 package 级 `bun test`，记录是否仍有无关失败**

Run: `bun test`

Expected: 如果仍有失败，必须区分“与本次改动直接相关”还是“仓库既有无关失败”，并保留证据。
