# Comet Design Handoff

- Change: compatible-image-model
- Phase: design
- Mode: compact
- Context hash: 91a36c0e81466b9e87d2914f97fe9b3448989bf26dd9639e9c57f9b16c932b79

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/compatible-image-model/proposal.md

- Source: openspec/changes/compatible-image-model/proposal.md
- Lines: 1-28
- SHA256: 2b59bb1d0159b449caac70b5e433d0b89aa4d5f561d9c40721a067fd60c45dc0

```md
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

```

## openspec/changes/compatible-image-model/design.md

- Source: openspec/changes/compatible-image-model/design.md
- Lines: 1-79
- SHA256: eb982c7968f43e7284bcd4aa21a6695ebbdb2c71963d9c7361f5571ff7f749a0

```md
## Context

当前 `generate_image` 在执行时从配置服务读取顶层 `image_model`，再复用现有 provider/model 解析逻辑。该字段只存在于定制版 schema；官方 opencode 的顶层配置禁止未知属性，因此共享配置一旦包含该字段就无法被官方版加载。

官方 schema 已允许在 `provider.<provider>.models.<model>.options` 中保存开放的模型选项。provider 和 model 的对象键也天然组成 `provider/model` 标识，可以承载图片默认模型声明而不增加新的顶层字段。

## Goals / Non-Goals

**Goals:**

- 让迁移后的单份配置同时通过官方版和定制版的严格解析。
- 从唯一的显式模型标记稳定解析图片默认 provider/model。
- 保留旧 `image_model` 的过渡兼容，并定义无歧义的优先级。
- 保持现有工具参数覆盖行为和 provider/model 解析语义。

**Non-Goals:**

- 不向官方版添加 `generate_image` 能力。
- 不支持每个 provider 各自拥有默认图片模型。
- 不增加环境变量、独立配置文件、隐藏 Agent 或插件配置通道。
- 本次不删除旧 `image_model` 字段，也不承诺具体移除版本。

## Decisions

### 使用模型 options 中的布尔标记

新配置使用：

```jsonc
{
  "provider": {
    "openai": {
      "models": {
        "gpt-image-2": {
          "options": {
            "defaultForImageGeneration": true
          }
        }
      }
    }
  }
}
```

定制版只扫描用户在 `cfg.provider` 中显式声明的模型节点，不扫描动态 provider catalog。启用标记的 provider 键和 model 键组成默认模型标识；模型配置中的可选 `id` 仍是远端 API ID，不参与默认模型寻址。

选择该方案是因为 `models.*.options` 是官方 schema 明确开放的扩展边界，且配置位置与目标模型直接关联。隐藏 Agent 会把工具配置伪装成可执行 Agent；provider 级 option 则会被传给该 provider 的每个模型 SDK，影响范围更大。

### 仅在需要默认值时解析标记

当工具调用同时提供有效的 `provider` 和 `model` 时，直接沿用显式值，不扫描或校验默认标记。其他调用先解析新标记；存在一个启用标记时，将得到的 `provider/model` 交给现有解析逻辑；没有启用标记时回退旧 `image_model`。

新标记与旧字段同时存在时，新标记优先。这样迁移后的配置可先添加新声明，再删除旧字段，不会因两个值不同而静默回退到旧值。

配置层级继续使用现有深合并规则。项目配置要替换全局默认模型时，必须将全局模型同一路径的标记显式设为 `false`，再启用新的模型标记；否则合并后的多个 `true` 按歧义处理。

### 对开放 options 做窄范围运行时校验

`defaultForImageGeneration` 存在时 MUST 是布尔值。`false` 表示未启用；恰好一个 `true` 才形成默认值；多个 `true` 在调用需要默认值时报告歧义，并按 `provider/model` 排序列出冲突模型。校验只读取这一项，不限制同一 `options` 对象中的其他 provider/model 选项。

缺少新旧默认值时，错误提示 SHALL 展示新配置形态；旧字段仅作为迁移说明出现。

## Risks / Trade-offs

- [开放 model options 可能被下游 SDK 接收] → 标记只配置在图片模型上；官方版仅加载配置时不会初始化该模型 SDK，定制图片适配器也只读取已知图片选项。
- [多个标记造成选择歧义] → 不按对象顺序猜测，只有在需要默认值时明确失败；完整工具参数仍可绕过默认选择。
- [旧字段长期存在导致迁移拖延] → 示例、文档和错误提示只推荐新结构，旧字段保留但不再作为首选配置。
- [模型配置使用 `id` 别名] → 默认寻址始终使用配置对象键，与 Provider 服务现有模型查找规则一致。

## Migration Plan

1. 定制版先发布对新标记的读取与校验，同时继续支持旧 `image_model`。
2. 文档和示例改用 provider/model 标记，用户可在同一配置中先添加标记验证定制版行为。
3. 用户删除顶层 `image_model` 后，同一配置即可由官方版正常加载。
4. 若需回滚实现，旧字段仍可恢复原行为；新标记会被旧定制版和官方版作为开放 model option 保留或忽略。

## Open Questions

无。

```

## openspec/changes/compatible-image-model/tasks.md

- Source: openspec/changes/compatible-image-model/tasks.md
- Lines: 1-20
- SHA256: 77ccff7a1127e81f080a62bc5e02492fd4ba6c070a4cb7de19c639a6f8e8c7b9

```md
## 1. 锁定配置行为

- [ ] 1.1 扩展 `generate-image-config` 测试，覆盖唯一标记、对象键寻址、新标记优先、旧字段回退和完整工具参数绕过默认值
- [ ] 1.2 增加非布尔标记、多个启用标记、`false` 标记、项目层显式覆盖及缺失默认值场景

## 2. 实现兼容解析

- [ ] 2.1 从显式 `cfg.provider` 模型节点解析唯一的 `defaultForImageGeneration` 标记，并生成 provider/model 默认值
- [ ] 2.2 将兼容默认值接入 `GenerateImageTool`，保留现有参数覆盖和旧 `image_model` 回退语义
- [ ] 2.3 更新缺失、无效和歧义错误，使其指向新配置形态及冲突模型

## 3. 迁移用户配置说明

- [ ] 3.1 将样例配置和 VS Code、JetBrains、发布说明中的顶层 `image_model` 示例迁移为 provider model 标记
- [ ] 3.2 记录旧字段的过渡兼容、新标记优先级和官方版仅保证正常加载的边界

## 4. 验证

- [ ] 4.1 在 `packages/opencode` 运行聚焦测试和 `bun typecheck`
- [ ] 4.2 使用官方发布的 `https://opencode.ai/config.json` 或官方 CLI 验证迁移后示例可被严格加载，并确认配置不含定制顶层字段

```

## openspec/changes/compatible-image-model/specs/image-model-configuration/spec.md

- Source: openspec/changes/compatible-image-model/specs/image-model-configuration/spec.md
- Lines: 1-72
- SHA256: 7412d5753d453a1b30265921aa3099aae127b19d83c75e102cfff4c0353b7d68

```md
## ADDED Requirements

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

```
