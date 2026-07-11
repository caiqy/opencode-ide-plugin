# WebGUI Reasoning HTML Comment Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide model-generated HTML comments from WebGUI reasoning content without enabling HTML rendering or changing stored messages.

**Architecture:** Sanitize only the display value inside `ReasoningPart` with one non-greedy expression covering single-line, multiline, and optionally escaped comments. Reuse that value for the empty-state decision and Markdown rendering.

**Tech Stack:** React 19, TypeScript, ReactMarkdown, Vitest, Testing Library

## Global Constraints

- Do not enable raw HTML rendering.
- Do not add dependencies.
- Do not mutate `part.text` or affect ordinary assistant messages.
- Hide HTML comments inside reasoning code blocks as an accepted minimal-scope tradeoff.

---

### Task 1: Filter HTML comments from reasoning display

**Files:**
- Modify: `packages/opencode/webgui/src/components/MessageList/ReasoningPart.tsx:16-29`
- Test: `packages/opencode/webgui/src/components/MessageList/ReasoningPart.test.tsx`

**Interfaces:**
- Consumes: `part.text: string` from the existing reasoning part.
- Produces: no new exported interface; `ReasoningPart` renders the filtered local `text` value.

- [ ] **Step 1: Write the failing component tests**

Import `fireEvent`, change the existing empty-content case to use comment-only content, and add a case that expands the reasoning panel and checks surrounding text:

```tsx
import { fireEvent, render, screen } from "@testing-library/react"

it("当 thinking 内容仅包含 HTML 注释时不渲染可展开面板", () => {
  render(
    <PartOpenProvider items={[]}>
      <ReasoningPart
        part={{
          id: "r1",
          sessionID: "s1",
          messageID: "m1",
          type: "reasoning",
          text: "\\<!-- hidden -->",
          time: { start: 1 },
        }}
        durationMs={1000}
      />
    </PartOpenProvider>,
  )

  expect(screen.getByText("思考了 1 秒")).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "思考了 1 秒" })).not.toBeInTheDocument()
})

it("隐藏 HTML 注释并保留相邻推理内容", () => {
  render(
    <PartOpenProvider items={[]}>
      <ReasoningPart
        part={{
          id: "r2",
          sessionID: "s1",
          messageID: "m1",
          type: "reasoning",
          text: "Before\n\n<!-- hidden\ncomment -->\n\nAfter",
          time: { start: 1 },
        }}
        durationMs={1000}
      />
    </PartOpenProvider>,
  )

  fireEvent.click(screen.getByRole("button", { name: "思考了 1 秒" }))
  expect(screen.getByText("Before")).toBeInTheDocument()
  expect(screen.getByText("After")).toBeInTheDocument()
  expect(screen.queryByText(/hidden|comment/)).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run from `packages/opencode/webgui`:

```bash
bun run test:run src/components/MessageList/ReasoningPart.test.tsx
```

Expected: FAIL because comment-only reasoning still creates an expandable panel.

- [ ] **Step 3: Implement the minimal display-only filter**

Replace the local text construction and render the filtered value:

```tsx
const text = (part.text || "").replace(/\\?<!--[\s\S]*?-->/g, "").trim()
```

```tsx
content={<MarkdownRenderer tone="muted">{text}</MarkdownRenderer>}
```

- [ ] **Step 4: Run focused and package verification**

Run from `packages/opencode/webgui`:

```bash
bun run test:run src/components/MessageList/ReasoningPart.test.tsx
bun run build
```

Expected: both commands exit successfully; the focused test reports 2 passing tests.

- [ ] **Step 5: Commit the implementation**

```bash
git add packages/opencode/webgui/src/components/MessageList/ReasoningPart.tsx packages/opencode/webgui/src/components/MessageList/ReasoningPart.test.tsx
git commit -m "fix(webgui): hide reasoning html comments"
```
