## 1. 锁定配置行为

- [x] 1.1 扩展 `generate-image-config` 测试，覆盖唯一标记、对象键寻址、新标记优先、旧字段回退和完整工具参数绕过默认值
- [x] 1.2 增加非布尔标记、多个启用标记、`false` 标记、项目层显式覆盖及缺失默认值场景

## 2. 实现兼容解析

- [x] 2.1 从显式 `cfg.provider` 模型节点解析唯一的 `defaultForImageGeneration` 标记，并生成 provider/model 默认值
- [x] 2.2 将兼容默认值接入 `GenerateImageTool`，保留现有参数覆盖和旧 `image_model` 回退语义
- [x] 2.3 更新缺失、无效和歧义错误，使其指向新配置形态及冲突模型

## 3. 迁移用户配置说明

- [x] 3.1 将样例配置和 VS Code、JetBrains、发布说明中的顶层 `image_model` 示例迁移为 provider model 标记
- [x] 3.2 记录旧字段的过渡兼容、新标记优先级和官方版仅保证正常加载的边界

## 4. 验证

- [x] 4.1 在 `packages/opencode` 运行聚焦测试和 `bun typecheck`
- [ ] 4.2 使用官方发布的 `https://opencode.ai/config.json` 或官方 CLI 验证迁移后示例可被严格加载，并确认配置不含定制顶层字段
