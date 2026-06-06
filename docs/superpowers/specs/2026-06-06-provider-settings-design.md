# Provider 设置页设计

## 背景

当前 WebGUI 右上角“设置”弹窗已有 `Agent 配置` 与 `快捷短语` 等 tab。本需求在该弹窗中新增 `Provider 设置`，用于下载全局配置、查看 provider、编辑 provider 的接口地址、API 密钥和模型白名单。

本功能只作用于当前 WebGUI 设置弹窗，不新增 VSCode 插件原生配置页或命令。

## 目标

- `Provider 设置` 成为设置弹窗第一个 tab，并作为默认打开页。
- 支持从 URL 下载配置并保存到全局 `opencode.jsonc`。
- 支持 `覆盖` 与 `合并` 两种更新方式。
- 展示全局配置中的 provider 列表。
- 支持编辑单个 provider 的接口地址、API 密钥和模型白名单。
- Provider 配置保存后提示用户重启插件后生效，并提供 `立即重启` 与 `暂不重启`。

## 非目标

- 不实现 VSCode 插件原生设置页。
- 不新增全局路由页面。
- 不支持新增或删除 provider 本身；本次只编辑已有 provider 的指定字段。
- 不编辑 provider 的 `models` 详细模型元数据；模型白名单只维护 `whitelist: string[]`。

## 用户界面

### 设置页 tab

tab 顺序为：

1. `Provider 设置`
2. `Agent 配置`
3. `快捷短语`

打开设置弹窗时默认选中 `Provider 设置`。

### Provider 设置 tab

页面分为两块。

#### 配置更新区域

字段与控件：

- 配置 URL 输入框
  - 默认值：`https://raw.githubusercontent.com/caiqy/opencode-ide-plugin/refs/heads/ide-plugin/samles/opencode.jsonc`
- 更新方式
  - `覆盖`
  - `合并`
- `更新配置` 按钮

点击 `更新配置` 后下载远程 JSONC 配置，按照更新方式计算新配置，并保存到全局配置。

#### Provider 列表

数据源为全局配置对象中的 `provider` 字段。

表格列：

- 提供商：provider key / id
- 接口地址：`provider[providerId].options.baseURL`
- API 密钥：`provider[providerId].options.apiKey`，列表页中段脱敏展示
- 操作：`编辑`

API 密钥脱敏规则：

- 空值显示 `未配置`。
- 短 key 显示固定掩码，避免暴露完整值。
- 长 key 显示首尾少量字符，中间使用省略符，例如 `sk-1…9a2b`。

### Provider 编辑视图

点击列表中的 `编辑` 后，在同一个 tab 内切换到编辑视图。

字段：

- 提供商
  - 显示 provider key / id
  - 只读，不可修改
- 接口地址
  - 可修改
  - 保存到 `provider[providerId].options.baseURL`
- API 密钥
  - 明文显示
  - 可修改
  - 保存到 `provider[providerId].options.apiKey`
- 模型白名单
  - 保存到 `provider[providerId].whitelist`
  - 支持从下拉选择已有模型
  - 支持手动输入模型 ID 添加
  - 支持修改列表中的模型 ID
  - 支持删除

编辑视图提供：

- `返回列表`
- `取消`
- `保存 Provider`

## 配置更新语义

点击 `更新配置` 时执行以下流程：

1. 下载 URL 指向的 JSONC 配置。
2. 解析远程配置对象。
3. 根据更新方式生成新配置。
4. 优先调用现有 `sdk.global.config.update` 保存全局配置；实现阶段必须验证该 API 在目标环境中写入全局 `opencode.jsonc`。如果现有 API 会写入其他全局配置候选文件，则补一个最小后端能力，专门写入全局 `opencode.jsonc`。
5. 保存成功后刷新设置页 `formData` 与 `originalFormData`。
6. 弹出重启提示。

### 覆盖

`覆盖` 以远程配置为主体，但对同名 provider 保留当前本地配置中的：

- `options.baseURL`
- `options.apiKey`

除上述保留字段外，同名 provider 的其他字段以远程配置为准。

### 合并

`合并` 以当前本地全局配置为主体，将远程配置合并进来。

