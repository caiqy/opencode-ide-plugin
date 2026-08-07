# WebGUI 标签持久化一致性实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 保证 WebGUI 标签快照按操作顺序持久化，关闭的空白标签不会被旧写入复活，连续重启保持完整标签集合。

**架构：** `scopedStorage` 在 `scope + key` 粒度提供串行写、read-your-writes 和 flush；`tabStore` 是标签完整快照的唯一组装者，不再通过 repository 做 read-modify-write；WebGUI 主动重启前等待 scoped storage 队列清空。

**技术栈：** TypeScript、React 19、Vitest 4、Testing Library、IDE Bridge scoped storage。

## 全局约束

- 不新增依赖、宿主协议版本、CAS 或跨 WebGUI 实例冲突处理。
- 不改变最多六个标签、会话创建、删除和历史列表策略。
- 关闭未对话的 `New session` 只移除打开标签，不删除服务端 session，也不清理草稿复用指针。
- 同 key 写入失败不得阻断后续写入；不同 key 不得互相阻塞。
- 使用 vfox 管理的 Bun；测试和构建从 `packages/opencode/webgui` 运行，禁止从仓库根目录运行测试。
- 每个通过复核的任务创建 conventional commit；仅暂存本计划列出的文件。

---

## 文件职责

- `packages/opencode/webgui/src/state/scopedStorage.ts`：提供 scoped storage cache、按 key 写入顺序、read-your-writes 和全局 flush。
- `packages/opencode/webgui/src/state/scopedStorage.test.ts`：验证乱序防护、失败后继续和 flush。
- `packages/opencode/webgui/src/state/tabStore.ts`：在内存中组装并保存完整标签快照。
- `packages/opencode/webgui/src/state/tabStore.test.ts`：验证激活、关闭和连续恢复使用完整快照。
- `packages/opencode/webgui/src/state/repo/tabsRepo.ts`：只负责标签快照解析、加载和保存。
- `packages/opencode/webgui/src/state/repo/tabsRepo.test.ts`：验证 repository 的完整快照边界。
- `packages/opencode/webgui/src/components/CompactHeader/index.tsx`：重启前 flush scoped storage。
- `packages/opencode/webgui/src/components/CompactHeader/index.test.tsx`：验证 flush 完成前不发送 `restartHost`。

### Task 1：为 scoped storage 建立顺序和 flush 保证

**Files:**
- Modify: `packages/opencode/webgui/src/state/scopedStorage.ts`
- Test: `packages/opencode/webgui/src/state/scopedStorage.test.ts`

**Interfaces:**
- Produces: `flushScopedStateWrites(): Promise<void>`
- Preserves: `scopedStateSet(scope, key, value): Promise<ScopedStateWriteResult>`
- Preserves: `scopedStateGet(scope, keys): Promise<Record<string, string | undefined>>`

- [ ] **Step 1：加入可控 Promise 测试工具和失败测试**

在 `scopedStorage.test.ts` 的 imports 后加入：

```ts
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
```

把 `flushScopedStateWrites` 加入现有 import，并加入以下测试：

