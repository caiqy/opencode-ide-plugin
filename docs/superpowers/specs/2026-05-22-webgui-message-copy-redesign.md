# WebGUI Message Copy Redesign

**Goal:** 让对话区域复制行为稳定、可测试，并统一用户消息的选区复制、悬浮按钮复制与 VSCode WebView 快捷键复制路径。

**Context:** 当前用户消息复制比助手消息更容易失败。用户消息在 `TextPart.tsx` 内自定义 `onCopy`，会先 `preventDefault()`，再根据 DOM selection 与 `data-rawpart` 映射回原文；一旦映射失败，就可能阻止浏览器默认复制但没有写入剪贴板。按钮复制、快捷键复制和选区复制分别走不同链路，文本序列化规则也不一致。

---

## Root Cause

1. **用户消息选区复制过度依赖 DOM 结构。**
   `TextPart.tsx` 只在用户消息分支挂 `onCopy`，且非折叠选区会立即阻止默认行为。后续映射依赖 `window.getSelection()`、`range`、`focusNode`、`data-rawpart`、`data-raw-start`、`data-raw-end`。如果选区起止点跨越缩略图、mention 包装、非文本节点、或者浏览器返回的 `range` 与 `focusNode` 不符合预期，代码可能算不出 `rawStart/rawEnd`，造成空复制。

2. **复制文本序列化分裂。**
   `MessageRow.tsx` 对复制按钮使用 `message.parts.flatMap(...).join("")`。而 `MessageList/utils.ts` 已经有 `getUserMessagePlainText()`，使用 `join("\n").trim()`，并被回退到输入框逻辑复用。两个口径不一致，导致按钮复制、多段用户消息、undo-to-input 的文本可能不同。

3. **剪贴板执行分裂。**
   悬浮按钮使用 `writeClipboard()`，它有 `navigator.clipboard.writeText` 与 IDE bridge fallback；快捷键复制使用 `KeyboardHandler` 内的 `document.execCommand("copy")`；用户选区复制只在 `copy` event 里写 `clipboardData`。这三条路径没有共享的行为边界。

---

## Design

### 1. 新增用户消息复制领域工具

新增 `packages/opencode/webgui/src/components/MessageList/messageCopy.ts`，集中处理纯逻辑：

- `getMessageCopyText(message)`：返回消息级按钮复制文本。
  - 用户消息复用 `getUserMessagePlainText()`。
  - 助手消息沿用非 synthetic text part 拼接，但明确保留当前按钮复制语义。
- `getUserTextCopySelection(input)`：把用户消息 DOM selection 映射为原始文本片段。
  - 成功映射 mention 时返回 raw text。
  - 普通文本选区优先返回原文片段。
  - 映射失败时返回 `selection.toString()`，不再产生“阻止默认但没有内容”。
  - 折叠选区时返回整条用户消息文本。

`TextPart.tsx` 保留渲染职责，但将复制计算交给 `messageCopy.ts`。`onCopy` 只负责：

1. 确认事件属于当前用户消息 wrapper。
2. 调用复制计算。
3. 只有拿到非空文本时才 `preventDefault()` 并写入 `clipboardData`。
4. 拿不到文本时放行浏览器默认复制。

### 2. 统一消息按钮复制文本来源

`MessageRow.tsx` 不再内联 `flatMap(...).join("")`，改用 `getMessageCopyText(message)`。这样用户消息按钮复制与回退输入框使用同一规则，避免多段消息被无分隔拼接。

### 3. 保留 `writeClipboard()` 作为按钮复制执行层

`ActionButtons.tsx` 继续调用 `writeClipboard(copyText)`，不改变它的 UI 行为和 bridge fallback。此次重构不把 `KeyboardHandler` 改成异步 bridge 写剪贴板，因为键盘 copy 必须依赖浏览器 copy event 的同步 `clipboardData`，强行改为异步会改变 WebView 与系统快捷键交互语义。

### 4. 收窄 `KeyboardHandler` 改动

`KeyboardHandler` 只补充测试，不做行为改造。目标是确认：

- `execCommand("copy")` 成功时才阻止默认行为。
- 失败时不阻止默认行为，让浏览器或宿主处理。
- 有 DOM selection 时事件会留在 iframe 内触发 `copy` event，从而让 `TextPart.onCopy` 工作。

---

## Confirmed Behavior Changes

以下是已向用户说明并获得确认的既有行为变化：

1. **用户消息悬浮按钮复制的多段文本分隔符从空字符串改为换行。**
   现状：`["第一段", "第二段"].join("")` → `第一段第二段`。
   新行为：复用 `getUserMessagePlainText()` → `第一段\n第二段`。
   理由：与“回退到输入框”的用户原文恢复规则一致，更符合多段消息原貌。

2. **用户消息悬浮按钮复制会 trim 首尾空白。**
   这是 `getUserMessagePlainText()` 的既有规则。当前按钮复制不 trim。若用户依赖复制首尾空白，这会有差异。

3. **用户消息选区复制在映射失败时改为复制可见选区文本。**
   当前失败时可能为空；新行为会 fallback 到 `selection.toString()`。这属于修复，但复制 mention 时若映射失败，可能得到可见 label 而不是 raw mention 文本。

4. **折叠选区复制整条用户消息的行为保留。**
   当前用户消息内部折叠选区按 `Ctrl/Cmd+C` 会复制整条消息。新设计保留这一点，不做变更。

---

## Tests

### `messageCopy.test.ts`

- 用户消息按钮复制复用 `getUserMessagePlainText()`：忽略 synthetic text，过滤空文本，多段用换行，trim。
- 助手消息按钮复制保留当前拼接规则。
- 普通用户文本选区复制返回原文片段。
- 包含 file/agent mention 时，选区复制返回 raw mention 文本，而不是可视 label。
- 部分选中 mention 时仍复制完整 raw mention，避免粘贴后丢失引用语义。
- selection 不在当前 wrapper 内时返回 `null`，让组件放行默认复制。
- DOM 映射失败时返回 `selection.toString()` fallback。

### `TextPart.test.tsx`

- 用户消息普通选区 `copy` 写入选区文本。
- 折叠选区 `copy` 写入整条用户消息。
- selection 不在当前 wrapper 内时不阻止默认行为。
- 映射失败 fallback 时仍写入可见选区文本。
- 跨普通文本、mention 与后续文本复制时写入 raw 原文。

### `MessageRow.test.tsx`

- 用户消息 hover 后 `ActionButtons` 接收 canonical `copyText`。
- 多段用户消息不再被空字符串拼接。

### `keyboardHandler.test.ts`

- 保留并补强 copy 成功/失败的默认行为测试。
- DOM selection 位于非编辑消息区域时，`Ctrl/Cmd+C` 留在 iframe 内执行 `copy` 命令，不转发给父级。
- 不改变快捷键语义。

---

## Non-Goals

- 不重做助手 Markdown 复制语义。
- 不改变代码块复制按钮。
- 不改变 IDE bridge clipboard 协议。
- 不引入全局 copy listener。
- 不改视觉样式。

---

## Acceptance Criteria

- 用户消息映射失败时写入可见选区文本；无法得到文本或 selection 不属于当前 wrapper 时不阻止默认复制。
- 用户消息含 mention 时，能优先复制 raw 原文。
- 用户消息悬浮按钮复制使用统一 serializer。
- VSCode WebView 快捷键复制仍保持现有 copy event 触发方式。
- 新增复制相关单元测试覆盖上述场景并通过。
- `packages/opencode/webgui` 下相关测试与 `tsc -b`/构建通过。
