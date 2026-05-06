# WebGUI 重启插件能力 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 WebGUI 更多菜单中新增「重启插件」入口，确认后按宿主能力执行重启（VSCode 重载窗口、JetBrains 重启 IDE），并在不支持时隐藏入口。

**Architecture:** 通过 ideBridge `connected` 元数据下发 `restartMode` 能力；WebGUI 根据能力决定是否展示菜单项。点击菜单项复用现有 `ConfirmModal`，确认后发送 `restartHost` 消息，由 VSCode/JetBrains host 分别处理。

**Tech Stack:** React + TypeScript + Vitest（webgui）、VSCode Extension API + Mocha（vscode host tests）、Kotlin + JUnit5（JetBrains host tests）。

---

### Task 1: VSCode bridge 协议扩展（`restartMode` + `restartHost`）

**Files:**

- Modify: `hosts/vscode-plugin/src/ui/IdeBridgeServer.ts`
- Modify: `hosts/vscode-plugin/src/ui/WebviewController.ts`
- Test: `hosts/vscode-plugin/src/test/suite/ideBridgeServer.test.ts`

**Step 1: 写失败测试（先测协议行为）**

在 `ideBridgeServer.test.ts` 新增用例：

```ts
test("restartHost routes to session handler", async () => {
  let called = 0
  const handlers: SessionHandlers = {
    openFile: async () => {},
    openUrl: async () => {},
    reloadPath: async () => {},
    clipboardWrite: async () => {},
    restartHost: async () => {
      called += 1
    },
  }

  const session = await bridgeServer.createSession(handlers)
  const reply = await requestReply(session.baseUrl, session.token, { type: "restartHost", payload: {} })
  assert.strictEqual(reply.ok, true)
  assert.strictEqual(called, 1)
})
```

**Step 2: 运行测试确认失败**

Run (workdir=`hosts/vscode-plugin`):

```bash
pnpm test -- --grep "restartHost routes to session handler"
```

Expected: FAIL（`restartHost` 尚未被 `IdeBridgeServer.handleSend` 支持，或 `SessionHandlers` 类型缺少字段）。

**Step 3: 写最小实现**

`IdeBridgeServer.ts` 增加 handler 类型和 switch 分支：

```ts
export interface SessionHandlers {
  openFile: (path: string) => Promise<void>
  openUrl: (url: string) => Promise<void>
  reloadPath: (path: string) => Promise<void>
  clipboardWrite: (text: string) => Promise<void>
  restartHost?: () => Promise<void>
}

interface SessionMetadata {
  minVersion?: string
  restartMode?: "window" | "ide"
}

case "restartHost":
  if (session.handlers.restartHost) {
    await session.handlers.restartHost()
    this.replyOk(session, id)
  } else {
    this.replyError(session, id, "restartHost unsupported")
  }
  break
```

`WebviewController.ts` 在 `createSession` handlers + metadata 中补齐：

```ts
const session = await bridgeServer.createSession(
  {
    openFile: (p) => this.communicationBridge!.handleOpenFile(p),
    openUrl: (url) => this.communicationBridge!.handleOpenUrl(url),
    reloadPath: (p) => this.communicationBridge!.handleReloadPath(p),
    clipboardWrite: async (text) => {
      await vscode.env.clipboard.writeText(text)
    },
    restartHost: async () => {
      await vscode.commands.executeCommand("workbench.action.reloadWindow")
    },
    storageGet: this.storageGet,
    storageSet: this.storageSet,
  },
  {
    minVersion: vscode.workspace.getConfiguration("opencode").get<string>("minVersion", "1.1.1"),
    restartMode: "window",
  },
)
```

**Step 4: 再跑测试确认通过**

Run (workdir=`hosts/vscode-plugin`):

```bash
pnpm test -- --grep "restartHost routes to session handler"
```

Expected: PASS。

**Step 5: Commit**

```bash
git add hosts/vscode-plugin/src/ui/IdeBridgeServer.ts hosts/vscode-plugin/src/ui/WebviewController.ts hosts/vscode-plugin/src/test/suite/ideBridgeServer.test.ts
git commit -m "feat(vscode-plugin): add restartHost bridge support"
```

---

### Task 2: JetBrains bridge 增加 `restartHost` 与 `restartMode`

**Files:**

- Modify: `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt`
- Create: `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/IdeBridgeRestartHostTest.kt`

**Step 1: 写失败测试（先约束行为，不触发真实重启）**

