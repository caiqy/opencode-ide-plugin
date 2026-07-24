# image-model-configuration Specification

## Purpose
TBD - created by archiving change compatible-image-model. Update Purpose after archive.
## Requirements
### Requirement: 使用官方 schema 兼容的默认模型声明

系统 SHALL 允许用户在 `provider.<provider>.models.<model>.options.defaultForImageGeneration` 中用布尔标记声明图片生成默认模型，而无需在共享配置中加入定制顶层字段。

#### Scenario: 单个模型被标记为默认

- **WHEN** 配置中的一个显式 provider/model 节点将 `defaultForImageGeneration` 设为 `true`
- **THEN** 定制版使用该节点的 provider 键和 model 键组成图片默认模型

#### Scenario: 官方版加载迁移后的配置

- **WHEN** 配置只使用官方 schema 字段及 model `options` 中的默认标记，且不包含顶层 `image_model`
- **THEN** 官方原版 opencode 的严格配置解析接受该配置并可正常启动

#### Scenario: 模型配置包含 API ID 别名

- **WHEN** 被标记模型同时配置了与对象键不同的 `id`
- **THEN** 系统仍使用对象键查找配置模型，并保留 `id` 作为 provider 调用使用的 API 模型标识

### Requirement: 默认模型解析具有确定的优先级

系统 MUST 在需要默认模型时优先使用唯一的新模型标记，并仅在没有启用标记时回退到旧顶层 `image_model`。

#### Scenario: 新旧配置同时存在

- **WHEN** 唯一的新模型标记与旧 `image_model` 同时存在且指向不同模型
- **THEN** 系统使用新模型标记解析的模型

#### Scenario: 旧配置仍可工作

- **WHEN** 没有启用的新模型标记且配置包含有效的旧 `image_model`
- **THEN** 定制版继续使用旧字段提供图片默认模型

#### Scenario: 项目配置显式覆盖全局默认

- **WHEN** 项目配置将全局默认模型的标记设为 `false`，并将另一个显式模型的标记设为 `true`
- **THEN** 深合并后的配置仅使用项目启用的模型作为图片默认模型

#### Scenario: 完整工具参数绕过默认配置

- **WHEN** `generate_image` 调用同时提供有效的 `provider` 和 `model`
- **THEN** 系统使用显式参数，且不因缺失、无效或歧义的默认标记而失败

### Requirement: 默认标记必须无歧义且类型有效

系统 MUST 在调用需要默认模型时校验显式模型节点上的 `defaultForImageGeneration`，不得按配置顺序猜测默认模型。

#### Scenario: 多个模型被标记为默认

- **WHEN** 两个或更多显式模型节点将 `defaultForImageGeneration` 设为 `true`，且工具调用需要默认模型
- **THEN** 系统报告包含冲突 provider/model 的歧义错误

#### Scenario: 默认标记类型无效

- **WHEN** 任一显式模型节点包含非布尔的 `defaultForImageGeneration`，且工具调用需要默认模型
- **THEN** 系统报告指向该 provider/model 的配置类型错误

#### Scenario: false 标记不启用默认值

- **WHEN** 模型节点将 `defaultForImageGeneration` 设为 `false`
- **THEN** 系统忽略该节点并继续查找唯一启用标记或回退旧配置

### Requirement: 缺失默认值时提供可迁移指引

当工具调用需要默认模型但新标记和旧字段均不可用时，系统 SHALL 失败并展示官方 schema 兼容的新配置示例。

#### Scenario: 没有默认模型且参数不完整

- **WHEN** 配置没有启用的新标记和有效旧字段，且工具调用未同时提供 `provider` 与 `model`
- **THEN** 错误信息说明如何配置 `defaultForImageGeneration` 或同时传入完整工具参数
