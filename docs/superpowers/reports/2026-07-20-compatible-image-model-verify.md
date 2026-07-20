# compatible-image-model 验证报告

## 摘要

| 维度 | 结果 |
|---|---|
| 完整性 | PASS：9/9 tasks，4/4 requirements |
| 正确性 | PASS：11/11 scenarios 已由实现、测试或官方 schema 验证覆盖 |
| 一致性 | PASS：实现符合 OpenSpec design 与 Design Doc，无规格漂移 |

## Fresh 验证证据

- `packages/opencode`：`bun test test/tool/generate-image-config.test.ts test/tool/generate-image.test.ts`，54 pass、0 fail、159 assertions。
- `packages/opencode`：`bun typecheck` 运行 `tsgo --noEmit`，退出码 0。
- 仓库根：`bun run release-content:check` 输出 `release content is in sync`。
- `openspec validate "compatible-image-model" --strict` 通过。
- `git diff --check a5defaf2d4adc70abeca45dd785527e4b678f08d...HEAD` 通过。
- 官方 schema：`ajv-cli@5` 以 Draft 2020、`--strict=true` 验证代表性标准 JSON，输出 `compatible-image-model.json valid`。
- 官方 config schema SHA-256：`8ffffc8622f2bbee5e9b1e57bf2509910f2a6dfc237458766bfaa5e295787a2e`。
- models.dev schema SHA-256：`bd8bf403e56d42dd2c1495cff543c4dacfcc28f099054f1db9abae3a7a0dfefe`。
- Ajv 仅将官方 schema 的 `allowComments`、`allowTrailingCommas` 注册为无实例约束的布尔注解；strict 模式及其他实例约束保持启用。
- fixture 与 `samples/opencode.jsonc` 均无顶层 `image_model`；验证临时目录已删除。
- Build 最终审查经一轮文案修复后复查通过：无 Critical、Important 或 Minor，结论 `Ready to merge: Yes`。

## 规格映射

- 官方 schema 兼容声明：配置加载测试覆盖开放 model options；独立官方 schema 校验覆盖无定制顶层字段的 marker fixture。
- 确定性优先级：纯函数测试覆盖对象键寻址、API `id` 别名、新 marker 优先、legacy 回退、项目层显式 `false` 和未关闭全局标记的歧义。
- 类型与歧义：测试覆盖非布尔完整路径、`false` 忽略和多个 `true` 的排序冲突项。
- 工具接线：真实 `GenerateImageTool` 测试覆盖 marker 默认选择，以及完整 provider/model 面对歧义默认配置时绕过 resolver。
- 迁移指引：错误测试覆盖新 marker 提示；sample、shared 真源和 VS Code/JetBrains 生成内容使用新配置并准确描述 legacy 回退与官方能力边界。

## 设计一致性

- `resolveConfiguredImageModel` 保持纯函数，只读取显式 provider/model 节点，不依赖 Config/Provider 服务或动态 catalog。
- `GenerateImageTool` 仅在显式 provider/model 不完整时解析默认配置，并继续复用 `resolveModelParts` 与原 provider/adapter 链路。
- 未修改配置 schema、深合并、Protocol/HttpApi、SDK generated 源码或 lockfile；未新增依赖和文件级生产抽象。
- Design Doc 位于 `docs/superpowers/specs/2026-07-19-compatible-image-model-design.md`，frontmatter 正确关联当前 change。

## 问题

- CRITICAL：无。
- WARNING：无。
- SUGGESTION：官方 schema 校验目前是网络依赖的手动验收；仅在该兼容边界需要频繁回归时再增加持久自动化，当前不新增依赖或验证脚手架。

## 分支处理

用户选择保留 `compatible-image-model` 分支，稍后自行处理。当前是普通仓库，不涉及 Worktree 清理；未执行合并、推送或分支删除。

## 结论

完整验证通过；完成分支处理后可进入归档确认阶段。
