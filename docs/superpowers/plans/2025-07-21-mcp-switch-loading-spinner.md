# MCP Switch Loading Spinner Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 MCP Server 和 MCP Tool 的开关（Switch）处于忙碌（busy）状态时，将白色圆点替换为旋转 spinner，让用户能清晰感知操作正在进行中。

**Architecture:** 修改 `StatusPopover.tsx` 和对应的 `StatusPopover.test.tsx`。给现有 `Switch` 组件增加 `loading?: boolean` prop；当 loading=true 时，将内部圆点由实心白圆替换为 `animate-spin` 的半透明边框圆；在 MCP Server 开关和 MCP Tool 开关的调用处分别传入对应的 busy 状态作为 `loading`；同时移除 Tool 行旁边的独立 `"更新中..."` 文字（功能已由 Switch spinner 承担）。

**Tech Stack:** React 19、Tailwind CSS v4、Vitest + @testing-library/react

---

## Chunk 1: Switch 组件 loading prop + 相关测试

**Files:**

- Modify: `packages/opencode/webgui/src/components/CompactHeader/StatusPopover.tsx`
- Modify: `packages/opencode/webgui/src/components/CompactHeader/StatusPopover.test.tsx`

---

### Task 1: 为 Switch 组件增加 loading prop 并更新 MCP 开关调用

**Files:**

- Modify: `packages/opencode/webgui/src/components/CompactHeader/StatusPopover.tsx`

- [ ] **Step 1: 修改 Switch 组件，增加 loading prop**

  将 `StatusPopover.tsx` 第 300–316 行的 `Switch` 函数替换为以下内容：

  ```tsx
  function Switch(props: {
    label: string
    checked: boolean
    disabled?: boolean
    loading?: boolean
    onToggle: () => void
  }) {
    return (
      <button
        type="button"
        role="switch"
        aria-label={props.label}
        aria-checked={props.checked}
        disabled={props.disabled}
        className={`flex h-5 w-9 items-center rounded-full p-[2px] transition ${
          props.checked ? "bg-blue-600" : "bg-gray-300 dark:bg-gray-700"
        } disabled:cursor-not-allowed disabled:opacity-60`}
        onClick={props.onToggle}
      >
        {props.loading ? (
          <span
            aria-hidden="true"
            className={`h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin transition ${
              props.checked ? "translate-x-4" : "translate-x-0"
            }`}
          />
        ) : (
          <span
            aria-hidden="true"
            className={`h-4 w-4 rounded-full bg-white transition ${props.checked ? "translate-x-4" : "translate-x-0"}`}
          />
        )}
      </button>
    )
  }
  ```

- [ ] **Step 2: MCP Server 开关调用处传入 loading**

  将 `StatusPopover.tsx` 第 195–200 行的 `<Switch>` 替换为：

  ```tsx
  <Switch
    label={`切换 ${item.name}`}
    checked={item.enabled}
    disabled={item.disabled || data.mcpBusy[item.name] === true}
    loading={data.mcpBusy[item.name] === true}
    onToggle={() => void data.toggleMcp(item.name)}
  />
  ```

- [ ] **Step 3: MCP Tool 开关调用处传入 loading，移除独立"更新中..."文字**

  将 `StatusPopover.tsx` 第 204–231 行 `item.tools.map` 的内层 `return (...)` 替换为：

  ```tsx
  return (
    <div
      key={tool.id}
      className="ml-3 flex items-center justify-between gap-2 border-l border-gray-200 pl-2 dark:border-gray-800"
    >
      <span className="text-[11px] text-gray-600 dark:text-gray-300">{tool.name}</span>
      <Switch
        label={`切换 ${tool.name}`}
        checked={tool.enabled}
        disabled={busy}
        loading={busy}
        onToggle={() => {
          void (async () => {
            const ok = await data.toggleTool(item.name, tool.id, !tool.enabled)
            if (!ok) return
            save()
          })()
        }}
      />
    </div>
  )
  ```

  > 注意：原有的 `{busy ? <span ...>更新中...</span> : null}` 被删除，其功能由 `loading={busy}` 传入 Switch spinner 代替。

---

### Task 2: 更新已有测试，覆盖 loading spinner 行为

**Files:**

- Modify: `packages/opencode/webgui/src/components/CompactHeader/StatusPopover.test.tsx`

- [ ] **Step 1: 更新 "MCP tool busy" 测试——移除对"更新中..."文字的断言，改为断言 spinner 元素存在**

  将 `StatusPopover.test.tsx` 第 387–400 行的测试替换为：

  ```tsx
  it("MCP tool busy 只禁用当前 tool 开关并展示 spinner", async () => {
    const user = userEvent.setup()
    const view = data()
    view.mcpToolBusy = { alpha: { "alpha.read": true } }
    mocks.useStatusPopoverData.mockReturnValue(view)

    render(<StatusPopover open={true} connectionState="connected" onClose={vi.fn()} />)

    await user.click(screen.getByRole("tab", { name: "MCP" }))
    await user.click(screen.getByRole("button", { name: "展开工具 alpha" }))

    const busySwitch = screen.getByRole("switch", { name: "切换 alpha.read" })
    const idleSwitch = screen.getByRole("switch", { name: "切换 alpha.write" })

    expect(busySwitch).toBeDisabled()
    expect(idleSwitch).toBeEnabled()

    // busy switch 内部圆点变为 spinner（有 animate-spin class）
    const spinner = busySwitch.querySelector(".animate-spin")
    expect(spinner).toBeInTheDocument()

    // idle switch 内部仍是实心圆（无 animate-spin）
    const idleKnob = idleSwitch.querySelector(".animate-spin")
    expect(idleKnob).not.toBeInTheDocument()

    // 不再显示独立的"更新中..."文字
    expect(screen.queryByText("更新中...")).not.toBeInTheDocument()
  })
  ```

- [ ] **Step 2: 新增 "MCP server busy 展示 spinner" 测试**

  在上一个测试之后新增：

  ```tsx
  it("MCP server busy 只禁用当前 server 开关并展示 spinner", async () => {
    const user = userEvent.setup()
    const view = data()
    view.mcpBusy = { alpha: true }
    mocks.useStatusPopoverData.mockReturnValue(view)

    render(<StatusPopover open={true} connectionState="connected" onClose={vi.fn()} />)

    await user.click(screen.getByRole("tab", { name: "MCP" }))

    const sw = screen.getByRole("switch", { name: "切换 alpha" })
    expect(sw).toBeDisabled()

    const spinner = sw.querySelector(".animate-spin")
    expect(spinner).toBeInTheDocument()
  })
  ```

- [ ] **Step 3: 运行测试验证全部通过**

  ```bash
  cd packages/opencode/webgui && bun run test:run -- --reporter=verbose src/components/CompactHeader/StatusPopover.test.tsx
  ```

  预期输出（所有用例均 PASS，0 FAIL）：

  ```
  ✓ src/components/CompactHeader/StatusPopover.test.tsx
  Test Files  1 passed (1)
  Tests  X passed (X)
  ```

  ✓ src/components/CompactHeader/StatusPopover.test.tsx (N tests)

  ```

  ```

- [ ] **Step 4: Commit**

  ```bash
  git add packages/opencode/webgui/src/components/CompactHeader/StatusPopover.tsx \
          packages/opencode/webgui/src/components/CompactHeader/StatusPopover.test.tsx
  git commit -m "feat(webgui): add loading spinner to MCP switch during busy state"
  ```
