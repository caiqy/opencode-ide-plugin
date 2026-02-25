# WebGUI 配置文件按钮 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 WebGUI 更多功能菜单中新增“配置文件”按钮（位于“设置”上方），点击后确保并打开 `~/.config/opencode/opencode.jsonc`，失败时显示中文错误 toast。

**Architecture:** 前端只负责 UI 入口与错误反馈；通过 ideBridge 发送 `ensureAndOpenFile` 请求；VSCode bridge 负责 `~` 展开、目录/文件创建、然后复用 `openFile` 打开。这样把“确保存在 + 打开”封装为宿主端原子操作，避免前端分散处理文件系统细节。

**Tech Stack:** React + Vitest（webgui）、VSCode Extension（TypeScript + Mocha suite）、ideBridge SSE 请求通道。

---

## 执行约束

- 相关技能：`@superpowers/test-driven-development`、`@superpowers/verification-before-completion`
- 小步提交：每个任务完成后单独提交。
- 不从仓库根目录跑测试；webgui 测试在 `packages/opencode/webgui` 执行。

### Task 1: 菜单项与回调接口（ActionButtons）

**Files:**

- Modify: `packages/opencode/webgui/src/components/CompactHeader/ActionButtons.tsx`
- Modify: `packages/opencode/webgui/src/components/CompactHeader/ActionButtons.test.tsx`

**Step 1: Write the failing test**

在 `ActionButtons.test.tsx` 新增用例：

```tsx
it("配置文件菜单项位于设置上方并触发回调", async () => {
  const user = userEvent.setup()
  const onOpenConfigFile = vi.fn()

  render(
    <ActionButtons
      theme="light"
      toggleTheme={vi.fn()}
      onOpenCommandPalette={vi.fn()}
      onOpenConfigFile={onOpenConfigFile}
      onOpenSettings={vi.fn()}
      onNewSession={vi.fn()}
      onToggleHistory={vi.fn()}
      isCreatingSession={false}
      isShared={false}
      isSharing={false}
      onToggleShare={vi.fn()}
    />,
  )

  await user.click(screen.getByTitle("更多选项"))
  const config = screen.getByText("配置文件")
  const settings = screen.getByText("设置")
  expect(config.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  await user.click(config)
  expect(onOpenConfigFile).toHaveBeenCalledTimes(1)
})
```

**Step 2: Run test to verify it fails**

Run:

```bash
bun run test:run src/components/CompactHeader/ActionButtons.test.tsx
```

Expected: FAIL（`onOpenConfigFile` prop 不存在或找不到“配置文件”菜单项）。

**Step 3: Write minimal implementation**

在 `ActionButtons.tsx`：

- `ActionButtonsProps` 增加 `onOpenConfigFile: () => void`
- 在“命令面板”和“设置”之间插入“配置文件”按钮
- 点击行为使用 `handleMenuItemClick(onOpenConfigFile)`

**Step 4: Run test to verify it passes**

Run:

```bash
bun run test:run src/components/CompactHeader/ActionButtons.test.tsx
```

Expected: PASS。

**Step 5: Commit**

```bash
git add packages/opencode/webgui/src/components/CompactHeader/ActionButtons.tsx packages/opencode/webgui/src/components/CompactHeader/ActionButtons.test.tsx
git commit -m "feat(webgui): add config-file menu item above settings"
```

### Task 2: 连接 CompactHeader 事件与错误 toast

**Files:**

- Modify: `packages/opencode/webgui/src/components/CompactHeader/index.tsx`
- Modify: `packages/opencode/webgui/src/components/CompactHeader/index.test.tsx`

**Step 1: Write the failing test**

在 `index.test.tsx` 新增两个用例：

```tsx
it("点击配置文件后调用 ideBridge ensureAndOpenFile", async () => {
  // mock ideBridge.request
  // 打开更多菜单，点击“配置文件”
  // expect(ideBridge.request).toHaveBeenCalledWith("ensureAndOpenFile", { path: "~/.config/opencode/opencode.jsonc" })
})

it("打开配置文件失败时显示错误 toast", async () => {
  // ideBridge.request reject
  // 点击“配置文件”
  // expect(showToast).toHaveBeenCalledWith("打开配置文件失败", { variant: "error" })
})
```

