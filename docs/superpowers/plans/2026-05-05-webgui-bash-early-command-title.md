# WebGUI bash 提前显示命令标题 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 WebGUI 中的 bash 工具卡片在运行开始时就显示 `input.description`，而不是等命令执行完成后才显示完整标题。

**Architecture:** 只改 `ToolPart` 的展示 helper，不改后端事件流或消息结构。测试先在 `utils.test.ts` 中写出 bash 运行期标题回归用例，再在 `utils.tsx` 为 bash 增加一个仅在 `title` 缺失时生效的 `input.description` 兜底分支。

**Tech Stack:** TypeScript、React、Vitest、Testing Library、Bun

---

## 文件结构与职责

- `packages/opencode/webgui/src/components/parts/ToolPart/utils.tsx`
  - `getToolDisplayName(...)` 的集中展示规则
  - 本次只在这里为 `bash` 增加运行期标题兜底
- `packages/opencode/webgui/src/components/parts/ToolPart/utils.test.ts`
  - `getToolDisplayName(...)` 的纯函数测试
  - 本次新增 bash 回归测试，并补一条“非 bash 不吃 description”保护测试

### Task 1: 更新 ToolPart 标题规则并补回归测试

**Files:**

- Modify: `packages/opencode/webgui/src/components/parts/ToolPart/utils.test.ts:4-66`
- Modify: `packages/opencode/webgui/src/components/parts/ToolPart/utils.tsx:137-202`
- Verify: `packages/opencode/webgui/src/components/parts/ToolPart/index.tsx:75`

- [ ] **Step 1: 在 `utils.test.ts` 写 bash 运行期标题的失败测试**

在 `describe("getToolDisplayName", ...)` 里，插入下面两个测试，放在现有“在有 title 时使用中文工具名”测试后面：

```ts
it("bash 在无 title 时使用 description 作为运行中标题", () => {
  expect(
    getToolDisplayName("bash", { command: "git status", description: "查看工作区变更" }, undefined, undefined),
  ).toBe("执行命令：查看工作区变更")
})

it("非 bash 工具在无 title 时不应把 description 当作标题", () => {
  expect(
    getToolDisplayName("read", { filePath: "/tmp/demo.ts", description: "查看工作区变更" }, undefined, undefined),
  ).toBe("查看：/tmp/demo.ts")
})
```

说明：

- 第一条是这次问题的直接回归测试，当前实现下会失败
- 第二条保证修复只影响 bash，不让规则扩散到 read 等工具
- 现有第一个测试 `在有 title 时使用中文工具名` 已经覆盖了“title 优先于 fallback”的要求，不需要重复造一个 bash+title 用例

- [ ] **Step 2: 运行目标测试，确认新回归用例先失败**

Run:

```bash
bun run test:run src/components/parts/ToolPart/utils.test.ts
```

Expected:

- `bash 在无 title 时使用 description 作为运行中标题` 失败
- 失败信息类似：`Expected: "执行命令：查看工作区变更"` / `Received: "执行命令"`
- 其他既有测试保持通过

- [ ] **Step 3: 在 `utils.tsx` 为 bash 添加最小展示兜底实现**

把 `getToolDisplayName(...)` 中 `switch (tool)` 的实现改成下面这样，只新增 `bash` 分支，其余分支保持原样：

```ts
export function getToolDisplayName(
  tool: string,
  input: Record<string, unknown> | undefined,
  title: string | undefined,
  output: string | undefined,
): string {
  const toolLabel = getToolLabel(tool)

  if (title) {
    const normalizedTitle =
      tool === "skill"
        ? title
            .replace(/^Loaded skill:\s*/i, "")
            .replace(/^Loading skill:\s*/i, "")
            .replace(/^加载技能[:：]\s*/, "")
        : title

    let display = `${toolLabel}：${normalizedTitle}`

    if ((tool === "todowrite" || tool === "todoread") && output) {
      try {
        const todos = JSON.parse(output)
        if (Array.isArray(todos)) {
          const completed = todos.filter((t: Todo) => t.status === "completed").length
          const total = todos.length
          display = completed === 0 ? `${toolLabel}：共 ${total} 项` : `${toolLabel}：已完成 ${completed}/${total}`
        }
      } catch {
        // If parsing fails, keep original title
      }
    }

    if (tool === "grep" && input?.include) {
      display += ` (${input.include})`
    }

    return display
  }

  if (!input) return toolLabel

  switch (tool) {
    case "bash": {
      const desc = input.description
      return typeof desc === "string" && desc.length > 0 ? `${toolLabel}：${desc}` : toolLabel
    }
    case "list":
      return input.path ? `${toolLabel}：${input.path}` : toolLabel
    case "glob":
      return input.pattern ? `${toolLabel}：${input.pattern}` : toolLabel
    case "grep": {
      let grepDisplay = toolLabel
      if (input.pattern) grepDisplay += `：${input.pattern}`
      if (input.include) grepDisplay += ` (${input.include})`
      return grepDisplay
    }
    case "webfetch":
      return input.url ? `${toolLabel}：${input.url}` : toolLabel
    case "edit":
    case "multiedit":
    case "write":
    case "read":
      return input.filePath ? `${toolLabel}：${input.filePath}` : toolLabel
    default:
      return toolLabel
  }
}
```

实现约束：

- 只能在 `title` 缺失时使用这个 fallback
- 只能对 `bash` 生效
- 不要顺手重构其它工具逻辑

- [ ] **Step 4: 重新运行目标测试，确认回归用例转绿**

Run:

```bash
bun run test:run src/components/parts/ToolPart/utils.test.ts
```

Expected:

- `utils.test.ts` 全部通过
- 新增的 bash 回归测试通过
- 现有 `skill`、`grep`、`todoread/todowrite` 等展示测试仍保持通过

- [ ] **Step 5: 运行 ToolPart 相关验证，确认消费方未受破坏**

Run:

```bash
bun run test:run src/components/parts/ToolPart/utils.test.ts src/components/parts/ToolPart/index.test.tsx
```

Expected:

- 两个测试文件都 PASS
- `ToolPart/index.test.tsx` 中与 task / apply_patch / 展开区域相关的既有断言全部保持通过

- [ ] **Step 6: 检查工作区 diff，只保留这次最小改动**

Run:

```bash
git diff -- packages/opencode/webgui/src/components/parts/ToolPart/utils.tsx packages/opencode/webgui/src/components/parts/ToolPart/utils.test.ts
```

Expected:

- diff 只包含 `bash` fallback 分支
- diff 只包含两条测试新增
- 没有顺手格式化或无关改动

- [ ] **Step 7: 提交这次修复**

Run:

```bash
git add packages/opencode/webgui/src/components/parts/ToolPart/utils.tsx packages/opencode/webgui/src/components/parts/ToolPart/utils.test.ts
git commit -m "fix(webgui): show bash tool title before command completes"
```

Expected:

- commit 成功
- 提交只包含 bash 标题提前展示相关改动

## 自查

- **Spec coverage:** 已覆盖 spec 中的两项改动：`utils.tsx` bash fallback 与 `utils.test.ts` 回归测试；没有把范围扩散到其他工具或后端事件流
- **Placeholder scan:** 计划中没有 `TBD`、`TODO`、`类似 Task N`、`写一些测试` 之类占位描述；每个代码步骤都给了具体代码或命令
- **Type consistency:** 计划里统一使用 `getToolDisplayName(tool, input, title, output)`、`input.description`、`title`、`toolLabel`，与现有代码命名一致
