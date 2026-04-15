# 手动检查更新入口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在右上角菜单版本号右侧增加“检查更新”图标按钮，支持用户手动强制检查 GitHub Release；有更新时弹确认并走现有安装链路，无更新时提示“已是最新版”。

**Architecture:** 本次改动继续复用现有更新体系，不新增第二套状态机。VSCode 插件侧在 `UpdateService` 增加手动强制检查接口，通过 IdeBridge 暴露 `checkForUpdates`；WebGUI 侧由 `UpdateContext` 统一管理 `isChecking`、检查结果分流、确认安装，并在 `ActionButtons` 的版本号行挂载图标入口。

**Tech Stack:** TypeScript、React 19、Vitest、VSCode Extension API、Mocha、现有 IdeBridge SSE/HTTP 请求协议、ToastContext、ConfirmModal

---

## 文件结构

### VSCode 插件修改文件

- Modify: `hosts/vscode-plugin/src/update/UpdateService.ts`
  - 新增 `checkForUpdates()`，执行强制实时检查并返回结构化结果
- Modify: `hosts/vscode-plugin/src/ui/IdeBridgeServer.ts`
  - 新增 `checkForUpdates` 请求类型与 roundtrip 处理
- Modify: `hosts/vscode-plugin/src/ui/WebviewController.ts`
  - 为 session 注入 `checkForUpdates` handler
- Modify: `hosts/vscode-plugin/src/test/suite/updateService.test.ts`
  - 覆盖 `available` / `up-to-date` / 强制触发 checker
- Modify: `hosts/vscode-plugin/src/test/suite/ideBridgeServer.test.ts`
  - 覆盖 `checkForUpdates` roundtrip

### WebGUI 修改文件

- Modify: `packages/opencode/webgui/src/state/UpdateContext.tsx`
  - 增加 `isChecking`、`checkForUpdates()`、确认框状态与结果分流
- Modify: `packages/opencode/webgui/src/components/CompactHeader/ActionButtons.tsx`
  - 在版本号行增加检查更新图标按钮
- Modify: `packages/opencode/webgui/src/components/CompactHeader/index.tsx`
  - 连接 `useUpdate()`，把 `isChecking` / `checkForUpdates` 传给 `ActionButtons`
- Modify: `packages/opencode/webgui/src/components/CompactHeader/ActionButtons.test.tsx`
  - 覆盖图标渲染、loading、点击触发
- Modify: `packages/opencode/webgui/src/state/UpdateContext.test.tsx`
  - 覆盖 `up-to-date`、`available`、失败 toast、确认后安装

## 类型与接口约定

### `UpdateService.checkForUpdates()`

建议统一为：

```ts
type CheckForUpdatesResult =
  | {
      status: "available"
      latest: ReleaseInfo
    }
  | {
      status: "up-to-date"
      currentVersion: string
    }
```

### `UpdateContext` 暴露值补充

```ts
type UpdateValue = {
  currentVersion: string
  latest: UpdateRelease | null
  status: UpdateStatus
  isChecking: boolean
  installUpdate: (version: string) => Promise<void>
  checkForUpdates: () => Promise<void>
  openRelease: () => Promise<void>
}
```

### `ActionButtons` 新增 props

```ts
type ActionButtonsProps = {
  // ...existing props
  isCheckingForUpdates?: boolean
  onCheckForUpdates?: () => void
}
```

---

### Task 1: VSCode 侧新增手动检查接口

**Files:**

- Modify: `hosts/vscode-plugin/src/update/UpdateService.ts`
- Modify: `hosts/vscode-plugin/src/test/suite/updateService.test.ts`

- [ ] **Step 1: 先写失败测试，锁定 `checkForUpdates()` 行为**

在 `hosts/vscode-plugin/src/test/suite/updateService.test.ts` 追加：

