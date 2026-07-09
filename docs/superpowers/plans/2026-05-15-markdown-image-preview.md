# Markdown Image Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Markdown 正文图片与工具图片共享稳定预览能力，修复 generated-images 路径加载失败与滚动抖动。

**Architecture:** 新增共享 `ImagePreview` 组件负责缩略图、失败占位、点击放大，并用 portal 渲染放大层避免把 dialog 塞进 Markdown 段落。`MarkdownRenderer` 只在 `.opencode/generated-images/` 路径上改写为带当前 `directory ?? worktree` 的 WebGUI 专用路由，其他 URL 保持原样；链接包图片保持链接语义，不渲染嵌套按钮。`ToolImageAttachments` 复用共享组件，但继续保留工具卡片元信息布局和缩略图高度上限。`ProjectContext` 保持 `worktree` 与 `directory` 语义分离。

**Tech Stack:** React 19、TypeScript、ReactMarkdown、Vitest、Testing Library、Tailwind CSS。

---

### Task 1: Markdown 图片路径与失败占位测试

**Files:**

- Modify: `packages/opencode/webgui/src/components/MarkdownRenderer.test.tsx`
- Modify: `packages/opencode/webgui/src/components/MarkdownRenderer.tsx`
- Create: `packages/opencode/webgui/src/components/parts/ImagePreview.tsx`
- Create: `packages/opencode/webgui/src/components/parts/ImagePreview.test.tsx`
- Modify: `packages/opencode/webgui/src/components/parts/ToolPart/ToolImageAttachments.tsx`
- Modify: `packages/opencode/webgui/src/components/parts/ToolPart/ToolImageAttachments.test.tsx`
- Modify: `packages/opencode/webgui/src/state/ProjectContext.tsx`
- Create: `packages/opencode/webgui/src/state/ProjectContext.test.tsx`

- [ ] **Step 1: Write failing tests**

在 `MarkdownRenderer.test.tsx` 增加测试：

```tsx
it("generated-images Markdown 图片使用专用图片路由", () => {
  renderWithTheme(<MarkdownRenderer>{"![生成图](.opencode/generated-images/demo.png)"}</MarkdownRenderer>)

  const image = screen.getByRole("img", { name: "生成图" })

  expect(image.getAttribute("src")).toBe(getGeneratedImageUrl(".opencode/generated-images/demo.png", null))
})

it("generated-images Markdown 图片携带当前目录上下文", () => {
  project.directory = "D:\\repo with space"

  renderWithTheme(<MarkdownRenderer>{"![生成图](.opencode/generated-images/demo.png)"}</MarkdownRenderer>)

  expect(screen.getByRole("img", { name: "生成图" }).getAttribute("src")).toBe(
    getGeneratedImageUrl(".opencode/generated-images/demo.png", project.directory),
  )
})

it("generated-images Markdown 图片在目录未就绪时使用 worktree 兜底", () => {
  project.worktree = "D:\\repo"

  renderWithTheme(<MarkdownRenderer>{"![生成图](.opencode/generated-images/demo.png)"}</MarkdownRenderer>)

  expect(screen.getByRole("img", { name: "生成图" }).getAttribute("src")).toBe(
    getGeneratedImageUrl(".opencode/generated-images/demo.png", project.worktree),
  )
})

it("inline generated-images Markdown 图片也使用 worktree 兜底", () => {
  project.worktree = "D:\\repo"

  renderWithTheme(<MarkdownRenderer inline>{"![生成图](.opencode/generated-images/demo.png)"}</MarkdownRenderer>)

  expect(screen.getByRole("img", { name: "生成图" }).getAttribute("src")).toBe(
    getGeneratedImageUrl(".opencode/generated-images/demo.png", project.worktree),
  )
})

it("generated-images Markdown 图片兼容点斜杠与反斜杠路径", () => {
  renderWithTheme(<MarkdownRenderer>{"![生成图](.\\.opencode\\generated-images\\demo.png)"}</MarkdownRenderer>)

  expect(screen.getByRole("img", { name: "生成图" }).getAttribute("src")).toBe(
    getGeneratedImageUrl(".opencode/generated-images/demo.png", null),
  )
})

it("generated-images Markdown 图片兼容编码反斜杠路径", () => {
  renderWithTheme(<MarkdownRenderer>{"![生成图](.opencode%5Cgenerated-images%5Cdemo.png)"}</MarkdownRenderer>)

  expect(screen.getByRole("img", { name: "生成图" }).getAttribute("src")).toBe(
    getGeneratedImageUrl(".opencode/generated-images/demo.png", null),
  )
})

it("网络 Markdown 图片保持原始地址", () => {
  renderWithTheme(<MarkdownRenderer>{"![远程图](https://example.com/image.png)"}</MarkdownRenderer>)

  expect(screen.getByRole("img", { name: "远程图" }).getAttribute("src")).toBe("https://example.com/image.png")
})

it("Markdown 图片加载失败时显示稳定占位", () => {
  renderWithTheme(<MarkdownRenderer>{"![坏图](.opencode/generated-images/missing.png)"}</MarkdownRenderer>)

  fireEvent.error(screen.getByRole("img", { name: "坏图" }))

  expect(screen.getByText("图片预览不可用")).toBeInTheDocument()
  expect(screen.queryByRole("img", { name: "坏图" })).not.toBeInTheDocument()
  expect(screen.getByText("图片预览不可用")).toHaveClass("min-h-20")
})

it("非 base64 的 data image Markdown 图片保持原始地址", () => {
  const svg = "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E"

  renderWithTheme(<MarkdownRenderer>{`![SVG 图](${svg})`}</MarkdownRenderer>)

  expect(screen.getByRole("img", { name: "SVG 图" }).getAttribute("src")).toBe(svg)
})

it("无 alt 的 Markdown 图片使用文件名作为可访问名称", () => {
  renderWithTheme(<MarkdownRenderer>{"![](.opencode/generated-images/demo.png)"}</MarkdownRenderer>)

  expect(screen.getByRole("button", { name: "查看图片：demo.png" })).toBeInTheDocument()
})

it("无 alt 的链接包裹 Markdown 图片使用文件名作为链接名称", () => {
  renderWithTheme(
    <MarkdownRenderer>{"[![](.opencode/generated-images/demo.png)](https://example.com)"}</MarkdownRenderer>,
  )

  const link = screen.getByRole("link", { name: "demo.png" })

  expect(link.querySelector("button")).toBeNull()
  expect(link.querySelector("img")?.getAttribute("alt")).toBe("demo.png")
})

it("Markdown 图片预览弹窗渲染到 markdown 容器外", () => {
  const { container } = renderWithTheme(
    <MarkdownRenderer>{"![生成图](.opencode/generated-images/demo.png)"}</MarkdownRenderer>,
  )

  fireEvent.click(screen.getByRole("button", { name: "查看图片：生成图" }))

  const root = container.querySelector(".markdown-content")
  const dialog = screen.getByRole("dialog")

  expect(root?.contains(dialog)).toBe(false)
})

it("链接包裹 Markdown 图片时不产生交互元素嵌套", () => {
  renderWithTheme(
    <MarkdownRenderer>{"[![生成图](.opencode/generated-images/demo.png)](https://example.com)"}</MarkdownRenderer>,
  )

  const link = screen.getByRole("link", { name: "生成图" })

  expect(link.querySelector("button")).toBeNull()
  expect(link.querySelector("img")?.getAttribute("src")).toBe(
    getGeneratedImageUrl(".opencode/generated-images/demo.png", null),
  )
})
```

