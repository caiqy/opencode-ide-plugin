## Why

定制版使用顶层 `image_model` 配置图片生成默认模型，但官方 opencode 的严格配置 schema 会拒绝该未知字段，导致同一份用户配置无法在两个版本间共用。需要把默认模型表达迁移到官方 schema 已允许的结构中，同时给现有定制版用户保留过渡路径。

## What Changes

- 支持在 `provider.<provider>.models.<model>.options.defaultForImageGeneration` 中用布尔标记声明唯一的全局图片生成默认模型。
- 当工具调用需要默认模型时，优先使用新的模型标记；没有标记时回退到旧顶层 `image_model`。
- 完整指定 `provider` 和 `model` 的工具调用不依赖默认模型配置。
- 对非布尔标记和多个启用标记给出明确配置错误，避免静默选择错误模型。
- 更新配置示例、用户文档和错误提示，推荐官方 opencode 可接受的新配置形态；旧顶层字段在过渡期继续可用。

## Capabilities

### New Capabilities

- `image-model-configuration`: 定义官方 schema 兼容的图片默认模型声明、解析优先级、旧配置回退和歧义校验行为。

### Modified Capabilities

无。

## Impact

- 受影响代码：`generate_image` 工具的默认模型解析及其配置测试。
- 受影响文档：示例配置、IDE 插件说明和图片生成配置指引。
- 配置兼容性：迁移后的同一份 `opencode.jsonc` 可由官方版和定制版加载；官方版仅忽略定制图片生成语义，不获得 `generate_image` 能力。
- 不新增依赖，不要求修改官方顶层配置 schema；旧 `image_model` 字段本次不移除。
