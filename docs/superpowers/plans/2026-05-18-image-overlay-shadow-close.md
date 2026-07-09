# Image Overlay Shadow Close Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 WebGUI 图片预览在点击图片以外的阴影/空白区域时关闭，同时保留图片本体、工具栏和现有缩放拖拽交互。

**Architecture:** 保持 `ImagePreview` 与 `ImageOverlay` 的现有职责边界，只调整 `ImageOverlay` 的点击事件传播边界。根遮罩继续承担关闭行为，工具栏和图片本体阻止点击冒泡，图片舞台空白区域点击自然冒泡到根遮罩并关闭。

**Tech Stack:** React 19、TypeScript、Tailwind CSS、Vitest、Testing Library。

---

## File Structure

- Modify: `packages/opencode/webgui/src/components/parts/ImageOverlay.tsx`
  - 负责图片预览 overlay、工具栏、缩放、拖拽、滚轮和关闭行为。
  - 本计划只修改点击事件边界，不拆分文件，不改变缩放/保存/拖拽状态模型。
- Modify: `packages/opencode/webgui/src/components/parts/ImageOverlay.test.tsx`
  - 补充阴影点击关闭、图片点击不关闭、工具栏点击不关闭的回归测试。

## Task 1: 写出点击边界回归测试

**Files:**

- Modify: `packages/opencode/webgui/src/components/parts/ImageOverlay.test.tsx`

- [ ] **Step 1: Add failing tests for overlay click boundaries**

在 `describe("ImageOverlay", () => {` 内、`it("Esc 调用 onClose", ...` 后添加以下测试：

```tsx
it("点击图片舞台空白区域调用 onClose", () => {
  const onClose = vi.fn()
  renderOverlay({ onClose })

  const img = screen.getByRole("img", { name: "sample.png" })
  const stage = img.parentElement
  if (!stage) throw new Error("stage not found")

  fireEvent.click(stage)

  expect(onClose).toHaveBeenCalledTimes(1)
})

it("点击图片本体不会调用 onClose", () => {
  const onClose = vi.fn()
  renderOverlay({ onClose })

  fireEvent.click(screen.getByRole("img", { name: "sample.png" }))

  expect(onClose).not.toHaveBeenCalled()
})

it("点击顶部工具栏不会调用 onClose", () => {
  const onClose = vi.fn()
  renderOverlay({ onClose })

  const toolbar = screen.getByText("sample.png").parentElement
  if (!toolbar) throw new Error("toolbar not found")

  fireEvent.click(toolbar)

  expect(onClose).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run the focused test file and verify the new tests fail**

Run from `packages/opencode/webgui`:

```powershell
bun test:run src/components/parts/ImageOverlay.test.tsx
```

Expected result: the new “点击图片舞台空白区域调用 onClose” test fails because the current inner dialog calls `e.stopPropagation()` and blocks the root overlay close handler. Existing tests may still pass.

- [ ] **Step 3: Checkpoint if commits are allowed**

Only if the user explicitly allowed commits in the current session, run from repository root:

```powershell
git add packages/opencode/webgui/src/components/parts/ImageOverlay.test.tsx
git commit -m "test(webgui): cover image overlay click boundaries"
```

Expected result: a test-only commit is created. If commits are not allowed, skip this step and keep the change unstaged.

## Task 2: 实现阴影点击关闭行为

**Files:**

- Modify: `packages/opencode/webgui/src/components/parts/ImageOverlay.tsx`

- [ ] **Step 1: Update event propagation boundaries**

修改 `ImageOverlay.tsx` 的 JSX：

1. 保留根节点的 `onClick={onClose}`。
2. 移除 `role="dialog"` 所在内部容器上的 `onClick={(e) => e.stopPropagation()}`。
3. 给顶部工具栏 `<div className="flex items-center...">` 添加 `onClick={(event) => event.stopPropagation()}`。
4. 给 `<img>` 添加 `onClick={(event) => event.stopPropagation()}`。

目标代码片段如下：

```tsx
  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div className="flex h-full flex-col" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div
          className="flex items-center justify-between gap-4 border-b border-white/10 bg-black/50 px-4 py-3"
          onClick={(event) => event.stopPropagation()}
        >
          <span id={titleId} className="min-w-0 flex-1 truncate font-mono text-sm text-white/80">
            {alt}
          </span>