```ts
test("checkForUpdates 有更新时返回 available 并刷新 latest", async () => {
  const latest: ReleaseInfo = {
    version: "26.4.1407",
    releaseUrl: "https://example.test/releases/26.4.1407",
    notes: "## update",
    publishedAt: "2026-04-14T12:00:00Z",
    vsixUrl: "https://example.test/opencode.vsix",
  }

  const service = new UpdateService({
    currentVersion: "26.4.1406",
    checker: {
      async getLatest() {
        return latest
      },
    },
    installer: {
      async install() {
        return ""
      },
    },
  })

  const result = await service.checkForUpdates()

  assert.deepStrictEqual(result, {
    status: "available",
    latest,
  })
  assert.deepStrictEqual(service.getUpdateInfo(), {
    latest,
    notifiedVersion: latest.version,
    hasUpdate: true,
  })
})

test("checkForUpdates 无更新时返回 up-to-date", async () => {
  const calls: string[] = []
  const service = new UpdateService({
    currentVersion: "26.4.1406",
    checker: {
      async getLatest(version: string) {
        calls.push(version)
        return null
      },
    },
    installer: {
      async install() {
        return ""
      },
    },
  })

  const result = await service.checkForUpdates()

  assert.deepStrictEqual(result, {
    status: "up-to-date",
    currentVersion: "26.4.1406",
  })
  assert.deepStrictEqual(calls, ["26.4.1406"])
})
```

- [ ] **Step 2: 运行定向测试，确认当前失败**

Run: `pnpm run compile && pnpm exec mocha "out/test/test/suite/updateService.test.js" --ui tdd --timeout 20000`

Expected: FAIL，报错包含 `service.checkForUpdates is not a function` 或断言失败。

- [ ] **Step 3: 在 UpdateService 中实现最小版本的手动检查接口**

在 `hosts/vscode-plugin/src/update/UpdateService.ts` 增加：

```ts
type CheckForUpdatesResult =
  | {
      status: "available"
      latest: ReleaseInfo
    }
  | {
      status: "up-to-date"
      currentVersion: string
    }
```

```ts
  async checkForUpdates(): Promise<CheckForUpdatesResult> {
    const latest = await this.options.checker.getLatest(this.currentVersion)
    this.latest = latest

    if (!latest) {
      return {
        status: "up-to-date",
        currentVersion: this.currentVersion,
      }
    }

    this.notifiedVersion = latest.version
    this.broadcast("updateAvailable", latest)
    return {
      status: "available",
      latest,
    }
  }
```

并在文件末尾导出类型：

```ts
export type { CheckForUpdatesResult, UpdateEvent, UpdateEventPayload, UpdateInfo, UpdateServiceOptions, UpdateSession }
```

- [ ] **Step 4: 重新运行定向测试，确认通过**

Run: `pnpm run compile && pnpm exec mocha "out/test/test/suite/updateService.test.js" --ui tdd --timeout 20000`

Expected: PASS，`UpdateService Test Suite` 全部通过。

- [ ] **Step 5: 提交 Task 1**

```bash
git add hosts/vscode-plugin/src/update/UpdateService.ts hosts/vscode-plugin/src/test/suite/updateService.test.ts
git commit -m "feat(vscode): add manual update check result flow"
```

### Task 2: 通过 IdeBridge 暴露 `checkForUpdates`

**Files:**

- Modify: `hosts/vscode-plugin/src/ui/IdeBridgeServer.ts`
- Modify: `hosts/vscode-plugin/src/ui/WebviewController.ts`
- Modify: `hosts/vscode-plugin/src/test/suite/ideBridgeServer.test.ts`

- [ ] **Step 1: 先写失败测试，覆盖 `checkForUpdates` roundtrip**

在 `hosts/vscode-plugin/src/test/suite/ideBridgeServer.test.ts` 的 update bridge suite 内追加：