`provider` 字段按 provider id 合并：

- 远程新增 provider 直接加入。
- 同名 provider 合并字段。
- 本地已有 `options.baseURL` 与 `options.apiKey` 优先保留，避免覆盖用户密钥和接口地址。

## 保存 Provider 语义

编辑单个 provider 后点击 `保存 Provider`：

- 更新 `formData.provider[providerId]`。
- `baseURL` 为空时从 `options` 中移除 `baseURL`。
- `apiKey` 为空时从 `options` 中移除 `apiKey`。
- 模型白名单保存为去重后的非空字符串数组。
- 调用全局配置保存逻辑；该保存逻辑必须落到全局 `opencode.jsonc`。
- 保存成功后弹出重启提示。

## 重启提示

Provider 配置更新或保存成功后弹窗提示：配置变更需要重启插件后才能生效。

按钮：

- `立即重启`
  - 调用 `ideBridge.request("restartHost")`。
  - VSCode 侧已有 `restartHost` 支持，实际执行 `workbench.action.reloadWindow`。
- `暂不重启`
  - 关闭弹窗，不强制退出设置页。

如果 IDE bridge 不可用，或 `restartHost` 调用失败，展示提示：请手动重启插件或执行 Reload Window。

## 组件设计

### SettingsPanel

- 将 `activeTab` 默认值改为 `provider`。
- 将 `TabType` 扩展为包含 `provider`。
- 渲染 `ProviderSettingsTab`。
- 继续保留现有未保存更改确认逻辑。

### TabBar

- 添加第一个 tab：`Provider 设置`。
- 后续 tab 维持现有功能。

### ProviderSettingsTab

职责：

- 管理配置 URL、更新方式、下载中/保存中/错误状态。
- 展示 provider 列表。
- 进入和退出编辑视图。
- 执行远程配置下载与覆盖/合并计算。
- 保存全局配置到全局 `opencode.jsonc`。优先复用 `sdk.global.config.update`；如果验证发现它不能保证写入全局 `opencode.jsonc`，则使用实现阶段新增的最小后端能力。

### ProviderEditView

职责：

- 编辑单个 provider 的 `options.baseURL`、`options.apiKey` 与 `whitelist`。
- 提供模型白名单添加、修改、删除、去重。
- 将编辑结果写回 `formData.provider[providerId]`。

### RestartRequiredModal

职责：

- 展示重启提示。
- 执行 `立即重启`。
- 处理重启不可用或失败提示。

## 错误处理

- 下载配置失败：显示 `配置下载失败：<原因>`，不修改当前表单数据。
- 远程配置解析失败：显示 `配置解析失败`，不保存。
- 远程配置没有 `provider`：允许更新其他配置字段，Provider 列表可能为空。
- 保存失败：显示 `保存 Provider 设置失败`，保留用户编辑内容方便重试。
- 重启失败或不可用：显示 `请手动重启插件或执行 Reload Window`。

## 测试计划

### Provider 设置 tab

- 默认排在第一个并默认打开。
- 正确渲染 provider 列表。
- API Key 脱敏逻辑覆盖短 key、长 key、空 key。

### 编辑页

- provider id 不可编辑。
- `baseURL`、`apiKey`、`whitelist` 能正确写回 `formData.provider`。
- whitelist 支持添加、修改、删除、去重。

### 更新配置

- 覆盖模式保留同名 provider 的 `options.baseURL` 与 `options.apiKey`。
- 合并模式本地 `options.baseURL` 与 `options.apiKey` 优先。
- 下载失败不污染当前配置。
- 解析失败不污染当前配置。
- 保存失败保留当前编辑内容。

### 重启提示

- 保存后显示重启弹窗。
- `立即重启` 调用 `ideBridge.request("restartHost")`。
- `暂不重启` 只关闭弹窗。

## 已确认决策

- Provider 设置只加在当前 WebGUI 右上角设置弹窗中。
- Provider 设置作为第一个 tab，并作为默认打开页。
- 配置更新支持 `覆盖` 与 `合并`。
- 覆盖模式也需要保留同名 provider 的 `options.baseURL` 与 `options.apiKey`。
- 编辑页在同一个设置 tab 内呈现，不新增路由。
