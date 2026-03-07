# Runtime Overflow Branching Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 `SessionProcessor` 对运行时 `ContextOverflowError` 采用“首次 compact、compaction 模式下 stop”的条件分支语义。

**Architecture:** 先在现有 `packages/opencode/test/session/retry.test.ts` 中补两条最小行为测试，分别锁定普通 chat 模式下的首次 runtime overflow 和 compaction 模式下的再次 overflow。再只在 `packages/opencode/src/session/processor.ts` 的 catch 分支内做最小条件判断，不改 retry 链和其他 provider 错误语义。

**Tech Stack:** Bun test、TypeScript、OpenCode session pipeline。

---

### Task 1: 条件化 runtime overflow 分支

**Files:**

- Modify: `packages/opencode/test/session/retry.test.ts`
- Modify: `packages/opencode/src/session/processor.ts`

**Step 1: Write the failing test**

在 `packages/opencode/test/session/retry.test.ts` 新增两条用例：

```ts
test("runtime context overflow compacts on first occurrence", async () => {
  expect(result).toBe("compact")
})

test("compaction mode overflow stops instead of compacting again", async () => {
  expect(result).toBe("stop")
})
```

**Step 2: Run test to verify it fails**

Run: `bun test test/session/retry.test.ts --test-name-pattern "runtime context overflow compacts on first occurrence|compaction mode overflow stops instead of compacting again"`

Expected: 第一条 FAIL（当前实现会返回 `stop`），第二条 PASS 或一起 FAIL，取决于当前分支逻辑。

**Step 3: Write minimal implementation**

只在 `packages/opencode/src/session/processor.ts` 的 catch 分支内补一个条件：

```ts
const overflow =
  MessageV2.ContextOverflowError.isInstance(error) && !needsCompaction && input.assistantMessage.mode !== "compaction"

if (overflow) {
  needsCompaction = true
  input.assistantMessage.error = error
  Bus.publish(Session.Event.Error, {
    sessionID: input.sessionID,
    error,
  })
}
```

**Step 4: Run test to verify it passes**

Run: `bun test test/session/retry.test.ts`

Expected: 新增两条边界测试通过，且既有 retry 边界不回退。

**Step 5: Commit**

```bash
git add packages/opencode/test/session/retry.test.ts packages/opencode/src/session/processor.ts
git commit -m "fix(session): branch runtime overflow between compact and stop"
```
