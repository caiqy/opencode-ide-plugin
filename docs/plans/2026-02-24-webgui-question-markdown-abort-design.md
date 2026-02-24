# WebGUI 提问组件 Markdown 渲染与 Stop 清理设计（仅 WebGUI）

- 日期：2026-02-24
- 状态：已评审（用户逐节确认）

---

## 背景与问题

当前 WebGUI 中，提问消息的 `question` 文本不支持 Markdown 渲染，导致包含列表、强调、链接等内容时可读性较差。  
同时在用户点击 Stop 后，若前端未及时清理本地未处理提问，会出现同一提问反复弹出的问题。

---

## 目标与范围

在不改动服务端 `session.abort` 统一语义的前提下，仅修复 WebGUI 入口侧行为。  
具体包括：仅对 `question` 字段启用 Markdown 渲染，以及在 Stop 过程中优先保证停止动作落地并清理本地提问状态。

---

## 方案选择

### A. 入口最小改动（选中）

在 `QuestionOptions.tsx` 仅渲染 `question` 为 Markdown，`option.label` 与 `option.description` 保持纯文本。  
在 `useMessageInput.ts` 的 Stop 流程中，先执行本地提问批量 reject（容错），无论部分失败与否都继续调用 `session.abort`。

**优点**：改动集中、风险低、符合现有约束、回归面最小。  
**缺点**：仅覆盖 WebGUI，不解决其他入口一致性问题。

### B. 服务端统一增强

将提问清理与中止语义统一收敛到服务端接口，前端仅消费结果。  
**优点**：长期一致性好。  
**缺点**：违背“仅 WebGUI 修复”和“不改 `session.abort` 统一语义”的已确认约束。

### C. 前端全字段 Markdown

对 `question`、`option.label`、`option.description` 全量 Markdown 渲染。  
**优点**：展示能力最强。  
**缺点**：违背已确认渲染边界，且会引入选项展示歧义与额外测试面。

**结论**：选择 A。

---

## 架构与组件设计

### 组件职责

- `packages/opencode/webgui/src/components/MessageList/Parts/QuestionPart/QuestionOptions.tsx`
  - 对 `question` 字段走 Markdown 渲染组件
  - `option.label`、`option.description` 保持现有纯文本渲染路径

- `packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.ts`
  - Stop 入口编排：批量 reject 未处理提问（容错）→ 调用 `session.abort`
  - 失败处理策略：reject 局部失败不阻断 abort

### 测试职责

- `packages/opencode/webgui/src/components/MessageList/Parts/QuestionPart/QuestionOptions.test.tsx`
  - 验证 `question` Markdown 生效
  - 验证 `option.label` / `option.description` 不被 Markdown 解析

- `packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.test.tsx`
  - 验证 Stop 时批量 reject 与 abort 的调用顺序和兜底行为
  - 验证 reject 部分失败仍继续执行 abort

---

## 数据流（Markdown 渲染流、Stop 清理流）

### Markdown 渲染流

1. MessageList 渲染 QuestionPart。
2. `QuestionOptions.tsx` 读取提问数据。
3. `question` 进入 Markdown 渲染器输出富文本。
4. `option.label` 与 `option.description` 直接按字符串展示，不走 Markdown 管线。

### Stop 清理流

1. 用户点击 Stop，进入 `useMessageInput.ts` Stop handler。
2. 收集当前未处理提问并执行批量 reject。
3. 若批量 reject 出现部分失败，记录错误并继续流程。
4. 无条件调用 `session.abort`，确保停止优先语义。
5. UI 状态更新，避免旧提问再次弹出。

---

## 错误处理与边界

- 批量 reject 全部成功：正常进入 abort。
- 批量 reject 部分失败：不中断，继续 abort，并保留可观测日志。
- 批量 reject 全部失败：仍执行 abort，避免“无法停止”体验。
- Markdown 边界：仅 `question` 开启，选项字段严格保持原样，防止意外样式或交互变化。
- 本次不处理服务端会话语义，也不扩展到非 WebGUI 入口。

---

## 测试与验收（最小必要单测 + 手动验收）

### 单测最小集

1. `QuestionOptions.test.tsx`
   - 输入含 `**bold**`、列表、链接的 `question`，断言渲染为对应 HTML 结构
   - 输入含 Markdown 语法的 `option.label` / `option.description`，断言仍按纯文本显示

2. `useMessageInput.test.tsx`
   - Stop 时存在多个未处理提问，断言先触发批量 reject 再触发 `session.abort`
   - 模拟部分 reject 失败，断言 `session.abort` 仍被调用
   - 可选补充：reject 全失败时仍 abort

### 手动验收

1. 发送带 Markdown 的提问文本，确认问题描述展示正确。
2. 选项文字中输入 Markdown 语法，确认不被解析。
3. 提问弹出后点击 Stop，确认不会反复弹出同一未处理提问。
4. 在网络抖动或局部接口失败场景下点击 Stop，确认会话仍能停止。

---

## 风险与回退

- 风险：Markdown 渲染引入样式差异，可能影响现有排版。
- 风险：Stop 时新增容错分支，若日志不足可能增加排障成本。
- 回退策略：
  - 通过 feature flag 或最小化 revert 回退 `question` Markdown 渲染
  - 回退 Stop 新流程到原有逻辑（保留补丁前版本）
  - 单测保留，便于回滚后快速重验

---

## 非目标（YAGNI）

- 不改服务端 `session.abort` 语义与接口契约。
- 不对 `option.label`、`option.description` 做 Markdown 化。
- 不扩展到 CLI、桌面端或其他非 WebGUI 入口。
- 不在本次引入新的提问协议字段或跨端统一重构。
