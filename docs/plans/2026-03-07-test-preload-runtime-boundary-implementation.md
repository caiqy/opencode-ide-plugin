# Test preload runtime boundary Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将测试运行时目录清理职责从 `preload.ts` 迁出，并在不扩大回归面的前提下稳住 Windows 与非 Windows 的 teardown 行为。

**Architecture:** 先用一个很薄的结构约束测试锁定 `packages/opencode/test/preload.ts` 只做全局环境初始化，不再内联清理细节。再新增一个独立的测试清理 helper，并让 `preload.ts` 与 `tmpdir` fixture 共同复用它，把 Windows `EBUSY`、SQLite WAL sidecar 和临时目录删除抖动集中到 helper 内处理。

**Tech Stack:** Bun test、TypeScript、`bun:sqlite`、测试 fixture helper。

---

**Run From:** `packages/opencode`

---

### Task 1: 锁定职责边界

**Files:**
- Create: `packages/opencode/test/fixture/preload-boundary.test.ts`
- Modify: `packages/opencode/test/preload.ts`

**Step 1: Write the failing test**

在 `packages/opencode/test/fixture/preload-boundary.test.ts` 新增一个结构约束测试，直接读取 `packages/opencode/test/preload.ts` 源码并断言：

- 仍然保留 XDG / `OPENCODE_TEST_HOME` / `OPENCODE_TEST_MANAGED_CONFIG_DIR` 初始化
- 不再直接出现 `fsSync.rmSync`
- 不再直接出现 `fs.rm(`
- 不再直接包含 Windows `EBUSY` / SQLite WAL 清理分支
- 清理只通过单一 helper 调用完成

示例断言可保持在这种粒度：

```ts
test("preload only initializes global test environment", async () => {
  const source = await Bun.file(new URL("../preload.ts", import.meta.url)).text()

  expect(source).toContain('process.env["XDG_DATA_HOME"]')
  expect(source).toContain('process.env["OPENCODE_TEST_HOME"]')
  expect(source).not.toContain("fsSync.rmSync")
  expect(source).not.toContain("fs.rm(")
  expect(source).not.toContain("EBUSY")
  expect(source).toContain("cleanupTestDir")
})
```

**Step 2: Run test to verify it fails**

Run: `bun test test/fixture/preload-boundary.test.ts`

Expected: FAIL，因为当前 `packages/opencode/test/preload.ts` 仍然内联 `fs.rm(...)` 与 Windows 清理细节，职责边界尚未收紧。

**Step 3: Write minimal implementation**

只对 `packages/opencode/test/preload.ts` 做最小改动：

- 删除内联 `fs/promises` / `fs` / `afterAll` 清理细节
- 保留全局目录创建与环境变量设置
- 将 teardown 改为调用后续 Task 2 提供的 `cleanupTestDir(...)`
- 不在这里引入任何 overflow / compaction / Gemini / WebGUI 相关逻辑

目标形态类似：

```ts
const dir = path.join(os.tmpdir(), "opencode-test-data-" + process.pid)
await fs.mkdir(dir, { recursive: true })

afterAll(async () => {
  await cleanupTestDir(dir)
})
```

**Step 4: Run test to verify it passes**

Run: `bun test test/fixture/preload-boundary.test.ts`

Expected: PASS，且 `preload.ts` 只剩全局测试环境初始化与 helper 接线。

**Step 5: Commit**

仅在用户明确要求提交时执行：

```bash
git add test/fixture/preload-boundary.test.ts test/preload.ts
git commit -m "docs: lock preload test runtime boundary"
```

---

### Task 2: 迁出 Windows 清理逻辑

**Files:**
- Create: `packages/opencode/test/fixture/cleanup.ts`
- Create: `packages/opencode/test/fixture/cleanup.test.ts`
- Modify: `packages/opencode/test/fixture/fixture.ts`
- Modify: `packages/opencode/test/preload.ts`

**Step 1: Write the failing test**

在 `packages/opencode/test/fixture/cleanup.test.ts` 先补两类最小失败用例：

1. `cleanupTestDir` 在 `win32` + 首次 `EBUSY` 时会重试并最终成功  
2. `tmpdir` 的 `[Symbol.asyncDispose]` 不再空转，而是实际委托给 `cleanupTestDir`

建议把平台判断与删除动作做成可注入依赖，避免在测试里硬改 `process.platform`。示例粒度：

```ts
test("cleanupTestDir retries on win32 EBUSY and succeeds", async () => {
  const calls: string[] = []
  await cleanupTestDir("C:\\tmp\\case", {
    platform: "win32",
    rm: async () => {
      calls.push("rm")
      if (calls.length === 1) {
        const err = new Error("busy")
        ;(err as NodeJS.ErrnoException).code = "EBUSY"
        throw err
      }
    },
    sleep: async () => {},
  })

  expect(calls).toHaveLength(2)
})

test("tmpdir asyncDispose delegates to cleanup helper", async () => {
  expect(cleanupSpy).toHaveBeenCalledTimes(1)
})
```

