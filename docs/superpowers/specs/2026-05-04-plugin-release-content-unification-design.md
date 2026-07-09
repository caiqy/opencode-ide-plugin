# VSCode 与 JetBrains 插件发布内容统一设计

## 目标

在不改变两端发布标识、元数据完整度和版本处理差异的前提下，把 VSCode 与 JetBrains 插件的发布内容统一到同一套维护流程中，降低双维护成本，减少文案漂移，并支持后续一次准备、两端同时发版。

本次统一以 **JetBrains/IDEA 当前发布内容风格为基准**，让 VSCode 向其对齐，而不是把 JetBrains 文案降级到 VSCode 当前的简略形式。

## 非目标

- 不统一发布标识：
  - VSCode 继续保留 `publisher/name`
  - JetBrains 继续保留 `vendor/id`
- 不强行统一各平台 Marketplace 特有字段：
  - VSCode 继续保留 `categories`、`keywords`、`galleryBanner` 等
  - JetBrains 继续保留 `sinceBuild`、`untilBuild`、签名与发布配置等
- 不统一版本注入规则：
  - VSCode 继续使用 release workflow 中的版本转换逻辑
  - JetBrains 继续使用 Gradle / release workflow 的版本注入逻辑
- 不改造现有双平台发布骨架，不新增第二套主发布入口

## 当前现状

### VSCode

- 主发布元数据位于 `hosts/vscode-plugin/package.json`
- 展示文案主要来自：
  - `hosts/vscode-plugin/package.json`
  - `hosts/vscode-plugin/README.md`
  - `hosts/vscode-plugin/CHANGELOG.md`
- 当前短描述偏简略：`OpenCode UI VSCode extension`
- 当前更新日志按日期累计，不适合直接作为双平台统一发布说明
- README 仍保留 `GUI only variant` 历史文案，与当前标准版单路线发布策略不一致

### JetBrains

- 主发布标识和基础元数据位于：
  - `hosts/jetbrains-plugin/src/main/resources/META-INF/plugin.xml`
  - `hosts/jetbrains-plugin/build.gradle.kts`
- Marketplace 实际展示文案主要来自：
  - `hosts/jetbrains-plugin/description.html`
  - `hosts/jetbrains-plugin/changelog.html`
- 当前描述更完整，更接近正式发布页文案
- 当前更新日志更偏“版本说明 + 重点改进 + 功能概览”结构，适合作为统一方向
- README 同样保留 `GUI only variant` 说明，与当前实际发布策略不一致

## 统一边界

### 保留差异

以下内容继续允许双平台差异存在：

1. 发布标识
2. 元数据完整度
3. 版本处理

### 统一范围

以下内容改为统一维护：

1. 名称主体
2. 短描述主体
3. 长描述主体
4. README 主体
5. 更新日志主体
6. 标准版说明
7. 非官方提示

平台只允许在统一主体之外追加极少量 **平台尾注**。

## 方案对比

### 方案 A：单一内容源 + 自动生成平台产物（采用）

做法：

- 建立一套共享发布内容源
- VSCode 直接消费 Markdown
- JetBrains 在发布前把共享 Markdown 转为 HTML 产物
- 平台目录中的 README / changelog / description 变为生成产物

优点：

- 后续双平台一起发版时维护成本最低
- 能真正减少内容漂移
- 保持 JetBrains 现有 Marketplace 消费链路不变，仅替换内容来源

缺点：

- 需要一次性补齐生成脚本和同步校验

### 方案 B：只共享 changelog，其余文案继续分平台维护（不采用）

不采用原因：

- README 与描述仍会持续双维护
- 无法从根源解决发版时的文案漂移

### 方案 C：共享模板结构，但平台文件继续各自编辑（不采用）

不采用原因：

- 只能统一结构，不能统一内容源
- 仍需人工同步，后续维护收益有限

## 最终设计

### 一、统一内容方向

统一内容方向以 JetBrains 现有发布内容为主，具体表现为：

- 文案信息密度向 JetBrains 当前 `description.html` 看齐
- 更新日志表达方式向 JetBrains 当前“版本 + 重点改进 + 功能概览”结构看齐
- VSCode 侧补强描述和 README，而不是继续保留当前的极简写法

