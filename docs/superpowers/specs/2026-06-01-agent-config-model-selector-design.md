# Agent 配置页模型选择器替换设计

## 背景

Agent 配置页当前在“模型”列使用原生 `<select>` + `<optgroup>` 展示所有 Provider 和 Model。模型数量较多时，下拉列表过长，缺少搜索、收藏、最近使用等能力，选择体验明显差于对话界面的模型选择框。

对话界面已有 `ModelSelector` 组件，支持搜索、收藏、最近、Provider 分组和选中状态展示。本次改动目标是在 Agent 配置页复用这套交互，同时保留 Agent 配置特有的“默认”语义。

## 目标

- 将 Agent 配置页“模型”列替换为和对话界面一致的搜索式模型选择器。
- 支持在 Agent 配置页清空模型配置，恢复“默认”。
- 保持 `formData.agent[agentName].model = "provider/model"` 的保存格式不变。
- 保持 Variant 列根据所选模型动态显示可选项。
- 下拉列表在设置面板内不被滚动容器裁剪。
- Agent 配置保存后不触发实例 dispose / SSE 断连，并能热更新 active instances 的 agent model/variant cache。
- 不回退对话界面现有 `ModelSelector` 行为。

## 非目标

- 不重做 Agent 配置页整体布局。
- 不改变 Agent 配置保存入口，仍使用设置面板统一保存按钮。
- 不改变 Variant 的配置格式。
- 不复制一套新的模型搜索逻辑。

## 推荐方案

复用并轻量扩展 `ModelSelector`。

`ModelSelector` 保留当前默认行为，新增少量可选 props 以适配设置页：

- `allowClear`：是否展示“默认/清空”入口。
- `clearLabel`：清空入口文案，Agent 配置页使用“默认”。
- `onClear`：点击清空入口时调用；Agent 配置页用它清除该 Agent 的 model。
- `placeholder`：未选择时按钮文案，Agent 配置页使用“默认”。
- `buttonClassName`：允许 Agent 配置页设置表格内按钮宽度和边框样式。
- `dropdownPlacement`：允许设置弹层方向；对话界面保持向上，Agent 配置页使用向下。
- `providersData` / `defaultIdsData`：允许 Agent 配置页传入预加载 provider/default 数据，避免每一行 `ModelSelector` 重复调用 `sdk.config.providers()`。
- `renderInPortal`：允许下拉渲染到 `document.body`，避免 SettingsPanel 的 `overflow-y-auto` 裁剪；portal 打开后随 scroll/resize 重新计算 fixed 定位。

Agent 配置页通过这些 props 使用同一个搜索列表，不再直接渲染原生 `<select>` 模型列表。

## 交互设计

### Agent 配置页模型列

- 未配置模型时，按钮显示“默认”。
- 点击按钮打开模型选择弹层。
- 弹层顶部提供搜索输入。
- 弹层包含：
  - “默认”清空项；
  - 收藏；
  - 最近；
  - Provider 分组。
- 选择模型后，按钮显示模型名称，并将配置写入 `provider/model`。
- 点击“默认”后，清空该 Agent 的 `model` 字段。
- 下拉打开后按 Escape 只关闭模型下拉，不关闭 SettingsPanel，也不触发未保存更改确认。

### Variant 联动

- 模型改变后，根据新模型重新计算 variants。
- 如果当前 variant 不存在于新模型 variants 中，则清空 variant。
- 清空模型为“默认”时，也清空不再适用的 variant。

## 数据流

1. `AgentConfigTab` 从 `formData.agent?.[agentName]?.model` 解析出 `providerID` 和 `modelID`。
2. 将解析结果传给 `ModelSelector` 的 `selectedProviderId` / `selectedModelId`。
3. `ModelSelector` 选择模型后调用 `onSelect(providerID, modelID)`。
4. `AgentConfigTab` 调用 `updateAgent(agentName, "model", `${providerID}/${modelID}`)`。
5. `ModelSelector` 清空时调用 `onClear()`，Agent 配置页再调用 `updateAgent(agentName, "model", undefined)`。
6. `updateAgent` 继续负责删除空配置对象，避免写入无意义的空 agent 配置。
7. `SettingsPanel` 保存时只提交变化的顶层字段；当 `agent` 变化时提交完整顶层 `agent` patch。
8. 后端 `Config.updateGlobal()` 对顶层 `agent` 使用 replace 语义写入 JSON/JSONC，确保清空 model 会删除旧的 `agent.<name>.model`。
9. Global config handler 将 `agent` 视为 lightweight field：保存后不 dispose instance，而是在 active instances 上执行 `Agent.reloadModelConfig()` 热更新 cached model/variant。

## 错误处理与边界

- 如果已保存模型不存在于当前 Provider 列表中，Agent 配置页仍显示原始 `provider/model`，避免用户看不到当前配置。
- Provider 加载失败时沿用 `ModelSelector` 现有失败处理；Agent 配置页自身仍保留加载错误提示。
- 对话界面不传新增 props，因此保持原行为。
- `provider/model` 解析只按第一个 `/` 拆分，保留 model id 内部的 `/`。
- `ModelSelector` preferences 加载失败不缓存 rejected promise；reset 同时清理 cache 和 queue，避免失败状态污染后续读取。

## 测试计划

- `ModelSelector`：
  - 新增 `allowClear` 时显示清空入口。
  - 点击清空入口调用 `onClear`，且不调用 `onSelect`。
  - 默认 props 下不显示清空入口，确保对话界面不变。
  - portal 下拉在 scroll 和 resize 后重新定位。
- `AgentConfigTab`：
  - 模型列渲染搜索式选择器而不是原生模型 `<select>`。
  - 选择模型后写入 `agent.<name>.model`。
  - 点击“默认”清空 model。
  - 切换模型会清空不兼容 variant。
  - 多个 agent 行共享预加载 provider 数据，不为每行重复请求 provider 列表。
- `SettingsPanel`：
  - ModelSelector portal 打开时按 Escape 只关闭下拉，不关闭 SettingsPanel。
  - 清空 Agent model 保存时发送完整顶层 `agent` patch。
- `Config.updateGlobal`：
  - JSON 和 JSONC 全局配置都覆盖测试：顶层 `agent` replace 能删除旧 nested `model` 字段。

## 验收标准

- Agent 配置页不再出现长原生模型下拉列表。
- 可以通过搜索快速选择模型。
- 可以恢复默认模型。
- 保存后的配置格式和之前一致。
- 对话界面模型选择器行为保持不变。
- 保存 Agent 配置不会断开 webgui 与后端连接，也不会中断正在运行的对话。
