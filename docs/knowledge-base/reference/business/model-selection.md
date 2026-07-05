# 能力：模型、Agent 与 Variant 选择

> **象限**：Reference（能力参考）
> **能力编号**：B4 + E4（见 [capabilities-index](../capabilities-index.md)）
> **基线状态**：基线

## 代码真源

| 角色 | 文件 |
|------|------|
| 从消息提取历史选择 | `packages/opencode/webgui/src/lib/selection/selectionFromMessages.ts` |
| workspace 选择持久化 | `packages/opencode/webgui/src/state/repo/selectionRepo.ts` |
| 会话激活恢复链路 | `packages/opencode/webgui/src/state/useSessionActivation.ts` |
| 选择状态与 fallback | `packages/opencode/webgui/src/state/SessionContext.tsx` |
| 模型选择器 | `packages/opencode/webgui/src/components/ModelSelector.tsx` |
| Agent 选择器 | `packages/opencode/webgui/src/components/AgentSelector.tsx` |
| Variant 选择器 | `packages/opencode/webgui/src/components/VariantSelector.tsx` |
| recent/favorite 偏好 | `packages/opencode/webgui/src/state/repo/modelPrefsRepo.ts` |

> 命名交叉核验（Step 5）：`selectionFromMessages` 返回 provider/model/agent/variant（第 30-48 行），与 `selectionRepo` 的 workspace key `opencode:webgui:workspace:last_selection:v1` 字段对应（`selectionRepo.ts` 第 3-12 行）。

## 意图

让用户在多会话、多 Agent 工作流中切回旧会话时尽量恢复当时使用的 provider/model/agent/variant，同时为当前会话提供可搜索、可收藏、可清空的选择器。

## 行为契约

- 初始选择优先级是 workspace last selection → per-agent model map → global recent → opencode config model → providers 第一个可用模型（`SessionContext.tsx` 第 357-408 行）。
- 如果已保存 provider/model 或 variant 当前不可用，会 fallback 到 recent/config/first available 或清空 variant，并设置一次性提示“已恢复到当前可用配置”（`SessionContext.tsx` 第 410-450 行）。
- 会话激活时先 `ensureSession` 最近页，再从最新 user message 提取选择；找不到且有 cursor 时最多向前 `scanOlder` 10 页，不污染 visible messages（`useSessionActivation.ts` 第 82-160 行）。
- 选择提取尊重 revert boundary：如果 session 有 revert message，只看该 message 之前的可见消息（`selectionFromMessages.ts` 第 23-30 行）。
- `restoreSelections` 可由会话激活或 IDE bridge 调用；`variant: null` 表示显式恢复默认并移除该模型的临时 variant 偏好（`SessionContext.tsx` 第 596-648 行）。
- 手动切换模型会更新当前 agent 的 model map、patch workspace selection，并写入 global recent（`SessionContext.tsx` 第 475-518 行）。
- 手动切换 Agent 会保存旧 agent 的当前模型，并优先恢复新 agent 曾用模型（`SessionContext.tsx` 第 547-593 行）。
- `ModelSelector` 支持 provider/model 搜索、recent、favorite、默认模型标记、reasoning 标记（`ModelSelector.tsx` 第 279-349、396-447 行）。
- `ModelSelector` 的 `allowClear` 会展示清空项，选中时调用 `onClear` 而不是选择具体模型（`ModelSelector.tsx` 第 14-16、250-253、379-389 行）。
- recent/favorite 存在 global scoped storage `opencode:webgui:global:model:v1`；写入通过队列串行化，避免并发覆盖（`modelPrefsRepo.ts` 第 3、15、67-99 行）。
- `AgentSelector` 隐藏 `mode === "subagent"` 和 hidden agent；`VariantSelector` 总是提供“默认”选项，未选中 variant 时使用默认（`AgentSelector.tsx` 第 34-37 行；`VariantSelector.tsx` 第 42-53、84-103 行）。

## 边界与约束

- selectionRepo 是 workspace 级最近选择；modelPrefsRepo 是 global 级 recent/favorite。不要把会话选择写进 opencode config。
- 从消息恢复选择依赖 user message 的 `model.providerID/modelID/agent/variant`，不是 assistant meta。
- 历史扫描最多 10 页是当前上限；更深历史找不到选择时继续使用当前配置。
- `allowClear` 是 ModelSelector 的可选 UI 能力；是否允许清空由调用方传入，不是所有模型选择入口都默认可清空。
- favorite 不会从 Provider 原始模型列表删除模型；无搜索时 Provider 分组会隐藏已收藏项，避免重复显示（`ModelSelector.tsx` 第 416-421 行）。
- AgentSelector 的 `Build` fallback 只是显示 fallback；真实选中值仍由 `SessionContext` 的 `selectedAgent` 管理。
- 选择恢复链路已内化到本文；模型/Provider 偏好见 [model-selection 能力参考](model-selection.md)，主题偏好见 [settings-panel 能力参考](settings-panel.md)。

## 静态核验点

- `selectionRepo` 会清洗非法持久化 shape，非法 agent/model/variant 字段会回落为 null 或空 map（`selectionRepo.ts` 第 23-56 行）。
- `modelPrefsRepo` 会清洗 recent/favorite entry，并用内部队列串行保存（`modelPrefsRepo.ts` 第 18-27、67-87 行）。
- `useSessionActivation` 的 activation token 和 AbortController 会阻止旧会话恢复覆盖新会话（`useSessionActivation.ts` 第 85-108、128-130、184-189 行）。

## 漂移风险

- 改 user message 的 model/agent 字段时，必须同步 `selectionFromMessages`，否则旧会话恢复会静默失效。
- 改 Provider 列表 shape 时，必须同步 `hasModel`、`modelVariants` 和 `ModelSelector` 的模型遍历。

## 运行时待核验

- [ ] Provider 配置被删除/重命名后，旧会话切换时 fallback toast 是否只出现一次且不重复打扰（`待运行时核验`：需要真实配置变更 + 多次切换）。
- [ ] 多个 ModelSelector 实例同时打开时，favorite/recent 刷新顺序是否符合用户预期（`待运行时核验`：需要 UI 并发交互）。

## 相关

- 会话与聊天：[session-chat](session-chat.md)
- Provider 设置页：[provider-settings](provider-settings.md)
- scoped storage：[scoped-storage](scoped-storage.md)
- Agent 配置：[agent-config](agent-config.md)
