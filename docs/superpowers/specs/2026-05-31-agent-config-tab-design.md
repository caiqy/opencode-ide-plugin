# Agent 配置标签页设计

## 概述

在设置面板（SettingsPanel）中新增一个「Agent 配置」标签页，允许用户为所有系统已知的 agent 设置 model 和 variant，保存到全局配置文件 `~/.config/opencode/opencode.jsonc`。

## 需求

- 在设置面板 TabBar 中新增 "Agent 配置" 标签页
- 表格式布局，每行一个 agent，列：名称、Mode、Model、Variant
- 显示所有系统已知 agent（通过 `sdk.app.agents()` 获取），不仅限于已配置的
- 已配置的 agent 排在前面（正常样式），未配置的排在后面（淡化样式）
- Model 通过下拉选择器选择，按 provider 分组（数据来自 `sdk.config.providers()`）
- Variant 动态获取，根据选中 model 从 provider 数据中读取支持的 variants 列表
- 顶部有「重新加载配置」按钮，调用后端 invalidate 刷新配置缓存（解决跨项目同步问题）
- 保存走现有设置面板的统一保存流程（`sdk.global.config.update`）

## 技术方案

### 数据流

1. 打开设置面板时：
   - `sdk.global.config.get()` → 读取全局配置中的 `agent` 字段（当前已配置的 agent）
   - `sdk.app.agents()` → 获取所有系统已知 agent 列表（含 name、mode、description）
   - `sdk.config.providers()` → 获取可用 provider/model/variant 列表

2. 用户编辑：
   - 选择 model 时，从 providers 数据中找到对应 model 的 variants，更新 variant 下拉选项
   - 修改存储在本地 formData 中，不立即提交

3. 保存：
   - 将修改后的 `agent` 字段合并到全局配置，通过 `sdk.global.config.update` 提交
   - 后端 `updateGlobal` 写入文件 → `invalidate()` → `disposeAllInstances`
   - 当前项目下次发送消息时使用新配置

4. 重新加载按钮：
   - 调用后端 invalidate API，刷新当前 server 实例的配置缓存
   - 用于跨项目场景：项目 A 修改后，在项目 B 中点击重新加载

### 生效机制

- 当前项目：保存后立即生效（后端 disposeAllInstances 触发实例重建）
- 其他项目：需手动点击「重新加载配置」按钮

### UI 结构

```
SettingsPanel/
  TabBar: "常规" | "Agent 配置" | "快捷短语" | "高级"

AgentConfigTab (新文件: src/components/settings/AgentConfigTab.tsx)
├── 顶部：标题 + 重新加载按钮
├── 表格
│   ├── 表头：Agent | Mode | 模型 | Variant
│   ├── 已配置 agent 行（正常样式）
│   └── 未配置 agent 行（淡化样式）
└── 每行的 Model 下拉：按 provider 分组，显示 model name
    每行的 Variant 下拉：动态根据选中 model 显示可用 variants
```

### TabBar 变更

```typescript
// 当前
type TabType = "general" | "advanced" | "quick-phrases"

// 变更后
type TabType = "general" | "agents" | "quick-phrases" | "advanced"
```

TabBar 中新增：`{ id: "agents", label: "Agent 配置", icon: "🤖" }`

### AgentConfigTab 组件

Props：
```typescript
interface AgentConfigTabProps {
  formData: Partial<Config>
  setFormData: (data: Partial<Config>) => void
}
```

内部状态：
- `agents: Agent[]` — 系统已知 agent 列表
- `providers: Provider[]` — 可用 provider/model 列表
- `isLoading: boolean`

### Model 下拉选择器

复用现有 `sdk.config.providers()` 返回的数据结构。下拉列表按 provider 分组，每个 model 显示为 `provider/modelId` 格式的值，UI 上显示 model name。

选中 model 后：
1. 从 providers 数据中找到该 model 的 `variants` 字段
2. 更新对应行的 variant 下拉选项
3. 如果当前 variant 不在新 model 的 variants 列表中，重置为 undefined（默认）

### Variant 下拉选择器

选项来源：选中 model 对应的 `model.variants` 数组。始终包含一个「默认」选项（值为 undefined）。

### 保存逻辑

保存时通过 `sdk.global.config.update` 提交整个 `formData`（包含 `agent` 字段）。后端 `updateGlobal` 使用 JSONC patch 方式合并，只修改变化的字段，不会覆盖配置文件中已有的其他字段（如 prompt、temperature 等）。

具体逻辑：
- 遍历表格中所有 agent
- 如果用户设置了 model 或 variant（非「默认」），则在 `formData.agent[name]` 中设置 `{ model, variant }`
- 如果用户将已配置的 agent 改回「默认」，则将对应字段设为 `undefined`（patch 时移除）
- 只修改 model 和 variant 字段，不触碰 agent 配置中的其他字段（prompt、temperature、tools 等）

「默认」的语义：model 为 undefined 表示使用系统默认模型；variant 为 undefined 表示使用模型的默认推理强度。

### 重新加载按钮

后端没有独立的 invalidate 端点，但 `updateGlobal` 保存后会自动 invalidate 同一 server 的缓存。

重新加载按钮的实现：
1. 重新调用 `sdk.global.config.get()` 拉取最新全局配置
2. 重新调用 `sdk.app.agents()` 和 `sdk.config.providers()` 刷新 agent/model 列表
3. 用最新数据重置 UI 表格状态

适用场景：同一 server 管理的多个实例间，一个实例保存后另一个实例点击重新加载即可看到最新配置。对于完全独立的 server 进程（不同 IDE 窗口），需要重启才能生效——这是已知限制。

## 文件变更清单

| 文件 | 变更 |
|------|------|
| `src/components/SettingsPanel/TabBar.tsx` | 新增 "agents" tab |
| `src/components/SettingsPanel/index.tsx` | 导入并渲染 AgentConfigTab |
| `src/components/settings/AgentConfigTab.tsx` | 新建，Agent 配置表格组件 |

## 不在范围内

- Agent 的 prompt、temperature、top_p 等高级字段编辑（本次只做 model + variant）
- 项目级配置（本次只写全局配置）
- 自动跨实例同步（通过手动重新加载按钮解决）