### 二、单一内容源

新增共享发布内容目录，作为双平台发布文案的唯一真相源：

- `docs/release-content/manifest.json`
- `docs/release-content/description.shared.md`
- `docs/release-content/README.shared.md`
- `docs/release-content/CHANGELOG.md`

#### 1. `manifest.json`

用于保存短元数据与统一配置，例如：

- 共享名称主体：`OpenCode UI (unofficial)`
- 共享短描述
- VSCode 平台尾注
- JetBrains 平台尾注

该文件只承载短文案与配置，不承载长说明正文。

#### 2. `description.shared.md`

用于保存长描述主体，作为 Marketplace 描述的统一内容源。内容以当前 JetBrains `description.html` 为蓝本，覆盖：

- 一句话介绍
- 核心能力列表
- 非官方提示
- 标准版内置 backend 说明
- 适用人群 / 使用场景

#### 3. `README.shared.md`

用于保存双平台 README 的共享主体，承担文档式阅读场景。

#### 4. `CHANGELOG.md`

作为唯一共享更新日志源：

- 只维护一份
- 按版本编排
- 既服务 VSCode，也服务 JetBrains

### 三、平台产物设计

共享源经过生成脚本后，产出以下平台文件。

#### VSCode 产物

- `hosts/vscode-plugin/README.md`
- `hosts/vscode-plugin/CHANGELOG.md`
- `hosts/vscode-plugin/package.json` 中的统一文案字段：
  - `displayName`
  - `description`

保留不由统一源覆盖的字段：

- `name`
- `publisher`
- `version`
- `categories`
- `keywords`
- `galleryBanner`
- 其他 VSCode 扩展专有配置

#### JetBrains 产物

- `hosts/jetbrains-plugin/README.md`
- `hosts/jetbrains-plugin/description.html`
- `hosts/jetbrains-plugin/changelog.html`

保留不由统一源覆盖的字段：

- `plugin.xml` 中的 `id`、`vendor`、扩展点、actions 等
- `build.gradle.kts` 中的 `sinceBuild`、`untilBuild`、签名与 Marketplace 发布配置

### 四、内容结构与写作规范

#### 1. 名称主体

发布内容主体统一为：

`OpenCode UI (unofficial)`

README 标题、描述首句、共享内容标题都优先使用该英文主体。JetBrains 如需在插件内部 UI 保留中文显示名，不影响发布内容统一。

#### 2. 短描述

短描述应表达完整价值，不再使用“某某 extension”这种信息量过低的写法。统一短描述应同时覆盖：

- unofficial 身份
- 把 OpenCode 带入 IDE
- chat / context management / bundled backend 等核心能力

#### 3. 长描述与 README 主体章节

统一使用以下章节顺序：

1. 一句话介绍
2. 核心能力列表
3. 非官方提示
4. 标准版说明
5. 适用人群 / 使用场景
6. 平台尾注

#### 4. 更新日志结构

共享 `CHANGELOG.md` 采用按版本维护的固定结构：

```md
## v26.x.xxxx

### 近期重点改进

- ...

### 功能演进概览

- ...

### 修复与体验优化

- ...
```

这既保留 JetBrains 当前发布说明的组织方式，也适合 VSCode 直接显示 Markdown。

#### 5. 强制写作约束

统一内容中不允许再出现：

- `GUI only variant` 作为当前方案说明
- 旧的双路线安装指引
- 直接暴露源码路径，如 `src/main/resources/bin`
- 仅说明“VSCode extension / JetBrains plugin”而没有价值表达的极简短描述

### 五、生成流程

新增一个统一的发布内容同步脚本，例如 `bun run release-content:sync`，负责把共享源转换为平台产物。

#### 输入

- `docs/release-content/manifest.json`
- `docs/release-content/description.shared.md`
- `docs/release-content/README.shared.md`
- `docs/release-content/CHANGELOG.md`

#### 输出

- `hosts/vscode-plugin/README.md`
- `hosts/vscode-plugin/CHANGELOG.md`
- `hosts/vscode-plugin/package.json` 中的统一文案字段
- `hosts/jetbrains-plugin/README.md`
- `hosts/jetbrains-plugin/description.html`
- `hosts/jetbrains-plugin/changelog.html`

