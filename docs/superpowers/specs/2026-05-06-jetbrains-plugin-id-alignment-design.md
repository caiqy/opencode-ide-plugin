# JetBrains 插件 ID 对齐到 VSCode Unique Identifier 设计

**日期**: 2026-05-06
**状态**: 设计已确认

## 概述

当前 VSCode 插件对外发布身份由 `publisher/name` 组成，仓库内对应的是 `caiqy.opencode-ui`。JetBrains 插件当前技术 ID 仍是 `qtkj.opencode-ui`。虽然两端展示名已经统一为 `OpenCode UI (unofficial)`，但 Marketplace 技术身份仍不一致，导致发布标识、更新链路和后续维护认知不完全对齐。

本次改动的目标不是扩大双平台发布系统，而是把 JetBrains 插件技术 ID 从 `qtkj.opencode-ui` 调整为 `caiqy.opencode-ui`，与 VSCode Unique Identifier 对齐，同时同步收敛 JetBrains 宿主内所有依赖该 ID 的运行时路径，并在文档中明确这属于插件技术身份切换，而不是普通文案改名。

## 目标

1. 将 JetBrains 插件技术 ID 从 `qtkj.opencode-ui` 改为 `caiqy.opencode-ui`
2. 保证 JetBrains 宿主运行时所有依赖插件 ID 的路径与新 ID 一致
3. 保证 JetBrains 后续站内更新链路围绕新 ID 工作，不再查询旧 ID
4. 用最小范围完成本次身份对齐，不顺带引入无关重构
5. 在仓库文档中明确记录这次变更的迁移性质与已知限制

## 不在范围内

- 不改 VSCode 插件 `publisher/name`
- 不为旧 JetBrains 安装用户提供自动迁移到新 ID 的能力
- 不尝试继承旧 JetBrains Marketplace 插件的安装量、评价或更新轨迹
- 不重做 JetBrains / VSCode 的发布工作流骨架
- 不修改与插件 ID 无关的展示文案、功能逻辑或架构边界

## 当前现状与验证结论

### VSCode 当前身份

- `hosts/vscode-plugin/package.json`
  - `publisher: "caiqy"`
  - `name: "opencode-ui"`
- 对外 Unique Identifier 即 `caiqy.opencode-ui`

### JetBrains 当前身份

- `hosts/jetbrains-plugin/src/main/resources/META-INF/plugin.xml`
  - `<id>qtkj.opencode-ui</id>`
- `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/update/PluginUpdateService.kt`
  - 使用 `PluginId.getId("qtkj.opencode-ui")` 查询 Marketplace 更新

### 可行性验证结论

1. `caiqy.opencode-ui` 符合 JetBrains 插件 ID 的字符约束
2. `caiqy.opencode-ui` 也比 `opencode-ui` 更符合 JetBrains 官方推荐的“类似 Java package 的 fully qualified name”风格
3. 仓库内没有发现“JetBrains 插件 ID 必须保留旧命名空间”之类的代码级阻塞
4. 真正风险不在源码，而在 Marketplace 身份：如果旧 ID 已公开发布，则改 ID 应按“新插件身份阶段”理解，旧安装用户不会沿原链平滑升级

## 方案比较

### 方案 A：JetBrains 技术 ID 直接改为 `caiqy.opencode-ui`，并同步运行时与文档（采用）

做法：

- 修改 `plugin.xml` 中的 `<id>`
- 修改 JetBrains 更新服务里写死的旧 `PluginId`
- 补充迁移说明，明确这是技术身份切换

优点：

- 与 VSCode Unique Identifier 完全对齐
- 新 ID 形式比 `opencode-ui` 更规范
- 改动面小，目标集中

缺点：

- 若旧 JetBrains ID 已公开发布，则升级链会中断
- 后续发布和用户沟通需要显式说明迁移性质

### 方案 B：保持 JetBrains 技术 ID 不变，只统一展示层（不采用）

不采用原因：

- 无法满足“对齐 VSCode Unique Identifier”的目标
- 只是维持现状，不能解决两端技术身份不一致的问题

### 方案 C：改为 `opencode-ui`（不采用）

不采用原因：

- 虽然字符层面可用，但不如 `caiqy.opencode-ui` 符合 JetBrains 官方推荐命名形式
- 与 VSCode 实际 Unique Identifier 也并不完全一致

## 最终设计

## 一、总体原则

1. **这次改的是技术身份，不是展示文案**：关注点是插件 ID 与依赖该 ID 的运行时行为
2. **只做最小闭环**：仅修改对齐所必需的源码与说明，不扩大到无关发布结构
3. **新 ID 必须全链一致**：插件声明与更新查询不能一新一旧
4. **风险通过文档显式化**：不把身份迁移伪装成普通兼容更新

