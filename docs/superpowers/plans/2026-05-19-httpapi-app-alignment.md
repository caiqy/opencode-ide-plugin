# `test:httpapi` 与 `packages/app` 对齐修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 `packages/opencode` 的 `bun run test:httpapi` 初始化失败，并完成 `packages/app` 对当前 SDK v2 PTY / Path 契约的对齐，使根仓 `bun typecheck` 通过。

**Architecture:** 先用 TDD/回归方式锁定 `SessionSummaryScheduler` 的循环初始化问题，再把 HttpApi 顶层 layer 装配收敛到更稳定的边界；随后在 `packages/app` 中统一 `Path` 空态并对齐 PTY connect 调用面，避免继续依赖过时 SDK surface。整个过程保持“受影响边界对齐”，不扩散到无关子系统。

**Tech Stack:** TypeScript, Bun test, Effect v4 beta, Effect HttpApi, SolidJS, TanStack Solid Query, generated SDK v2

---

## 文件结构与职责

- `packages/opencode/src/server/routes/instance/httpapi/server.ts`
  - HttpApi 顶层 route tree 与 layer 装配边界
- `packages/opencode/src/session/summary-scheduler.ts`
  - summary scheduler 服务定义与默认 layer 组合
- `packages/opencode/test/server/httpapi-session.test.ts`
  - 已有 scheduler / httpapi session 关键回归；可补充针对 scheduler runtime 装配的 focused 回归
- `packages/opencode/test/server/httpapi-cors.test.ts`
  - 如需要，可作为 `HttpApiApp.createRoutes()` 装配的最小探针测试参考
- `packages/opencode/test/server/httpapi-exercise/index.ts`
  - `bun run test:httpapi` 真正执行入口，不直接改业务断言，作为最终验证入口
- `packages/app/src/components/terminal.tsx`
  - PTY ticket 获取与 websocket 建立逻辑
- `packages/app/src/context/global-sync.tsx`
  - global store 的 `Path` fallback 与 query options 边界
- `packages/app/src/context/global-sync/child-store.ts`
  - child store 的 `Path` fallback
- `packages/app/src/context/global-sync/bootstrap.ts`
  - `loadPathQuery` 的类型来源，可作为统一 `Path` 空态 helper 的合理落点参考
- `packages/app/src/context/global-sync.test.ts`
  - 适合新增统一空 `Path` helper 的纯测试
- `packages/app/src/context/global-sync/child-store.test.ts`
  - 适合新增 child store 对完整 `Path` 空态的回归
- `packages/app/src/utils/terminal-websocket-url.test.ts`
  - 现有 websocket URL 语义测试，确认 ticket 相关参数仍保持预期

---

### Task 1: 先用测试和探针锁定 `test:httpapi` 的初始化回归边界

**Files:**

- Modify: `packages/opencode/test/server/httpapi-session.test.ts`
- Reference: `packages/opencode/src/server/routes/instance/httpapi/server.ts`
- Reference: `packages/opencode/src/session/summary-scheduler.ts`

- [ ] **Step 1: 写一个最小回归测试，证明当前 scheduler runtime 装配会触发初始化失败**

在 `packages/opencode/test/server/httpapi-session.test.ts` 现有 `summaryRuntime` 附近新增一个 focused 测试，目标不是跑完整 harness，而是直接验证当前 runtime/layer 装配是否能成功取到 `SessionSummaryScheduler.Service`。测试形态保持与文件现有 `ManagedRuntime.make(...)` 风格一致，例如：

```ts
test("summary scheduler runtime can initialize", async () => {
  const runtime = ManagedRuntime.make(SessionSummaryScheduler.defaultLayer.pipe(Layer.provideMerge(AppLayer)), {
    memoMap,
  })

  await expect(
    runtime.runPromise(SessionSummaryScheduler.Service.pipe(Effect.map((svc) => typeof svc.flush))),
  ).resolves.toBe("function")

  await runtime.dispose()
})
```

