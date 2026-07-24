---
comet_change: compatible-image-model
role: technical-design
canonical_spec: openspec
archived-with: 2026-07-24-compatible-image-model
status: final
---

# 官方配置兼容的图片默认模型设计

## 背景

定制版目前用顶层 `image_model` 为 `generate_image` 配置默认模型。官方 opencode 的顶层配置 schema 禁止未知字段，因此包含该字段的同一份 `opencode.jsonc` 无法同时供官方版和定制版使用。

官方 schema 已允许 `provider.<provider>.models.<model>.options` 保存开放选项。本次把默认图片模型声明迁移到这个已有扩展边界，不修改官方 schema，也不向官方版增加 `generate_image` 能力。

## 目标

- 迁移后的同一份配置可由官方版和定制版正常加载。
- 定制版可从唯一的模型标记解析全局图片默认模型。
- 完整工具参数继续优先，现有 provider/model 覆盖矩阵保持不变。
- 旧顶层 `image_model` 继续作为过渡回退。
- 无效和歧义配置明确失败，不按配置顺序猜测模型。

## 非目标

- 不修改配置加载、深合并或 provider catalog 机制。
- 不支持每个 provider 各自拥有图片默认模型。
- 不新增环境变量、独立配置文件、隐藏 Agent 或插件专用配置。
- 不移除旧 `image_model`，也不设移除版本。
- 不保证官方版理解该标记的图片生成语义；官方版只需接受配置并正常启动。

## 配置契约

新配置在目标模型上设置布尔标记：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
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

标记规则：

- 只扫描 `cfg.provider` 中用户显式声明的 model 节点，不扫描动态 provider catalog。
- provider 和 model 的对象键组成 `provider/model`；model 配置中的 API `id` 不参与默认寻址。
- 标记缺失或为 `false` 时不启用该节点。
- 标记存在时必须是布尔值；其他类型是配置错误。
- 合并后的配置全局只能有一个 `true`。
- 唯一新标记优先于旧顶层 `image_model`；没有新标记时才回退旧字段。

`options` 中的其他字段不受本次校验影响。

## 配置层级覆盖

继续使用现有全局和项目配置深合并语义，不增加特殊合并逻辑。项目配置要替换全局默认值，必须关闭旧路径并开启新路径：

```jsonc
{
  "provider": {
    "openai": {
      "models": {
        "gpt-image-2": {
          "options": {
            "defaultForImageGeneration": false
          }
        },
        "gpt-image-3": {
          "options": {
            "defaultForImageGeneration": true
          }
        }
      }
    }
  }
}
```

如果项目配置只开启新模型而未关闭全局模型，合并结果包含多个 `true`，调用需要默认值时报告歧义。

## 组件与数据流

实现保持在现有两个模块内：

- `packages/opencode/src/tool/generate-image/config.ts`：新增纯函数 `resolveConfiguredImageModel`，扫描标记并执行新旧配置优先级。
- `packages/opencode/src/tool/generate-image.ts`：仅决定是否需要默认值，再复用现有 `resolveModelParts` 和后续 provider/model 解析链路。

```text
GenerateImageTool.execute
  |
  +-- provider 和 model 均已提供
  |     -> 直接使用显式参数，不解析或校验默认标记
  |
  +-- 任一参数缺失
        -> resolveConfiguredImageModel(cfg.provider, cfg.image_model)
        -> resolveModelParts(configuredDefault, provider, model)
        -> 现有 Provider 服务和图片 adapter 链路
```

`resolveConfiguredImageModel` 只接收显式 provider 配置和旧字段值，返回 `provider/model | undefined`。它不依赖 Config 服务、Provider 服务或工具上下文，避免扩大现有解析函数职责。

## 解析算法

1. 遍历显式 provider 及其显式 model 节点。
2. 读取每个 `options.defaultForImageGeneration`。
3. 对非布尔值报告包含完整配置路径的类型错误；忽略缺失值和 `false`；收集 `true` 对应的对象键。
4. 多个启用项按 `provider/model` 排序后报告歧义，保证错误内容稳定。
5. 一个启用项返回其 `provider/model`。
6. 没有启用项时返回旧 `image_model`；两者都没有时返回 `undefined`，交给现有参数解析报告缺失配置。

扫描和校验只在工具调用需要默认值时发生。完整 `provider + model` 即使面对缺失、非布尔或多个默认标记也可继续执行。

## 错误行为

- 非布尔标记：指出 `provider.<provider>.models.<model>.options.defaultForImageGeneration` 必须为布尔值。
- 多个启用标记：列出排序后的冲突 `provider/model`。
- 缺少默认值：展示新 marker 配置，并说明也可同时传入完整 `provider` 和 `model`。
- 仅传 provider 或仅传 model：保留现有覆盖矩阵，但错误指引改用新 marker，不再把旧字段作为首选示例。

旧字段回退不产生运行时弃用警告。迁移通过示例、用户文档和错误提示完成，避免每次调用重复输出警告。

## 文档与迁移

实现发布后：

1. 定制版同时支持新标记和旧字段。
2. `samples/opencode.jsonc`、VS Code 和 JetBrains README、共享发布说明改用新标记。
3. 用户先添加新标记验证定制版，再删除顶层 `image_model`。
4. 删除旧字段后，同一配置可由官方版正常加载。

历史设计和实施计划保留原始记录；生成 SDK 中的旧字段继续存在，因为本次不删除公开兼容字段，也不触发 Protocol/HttpApi 生成。

## 测试策略

`packages/opencode/test/tool/generate-image-config.test.ts` 覆盖：

- 严格配置加载后保留开放 options 中的 marker。
- 唯一 `true`、`false`、非布尔和多个 `true`。
- 多默认错误按 `provider/model` 稳定排序。
- 使用对象键而不是 model API `id`。
- 新标记优先、旧字段回退和无默认值。
- 项目层以 `false` 关闭全局标记并启用另一模型。
- 现有 provider/model 参数覆盖矩阵及更新后的错误指引。

`packages/opencode/test/tool/generate-image.test.ts` 只增加两项接线回归：

- 没有工具覆盖时使用 marker 选择的模型。
- 完整显式参数绕过无效或歧义的默认标记。

验证命令从 `packages/opencode` 运行聚焦测试和 `bun typecheck`。另用官方发布 schema 或官方 CLI 严格加载迁移后的代表性配置，并确认用户文档示例不含定制顶层字段。

## 风险与约束

- 开放 model options 可能被下游 SDK 看见。标记只放在目标图片模型上；定制图片 adapter 只读取已知图片选项，官方版的验收边界仅为配置加载。
- 多层配置可能保留两个启用项。保持现有深合并，要求覆盖层显式写 `false`，不引入特殊删除语义。
- 旧字段可能长期存在。新文档和错误提示只推荐 marker，但本次不增加删除承诺。
- 多默认不能安全推断用户意图，因此明确失败；完整显式工具参数保留恢复通道。

## 验收标准

- 唯一 marker 可稳定解析到对象键对应的 provider/model。
- 新标记优先于旧字段；没有新标记时旧配置继续工作。
- 非布尔和多默认在需要默认值时给出确定性错误。
- 完整工具参数不受默认配置错误影响。
- 项目层以 `false` 关闭全局标记后可启用另一个默认模型。
- 迁移后的示例通过官方严格配置加载和定制版配置测试。
