# Provider 模型白名单候选下拉设计

## 背景

Provider 设置页的“模型白名单”当前使用原生 `input + datalist`。Chrome 的 datalist 弹层样式与宽度不可控，导致下拉框明显窄于输入框、视觉不一致。同时候选模型来自 `sdk.config.providers()` 的当前 provider models，这个结果会受现有 whitelist 过滤影响，因此不能可靠展示 whitelist 之外的模型。

## 目标

- 用自绘 combobox/popover 替换原生 datalist，使下拉宽度与输入框一致，并适配当前深色主题。
- 候选模型优先来自 opencode 的本地/内置 models.dev provider catalog，避免被当前 whitelist 过滤。
- 继续支持手动输入任意模型 ID，并通过“添加模型”加入 whitelist。
- 候选列表过滤已在 whitelist 中的模型，避免重复添加。
- 搜索输入支持按模型 ID/name 模糊过滤，空结果时仍提示可手动添加当前输入。

## 非目标

- 本轮不接入 provider 实时 `/models` API 探测。
- 本轮不修改配置保存语义、覆盖/合并语义或 Provider 列表结构。
- 本轮不要求模型候选包含所有第三方网关动态模型；手动输入仍是兜底。

## 数据来源

新增后端只读接口，返回指定 provider 的 catalog 模型列表：

- 输入：provider ID。
- 来源：现有 models.dev 数据缓存/快照（`packages/opencode/src/provider/models.ts`）。
- 输出：模型 ID、名称、状态等展示所需字段。
- 失败策略：读取失败时返回空列表，前端保留手动输入能力。

## 前端交互

- “模型白名单”新增自绘候选面板，面板宽度跟随输入框容器。
- 输入聚焦或输入内容变化时打开候选面板。
- 点击候选模型会把模型 ID 填入输入框；点击“添加模型”或按 Enter 添加。
- 候选项显示模型 ID，若存在 name/status 可作为次要信息展示。
- 候选面板最大高度限制并滚动，避免遮挡保存按钮。
- 已在 whitelist 中的模型不出现在候选项中。

## 测试

- 后端测试：catalog 接口返回指定 provider 的 whitelist 外模型。
- 前端测试：
  - 下拉不再使用 datalist。
  - 输入聚焦后展示自绘候选列表。
  - 候选列表包含 whitelist 外模型，并排除已在 whitelist 中的模型。
  - 点击候选并添加后更新 whitelist。
  - 候选为空时仍可手动添加输入值。

## 自审

- 无 TBD/TODO。
- 范围聚焦于白名单候选输入，不改变保存语义。
- 数据来源明确为本地/内置 models.dev catalog，实时 provider `/models` 留作后续增强。
