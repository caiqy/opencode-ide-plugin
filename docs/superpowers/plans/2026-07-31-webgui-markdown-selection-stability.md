# WebGUI Markdown 文本选区稳定性实施计划

> **面向代理执行者：** 必须使用 `subagent-driven-development`（推荐）或 `executing-plans`，逐项执行本计划。所有步骤使用复选框跟踪。

**目标：** 已完成的 Markdown 消息因界面状态重新渲染时，保留正文 DOM 节点，使浏览器文本选区不再突然全选或清空。

**架构：** 保留现有 `react-markdown` 渲染链，只用 React `useMemo` 稳定自定义 Markdown 组件映射的函数身份。通过节点身份回归测试直接覆盖浏览器 Selection Range 所依赖的前提，不增加 Selection 保存或偏移恢复逻辑。

**技术栈：** React 19、react-markdown 10、Vitest、Testing Library、Vite

## 全局约束

- 不新增依赖，不改变 Markdown 样式、复制内容或流式文本更新规则。
- 仅当 `inline`、`tone` 或项目目录变化时重建 Markdown 组件映射。
- 不修改当前工作区中已有改动的 `MessagesContext.tsx` 与 `MessagesContext.questions.test.tsx`。
- 未经用户明确要求，不创建 Git 提交。

---

### 任务 1：保持 Markdown DOM 节点稳定

**文件：**
- 修改：`packages/opencode/webgui/src/components/MarkdownRenderer.test.tsx`
- 修改：`packages/opencode/webgui/src/components/MarkdownRenderer.tsx:1,312-319`

**接口：**
- 使用：现有 `MarkdownRenderer({ children, inline, tone })`
- 产出：接口不变；相同渲染输入下复用 `react-markdown` 的 `components` 映射

- [x] **步骤 1：编写失败的节点身份回归测试**

在 `MarkdownRenderer.test.tsx` 的基础渲染测试之后加入：

```tsx
it("相同复杂 Markdown 重渲染时保留正文 DOM 节点", () => {
  const markdown = [
    "1. 合并到 `opencode/dev`，保持本地。",
    "2. 检查 `packages/opencode/webgui/src/components/MarkdownRenderer.tsx`。",
  ].join("\n")
  const view = renderWithTheme(<MarkdownRenderer>{markdown}</MarkdownRenderer>)
  const code = screen.getByText("opencode/dev")
  const item = code.closest("li")

  expect(item).toBeTruthy()

  view.rerender(
    <ThemeProvider>
      <MarkdownRenderer>{markdown}</MarkdownRenderer>
    </ThemeProvider>,
  )

  expect(screen.getByText("opencode/dev")).toBe(code)
  expect(code.closest("li")).toBe(item)
  expect(code.isConnected).toBe(true)
})
```

- [x] **步骤 2：运行测试并确认按预期失败**

从 `packages/opencode/webgui` 运行：

```bash
bun run test:run -- src/components/MarkdownRenderer.test.tsx
```

预期：新增用例失败，报告重新渲染后的 `code` 节点不是先前记录的节点；其余用例通过。

- [x] **步骤 3：实现最小修复**

将 React 导入改为：

```tsx
import React, { useMemo } from "react"
```

将 `MarkdownRenderer` 中直接创建组件映射的逻辑改为：

```tsx
const components = useMemo(
  () =>
    inline
      ? createInlineComponents(styles, tone, directory)
      : createMarkdownComponents(styles, tone, directory),
  [directory, inline, styles, tone],
)
```

保留其余渲染和 `urlTransform` 行为不变。

- [x] **步骤 4：运行定向测试并确认通过**

```bash
bun run test:run -- src/components/MarkdownRenderer.test.tsx
```

预期：文件内全部用例通过，新增节点身份用例由失败变为通过。

- [x] **步骤 5：运行 WebGUI 构建验证**

```bash
bun run build
```

预期：TypeScript 构建与 Vite 生产构建均退出 0。

- [x] **步骤 6：验证 DOM Selection 锚点**

在步骤 1 的用例中，从列表普通文本到行内代码创建真实 `Range` 并加入 `window.getSelection()`。相同属性重新渲染后，断言选中文本、`anchorNode`、`focusNode` 与 Range 端点都保持原值且仍连接文档。补充正文变化时未变片段节点复用，以及 `inline`、`tone`、项目目录变化时缓存正确失效的用例。

再次运行：

```bash
bun run test:run -- src/components/MarkdownRenderer.test.tsx
```

预期：进程自行退出 0；27 个用例全部通过，Selection 文本和四个锚点引用保持稳定。