- [ ] **Step 2: Verify tests fail**

Run: `bun run test:run src/components/MarkdownRenderer.test.tsx src/components/parts/ImagePreview.test.tsx src/components/parts/ToolPart/ToolImageAttachments.test.tsx`

Expected: generated image URL/directory/worktree fallback/path-compat tests fail because Markdown currently leaves paths unchanged or omits instance context；data URL、empty-alt、failure fallback、portal、link nesting、ImagePreview reset tests fail because the shared preview behavior is not implemented yet.

- [ ] **Step 3: Implement shared preview**

Create `ImagePreview.tsx` with props for `src`, `alt`, `filename`, `className`, `imageClassName`, `fallbackClassName`, `fallbackText`, and `interactive`; render an image button, portal-based `ImageOverlay`, and a stable fallback when `onError` fires. Reset failed/preview state when `src` changes, derive a friendly basename for empty alt text, and safely handle invalid percent-encoding.

- [ ] **Step 4: Wire MarkdownRenderer**

Add a markdown `img` component and `urlTransform` that resolve `.opencode/generated-images/` via `getGeneratedImageUrl(src, directory ?? worktree)` and render `ImagePreview` with compact正文样式。External URLs、absolute paths、relative paths、all `data:image/*` URLs、blob URLs keep original `src`. Wrap link contents with an image-link context so linked images render as plain images instead of nested buttons, including empty-alt linked images with basename fallback.

- [ ] **Step 5: Wire ToolImageAttachments**

Replace its inline image/error/overlay state with `ImagePreview`, preserving `Image #N`、文件名、relativePath layout and current tests. Add `max-h-80 object-contain` to keep tall/4K thumbnails from stretching the card excessively.

- [ ] **Step 5.5: Keep ProjectContext path semantics separate**

Store `directory` and `worktree` separately in `ProjectContext`; use `path.get().worktree` or `project.current().worktree` for `worktree`, and never let `directory` overwrite `worktree`. Add `ProjectContext.test.tsx` asserting `worktree === D:/repo` while `directory === D:/repo/sub`.

Add a direct `ToolImageAttachments` regression test asserting `directory === null && worktree !== null` still passes `worktree` into `getGeneratedImageUrl()` for `relativePath` images.

- [ ] **Step 6: Verify targeted tests pass**

Run: `bun run test:run src/components/MarkdownRenderer.test.tsx src/components/parts/ImagePreview.test.tsx src/components/parts/ToolPart/ToolImageAttachments.test.tsx src/state/ProjectContext.test.tsx`

Expected: PASS.

- [ ] **Step 7: Build WebGUI**

Run: `bun run build`

Expected: `tsc -b && vite build` succeeds; existing chunk-size warning is acceptable.