新增测试思路：注入可替换的重启函数，验证收到 `restartHost` 后被调用一次并回 `ok=true`。

```kotlin
@Test
fun `restartHost calls restart hook and replies ok`() {
    var called = 0
    IdeBridge.restartHook = { called += 1 }
    val project = Mockito.mock(Project::class.java)
    Mockito.`when`(project.name).thenReturn("test-project")
    val session = IdeBridge.createSession(project)

    val reply = send(session, "restartHost", JsonObject())
    assertEquals(true, reply.get("ok")?.asBoolean)
    assertEquals(1, called)
}
```

**Step 2: 运行测试确认失败**

Run (workdir=`hosts/jetbrains-plugin`):

```bash
./gradlew unitTest --tests "paviko.opencode.ui.IdeBridgeRestartHostTest"
```

Expected: FAIL（当前无 `restartHost` 分支/无可注入重启 hook）。

**Step 3: 写最小实现**

`IdeBridge.kt` 中新增可测 hook + 分支：

```kotlin
@Volatile
internal var restartHook: () -> Unit = {
    ApplicationManager.getApplication().restart()
}

// connected metadata
addProperty("restartMode", "ide")

// send handler
"restartHost" -> {
    restartHook()
    replyOk(session, id)
}
```

> 注意：测试结束后恢复 `restartHook` 默认值，避免污染其它测试。

**Step 4: 再跑测试确认通过**

Run (workdir=`hosts/jetbrains-plugin`):

```bash
./gradlew unitTest --tests "paviko.opencode.ui.IdeBridgeRestartHostTest"
```

Expected: PASS。

**Step 5: Commit**

```bash
git add hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/IdeBridgeRestartHostTest.kt
git commit -m "feat(jetbrains-plugin): support restartHost bridge message"
```

---

### Task 3: WebGUI 菜单项展示与顺序（能力 gating）

**Files:**

- Modify: `packages/opencode/webgui/src/components/CompactHeader/ActionButtons.tsx`
- Modify: `packages/opencode/webgui/src/components/CompactHeader/ActionButtons.test.tsx`

**Step 1: 写失败测试（先定 UI 行为）**

在 `ActionButtons.test.tsx` 增加：

```tsx
it("支持重启时显示重启插件且位于配置文件下方", async () => {
  const user = userEvent.setup()
  const onRestart = vi.fn()
  renderButtons({ canRestart: true, onRestart })

  await user.click(screen.getByTitle("更多选项"))

  const configItem = screen.getByText("配置文件").closest("button")!
  const restartItem = screen.getByText("重启插件").closest("button")!
  expect(configItem.compareDocumentPosition(restartItem) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

  await user.click(screen.getByText("重启插件"))
  expect(onRestart).toHaveBeenCalledOnce()
})
```

**Step 2: 运行测试确认失败**

Run (workdir=`packages/opencode/webgui`):

```bash
pnpm test:run src/components/CompactHeader/ActionButtons.test.tsx
```

Expected: FAIL（`ActionButtons` 尚无 `canRestart/onRestart` 属性与菜单项）。

**Step 3: 写最小实现**

`ActionButtons.tsx` 扩展 props 并渲染按钮：

```tsx
interface ActionButtonsProps {
  // ...existing
  canRestart: boolean
  onRestart: () => void
}

{
  canRestart && (
    <button
      onClick={() => handleMenuItemClick(onRestart)}
      className="w-full px-3 py-2 text-xs text-left text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2"
    >
      <span>重启插件</span>
    </button>
  )
}
```

并更新测试默认 props。

**Step 4: 再跑测试确认通过**

Run (workdir=`packages/opencode/webgui`):

```bash
pnpm test:run src/components/CompactHeader/ActionButtons.test.tsx
```

Expected: PASS。

**Step 5: Commit**

```bash
git add packages/opencode/webgui/src/components/CompactHeader/ActionButtons.tsx packages/opencode/webgui/src/components/CompactHeader/ActionButtons.test.tsx
git commit -m "feat(webgui): add restart entry in compact header menu"
```

---

### Task 4: CompactHeader 复用 `ConfirmModal` 执行重启请求

**Files:**

- Modify: `packages/opencode/webgui/src/components/CompactHeader/index.tsx`
- Modify: `packages/opencode/webgui/src/components/CompactHeader/index.test.tsx`
- Modify: `packages/opencode/webgui/src/lib/ideBridge.ts`

**Step 1: 写失败测试（先定交互）**