```ts
test("checkForUpdates 返回结构化结果", async () => {
  const session = await bridgeServer.createSession(
    {
      openFile: async () => {},
      openUrl: async () => {},
      reloadPath: async () => {},
      clipboardWrite: async () => {},
      getUpdateInfo: async () => ({ state: "idle" }),
      installUpdate: async () => {},
      checkForUpdates: async () => ({
        status: "up-to-date",
        currentVersion: "26.4.1406",
      }),
    },
    {},
  )

  try {
    const reply = await requestReply(session.baseUrl, session.token, { type: "checkForUpdates" })
    assert.strictEqual(reply.ok, true)
    assert.deepStrictEqual(reply.result, {
      status: "up-to-date",
      currentVersion: "26.4.1406",
    })
  } finally {
    bridgeServer.removeSession(session.sessionId)
  }
})
```

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `pnpm run compile && pnpm exec vscode-test --run out/test/test/suite/ideBridgeServer.test.js`

Expected: FAIL，报错包含 `checkForUpdates not supported` 或 reply 结构不匹配。

- [ ] **Step 3: 在 bridge 层接通请求与 handler**

在 `hosts/vscode-plugin/src/ui/IdeBridgeServer.ts` 的 `SessionHandlers` 中增加：

```ts
  checkForUpdates?: () => Promise<Record<string, unknown>>
```

在 `handleSend` 中增加：

```ts
        case "checkForUpdates": {
          if (!session.handlers.checkForUpdates) {
            this.replyError(session, id, "checkForUpdates not supported")
            break
          }
          const result = await session.handlers.checkForUpdates()
          if (id) {
            this.broadcastSSE(session, JSON.stringify({ replyTo: id, ok: true, result, timestamp: Date.now() }))
          }
          break
        }
```

在 `hosts/vscode-plugin/src/ui/WebviewController.ts` 的 session handlers 中增加：

```ts
          checkForUpdates: updateService
            ? async () => {
                return (await updateService.checkForUpdates()) as Record<string, unknown>
              }
            : undefined,
```

- [ ] **Step 4: 重新运行 bridge 测试**

Run: `pnpm run compile && pnpm exec vscode-test --run out/test/test/suite/ideBridgeServer.test.js`

Expected: PASS，新增 `checkForUpdates` 用例通过。

- [ ] **Step 5: 提交 Task 2**

```bash
git add hosts/vscode-plugin/src/ui/IdeBridgeServer.ts hosts/vscode-plugin/src/ui/WebviewController.ts hosts/vscode-plugin/src/test/suite/ideBridgeServer.test.ts
git commit -m "feat(vscode): expose manual update check via ide bridge"
```

### Task 3: 在 UpdateContext 中增加手动检查、确认与 toast 分流

**Files:**

- Modify: `packages/opencode/webgui/src/state/UpdateContext.tsx`
- Modify: `packages/opencode/webgui/src/state/UpdateContext.test.tsx`

- [ ] **Step 1: 先写失败测试，覆盖 up-to-date / available / reject 三类分流**

在 `packages/opencode/webgui/src/state/UpdateContext.test.tsx` 中补：

