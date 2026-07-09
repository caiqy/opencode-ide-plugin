# Compact Overflow Error Suppression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在普通对话因上下文超限而自动转入 compaction 时，不再先向前端发出中间 `session.error` 误报。

**Architecture:** 保持 `ContextOverflowError -> needsCompaction -> process() 返回 "compact"` 这条恢复链路不变，只移除 `SessionProcessor.halt()` 中这一路径的 `Session.Event.Error` 广播。用一条新的 processor effect 测试锁定“仍返回 compact，但不再发布 session.error”，再跑既有 compaction / stream error / WebGUI session-error 回归测试确认边界没有扩大。

**Tech Stack:** Bun test、Effect、SessionProcessor、Bus、Vitest（WebGUI 回归）

---

### Task 1: 锁定回归测试

**Files:**

- Modify: `packages/opencode/test/session/processor-effect.test.ts`
- Test: `packages/opencode/test/session/processor-effect.test.ts`

- [ ] **Step 1: 在 processor effect 测试里新增红灯用例**

把下面这条测试插入到 `requests compaction on structured context overflow` 附近，复用同文件已有的 `Bus.Service`、`provideTmpdirServer(...)`、`boot()`、`user(...)`、`assistant(...)`、`agent()`、`ref`、`provider.getModel(...)`：

```ts
it.live("suppresses session error when overflow transitions into compaction", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()
        const bus = yield* Bus.Service

        yield* llm.error(400, { type: "error", error: { code: "context_length_exceeded" } })

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "compact json")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const errs: string[] = []
        const off = yield* bus.subscribeCallback(Session.Event.Error, (evt) => {
          if (evt.properties.sessionID !== chat.id) return
          if (!evt.properties.error) return
          errs.push(evt.properties.error.name)
        })

        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
        })

        const value = yield* handle.process({
          user: {
            id: parent.id,
            sessionID: chat.id,
            role: "user",
            time: parent.time,
            agent: parent.agent,
            model: { providerID: ref.providerID, modelID: ref.modelID },
          } satisfies MessageV2.User,
          sessionID: chat.id,
          model: mdl,
          agent: agent(),
          system: [],
          messages: [{ role: "user", content: "compact json" }],
          tools: {},
        })

        off()

        expect(value).toBe("compact")
        expect(handle.message.error).toBeUndefined()
        expect(errs).toEqual([])
      }),
    { config: (url) => providerCfg(url) },
  ),
)
```

- [ ] **Step 2: 运行新测试，确认当前实现先红灯**

Run:

```bash
bun test test/session/processor-effect.test.ts --test-name-pattern "suppresses session error when overflow transitions into compaction"
```

Expected: FAIL，通常会表现为 `expect(errs).toEqual([])` 不成立，数组里含有 `ContextOverflowError`。

- [ ] **Step 3: 提交测试红灯快照（可选，若你在小步提交）**

```bash
git add packages/opencode/test/session/processor-effect.test.ts
git commit -m "test(session): cover suppressed overflow error before compaction"
```

如果你不打算保留红灯提交，这一步跳过。

### Task 2: 最小实现后端抑制逻辑

**Files:**

- Modify: `packages/opencode/src/session/processor.ts`
- Test: `packages/opencode/test/session/processor-effect.test.ts`

- [ ] **Step 1: 修改 `halt()` 的 overflow 分支，只保留 compaction 信号**

把 `packages/opencode/src/session/processor.ts` 中这段代码：

```ts
if (MessageV2.ContextOverflowError.isInstance(error)) {
  ctx.needsCompaction = true
  yield * bus.publish(Session.Event.Error, { sessionID: ctx.sessionID, error })
  return
}
```

改成：

```ts
if (MessageV2.ContextOverflowError.isInstance(error)) {
  ctx.needsCompaction = true
  return
}
```

不要顺手改动其他错误分支，也不要修改 `ctx.assistantMessage.error` 的普通错误处理逻辑。

- [ ] **Step 2: 运行新测试，确认现在转绿**

Run:

```bash
bun test test/session/processor-effect.test.ts --test-name-pattern "suppresses session error when overflow transitions into compaction"
```

Expected: PASS。

- [ ] **Step 3: 运行同文件里原有 overflow 行为测试**

Run:

```bash
bun test test/session/processor-effect.test.ts --test-name-pattern "requests compaction on structured context overflow"
```

Expected: PASS，确认仍然返回 `"compact"`，只是不再对外广播 `session.error`。

- [ ] **Step 4: 提交最小实现**

```bash
git add packages/opencode/src/session/processor.ts packages/opencode/test/session/processor-effect.test.ts
git commit -m "fix(session): suppress overflow error during auto compaction"
```

### Task 3: 跑回归并确认边界

**Files:**

- Test: `packages/opencode/test/session/compaction.test.ts`
- Test: `packages/opencode/test/session/message-v2.stream-error.test.ts`
- Test: `packages/opencode/webgui/src/state/MessagesContext.session-error.test.tsx`

- [ ] **Step 1: 确认 compaction 自身失败的最终错误仍保留**

Run:

```bash
bun test test/session/compaction.test.ts --test-name-pattern "marks summary message as errored on compact result"
```

Expected: PASS，确保 compact 真失败时仍然落最终错误，不会被这次修复吞掉。

- [ ] **Step 2: 确认 overflow 分类逻辑没有被破坏**

Run:

```bash
bun test test/session/message-v2.stream-error.test.ts --test-name-pattern "keeps recovered context overflow as ContextOverflowError"
```

Expected: PASS，说明 `MessageV2.fromError()` 仍然把 overflow 归类成 `ContextOverflowError`。

- [ ] **Step 3: 确认 WebGUI 现有 synthetic error 清理逻辑仍正常**

Run:

```bash
bun run test:run src/state/MessagesContext.session-error.test.tsx
```

Expected: PASS，说明前端现有“收到 `session.error` 就显示、收到 `session.compacted` 就清理”的通用逻辑没有被破坏；这次修复只是让目标场景不再收到那条中间错误事件。

- [ ] **Step 4: 检查工作区状态**

Run:

```bash
git status --short --branch
```

Expected: 只出现这次计划内修改；如果已经 commit，则工作区干净。

- [ ] **Step 5: 如果前面还没提交，补最终提交**

```bash
git add packages/opencode/src/session/processor.ts packages/opencode/test/session/processor-effect.test.ts
git commit -m "fix(session): suppress overflow error during auto compaction"
```

## 计划自检

- **Spec coverage:**
  - “auto compaction 时不再先向前端发 session.error” → Task 1 + Task 2
  - “仍然返回 compact 并继续 compaction” → Task 2 Step 3
  - “compaction 失败仍保留最终错误” → Task 3 Step 1
  - “前端通用 session-error 逻辑不破坏” → Task 3 Step 3
- **Placeholder scan:** 无 `TODO` / `TBD` / “自行处理” 类占位语句。
- **Type consistency:** 使用的事件名、错误名、测试 helper、文件路径均与现有代码一致：`Session.Event.Error`、`MessageV2.ContextOverflowError`、`provideTmpdirServer(...)`、`boot()`、`agent()`、`providerCfg(url)`。
