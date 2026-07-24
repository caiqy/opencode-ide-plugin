# Brainstorm Summary

- Change: compatible-image-model
- Date: 2026-07-19

## 已确认事实

- 迁移后的同一份 `opencode.jsonc` 只需保证官方版正常加载；官方版无需获得 `generate_image`。
- 新配置使用 `provider.<provider>.models.<model>.options.defaultForImageGeneration: true`，且全局只允许一个默认图片模型。
- 完整工具参数 `provider + model` 绕过默认配置；需要默认值时新标记优先于旧 `image_model`。
- 旧顶层 `image_model` 保留过渡期支持，本次不设移除版本。
- 默认寻址使用 provider/model 对象键，不使用模型配置中的 API `id` 别名。
- 配置继续按现有规则深合并；项目配置覆盖全局默认时，必须将旧模型标记显式设为 `false`，再启用新模型。
- 旧 `image_model` 回退不新增运行时警告；迁移只通过文档、示例和缺失配置错误提示传达。

## 确认的技术方案

- 在现有 `generate-image/config.ts` 中增加一个窄范围纯配置解析函数，再把结果交给 `resolveModelParts`。
- 不新增文件，不把扫描逻辑内联进 `GenerateImageTool`，也不扩大 `resolveModelParts` 对完整配置结构的依赖。
- `resolveConfiguredImageModel` 只接收 `cfg.provider` 与旧 `cfg.image_model`，返回 `provider/model | undefined`；它只扫描用户显式模型节点。
- `GenerateImageTool` 在 `provider` 和 `model` 都存在时完全绕过默认配置；其他调用先取得兼容默认值，再复用现有覆盖矩阵和 provider/model 解析流程。
- 标记缺失或为 `false` 时忽略，为 `true` 时收集，其他类型报告包含完整配置路径的错误。
- 多个启用标记按 `provider/model` 排序后报告歧义；一个标记优先于旧字段；没有标记才回退旧字段。
- 缺失配置错误只推荐新 marker 形态；默认配置的所有校验只在工具调用确实需要默认值时执行。

## 关键取舍与风险

- 保持现有深合并和配置加载器不变，以项目配置显式 `false` 关闭全局标记换取更小改动。
- marker 位于官方 schema 开放的 model `options` 中；官方版只需正常加载，不承诺使用该图片模型执行语言调用。
- 旧顶层字段继续被定制版接受但不再推荐；不增加运行时弃用日志，避免重复噪声和额外状态。
- 多默认不猜测胜者，稳定排序后报错；完整工具参数绕过默认校验，保证显式调用可恢复。

## 测试策略

- `generate-image-config.test.ts` 覆盖配置加载、唯一标记、`false`、非布尔、多标记稳定排序、对象键寻址、新键优先、旧键回退和项目层显式覆盖，并更新现有解析矩阵的配置指引。
- `generate-image.test.ts` 增加最小接线测试：marker 默认生效；完整工具参数在默认标记无效或歧义时仍执行。
- 在 `packages/opencode` 运行两个聚焦测试文件和 `bun typecheck`。
- 使用官方发布 schema 或官方 CLI 对迁移后样例做严格加载验证，并检查文档样例不含定制顶层字段。

## Spec Patch

补充配置层级覆盖场景：项目配置通过将全局默认模型 marker 设为 `false`、再启用另一个模型完成覆盖；未关闭旧标记时保持多默认歧义错误。
