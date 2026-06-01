# 快捷短语固定交互设计

日期：2026-06-01

## 背景

WebGUI 的快捷短语目前支持三种可切换的"输入模式"：

- `double_send`（直接发送）
- `confirm_send`（确认后发送）
- `fill_input`（回填输入框）

模式存储在 `quickPhraseRepo` 的 `QuickPhraseState.mode` 字段中，用户通过设置页（`QuickPhrasesTab`）顶部的下拉框切换。短语按钮统一通过 `onDoubleClick → onActivate` 触发，`MessageInput/index.tsx` 的 `onActivatePhrase` 根据当前 `mode` 分发到回填 / 发送 / 确认弹窗。

## 目标

去掉可切换的输入模式，固定为两种交互：

- **左键双击** → 立即发送短语正文
- **右键双击** → 把正文回填到输入框（不发送）

并彻底移除 `mode` 这套数据与代码。

## 关键技术决策：右键双击检测

浏览器没有原生的"右键双击"事件。`dblclick` 只对主键（左键）触发；`contextmenu` 每次右键都触发但没有"双击"语义。因此：

- **左键双击**沿用按钮原生 `onDoubleClick`（最稳，自带阈值与拖拽交互处理）。
- **右键双击**在 `onContextMenu` 中 `preventDefault()` 阻止系统菜单，并用一个组件内 `useRef` 记录上次右键的 `{ id, time }`；当同一按钮两次右键间隔 ≤ 400ms 时判定为右键双击 → 回填，否则只记录时间戳。

采用此方案而非"左右键都自己实现双击检测"，是为了保留浏览器原生左键双击的稳定性，并避免与 `QuickPhraseBar` 现有横向拖拽（pointer 事件）逻辑互相干扰，改动面最小。

## 交互行为（最终）

快捷短语栏中每个短语按钮：

- 左键双击 → 立即发送正文（等价旧 `double_send`）
- 右键双击 → 回填正文到输入框，替换当前草稿（等价旧 `fill_input`），不发送
- 单击（左或右）、单次右键：无副作用
- 右键在按钮上不弹系统菜单（`preventDefault`）；按钮以外区域不受影响
- `disabled`（会话忙 / 锁定 / 空正文 / 无 session）时两种交互都不触发
- 按钮 `title` 更新为：`左键双击发送 / 右键双击回填：<正文>`
- 现有横向拖拽（pointer 事件）逻辑完全保留，不改动

## 组件与数据改动

### `state/repo/quickPhraseRepo.ts`

- 删除 `QuickPhraseMode` 类型导出。
- 从 `QuickPhraseState` 删除 `mode` 字段。
- 删除 `setQuickPhraseMode` 函数。
- `normalize()` 中删除 `mode(...)` 解析与内部 `mode` 辅助函数；旧 localStorage 里残留的 `mode` 字段在反序列化时被自然忽略，无需迁移逻辑。
- 其余（items、order、preset 合并、增删改、排序、隐藏、`enqueue`、`sorted`）保持不变。

### `components/settings/QuickPhrasesTab.tsx`

- 删除顶部"输入模式" `<label>` + `<select>` 整块。
- 删除 `mode` state、`setMode`，以及 `apply()` 中的 `setMode(state.mode)`。
- 删除对 `setQuickPhraseMode`、`QuickPhraseMode` 的 import。
- 保留短语增删改、隐藏、排序与 `quick_phrase_updated_event` 通知逻辑。

### `components/MessageInput/QuickPhraseBar.tsx`

- 删除 `mode` prop 与 `modeLabels` 映射。
- 新增 callback props：`onSend(item)` 与 `onFill(item)`，替代原 `onActivate`。
- 每个短语按钮：
  - `onDoubleClick={() => !disabled && onSend(item)}`
  - `onContextMenu={(e) => { e.preventDefault(); if (disabled) return; 右键双击检测 → onFill(item) }}`
  - 右键双击检测：组件内 `useRef<{ id: string; time: number } | null>`；`contextmenu` 时若 `id` 相同且 `now - time ≤ 400ms` 判定右键双击并调用 `onFill(item)`，随后清空 ref；否则记录 `{ id, now }`。