如果这段测试一开始不是稳定复现当前错误，就把断言改成直接调用 `svc.flush()` 或 `svc.syncVisible([])`，直到能在单测里稳定打到 `defaultLayer before initialization`。

- [ ] **Step 2: 只跑这条测试，确认当前确实失败且失败形态是初始化问题**

Run:

```powershell
bun test packages/opencode/test/server/httpapi-session.test.ts --timeout 30000
```

Expected:

- 新增测试失败，且错误包含 `Cannot access 'defaultLayer' before initialization`，或同等含义的 scheduler/default layer 初始化失败。

- [ ] **Step 3: 记录当前依赖回绕点，明确实施边界**

在开始改代码前，人工核对以下依赖事实并写在本地工作笔记中（不需要提交文档）：

```ts
// HttpApi 顶层 createRoutes 目前显式提供
SessionSummaryScheduler.defaultLayer

// scheduler defaultLayer 目前会回拉
layer.pipe(Layer.provide(Session.defaultLayer), Layer.provide(SessionSummary.defaultLayer), Layer.provide(Bus.layer))

// session / prompt / processor / httpapi session 链路会再次消费 SessionSummaryScheduler.Service
```

这一步的目的是确保后续修的是“顶层装配回绕”，而不是去改 summary 行为本身。

- [ ] **Step 4: 提交测试前状态（可选，本地 checkpoint）**

```bash
git add packages/opencode/test/server/httpapi-session.test.ts
git commit -m "test: capture summary scheduler init regression"
```

如果你不想在红灯状态提交，这一步可以跳过，但后续任务仍按同一测试推进。

---

### Task 2: 重构 `SessionSummaryScheduler` 与 HttpApi 顶层 layer 装配边界

**Files:**

- Modify: `packages/opencode/src/server/routes/instance/httpapi/server.ts`
- Modify: `packages/opencode/src/session/summary-scheduler.ts`
- Test: `packages/opencode/test/server/httpapi-session.test.ts`

- [ ] **Step 1: 先收窄 scheduler 的默认层定义，避免它回拉整棵 session default graph**

目标是把 `summary-scheduler.ts` 里的：

```ts
export const defaultLayer = Layer.suspend(() =>
  layer.pipe(Layer.provide(Session.defaultLayer), Layer.provide(SessionSummary.defaultLayer), Layer.provide(Bus.layer)),
)
```

改成“只表达 scheduler 自己的直接依赖边界”的形式。优先考虑两种等价安全写法之一：

```ts
export const defaultLayer = Layer.suspend(() =>
  layer.pipe(Layer.provide(Bus.layer), Layer.provide(SessionSummary.defaultLayer), Layer.provide(Session.defaultLayer)),
)
```

如果只调顺序不能打破回绕，就进一步把 `defaultLayer` 拆成窄层，例如：

```ts
export const schedulerLayer = layer

export const defaultLayer = Layer.suspend(() =>
  schedulerLayer.pipe(
    Layer.provide(Bus.layer),
    Layer.provide(SessionSummary.defaultLayer),
    Layer.provide(Session.defaultLayer),
  ),
)
```

最终目标不是改名字，而是为下一步“顶层不再无脑提供 scheduler defaultLayer”创造清晰边界。

- [ ] **Step 2: 从 HttpApi 顶层 `createRoutes()` 中移除或替换 scheduler 的递归装配点**

在 `packages/opencode/src/server/routes/instance/httpapi/server.ts` 的 `createRoutes()` 提供列表中，找到：

```ts
SessionSummaryScheduler.defaultLayer,
```

将其调整为不再在顶层 route composition 阶段直接拉起会回绕 session graph 的完整默认层。优先目标是让 scheduler 由更靠近 session 子系统的边界提供，而不是在 `createRoutes()` 中重复装配。可接受的实现方向包括：