## 二、实现范围

### 1. JetBrains 插件主身份改名

修改：

- `hosts/jetbrains-plugin/src/main/resources/META-INF/plugin.xml`

将：

- `qtkj.opencode-ui`

改为：

- `caiqy.opencode-ui`

这是 JetBrains 插件在 IDE 与 Marketplace 中的主技术标识，也是后续一切 Marketplace 查询和安装身份的根。

### 2. JetBrains 更新查询链路同步改名

修改：

- `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/update/PluginUpdateService.kt`

将写死的：

- `PluginId.getId("qtkj.opencode-ui")`

改为：

- `PluginId.getId("caiqy.opencode-ui")`

这样 JetBrains 站内更新逻辑才会围绕新的 Marketplace 身份查询兼容版本。否则插件主身份和更新查询身份会分裂，导致更新能力指向旧插件。

### 3. 文档与说明同步收敛

本次需要在仓库文档中明确：

- JetBrains 技术 ID 已切换到 `caiqy.opencode-ui`
- 这次变更属于技术插件身份调整
- 若旧 `qtkj.opencode-ui` 已在 JetBrains Marketplace 公开发布，则旧安装用户不保证自动升级到新 ID
- 若需要迁移说明、公告文案或市场侧上架策略，应在发布时单独处理

文档修改应以“当前事实”和“迁移约束”为主，不需要把历史设计文档全部回写重写。

### 4. 明确不做的事

本次不做：

- 自动检测并迁移旧插件安装状态
- 在 WebGUI 或 JetBrains UI 内新增专门迁移向导
- 兼容保留对旧 Marketplace ID 的双查找逻辑
- 修改 VSCode 端与此无关的发布配置

## 三、影响分析

### 运行时影响

JetBrains 运行时真正依赖插件 ID 的核心路径只有两类：

1. 插件元数据主声明
2. Marketplace 更新查询

因此源码层面的主改动点是有限且清晰的，不涉及 WebGUI、VSCode 后端或核心 opencode server 的协议变化。

### 发布影响

如果 `qtkj.opencode-ui` 已经作为公开 JetBrains Marketplace 插件存在，则改成 `caiqy.opencode-ui` 后：

- Marketplace 会把新 ID 视为新的技术身份
- 旧安装用户不会自动沿原插件链升级到新 ID
- 旧插件与新插件可能在一段时间内并存于认知层面

因此，这次改动虽然源码简单，但发布语义上必须按“身份迁移”对待。

### 不应误改的边界

仓库中若出现其他平台的 `qtkj.opencode-ui` 字样，需要区分是否属于 JetBrains 技术 ID。

例如 VSCode 侧若存在使用 `publisher.name` 组合值的逻辑，那是另一个平台的扩展身份，不应因本次 JetBrains 对齐而顺手改动。

## 四、验证方案

### 1. 静态验证

实施后需要确认：

- JetBrains 运行时源码路径中不再残留旧的 `qtkj.opencode-ui`
- `plugin.xml` 与 `PluginUpdateService.kt` 对新 ID 的使用保持一致

### 2. 构建级验证

需要执行 JetBrains 插件构建，确认：

- 插件元数据可以正常打包
- 产物中插件 ID 与预期一致

### 3. 风险保留说明

验证通过只代表：

- 源码和构建层面可工作

不代表：

- 旧 Marketplace 插件能自动迁移到新插件身份
- 线上 Marketplace 历史数据能自动继承

这些风险必须继续保留在发布说明中，而不是通过本地构建验证消解。

## 五、成功标准

本次设计完成后的成功标准是：

1. JetBrains 插件技术 ID 已统一为 `caiqy.opencode-ui`
2. JetBrains 更新查询逻辑已围绕 `caiqy.opencode-ui` 工作
3. 仓库内关于本次变更的迁移性质已有清晰说明
4. 变更范围保持最小，没有引入与目标无关的扩散修改

## 六、测试策略

本次以回归验证为主：

1. 搜索确认 JetBrains 运行时关键路径已统一为新 ID
2. 构建 JetBrains 插件，检查是否能正常产出
3. 如有现成单元测试覆盖更新服务，可同步更新预期值；若没有，不为本次单独扩展大范围测试框架

## 七、已知限制

1. JetBrains 官方建议公开发布后的插件 ID 保持稳定，因此这次变更天然带有发布身份迁移成本
2. 若旧 ID 已在 Marketplace 使用，升级链中断不属于实现缺陷，而是技术身份切换的自然结果
3. 本次不解决旧插件用户如何被引导迁移的问题；那需要发布策略和用户沟通层面的后续动作