- `title` 改为 `左键双击发送 / 右键双击回填：${item.body}`。
- 横向拖拽（pointer 事件）逻辑不动。

### `components/MessageInput/index.tsx`

- 删除 `onActivatePhrase`（基于 `quickPhrases.mode` 的分发）。
- 删除 `phraseConfirm` / `setPhraseConfirm` state、`onConfirmPhrase`，以及"确认发送快捷短语"的 `<ConfirmModal>`。
- 保留 `fillPhrase` 与 `sendPhrase`，作为：
  - `onSend = (item) => sendPhrase(item.body)`
  - `onFill = (item) => fillPhrase(item.body)`
  - 两者沿用现有内部的 `isDisabled` / 空正文 / session 守卫。
- `QuickPhraseBar` 不再接收 `mode` prop。
- 精简会话历史的 `<ConfirmModal>` 保留不动。

## 测试

### `components/settings/QuickPhrasesTab.test.tsx`

- 删除"可以切换输入模式"用例（断言 `getByLabelText("输入模式")` 并切到 `double_send`）。
- 保留增删改 / 隐藏 / 排序相关用例。

### `components/MessageInput/index.test.tsx`

- 删除 / 重写依赖 `mode` 的用例：`fill_input 模式双击仅回填不发送`、`double_send 模式双击会直接发送`、`double_send 模式发送不应回填输入框`、`double_send 模式遇到空正文时不应发送`、`confirm_send 模式双击需确认后发送`、`没有 session 时 double_send 不应触发发送意图` 等。
- 测试 harness 的 `lastQuickPhraseBarProps` mock 从 `{ mode, items, onActivate }` 改为 `{ items, disabled, onSend, onFill }`。
- 改写为基于新 props 的断言：
  - 调用 `onSend` → `submitQuickPhrase` 被调用、`onSendIntent` 触发、不回填。
  - 调用 `onFill` → `insertPlainWithMentionsImpl` 回填、不发送。
  - 空正文 / 无 session / disabled 时不触发。

### `QuickPhraseBar.test.tsx`（已存在）

- 现有 4 个用例都向 `QuickPhraseBar` 传 `onActivate={vi.fn()}`，需改为新的 props 签名（`onSend` / `onFill`），其余断言（展开/收起、横向滚动、禁用、pointerDown 不捕获）保持不变。
- 新增右键双击检测用例：两次 `contextmenu` 间隔 ≤ 400ms 触发 `onFill`；单次右键不触发。
- 新增：`contextmenu` 调用了 `preventDefault`（断言 `defaultPrevented` 或 mock 的 `preventDefault`）。
- 新增：左键 `dblclick` 触发 `onSend`。
- 新增：`disabled` 时左键双击与右键双击都不触发。

## 验证

在 `packages/opencode/webgui` 下：

- `bun run test:run src/components/MessageInput/index.test.tsx`
- `bun run test:run src/components/settings/QuickPhrasesTab.test.tsx`
- `QuickPhraseBar` 相关测试一并运行
- 类型检查 / 构建按仓库现有方式执行

## 文档更新

- `docs/repowiki/06-settings-update-localization.md`：把"为每条短语选择执行模式：填入输入框、确认后发送或双击发送"更新为固定的"左键双击发送、右键双击回填"。
- `docs/repowiki/04-session-chat.md`：把"支持填入输入框、确认后发送、双击发送等模式"更新为固定行为描述。

## 非目标

- 不改动快捷短语的增删改、隐藏、排序、preset 合并逻辑。
- 不改动横向拖拽 / 展开收起逻辑。
- 不改动精简会话历史的确认弹窗。
- 不为旧 `mode` 字段做数据迁移（直接忽略）。