```ts
it("同 key 写入串行执行且待写期间读取内存最新值", async () => {
  vi.mocked(ideBridge.isInstalled).mockReturnValue(true)
  const first = deferred<boolean>()
  vi.mocked(ideBridge.storageSet).mockImplementationOnce(() => first.promise).mockResolvedValueOnce(true)
  vi.mocked(ideBridge.storageGet).mockResolvedValue({
    "opencode:webgui:workspace:tabs:v1": JSON.stringify({ open_tabs: ["old"], active_tab: "old" }),
  })

  const one = scopedStateSetJSON("workspace", "opencode:webgui:workspace:tabs:v1", {
    open_tabs: ["s1"],
    active_tab: "s1",
  })
  const two = scopedStateSetJSON("workspace", "opencode:webgui:workspace:tabs:v1", {
    open_tabs: ["s1", "s2"],
    active_tab: "s2",
  })

  await vi.waitFor(() => expect(ideBridge.storageSet).toHaveBeenCalledTimes(1))
  await expect(
    scopedStateGetJSON("workspace", "opencode:webgui:workspace:tabs:v1", {
      open_tabs: [],
      active_tab: "",
    }),
  ).resolves.toEqual({ open_tabs: ["s1", "s2"], active_tab: "s2" })

  first.resolve(true)
  await Promise.all([one, two])
  expect(vi.mocked(ideBridge.storageSet).mock.calls.map((call) => call[2])).toEqual([
    JSON.stringify({ open_tabs: ["s1"], active_tab: "s1" }),
    JSON.stringify({ open_tabs: ["s1", "s2"], active_tab: "s2" }),
  ])
})

it("同 key 写失败后继续执行后续写入", async () => {
  vi.mocked(ideBridge.isInstalled).mockReturnValue(true)
  vi.mocked(ideBridge.storageSet).mockResolvedValueOnce(false).mockResolvedValueOnce(true)

  const first = scopedStateSetJSON("workspace", "key", "old")
  const second = scopedStateSetJSON("workspace", "key", "new")

  await expect(first).resolves.toEqual({ ok: false, error: "host_write_failed" })
  await expect(second).resolves.toEqual({ ok: true })
  expect(ideBridge.storageSet).toHaveBeenNthCalledWith(1, "workspace", "key", JSON.stringify("old"))
  expect(ideBridge.storageSet).toHaveBeenNthCalledWith(2, "workspace", "key", JSON.stringify("new"))
})

it("flush 等待当前及期间追加的 scoped storage 写入", async () => {
  vi.mocked(ideBridge.isInstalled).mockReturnValue(true)
  const first = deferred<boolean>()
  const second = deferred<boolean>()
  vi.mocked(ideBridge.storageSet).mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise)

  const one = scopedStateSetJSON("workspace", "key", "one")
  let flushed = false
  const flush = flushScopedStateWrites().then(() => {
    flushed = true
  })
  const two = scopedStateSetJSON("workspace", "key", "two")

  await vi.waitFor(() => expect(ideBridge.storageSet).toHaveBeenCalledTimes(1))
  expect(flushed).toBe(false)
  first.resolve(true)
  await vi.waitFor(() => expect(ideBridge.storageSet).toHaveBeenCalledTimes(2))
  expect(flushed).toBe(false)
  second.resolve(true)
  await Promise.all([one, two, flush])
  expect(flushed).toBe(true)
})
```

- [ ] **Step 2：运行测试并确认旧实现失败**

Working directory: `packages/opencode/webgui`

```bash
bun run test:run src/state/scopedStorage.test.ts
```

Expected: FAIL；第二次 `storageSet` 会在第一次完成前开始，读取可能返回宿主旧值，且 `flushScopedStateWrites` 尚未导出。

- [ ] **Step 3：实现 per-key 写入链和 flush**

在 `scopedStorage.ts` 的 `dirty` 后加入：

```ts
const writes = {
  global: new Map<string, Promise<ScopedStateWriteResult>>(),
  workspace: new Map<string, Promise<ScopedStateWriteResult>>(),
  mem: new Map<string, Promise<ScopedStateWriteResult>>(),
}
```

在 `resetScopedStateForTest()` 中清空三张 `writes` map。把 `scopedStateGet` 中对每个 key 的权威判断统一为：

```ts
const local = dirtyKeys.has(key) || writes[scope].has(key)
```

只有 `local === false` 时才允许宿主值覆盖 cache；最终返回值在 `local === true` 时优先 `mem.get(key)`。

把 `scopedStateSet` 改为排队入口，并把实际写入放到紧邻其下的 helper：

```ts
export function scopedStateSet(
  scope: StorageScope,
  key: string,
  value: string,
): Promise<ScopedStateWriteResult> {
  cache[scope].set(key, value)
  const queued = Promise.resolve(writes[scope].get(key))
    .catch(() => undefined)
    .then(() => writeScopedState(scope, key, value))
    .then((result) => {
      if (writes[scope].get(key) === queued) writes[scope].delete(key)
      return result
    })
  writes[scope].set(key, queued)
  return queued
}

async function writeScopedState(scope: StorageScope, key: string, value: string): Promise<ScopedStateWriteResult> {
  const dirtyKeys = dirty[scope]
  if (!ideBridge.isInstalled()) {
    const ok = browserSet(scope, key, value)
    if (ok) {
      dirtyKeys.delete(key)
      return { ok: true }
    }
    dirtyKeys.add(key)
    warn(key, "host_write_failed")
    return { ok: false, error: "host_write_failed" }
  }

  const ok = await ideBridge.storageSet(scope, key, value).catch(() => false)
  if (ok) {
    dirtyKeys.delete(key)
    return { ok: true }
  }
  dirtyKeys.add(key)
  warn(key, "host_write_failed")
  return { ok: false, error: "host_write_failed" }
}

export async function flushScopedStateWrites(): Promise<void> {
  while (true) {
    const pending = [...writes.global.values(), ...writes.workspace.values(), ...writes.mem.values()]
    if (pending.length === 0) return
    await Promise.all(pending)
  }
}
```