```tsx
it("checkForUpdates 返回 up-to-date 时显示已是最新版 toast", async () => {
  mocks.request.mockResolvedValueOnce({
    result: { latest: null, hasUpdate: false },
  })
  mocks.request.mockResolvedValueOnce({
    result: { status: "up-to-date", currentVersion: "26.4.1406" },
  })

  const toast = vi.fn()
  const wrapperWithToast = ({ children }: { children: ReactNode }) => (
    <ToastContext.Provider value={{ toasts: [], showToast: toast, dismissToast: vi.fn(), clearAllToasts: vi.fn() }}>
      <UpdateProvider>{children}</UpdateProvider>
    </ToastContext.Provider>
  )

  const { result } = renderHook(() => useUpdate(), { wrapper: wrapperWithToast })

  await waitFor(() => expect(result.current.status).toBe("idle"))
  await act(async () => {
    await result.current.checkForUpdates()
  })

  expect(mocks.request).toHaveBeenLastCalledWith("checkForUpdates", undefined)
  expect(toast).toHaveBeenCalledWith("已是最新版", expect.anything())
})

it("checkForUpdates 返回 available 时记录 latest 并等待确认安装", async () => {
  mocks.request.mockResolvedValueOnce({ result: { latest: null, hasUpdate: false } })
  mocks.request.mockResolvedValueOnce({
    result: {
      status: "available",
      latest: {
        version: "26.4.1407",
        releaseUrl: "https://example.test/releases/26.4.1407",
      },
    },
  })

  const { result } = renderHook(() => useUpdate(), { wrapper })

  await waitFor(() => expect(result.current.status).toBe("idle"))
  await act(async () => {
    await result.current.checkForUpdates()
  })

  expect(result.current.latest?.version).toBe("26.4.1407")
})

it("checkForUpdates reject 时显示失败 toast", async () => {
  mocks.request.mockResolvedValueOnce({ result: { latest: null, hasUpdate: false } })
  mocks.request.mockRejectedValueOnce(new Error("boom"))
  const toast = vi.fn()
  const wrapperWithToast = ({ children }: { children: ReactNode }) => (
    <ToastContext.Provider value={{ toasts: [], showToast: toast, dismissToast: vi.fn(), clearAllToasts: vi.fn() }}>
      <UpdateProvider>{children}</UpdateProvider>
    </ToastContext.Provider>
  )

  const { result } = renderHook(() => useUpdate(), { wrapper: wrapperWithToast })

  await waitFor(() => expect(result.current.status).toBe("idle"))
  await act(async () => {
    await result.current.checkForUpdates()
  })

  expect(toast).toHaveBeenCalledWith("检查更新失败，请稍后重试", expect.anything())
})
```

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `bun run test:run src/state/UpdateContext.test.tsx`

Expected: FAIL，报错包含 `checkForUpdates is not a function` 或 toast 断言失败。

- [ ] **Step 3: 在 UpdateContext 中实现 `isChecking`、`checkForUpdates` 与确认状态**

在 `packages/opencode/webgui/src/state/UpdateContext.tsx` 中将 `UpdateValue` 扩为：

```tsx
type UpdateValue = {
  currentVersion: string
  latest: UpdateRelease | null
  status: UpdateStatus
  isChecking: boolean
  confirmOpen: boolean
  confirmVersion: string | null
  installUpdate: (version: string) => Promise<void>
  checkForUpdates: () => Promise<void>
  confirmInstall: () => Promise<void>
  cancelInstallConfirm: () => void
  openRelease: () => Promise<void>
}
```

并增加最小实现：

```tsx
const toast = useToast()
const [isChecking, setIsChecking] = useState(false)
const [confirmOpen, setConfirmOpen] = useState(false)
const [confirmVersion, setConfirmVersion] = useState<string | null>(null)

const checkForUpdates = useCallback(async () => {
  setIsChecking(true)
  try {
    const reply = await ideBridge.request<{ status: string; latest?: UpdateRelease; currentVersion?: string }>(
      "checkForUpdates",
    )
    const result = reply.result
    if (result?.status === "up-to-date") {
      toast.showToast("已是最新版", { variant: "success" })
      return
    }
    if (result?.status === "available" && result.latest) {
      setLatest((current) => mergeRelease(current, result.latest))
      setStatus("available")
      setConfirmVersion(result.latest.version)
      setConfirmOpen(true)
    }
  } catch {
    toast.showToast("检查更新失败，请稍后重试", { variant: "error" })
  } finally {
    setIsChecking(false)
  }
}, [toast])

const confirmInstall = useCallback(async () => {
  if (!confirmVersion) return
  setConfirmOpen(false)
  await installUpdate(confirmVersion)
}, [confirmVersion, installUpdate])

const cancelInstallConfirm = useCallback(() => {
  setConfirmOpen(false)
  setConfirmVersion(null)
}, [])
```

- [ ] **Step 4: 重新运行定向测试**

Run: `bun run test:run src/state/UpdateContext.test.tsx`

Expected: PASS，新增手动检查分流测试通过。

- [ ] **Step 5: 提交 Task 3**

```bash
git add packages/opencode/webgui/src/state/UpdateContext.tsx packages/opencode/webgui/src/state/UpdateContext.test.tsx
git commit -m "feat(webgui): add manual update check state flow"
```