```

图片节点目标代码片段如下：

```tsx
<img
  src={url}
  alt={alt}
  draggable={false}
  onLoad={(event) => {
    naturalSize.current = {
      width: event.currentTarget.naturalWidth,
      height: event.currentTarget.naturalHeight,
    }

    if (isFit) applyFit()
  }}
  onClick={(event) => event.stopPropagation()}
  onDoubleClick={resetView}
  className="select-none rounded shadow-2xl"
  style={{
    maxWidth: "none",
    maxHeight: "none",
    transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
    transformOrigin: "center center",
  }}
/>
```

- [ ] **Step 2: Run focused tests and verify they pass**

Run from `packages/opencode/webgui`:

```powershell
bun test:run src/components/parts/ImageOverlay.test.tsx
```

Expected result: all `ImageOverlay` tests pass, including the three new click-boundary tests.

- [ ] **Step 3: Checkpoint if commits are allowed**

Only if the user explicitly allowed commits in the current session, run from repository root:

```powershell
git add packages/opencode/webgui/src/components/parts/ImageOverlay.tsx packages/opencode/webgui/src/components/parts/ImageOverlay.test.tsx
git commit -m "fix(webgui): close image preview from shadow clicks"
```

Expected result: implementation and tests are committed. If commits are not allowed, skip this step and keep the change unstaged.

## Task 3: 验证不退化

**Files:**

- Read-only verification for `packages/opencode/webgui/src/components/parts/ImageOverlay.tsx`
- Read-only verification for `packages/opencode/webgui/src/components/parts/ImageOverlay.test.tsx`

- [ ] **Step 1: Run adjacent preview tests**

Run from `packages/opencode/webgui`:

```powershell
bun test:run src/components/parts/ImageOverlay.test.tsx src/components/parts/ImagePreview.test.tsx
```

Expected result: both test files pass. This confirms the portal-opening wrapper and overlay interaction still work together.

- [ ] **Step 2: Run WebGUI typecheck**

Run from `packages/opencode/webgui`:

```powershell
bun typecheck
```

Expected result: TypeScript typecheck completes without errors.

- [ ] **Step 3: Manual behavior check in browser or IDE webview**

Open any generated image preview and verify these actions:

1. Click the dark area around the image: preview closes.
2. Reopen preview, click the image: preview remains open.
3. Click `保存`, `-`, `+`, `重置`, `适应`: each control works and preview remains open unless `关闭` is clicked.
4. Press `Escape`: preview closes.
5. Reopen preview, use mouse wheel over the stage: zoom percentage changes.
6. Drag the image: image position changes and preview remains open.

Expected result: all six manual checks match the described behavior.

- [ ] **Step 4: Final checkpoint if commits are allowed and there are verification-only adjustments**

Only if the user explicitly allowed commits and Step 1 or Step 2 required additional code changes, run from repository root:

```powershell
git status --short
git add packages/opencode/webgui/src/components/parts/ImageOverlay.tsx packages/opencode/webgui/src/components/parts/ImageOverlay.test.tsx
git commit -m "fix(webgui): stabilize image preview close interaction"
```

Expected result: no uncommitted implementation/test changes remain after the final commit. If commits are not allowed, do not run git commit.

## Self-Review

- Spec coverage: the plan covers shadow click close, image click preservation, toolbar click preservation, existing close/zoom/drag/save behavior, and focused tests.
- Placeholder scan: no unresolved placeholders or ambiguous implementation steps remain.
- Type consistency: the plan uses existing `ImageOverlay` props and existing `onClose`, `onClick`, `onDoubleClick`, `onWheel`, `renderOverlay`, `screen`, `fireEvent`, and `vi` APIs consistently.