- [ ] **Step 4：运行 scoped storage 测试**

```bash
bun run test:run src/state/scopedStorage.test.ts
```

Expected: PASS，全部 scoped storage 测试通过。

### Task 2：让标签层只保存完整快照

**Files:**
- Modify: `packages/opencode/webgui/src/state/tabStore.ts`
- Modify: `packages/opencode/webgui/src/state/repo/tabsRepo.ts`
- Test: `packages/opencode/webgui/src/state/tabStore.test.ts`
- Test: `packages/opencode/webgui/src/state/repo/tabsRepo.test.ts`

**Interfaces:**
- Consumes: `saveTabs(value: Tabs): Promise<ScopedStateWriteResult>`
- Produces: 所有 `tabStore` mutation 均保存完整 `{ open_tabs, active_tab }`。
- Removes: 未使用的 repository read-modify-write exports `saveOpenTabs`、`activateTab`、`removeTab`。

- [ ] **Step 1：把 tabStore 测试改成完整快照契约**

从 `tabStore.test.ts` 的 repository mock 删除 `saveOpenTabs` 和 `activateTab`，并加入：

```ts
it("激活相邻标签后关闭当前标签按顺序保存完整快照", async () => {
  mocks.loadTabs.mockResolvedValueOnce({
    open_tabs: ["s-draft", "s2"],
    active_tab: "s-draft",
  })
  const { result } = renderHook(() => useTabStore(), { wrapper })
  await waitFor(() => expect(result.current.loaded).toBe(true))
  mocks.saveTabs.mockClear()

  act(() => {
    result.current.activateTab("s2")
    result.current.closeTab("s-draft")
  })

  expect(mocks.saveTabs).toHaveBeenNthCalledWith(1, {
    open_tabs: ["s-draft", "s2"],
    active_tab: "s2",
  })
  expect(mocks.saveTabs).toHaveBeenNthCalledWith(2, {
    open_tabs: ["s2"],
    active_tab: "s2",
  })
})
```

更新现有 `openTab` 和 `activateTab` 断言：激活已存在标签时应调用 `saveTabs`，参数包含未变化的完整 `open_tabs` 和新的 `active_tab`。删除所有 `saveOpenTabs`/repository `activateTab` 断言。

- [ ] **Step 2：运行测试并确认旧实现失败**

```bash
bun run test:run src/state/tabStore.test.ts
```

Expected: FAIL；旧实现激活已有标签时调用 repository `activateTab`，不会直接保存完整快照。

- [ ] **Step 3：简化 tabStore 和 tabsRepo**

将 `tabStore.ts` import 改为：

```ts
import { loadTabs, saveTabs } from "./repo/tabsRepo"
```

将 `activateTab` 的持久化尾部改为：

```ts
if (!ready.current) return
persist(next)
```

从 `tabsRepo.ts` 删除 `saveOpenTabs`、`activateTab` 和 `removeTab`，保留 `parse`、`loadTabs`、`saveTabs`。更新 `tabsRepo.test.ts` 只导入 `loadTabs`、`saveTabs`，并以此测试保存时会过滤非字符串 ID、校正无效 active tab：

```ts
it("saveTabs 保存规范化的完整快照", async () => {
  vi.mocked(scopedStateSetJSON).mockResolvedValue({ ok: true })

  await saveTabs({ open_tabs: ["s1", "s2"], active_tab: "missing" })

  expect(scopedStateSetJSON).toHaveBeenCalledWith("workspace", "opencode:webgui:workspace:tabs:v1", {
    open_tabs: ["s1", "s2"],
    active_tab: "s2",
  })
})
```

