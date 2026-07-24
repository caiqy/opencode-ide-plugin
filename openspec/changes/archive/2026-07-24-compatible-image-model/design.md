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