### Task 4: 在版本号行增加图标按钮并接入确认框

**Files:**

- Modify: `packages/opencode/webgui/src/components/CompactHeader/ActionButtons.tsx`
- Modify: `packages/opencode/webgui/src/components/CompactHeader/index.tsx`
- Modify: `packages/opencode/webgui/src/components/CompactHeader/ActionButtons.test.tsx`

- [ ] **Step 1: 先写失败测试，锁定按钮渲染、loading 和点击**

在 `packages/opencode/webgui/src/components/CompactHeader/ActionButtons.test.tsx` 中补：

```tsx
it("版本号右侧显示检查更新按钮", async () => {
  const user = userEvent.setup()
  renderButtons({ onCheckForUpdates: vi.fn(), isCheckingForUpdates: false })

  await user.click(screen.getByTitle("更多选项"))
  expect(screen.getByTitle("检查更新")).toBeInTheDocument()
  expect(screen.getByText("vtest")).toBeInTheDocument()
})

it("点击检查更新图标时触发 onCheckForUpdates", async () => {
  const user = userEvent.setup()
  const onCheckForUpdates = vi.fn()
  renderButtons({ onCheckForUpdates, isCheckingForUpdates: false })

  await user.click(screen.getByTitle("更多选项"))
  await user.click(screen.getByTitle("检查更新"))

  expect(onCheckForUpdates).toHaveBeenCalledOnce()
})

it("检查更新中时按钮禁用", async () => {
  const user = userEvent.setup()
  renderButtons({ onCheckForUpdates: vi.fn(), isCheckingForUpdates: true })

  await user.click(screen.getByTitle("更多选项"))
  expect(screen.getByTitle("检查更新")).toBeDisabled()
})
```

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `bun run test:run src/components/CompactHeader/ActionButtons.test.tsx`

Expected: FAIL，报错包含缺少 `onCheckForUpdates` / `isCheckingForUpdates` props 或查找不到按钮。

- [ ] **Step 3: 在 ActionButtons / CompactHeader 中接入 useUpdate 与确认框**

在 `ActionButtons.tsx` 的 props 中增加：

```tsx
  isCheckingForUpdates?: boolean
  onCheckForUpdates?: () => void
```

将版本号行改为：

```tsx
<div className="px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300 flex items-center justify-center gap-2 select-none">
  <span>v{__APP_VERSION__}</span>
  <button
    type="button"
    title="检查更新"
    data-tip="检查更新"
    disabled={isCheckingForUpdates === true}
    className="inline-flex items-center justify-center text-gray-500 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed dark:text-gray-400 dark:hover:text-gray-100"
    onClick={() => {
      onCheckForUpdates?.()
    }}
  >
    {isCheckingForUpdates ? (
      <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M4 4v5h5M20 20v-5h-5M5 19a9 9 0 0014.13-2M19 5a9 9 0 00-14.13 2"
        />
      </svg>
    ) : (
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M4 4v5h5M20 20v-5h-5M5 19a9 9 0 0014.13-2M19 5a9 9 0 00-14.13 2"
        />
      </svg>
    )}
  </button>
</div>
```

在 `CompactHeader/index.tsx` 中接入：

```tsx
import { useUpdate } from "../../state/UpdateContext"
```

```tsx
const update = useUpdate()
```

把 props 传给 `ActionButtons`：

```tsx
        isCheckingForUpdates={update.isChecking}
        onCheckForUpdates={() => {
          void update.checkForUpdates()
        }}
```

并在当前组件内复用 `ConfirmModal`：

```tsx
<ConfirmModal
  isOpen={update.confirmOpen}
  title="发现新版本"
  message={
    update.confirmVersion ? `检测到新版本 v${update.confirmVersion}，是否立即更新？` : "检测到新版本，是否立即更新？"
  }
  confirmText="立即更新"
  cancelText="稍后"
  onConfirm={() => {
    void update.confirmInstall()
  }}
  onClose={update.cancelInstallConfirm}
/>
```