**Step 2: Run test to verify it fails**

Run: `bun test test/fixture/cleanup.test.ts`

Expected: FAIL，因为 `cleanup.ts` 尚不存在，且 `packages/opencode/test/fixture/fixture.ts` 当前没有真正删除临时目录。

**Step 3: Write minimal implementation**

新增 `packages/opencode/test/fixture/cleanup.ts`，只封装测试目录清理，不碰业务代码。实现范围控制在下面三点：

- 导出 `cleanupTestDir(dir, options?)`
- Windows 下仅对 `EBUSY` / `ENOTEMPTY` / 短暂删除抖动做有限次重试
- 删除目录前顺手尝试移除同目录下常见 SQLite sidecar 文件，例如 `*.db-wal`、`*.db-shm`

然后做两处接线：

- `packages/opencode/test/fixture/fixture.ts` 的 `[Symbol.asyncDispose]` 改为 `await cleanupTestDir(dirpath)`
- `packages/opencode/test/preload.ts` 的全局 teardown 改为复用同一个 helper

这里优先采用“独立 cleanup helper + fixture 复用”的最小面方案，不新增 db 生命周期抽象。

**Step 4: Run test to verify it passes**

Run: `bun test test/fixture/cleanup.test.ts`

Expected: PASS，说明 Windows 重试策略与 `tmpdir` 接线都已落地。

**Step 5: Commit**

仅在用户明确要求提交时执行：

```bash
git add test/fixture/cleanup.ts test/fixture/cleanup.test.ts test/fixture/fixture.ts test/preload.ts
git commit -m "docs: move test runtime cleanup out of preload"
```

---

### Task 3: 验证 teardown 不回退

**Files:**
- Modify: `packages/opencode/test/fixture/cleanup.test.ts`

**Step 1: Write the failing test**

继续在 `packages/opencode/test/fixture/cleanup.test.ts` 增加一个更局部的集成测试，覆盖真实 SQLite WAL 场景，但仍保持在测试基础设施层，不耦合会话回归。

建议测试流程：

- 用 `await using tmp = await tmpdir()` 创建目录
- 在 `tmp.path` 下用 `bun:sqlite` 建一个临时数据库
- 执行 `PRAGMA journal_mode = WAL`
- 写入一条记录并 `close()`
- 调用 disposer 后断言目录已被删除

再补一个非 Windows 直通用例，确认非 `win32` 不走多余重试分支。

示例粒度：

```ts
test("tmpdir cleanup removes sqlite wal workspace", async () => {
  const tmp = await tmpdir()
  const dbPath = path.join(tmp.path, "state.db")
  const sqlite = new Database(dbPath)

  sqlite.exec("PRAGMA journal_mode = WAL")
  sqlite.exec("CREATE TABLE test (id INTEGER PRIMARY KEY)")
  sqlite.exec("INSERT INTO test DEFAULT VALUES")
  sqlite.close()

  await tmp[Symbol.asyncDispose]()

  expect(await Bun.file(dbPath).exists()).toBe(false)
})
```

**Step 2: Run test to verify it fails**

Run: `bun test test/fixture/cleanup.test.ts --test-name-pattern "tmpdir cleanup removes sqlite wal workspace|cleanupTestDir skips retry path on non-win32"`

Expected: 至少一条 FAIL，通常会表现为目录或 sidecar 文件残留，或非 Windows 路径断言不满足。

**Step 3: Write minimal implementation**

只在 `packages/opencode/test/fixture/cleanup.ts` 内补足缺失逻辑：

- 确保先处理 WAL / SHM sidecar，再删目录
- 非 Windows 直接单次删除
- Windows 才启用有限次重试与短延迟
- 不把任何 `Session` / `storage/db.ts` 生命周期改造混进这次变更

**Step 4: Run test to verify it passes**

Run: `bun test test/fixture/cleanup.test.ts`

Expected: PASS，覆盖 Windows 模拟重试、非 Windows 直通删除，以及真实 SQLite WAL 清理场景。

然后再跑一次边界相关的最小验证：

Run: `bun test test/fixture/preload-boundary.test.ts test/fixture/cleanup.test.ts`

Expected: 全部 PASS。

**Step 5: Commit**

仅在用户明确要求提交时执行：

```bash
git add test/fixture/cleanup.test.ts test/fixture/cleanup.ts
git commit -m "docs: verify test teardown across wal and platform boundaries"
```

---

### Keep scope

本计划只处理 `packages/opencode/test/preload.ts` 的职责边界与测试运行时清理层级调整。执行时不要顺手带入 `test/session/retry.test.ts`、`test/session/compaction.test.ts`、Gemini provider、WebGUI 或其他回归修复。
