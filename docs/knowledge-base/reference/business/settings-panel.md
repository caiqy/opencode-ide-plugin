# 能力：设置面板壳层

> **象限**：Reference（能力参考）
> **能力编号**：E1（见 [capabilities-index](../capabilities-index.md)）
> **基线状态**：部分基线；实际 5 tab 组成是后续漂移修正

## 代码真源

| 角色 | 文件 |
|------|------|
| 面板挂载与保存 | `packages/opencode/webgui/src/components/SettingsPanel/index.tsx` |
| 头部/底部 | `packages/opencode/webgui/src/components/SettingsPanel/SettingsHeader.tsx`、`SettingsFooter.tsx` |
| tab 导航 | `packages/opencode/webgui/src/components/SettingsPanel/TabBar.tsx` |
| 表单加载 | `packages/opencode/webgui/src/components/SettingsPanel/hooks/useSettingsForm.ts` |
| 未保存拦截 | `packages/opencode/webgui/src/components/SettingsPanel/hooks/useUnsavedChanges.ts` |
| tab 内容 | `packages/opencode/webgui/src/components/settings/` |

> 命名交叉核验（Step 5）：`SettingsPanel/index.tsx` 第 21 行定义 `TabType = "provider" | "general" | "agents" | "advanced" | "quick-phrases"`，第 24 行默认 `provider`。

## 意图

设置面板是 WebGUI 内编辑 opencode 全局 config 和插件体验设置的统一入口。它负责加载、比较、保存配置，并把具体业务分发给 Provider、General、Agent、Advanced、Quick phrases 各 tab。

## 行为契约

- 打开面板时读取 opencode 全局 config：`useSettingsForm.ts` 第 20 行调用 `sdk.global.config.get()`，第 27-29 行把返回值同时写入 `formData` 与 `originalFormData`。
- 实际 tab 是 5 个：`SettingsPanel/index.tsx` 第 126-136 行分别挂载 `ProviderSettingsTab`、`GeneralTab`、`AgentConfigTab`、`AdvancedTab`、`QuickPhrasesTab`。
- 可见导航当前只列 3 个 tab：`TabBar.tsx` 第 7-11 行显示 Provider、Agent、Quick phrases；`general`/`advanced` 仍保留在 `TabType` 和渲染分支中。
- 保存只发送变更字段：`SettingsPanel/index.tsx` 第 70-78 行构造 diff patch，再调用 `sdk.global.config.update()`，用于减少不必要的 Instance dispose。
- 关闭和 Escape 都走未保存检查：`SettingsPanel/index.tsx` 第 32-39 行、47-60 行；`ConfirmModal` 在第 153-162 行拦截放弃更改。

## 边界与约束

- opencode 全局 config 是设置面板保存的底层真源；WebGUI tabs/drafts/theme/model prefs 走 [scoped-storage](scoped-storage.md)。
- Provider 细节见 [provider-settings](provider-settings.md)，Agent 默认模型见 [agent-config](agent-config.md)，模型选择器见 [model-selection](model-selection.md)，快捷短语入口见 [message-input](message-input.md)。
- `SettingsPanel` 不直接负责配置热重载策略；是否 dispose 由服务端 config handler 判断。

## 维护检查

- 新增 tab 时同步 `TabType`、`TabBar` 可见入口和内容渲染分支。
- 新增保存字段时确认它属于 opencode config，而不是 scoped storage。
- 改保存逻辑时保留 diff patch，避免把轻量字段和重字段一起提交。
- 改关闭行为时同时检查按钮关闭、遮罩关闭（如有）和 Escape。
- 改浏览器模式入口时确认不会暴露依赖 IDE bridge 的按钮。
- 改 Provider/Agent tab 时优先在对应能力文档补契约，不把细节塞回壳层。
- 改中文文案时保持专有名词 `Provider`、`Agent`、`WebGUI` 原文。
- 改错误展示时不要只依赖 console；面板已有 `error` 与保存异常边界。

## 已知漂移

- [settings-panel](settings-panel.md) 漏列 `ProviderSettingsTab`，并按旧口径描述为 4 tab；当前代码真源确认是 5 个 `TabType`，默认 `provider`。
- [settings-panel](settings-panel.md) 仍写到 General/Advanced 偏好，但当前 `TabBar.tsx` 第 7-11 行没有展示这两个入口。

## 运行时待核验

- [ ] 浏览器模式下 general/advanced tab 和配置文件按钮的隐藏行为（`待运行时核验`：当前可从 `TabBar` 静态确认导航隐藏，但需实机确认所有入口不可达）。

## 相关

- 设置与本地化深度清单：[settings-panel](settings-panel.md)
- 状态存储边界：[scoped-storage](scoped-storage.md)
