# 能力：Agent 配置热重载

> **象限**：Reference（能力参考）
> **能力编号**：E3（见 [capabilities-index](../capabilities-index.md)）
> **基线状态**：**新增**（2026-06-01）

## 代码真源

| 角色 | 文件 |
|------|------|
| Agent 设置页 | `packages/opencode/webgui/src/components/settings/AgentConfigTab.tsx` |
| 全局配置保存/热重载 | `packages/opencode/src/server/routes/instance/httpapi/handlers/global.ts` |
| Instance dispose 入口 | `packages/opencode/src/server/routes/instance/httpapi/handlers/instance.ts` |

> 命名交叉核验（Step 5）：`SettingsPanel/index.tsx` 第 132 行把 `activeTab === "agents"` 绑定到 `AgentConfigTab`；服务端实际热重载逻辑在 `handlers/global.ts` 第 151-168 行。

## 意图

允许用户在设置页为每个 Agent 指定默认模型和 variant，并让轻量 Agent 配置变更在现有 Instance 内生效，避免保存设置后打断当前会话或重连。

## 行为契约

- 设置页加载 Agent 列表和 Provider 模型目录：`AgentConfigTab.tsx` 第 57 行并发调用 `sdk.app.agents()` 与 `sdk.config.providers()`。
- 每行 Agent 从 `formData.agent?.[agent.name]` 读取配置：`AgentConfigTab.tsx` 第 101-110 行映射 `model`、`variant` 与 `configured`。
- 模型选择使用搜索式 `ModelSelector`：`AgentConfigTab.tsx` 第 237-250 行传入 `providersData`、`defaultIdsData`，并允许 `allowClear` 回到默认。
- variant 候选来自已选模型的 `variants`：`AgentConfigTab.tsx` 第 21-33 行；切换模型时第 124-128 行会清掉不再合法的 variant。
- 服务端用变更字段决定是否 dispose：`handlers/global.ts` 第 23-40 行定义轻量字段，`agent` 在其中；第 65-79 行按 PATCH/replace 的实际变更 key 判断。
- 轻量变更不 dispose，而是刷新 Agent 服务缓存：`handlers/global.ts` 第 160-167 行和第 185-192 行调用 `instances.provideAll(agent.reloadModelConfig())`。

## 边界与约束

- 当前 UI 只编辑 `model` 和 `variant`；system prompt、max steps 等 Agent 配置属于底层 config 能力，但不在当前 `AgentConfigTab` 表格中暴露。
- `handlers/instance.ts` 第 28-31 行仍保留显式 dispose endpoint；Agent 配置保存不应走这个入口。
- 保存入口仍是全局 config update，面板层只负责发送 diff patch，dispose 决策由服务端执行。

## 维护检查

- 新增 Agent 字段时先判断是否属于 `LIGHTWEIGHT_FIELDS`，再决定是否允许热重载。
- 改 `agent` config schema 后同步检查 `AgentConfigTab.tsx` 第 101-110 行的读取逻辑。
- 改模型值格式时同步 `parseModelValue()` 和 `updateAgent()`，它们当前依赖 `provider/modelId`。
- 改 variant 结构时同步 `getVariantsForModel()`，当前读取 `provider.models[modelID].variants`。
- 改保存链路时确认 `SettingsPanel` 仍只发变更字段。
- 改 dispose 策略时检查 `handlers/global.ts` 的 PATCH 与 replace 两条路径。
- 改 Agent 服务缓存时确认 `agent.reloadModelConfig()` 仍覆盖所有现有 Instance。
- 改 UI 文案时保留 `Agent`、`Provider`、`Variant` 原文。

## 已知漂移

- [upstream-compatibility](upstream-compatibility.md) 把热重载关键文件只列到 `handlers/instance.ts`；当前代码真源显示实际判断与热重载在 `handlers/global.ts`。
- [settings-panel](settings-panel.md) 描述包含 system prompt、max steps，但当前 UI 代码没有这些输入控件。

## 运行时待核验

- [ ] 保存 Agent 模型/variant 后当前会话不中断且下一次 agent 行为使用新配置（`待运行时核验`：需要真实 WebGUI + 一次消息执行）。
- [ ] 热重载失败时用户侧反馈路径（`待运行时核验`：代码只记录 `log.warn`，需运行确认 UI 是否可感知）。

## 相关

- 设置面板壳层：[settings-panel](settings-panel.md)
- 模型选择器：[model-selection](model-selection.md)
- 上游适配边界：[upstream-compatibility](upstream-compatibility.md)
