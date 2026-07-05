# 能力：中文本地化

> **象限**：Reference（能力参考）
> **能力编号**：A3（见 [capabilities-index](../capabilities-index.md)）
> **基线状态**：基线

## 代码真源

| 角色 | 文件 |
|------|------|
| 工具中文名表 | `packages/opencode/webgui/src/components/parts/ToolPart/utils.tsx` |
| 设置与快捷短语文案 | `packages/opencode/webgui/src/components/settings/` |
| 输入区文案 | `packages/opencode/webgui/src/components/MessageInput/` |
| 选择器文案 | `packages/opencode/webgui/src/components/ModelSelector.tsx`、`AgentSelector.tsx`、`VariantSelector.tsx` |
| 全站 UI 文案 | `packages/opencode/webgui/src/` |

> 命名交叉核验（Step 5）：`ToolPart/utils.tsx` 第 3-29 行是工具展示名集中表，`getToolLabel` 第 31-33 行确认未收录工具回退原始 tool id。

## 意图

让 IDE WebGUI 面向中文用户提供固定中文界面，同时保留 Provider、MCP、LSP、SDK、WebGUI 等协议和产品专有名词，避免引入 i18n 运行时复杂度。

## 行为契约

- 当前没有 i18n key、语言包或语言切换层；UI 文案直接写在组件中（例如 `ModelSelector.tsx` 第 373、391、393、400、410 行）。
- 工具展示中文名集中在 `TOOL_LABELS`，覆盖 bash/read/write/edit/apply_patch/MCP 相关工具等常见 tool id（`ToolPart/utils.tsx` 第 3-29 行）。
- 未收录工具不会被翻译，直接显示原始 tool id（`ToolPart/utils.tsx` 第 31-33 行）。
- 工具标题会组合中文工具名与原始 title/input，例如 `执行命令：<description>`、`文本查找：<pattern>`（`ToolPart/utils.tsx` 第 139-213 行）。
- Variant 的常见 reasoning 值翻译为低/中/高/无/极低/最大/超高，未知 variant 回退首字母大写原值（`VariantSelector.tsx` 第 11-31 行）。
- Agent 选择器隐藏 subagent/hidden agent，界面文案使用“智能体”“正在加载智能体…”等中文（`AgentSelector.tsx` 第 34-37、93-123 行）。
- 附件、发送失败、终止失败、压缩会话等用户反馈是中文 toast/文案（`useFileAttachment.ts` 第 30-35、59-64 行；`useMessageInput.ts` 第 141-168、241-248 行）。

## 边界与约束

- 中文化只影响展示文案，不改变 API 字段、tool id、Provider id、model id 或协议名称。
- 专有名词保留英文；MCP/LSP/Provider/SDK/WebGUI/VSCode/JetBrains 等不翻译。
- 新增工具展示名优先更新 `ToolPart/utils.tsx` 的集中表；不要在各 tool card 内分散硬编码同一 tool id 的中文名。
- 这不是可切换语言能力；需要多语言时应先设计 i18n 边界，而不是在现有中文字符串旁边继续堆条件分支。
- 工具卡片的动态 title/output 仍来自模型或后端，不属于固定中文本地化范围。
- `getToolDisplayName` 会保留 title、path、pattern、url 等用户/工具输入内容，不做翻译或清洗（`ToolPart/utils.tsx` 第 147-182、188-212 行）。
- 错误对象里的底层英文 message 可能透传到 toast；只有 WebGUI 自己生成的 fallback 文案由前端固定中文控制。

## 静态核验点

- `TOOL_LABELS` 没有外部配置入口，工具名变更必须改代码（`ToolPart/utils.tsx` 第 3-29 行）。
- 未知 variant 和未知 tool 都有原值 fallback，不会因为缺翻译表而空白（`VariantSelector.tsx` 第 29-31 行；`ToolPart/utils.tsx` 第 31-33 行）。
- 设置、选择器、输入区的 placeholder/title/aria 文案当前直接位于组件源码，本文记录约束不是真源。

## 漂移风险

- 新增工具、Agent 模式或 Variant 枚举时，最容易遗漏中文展示名和 fallback 语义。
- 新增设置 tab 或状态面板项时，应按现有固定中文风格写在组件源码里。
- 如果未来引入 i18n，本页应改为记录语言包真源，而不是继续列散落字符串。
- 新增 toast/error fallback 时，优先写中文；底层 error.message 可透传但不替代用户级 fallback。
- 文案审查时按组件入口抽样，不复制旧清单。
- 新增 aria-label/title 时同样属于本地化范围，不只检查可见文本。
- 新增模型能力标签时，中文展示和原始能力字段要分开处理。
- 新增工具参数摘要时，参数值保持原文，只有固定标签中文化。

## 运行时待核验

- [ ] 全站是否仍残留用户可见英文普通文案（非专有名词、非代码/模型/tool id）（`待运行时核验`：需要 UI 遍历截图或自动化文案扫描）。

## 相关

- 工具调用卡片：[tool-rendering](tool-rendering.md)
- 设置面板：[settings-panel](settings-panel.md)
- 模型选择器：[model-selection](model-selection.md)
- 消息输入：[message-input](message-input.md)