新增/扩展 `index.test.tsx`：

```tsx
it("点击重启插件后弹出确认框，确认后调用 restartHost", async () => {
  const user = userEvent.setup()
  mocks.ideBridgeRequest.mockResolvedValue({ ok: true })
  mocks.ideBridgeRestartMode = "window"

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
  expect(screen.getByText("确认重启插件")).toBeInTheDocument()

  await user.click(screen.getByText("重启"))
  expect(mocks.ideBridgeRequest).toHaveBeenCalledWith("restartHost")
})
```

**Step 2: 运行测试确认失败**

Run (workdir=`packages/opencode/webgui`):

```bash
pnpm test:run src/components/CompactHeader/index.test.tsx
```

Expected: FAIL（当前无重启确认状态与调用链）。

**Step 3: 写最小实现**

`ideBridge.ts`：记录能力。

```ts
restartMode: "window" | "ide" | null = null

if (data.restartMode === "window" || data.restartMode === "ide") {
  this.restartMode = data.restartMode
}
```

`CompactHeader/index.tsx`：

```tsx
const [restartConfirmOpen, setRestartConfirmOpen] = useState(false)
const [restarting, setRestarting] = useState(false)
const canRestart = ideBridge.restartMode === "window" || ideBridge.restartMode === "ide"

const handleRestart = useCallback(() => setRestartConfirmOpen(true), [])

const handleRestartConfirm = useCallback(async () => {
  setRestarting(true)
  try {
    await ideBridge.request("restartHost")
  } catch {
    toast.showToast("重启失败，请稍后重试", { variant: "error" })
  }
  setRestarting(false)
  setRestartConfirmOpen(false)
}, [toast])
```

并在 JSX 中：

1. 给 `ActionButtons` 传 `canRestart` 和 `onRestart`。
2. 追加一个 `ConfirmModal`（复用现有组件，`confirmText="重启"`）。

**Step 4: 再跑测试确认通过**

Run (workdir=`packages/opencode/webgui`):

```bash
pnpm test:run src/components/CompactHeader/index.test.tsx src/components/CompactHeader/ActionButtons.test.tsx
```

Expected: PASS。

**Step 5: Commit**

```bash
git add packages/opencode/webgui/src/components/CompactHeader/index.tsx packages/opencode/webgui/src/components/CompactHeader/index.test.tsx packages/opencode/webgui/src/lib/ideBridge.ts
git commit -m "feat(webgui): confirm and request host restart from compact header"
```

---

### Task 5: 回归验证与收尾

**Files:**

- Modify (if needed): `hosts/vscode-plugin/src/test/suite/ideBridgeServer.test.ts`
- Modify (if needed): `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/IdeBridgeRestartHostTest.kt`
- Modify (if needed): `packages/opencode/webgui/src/components/CompactHeader/*.test.tsx`

**Step 1: 运行 WebGUI 相关回归**

Run (workdir=`packages/opencode/webgui`):

```bash
pnpm test:run src/components/CompactHeader/ActionButtons.test.tsx src/components/CompactHeader/index.test.tsx
```

Expected: PASS。

**Step 2: 运行 VSCode host 回归**

Run (workdir=`hosts/vscode-plugin`):

```bash
pnpm test -- --grep "IdeBridgeServer"
```

Expected: PASS（至少覆盖 `restartHost` 新分支）。

**Step 3: 运行 JetBrains host 回归**

Run (workdir=`hosts/jetbrains-plugin`):

```bash
./gradlew unitTest --tests "paviko.opencode.ui.IdeBridge*"
```

Expected: PASS。

**Step 4: 最终检查差异**

Run:

```bash
git status
git diff --stat
```

Expected: 仅包含本需求相关文件。

**Step 5: Commit**

```bash
git add hosts/vscode-plugin/src/ui/IdeBridgeServer.ts hosts/vscode-plugin/src/ui/WebviewController.ts hosts/vscode-plugin/src/test/suite/ideBridgeServer.test.ts hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/IdeBridgeRestartHostTest.kt packages/opencode/webgui/src/lib/ideBridge.ts packages/opencode/webgui/src/components/CompactHeader/ActionButtons.tsx packages/opencode/webgui/src/components/CompactHeader/ActionButtons.test.tsx packages/opencode/webgui/src/components/CompactHeader/index.tsx packages/opencode/webgui/src/components/CompactHeader/index.test.tsx
git commit -m "feat(webgui): add host-aware restart action in more menu"
```