- [ ] **Step 4：运行标签状态 focused tests**

```bash
bun run test:run src/state/tabStore.test.ts src/state/repo/tabsRepo.test.ts
```

Expected: PASS，完整快照顺序断言通过，repository 不再包含 read-modify-write API。

### Task 3：主动重启前等待状态写入

**Files:**
- Modify: `packages/opencode/webgui/src/components/CompactHeader/index.tsx`
- Test: `packages/opencode/webgui/src/components/CompactHeader/index.test.tsx`

**Interfaces:**
- Consumes: `flushScopedStateWrites(): Promise<void>`
- Preserves: `ideBridge.request("restartHost")`

- [ ] **Step 1：加入重启顺序失败测试**

在 `index.test.tsx` 的 hoisted mocks 中加入 `flushScopedStateWrites: vi.fn()`，并 mock `../../state/scopedStorage`：

```ts
vi.mock("../../state/scopedStorage", () => ({
  flushScopedStateWrites: (...args: unknown[]) => mocks.flushScopedStateWrites(...args),
}))
```

在 `beforeEach` 中设置 `mocks.flushScopedStateWrites.mockResolvedValue(undefined)`，然后加入：

```ts
it("重启前等待 scoped storage 写入完成", async () => {
  const user = userEvent.setup()
  let release = () => {}
  mocks.ideBridgeRestartMode = "window"
  mocks.flushScopedStateWrites.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      }),
  )
  mocks.ideBridgeRequest.mockResolvedValue({ ok: true })

  render(
    <CompactHeader
      connectionState={"connected" as ConnectionState}
      onNewSession={vi.fn()}
      isCreatingSession={false}
      onOpenCommandPalette={vi.fn()}
    />,
  )
  await user.click(screen.getByTitle("更多选项"))
  await user.click(screen.getByText("重启插件"))
  await user.click(screen.getByRole("button", { name: "重启" }))

  expect(mocks.flushScopedStateWrites).toHaveBeenCalledOnce()
  expect(mocks.ideBridgeRequest).not.toHaveBeenCalledWith("restartHost")
  release()
  await waitFor(() => expect(mocks.ideBridgeRequest).toHaveBeenCalledWith("restartHost"))
})
```

- [ ] **Step 2：运行测试并确认旧实现失败**

```bash
bun run test:run src/components/CompactHeader/index.test.tsx -t "重启前等待 scoped storage 写入完成"
```

Expected: FAIL；旧实现没有调用 flush，立即请求 `restartHost`。

- [ ] **Step 3：接入 flush**

在 `CompactHeader/index.tsx` 加入：

```ts
import { flushScopedStateWrites } from "../../state/scopedStorage"
```

在 `handleRestartConfirm` 的 `try` 第一行加入：

```ts
await flushScopedStateWrites()
```

保持现有 toast、loading 和确认框关闭逻辑不变。

- [ ] **Step 4：运行 CompactHeader focused test**

```bash
bun run test:run src/components/CompactHeader/index.test.tsx
```

Expected: PASS，现有重启成功和失败场景均保持通过。

### Task 4：整体验证

**Files:**
- Verify only: `packages/opencode/webgui`

**Interfaces:**
- Consumes: Tasks 1-3 的最终实现。
- Produces: 可复核的测试、构建和 diff 证据。

- [ ] **Step 1：运行所有相关测试**

Working directory: `packages/opencode/webgui`

```bash
bun run test:run src/state/scopedStorage.test.ts src/state/tabStore.test.ts src/state/repo/tabsRepo.test.ts src/components/CompactHeader/index.test.tsx
```

Expected: PASS，0 failed。

- [ ] **Step 2：运行 WebGUI 完整测试**

```bash
bun run test:run
```

Expected: PASS，0 failed。

- [ ] **Step 3：运行 TypeScript 构建**

```bash
bun run build
```

Expected: exit 0；`tsc -b` 与 Vite build 均成功。

- [ ] **Step 4：检查最终 diff**

Working directory: repository root

```bash
git diff --check
```

Expected: `git diff --check` 无输出；只有本计划列出的文件发生预期变化，不包含生成文件和 Comet 文件。