```ts
// 方向 A：顶层删除该项，由内部 graph 自洽提供
// SessionSummaryScheduler.defaultLayer,

// 方向 B：顶层只提供更窄的稳定层，而不是 defaultLayer
SessionSummaryScheduler.layer,
```

只有在确认 `layer` 本身还缺少直接依赖时，才继续用 `pipe(Layer.provide(...))` 补直接依赖；不要在这里重新回拉整套 session default graph。

- [ ] **Step 3: 用最小实现让新增回归测试通过**

完成上述改动后，优先保证 Task 1 新增的 focused 初始化测试通过。此时不要顺手改 summary 调度语义或 unrelated handler。

可接受的最终状态示例：

```ts
test("summary scheduler runtime can initialize", async () => {
  const runtime = ManagedRuntime.make(SessionSummaryScheduler.defaultLayer.pipe(Layer.provideMerge(AppLayer)), {
    memoMap,
  })

  await expect(runtime.runPromise(SessionSummaryScheduler.Service)).resolves.toBeDefined()
  await runtime.dispose()
})
```

- [ ] **Step 4: 重新跑 focused 服务端测试，确认不再出现初始化错误**

Run:

```powershell
bun test packages/opencode/test/server/httpapi-session.test.ts --timeout 30000
```

Expected:

- focused 测试通过
- 文件内已有 foreground-read / summary 相关回归仍通过
- 不再出现 `defaultLayer` 初始化错误

- [ ] **Step 5: 提交 scheduler / httpapi 边界重构**

```bash
git add packages/opencode/src/server/routes/instance/httpapi/server.ts packages/opencode/src/session/summary-scheduler.ts packages/opencode/test/server/httpapi-session.test.ts
git commit -m "refactor: align httpapi scheduler layer boundaries"
```

---

### Task 3: 对齐 `packages/app` 的 `Path` 空态结构

**Files:**

- Modify: `packages/app/src/context/global-sync.tsx`
- Modify: `packages/app/src/context/global-sync/child-store.ts`
- Optional Modify: `packages/app/src/context/global-sync/bootstrap.ts`
- Modify/Test: `packages/app/src/context/global-sync.test.ts`
- Test: `packages/app/src/context/global-sync/child-store.test.ts`

- [ ] **Step 1: 先新增纯测试，锁定完整 `Path` 空态 shape**

在 `packages/app/src/context/global-sync.test.ts` 增加一个针对统一空 `Path` 的纯测试。推荐先抽一个 helper 后再测；如果 helper 还没抽，也先写目标断言：

```ts
import { emptyPath } from "./global-sync/bootstrap"

test("emptyPath includes configFile for SDK v2 Path shape", () => {
  expect(emptyPath()).toEqual({
    state: "",
    config: "",
    configFile: "",
    worktree: "",
    directory: "",
    home: "",
  })
})
```

如果你不想把 helper 放在 `bootstrap.ts`，可以放在 `global-sync/utils` 或 `global-sync/types` 邻近文件，但计划执行时要确保测试引用的是最终统一来源，而不是内联字面量。

- [ ] **Step 2: 跑 app 的 focused 测试，确认它先红灯或编译失败**

Run:

```powershell
bun test packages/app/src/context/global-sync.test.ts packages/app/src/context/global-sync/child-store.test.ts
```

Expected:

- 在 helper 未实现前失败，或因导出不存在 / shape 不匹配而失败。

- [ ] **Step 3: 实现统一空 `Path` helper，并在 global store fallback 中使用**

在一个统一位置实现 helper，例如 `packages/app/src/context/global-sync/bootstrap.ts`：

```ts
export function emptyPath(): Path {
  return {
    state: "",
    config: "",
    configFile: "",
    worktree: "",
    directory: "",
    home: "",
  }
}
```

然后把 `global-sync.tsx` 中的：

```ts
const EMPTY = { state: "", config: "", worktree: "", directory: "", home: "" }
```

替换为：