#### 平台生成规则

##### VSCode

- `README.md` 由 `README.shared.md` 生成，并追加 VSCode 平台尾注
- `CHANGELOG.md` 直接由共享 `CHANGELOG.md` 覆盖
- `package.json` 只同步统一文案字段，不碰发布标识与其他专有配置

##### JetBrains

- `README.md` 由 `README.shared.md` 生成，并追加 JetBrains 平台尾注
- `description.html` 由 `description.shared.md` 转换生成
- `changelog.html` 由共享 `CHANGELOG.md` 转换生成，可按约定只提取最近一个版本或最近若干版本
- `plugin.xml` 中的短描述保留为兜底值，但 Marketplace 实际展示继续以生成产物注入为准

### 六、与现有发布链路的关系

#### VSCode

- 继续保留当前 `.vsix` 打包与 Marketplace 发布流程
- 只要求在打包前保证 README、CHANGELOG 和统一文案字段已同步

#### JetBrains

- 继续保留当前 `build.gradle.kts` 读取 `description.html` / `changelog.html` 的方式
- 不改变 JetBrains Marketplace 当前的 HTML 消费链路
- 只把 HTML 的内容来源改为共享 Markdown 经脚本生成

#### Release workflow

- 在现有 `release.yml` 中增加前置同步 / 校验步骤
- 不新增新的主发布 workflow

### 七、校验规则

为避免未来再次漂移，统一方案必须附带自动校验。

#### 1. 共享源到产物一致性校验

- 运行同步脚本后，如平台产物发生变化但未同步提交，则失败

#### 2. 禁用旧文案校验

生成后的 README / description / changelog 中不允许出现：

- `GUI only`
- 旧的双路线发布说明
- JetBrains 描述中的源码路径暴露

#### 3. 标题与短描述一致性校验

至少校验以下内容与共享配置一致：

- VSCode `displayName`
- README 标题
- 共享描述首句

#### 4. 更新日志结构校验

- 共享 `CHANGELOG.md` 必须符合“版本 -> 小节”结构
- JetBrains `changelog.html` 必须由共享 Markdown 生成，不允许继续长期手工维护另一份

### 八、迁移策略

采用低风险分步迁移：

#### 第一步：建立共享源

- 新增共享目录与源文件
- 以当前 JetBrains 内容为基准整理首版正文

#### 第二步：引入生成脚本

- 先只生成平台产物
- 不立即修改主发布流程
- 用生成结果与现有文件做人工比对

#### 第三步：切换平台文件为生成产物

- VSCode：`README.md`、`CHANGELOG.md`
- JetBrains：`README.md`、`description.html`、`changelog.html`

#### 第四步：接入 release 前同步校验

- 在发版前自动执行同步脚本
- 发现平台产物未同步时直接失败

### 九、风险与应对

#### 风险 1：JetBrains HTML 展示质量退化

应对：

- 保留 JetBrains HTML 产物
- 只改变来源，不改变 JetBrains Marketplace 的消费方式

#### 风险 2：双平台对同一段短文案长度要求不同

应对：

- 采用共享主体 + 平台尾注
- 短描述从 `manifest.json` 的独立字段读取，而不是从 README 或长描述硬截断

#### 风险 3：平台目录下的生成产物被手工修改

应对：

- 在文件头注释或维护文档中明确其为生成产物
- 用 CI 校验阻止漂移

#### 风险 4：JetBrains changeNotes 只需要最近版本，而共享 changelog 保留完整历史

应对：

- 共享 `CHANGELOG.md` 保留完整历史
- JetBrains HTML 生成时按规则提取最近一个版本或最近若干版本

## 成功标准

方案落地后，应该满足：

- 修改一处共享发布内容，可同步影响 VSCode 与 JetBrains 两端
- 两端 README、描述、更新日志主体不再长期漂移
- 发版时不再需要分别手改两套正文
- 仍保留三类必要差异：
  - 发布标识
  - 元数据完整度
  - 版本处理

## 备注

- 本设计只覆盖发布内容统一，不直接实现脚本、模板或 CI 改造
- 根据仓库当前协作约束，本文档会写入仓库，但不会在未获明确授权时主动创建 git commit