- [ ] **Step 4: 重新运行 Header 定向测试**

Run: `bun run test:run src/components/CompactHeader/ActionButtons.test.tsx`

Expected: PASS，新增检查更新图标用例通过。

- [ ] **Step 5: 提交 Task 4**

```bash
git add packages/opencode/webgui/src/components/CompactHeader/ActionButtons.tsx packages/opencode/webgui/src/components/CompactHeader/index.tsx packages/opencode/webgui/src/components/CompactHeader/ActionButtons.test.tsx
git commit -m "feat(webgui): add manual update check button in version row"
```

### Task 5: 全量验证本次补充功能

**Files:**

- Modify: `packages/opencode/webgui/src/state/UpdateContext.test.tsx`
- Modify: `packages/opencode/webgui/src/components/CompactHeader/ActionButtons.test.tsx`
- Modify: `hosts/vscode-plugin/src/test/suite/updateService.test.ts`
- Modify: `hosts/vscode-plugin/src/test/suite/ideBridgeServer.test.ts`

- [ ] **Step 1: 补齐一条确认安装调用测试**

在 `packages/opencode/webgui/src/state/UpdateContext.test.tsx` 增加：

```tsx
it("用户确认后会调用 installUpdate(version)", async () => {
  mocks.request.mockResolvedValueOnce({ result: { latest: null, hasUpdate: false } })
  mocks.request.mockResolvedValueOnce({
    result: {
      status: "available",
      latest: { version: "26.4.1407", releaseUrl: "https://example.test/releases/26.4.1407" },
    },
  })
  mocks.request.mockResolvedValueOnce({ ok: true })

  const { result } = renderHook(() => useUpdate(), { wrapper })

  await waitFor(() => expect(result.current.status).toBe("idle"))
  await act(async () => {
    await result.current.checkForUpdates()
  })
  await act(async () => {
    await result.current.confirmInstall()
  })

  expect(mocks.request).toHaveBeenLastCalledWith("installUpdate", { version: "26.4.1407" })
})
```

- [ ] **Step 2: 运行 WebGUI 定向测试**

Run: `bun run test:run src/state/UpdateContext.test.tsx src/components/CompactHeader/ActionButtons.test.tsx src/components/UpdateBanner.test.tsx`

Expected: PASS，所有与手动检查相关的 WebGUI 测试通过。

- [ ] **Step 3: 运行 VSCode 插件定向测试**

Run: `pnpm run compile && pnpm exec mocha "out/test/test/suite/updateService.test.js" --ui tdd --timeout 20000 && pnpm exec vscode-test --run out/test/test/suite/ideBridgeServer.test.js`

Expected: PASS，手动检查接口与 bridge roundtrip 通过。

- [ ] **Step 4: 运行 WebGUI build**

Run: `bun run build`

Expected: PASS，构建成功。

- [ ] **Step 5: 提交 Task 5**

```bash
git add packages/opencode/webgui/src/state/UpdateContext.test.tsx packages/opencode/webgui/src/components/CompactHeader/ActionButtons.test.tsx hosts/vscode-plugin/src/test/suite/updateService.test.ts hosts/vscode-plugin/src/test/suite/ideBridgeServer.test.ts
git commit -m "test: cover manual update check entry flow"
```

## 自检

- **Spec coverage**
  - 版本号右侧图标入口：Task 4
  - 手动强制检查：Task 1 / Task 2 / Task 3
  - 有更新确认后安装：Task 3 / Task 5
  - 无更新 toast：Task 3
  - 失败 toast：Task 3
  - 保留 UpdateBanner 主链路：Task 3 / Task 5
  - VSCode / WebGUI 测试：Task 1 / 2 / 3 / 4 / 5
- **Placeholder scan**
  - 无 `TODO` / `TBD` / “后续补充” 占位
- **Type consistency**
  - 统一使用 `checkForUpdates()`、`isChecking`、`confirmOpen`、`confirmVersion`
  - Bridge 请求名统一为 `checkForUpdates`