```ts
const EMPTY = emptyPath()
```

同样把 `child-store.ts` 中的 `path` getter fallback 也替换成统一 helper。

- [ ] **Step 4: 给 child store 增加回归，证明默认空态包含 `configFile`**

在 `packages/app/src/context/global-sync/child-store.test.ts` 增加一条测试，最小化创建 manager 后读取新 child store 的 `path`：

```ts
test("child store path fallback includes configFile", () => {
  const owner = createRoot((dispose) => {
    const current = getOwner()
    dispose()
    return current
  })
  if (!owner) throw new Error("owner required")

  const manager = createChildStoreManager({
    owner,
    isBooting: () => false,
    isLoadingSessions: () => false,
    onBootstrap() {},
    onDispose() {},
    translate: (key) => key,
    queryOptions: {} as any,
    global: { provider: null! },
  })

  const [store] = manager.child("/repo", { bootstrap: false })

  expect(store.path).toEqual({
    state: "",
    config: "",
    configFile: "",
    worktree: "",
    directory: "",
    home: "",
  })
})
```

如果 `useQueries` 需要更具体的 stub，按现有测试风格补最小 mock，但不要把测试扩展成 integration harness。

- [ ] **Step 5: 重新跑 focused app 测试，确认空态统一通过**

Run:

```powershell
bun test packages/app/src/context/global-sync.test.ts packages/app/src/context/global-sync/child-store.test.ts
```

Expected:

- 两个测试文件通过
- 空 `Path` 结构包含 `configFile`

- [ ] **Step 6: 提交 `Path` 空态对齐改动**

```bash
git add packages/app/src/context/global-sync.tsx packages/app/src/context/global-sync/child-store.ts packages/app/src/context/global-sync/bootstrap.ts packages/app/src/context/global-sync.test.ts packages/app/src/context/global-sync/child-store.test.ts
git commit -m "refactor: align app path fallbacks with sdk v2"
```

---

### Task 4: 对齐 `packages/app` 的 PTY connect 调用面

**Files:**

- Modify: `packages/app/src/components/terminal.tsx`
- Reference: `packages/sdk/js/src/v2/gen/sdk.gen.ts:1440-1465`
- Test: `packages/app/src/utils/terminal-websocket-url.test.ts`

- [ ] **Step 1: 先写一个最小类型目标，明确 terminal 必须使用当前 SDK 暴露的 `connect(...)`**

这里用类型红灯代替业务单测红灯：先把 `terminal.tsx` 中 `connectToken()` 片段旁边写成目标形态草稿（不提交半成品），明确准备改成：

```ts
const result = await client.pty
  .connect(
    { ptyID: id, directory },
    {
      throwOnError: false,
      headers: { "x-opencode-ticket": "1" },
    },
  )
  .catch((err: unknown) => {
    if (err instanceof Error && err.message.includes("Request is not supported")) return
    throw err
  })
```

这一步的目的不是最终代码提交，而是确保改动方向是“当前 SDK 契约”，不是再造 shim。

- [ ] **Step 2: 实际替换 `connectToken(...)` 为 `connect(...)`，并保留现有 ticket 分支语义**

把：

```ts
client.pty.connectToken(...)
```

替换为：

```ts
client.pty.connect(...)
```

并保留以下逻辑不变：

```ts
if (!result) return
if (result.response.status === 200 && result.data?.ticket) return result.data.ticket
if (result.response.status === 404 || result.response.status === 405) return
if (result.response.status === 403)
  throw new Error("PTY connect ticket rejected by origin or CSRF checks. Check the server CORS config.")
throw new Error(`PTY connect ticket failed with ${result.response.status}`)
```

不要顺手改 websocket retry、`gone()`、`fail()`、`terminalWebSocketURL(...)` 的其它逻辑。

- [ ] **Step 3: 跑根仓 typecheck 的最小前置验证，确认 PTY 类型错误已消失**

Run:

```powershell
bun typecheck
```

Expected:

- `packages/app/src/components/terminal.tsx` 上的 `Property 'connectToken' does not exist on type 'Pty'` 错误消失
- 如果还有其它错误，仅允许是与本任务无关的新暴露问题；若仍是 `terminal.tsx`，继续修到该错误消失为止

- [ ] **Step 4: 补跑 websocket URL 测试，确认 ticket/auth 语义未回退**

Run:

```powershell
bun test packages/app/src/utils/terminal-websocket-url.test.ts
```

Expected:

- 测试全部通过
- 说明本次只替换 PTY SDK 调用面，没有破坏 websocket URL 鉴权参数语义

- [ ] **Step 5: 提交 PTY 调用面对齐改动**

```bash
git add packages/app/src/components/terminal.tsx
git commit -m "refactor: align app pty connect flow with sdk v2"
```

---

### Task 5: 跑完整验证矩阵并确认 merge 可用性证据

**Files:**

- No code changes expected
- Verify: `packages/opencode/test/server/generated-image-route.test.ts`
- Verify: `packages/opencode/test/server/httpapi-session.test.ts`
- Verify: `packages/opencode/webgui/package.json`
- Verify: `hosts/vscode-plugin/package.json`

- [ ] **Step 1: 运行 `test:httpapi` 最终验证**

Run:

```powershell
bun run test:httpapi
```

Workdir:

```text
packages/opencode
```

Expected:

- 命令通过
- 不再出现 `Cannot access 'defaultLayer' before initialization.`

- [ ] **Step 2: 运行根仓 typecheck 最终验证**

Run:

```powershell
bun typecheck
```

Expected:

- turbo 全部通过
- `packages/app` 不再报 `connectToken` / `configFile` 相关错误

- [ ] **Step 3: 运行关键服务端回归**

Run:

```powershell
bun test test/server/generated-image-route.test.ts --timeout 30000
bun test test/server/httpapi-session.test.ts --timeout 30000
```

Workdir:

```text
packages/opencode
```

Expected:

- 两个关键回归都通过

- [ ] **Step 4: 运行 WebGUI 全量测试**

Run:

```powershell
bun run test:run
```

Workdir:

```text
packages/opencode/webgui
```

Expected:

- 全量测试通过

- [ ] **Step 5: 运行 VSCode 插件编译验证**

Run:

```powershell
pnpm run compile
```

Workdir:

```text
hosts/vscode-plugin
```

Expected:

- compile 通过

- [ ] **Step 6: 汇总验证证据并提交最终修复**

```bash
git add packages/opencode/src/server/routes/instance/httpapi/server.ts packages/opencode/src/session/summary-scheduler.ts packages/opencode/test/server/httpapi-session.test.ts packages/app/src/components/terminal.tsx packages/app/src/context/global-sync.tsx packages/app/src/context/global-sync/child-store.ts packages/app/src/context/global-sync/bootstrap.ts packages/app/src/context/global-sync.test.ts packages/app/src/context/global-sync/child-store.test.ts docs/superpowers/specs/2026-05-19-httpapi-app-alignment-design.md docs/superpowers/plans/2026-05-19-httpapi-app-alignment.md
git commit -m "fix: align httpapi and app contracts after upstream merge"
```

如果你明确要求暂不提交，这一步改为只整理验证结果，不执行 commit。

---

## 计划自检

- Spec coverage：
  - `test:httpapi` 初始化回归 → Task 1 / Task 2
  - `packages/app` PTY 对齐 → Task 4
  - `Path` 空态统一 → Task 3
  - 关键回归与更广验证 → Task 5
- Placeholder scan：已去除 `TODO` / `TBD` / “类似上一步” 之类占位描述。
- Type consistency：统一使用 `SessionSummaryScheduler`, `emptyPath`, `client.pty.connect(...)`, `configFile` 等最终命名，不混用旧 `connectToken` 作为目标实现名。