**Step 2: Run test to verify it fails**

Run:

```bash
bun run test:run src/components/CompactHeader/index.test.tsx
```

Expected: FAIL（尚未传递回调，也无 bridge 调用与失败 toast）。

**Step 3: Write minimal implementation**

在 `index.tsx`：

- 引入 `ideBridge`；
- 新增 `handleOpenConfigFile`：

```ts
const handleOpenConfigFile = useCallback(() => {
  void ideBridge.request("ensureAndOpenFile", { path: "~/.config/opencode/opencode.jsonc" }).catch(() => {
    toast.showToast("打开配置文件失败", { variant: "error" })
  })
}, [toast])
```

- 将 `onOpenConfigFile={handleOpenConfigFile}` 传给 `ActionButtons`。

**Step 4: Run test to verify it passes**

Run:

```bash
bun run test:run src/components/CompactHeader/index.test.tsx src/components/CompactHeader/ActionButtons.test.tsx
```

Expected: PASS。

**Step 5: Commit**

```bash
git add packages/opencode/webgui/src/components/CompactHeader/index.tsx packages/opencode/webgui/src/components/CompactHeader/index.test.tsx
git commit -m "feat(webgui): wire config-file action to ide bridge"
```

### Task 3: VSCode Bridge 新增 ensureAndOpenFile 消息处理

**Files:**

- Modify: `hosts/vscode-plugin/src/ui/IdeBridgeServer.ts`
- Test: `hosts/vscode-plugin/src/test/suite/webviewIntegration.test.ts`（新增用例）

**Step 1: Write the failing test**

在 `webviewIntegration.test.ts` 增加 bridge 消息分发测试：

```ts
test("ensureAndOpenFile creates missing config file then opens it", async () => {
  // 构造 session handlers.openFile mock
  // 发送 type=ensureAndOpenFile payload.path="~/.config/opencode/opencode.jsonc"
  // 断言 openFile 收到展开后的绝对路径
  // 断言目标文件存在
})
```

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm --dir hosts/vscode-plugin run test -- --grep "ensureAndOpenFile"
```

Expected: FAIL（消息类型未实现）。

**Step 3: Write minimal implementation**

在 `IdeBridgeServer.ts` 的 `handleSend` switch 中新增分支：

```ts
case "ensureAndOpenFile":
  if (!payload?.path || typeof payload.path !== "string") {
    this.replyError(session, id, "Missing path")
    break
  }
  const p = payload.path.startsWith("~/") ? path.join(os.homedir(), payload.path.slice(2)) : payload.path
  fs.mkdirSync(path.dirname(p), { recursive: true })
  if (!fs.existsSync(p)) fs.writeFileSync(p, "")
  await session.handlers.openFile(p)
  this.replyOk(session, id)
  break
```

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm --dir hosts/vscode-plugin run test -- --grep "ensureAndOpenFile"
```

Expected: PASS。

**Step 5: Commit**

```bash
git add hosts/vscode-plugin/src/ui/IdeBridgeServer.ts hosts/vscode-plugin/src/test/suite/webviewIntegration.test.ts
git commit -m "feat(vscode): support ensure-and-open config file bridge message"
```

### Task 4: 回归验证与收尾

**Files:**

- Verify only（无新增文件）

**Step 1: Run focused webgui regression tests**

Run:

```bash
bun run test:run src/components/CompactHeader/ActionButtons.test.tsx src/components/CompactHeader/index.test.tsx
```

Expected: PASS。

**Step 2: Run host compile check**

Run:

```bash
pnpm --dir hosts/vscode-plugin run compile
```

Expected: TypeScript compile PASS。

**Step 3: Manual verification**

1. 打开 WebGUI → 更多选项；
2. 确认“配置文件”在“设置”上方；
3. 删除 `~/.config/opencode/opencode.jsonc` 后点击“配置文件”；
4. 确认文件被创建为空文件并在 IDE 打开；
5. 人为制造错误（如只读目录）验证 toast：`打开配置文件失败`。

**Step 4: Final commit**

```bash
git add -A
git commit -m "test(webgui,vscode): cover config-file menu and bridge flow"
```
