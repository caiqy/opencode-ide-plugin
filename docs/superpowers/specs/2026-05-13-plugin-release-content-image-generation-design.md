# 插件统一介绍页按生图能力更新设计

## 背景

仓库当前通过统一发布内容源维护插件介绍文案：

- `docs/release-content/README.shared.md`
- `docs/release-content/description.shared.md`

其中：

- `README.shared.md` 会生成 VSCode / JetBrains 插件的 README。
- `description.shared.md` 会转换为 JetBrains Marketplace 使用的 `description.html`。

最近仓库已新增一批图片生成相关能力，包括：

- `generate_image` tool
- WebGUI 图片预览
- 生成图片保存到项目文件
- 插件内图片预览保存支持

当前统一介绍页仍以通用聊天与上下文管理为主，没有把图片生成工作流作为新的核心卖点，也没有向用户说明生图功能的最小配置前提。

## 目标

本次更新的目标是：

1. 将统一介绍页的主卖点切换为“IDE 内的完整图片生成工作流”。
2. 在文案中明确覆盖完整生图链路：生成、编辑、预览、保存到项目文件。
3. 增加面向最终用户的“生图配置要点”，说明启用条件与使用前提。
4. 将 `README.shared.md` 与 `description.shared.md` 的正文内容保持一致，减少长期漂移。
5. 保持对现有发布链路和 Marketplace 校验规则的兼容。

## 非目标

本次不包含以下内容：

- 不修改 `docs/release-content/manifest.json` 中的短描述。
- 不调整 `script/release-content.ts` 的生成逻辑。
- 不改变 VSCode README、JetBrains README、JetBrains `description.html` 的输出路径与同步机制。
- 不加入 provider 清单、API 参数、尺寸限制、格式限制等细粒度技术文档。
- 不在商店文案中暴露内部实现术语，如 provider tool、Responses 链路、具体工具名注入方式等。

## 已确认约束

### 1. 文案方向

统一介绍页本次采用“突出新生图能力”的方向，且强调的是完整生图链路，而不是只介绍图片生成本身。

### 2. 语言形式

文案采用“英文标题/英文首句 + 中文正文”的形式：

- `README.shared.md` 保留英文标题与英文首句。
- `description.shared.md` 保留英文首句。
- 其余主体内容改为中文。

### 3. Marketplace 校验兼容

JetBrains Marketplace 发布链路会校验描述内容必须以 `OpenCode UI` 开头。因此：

- `description.shared.md` 第一行必须保留英文引导句。
- 不应将第一行改成纯中文。

### 4. 两份文档的一致性

用户已确认：`README.shared.md` 与 `description.shared.md` 的内容应尽量保持一致。

允许存在的最小差异仅限于：

- `README.shared.md` 使用 Markdown 一级标题 `# OpenCode UI (unofficial)`。
- `description.shared.md` 不需要 README 标题，但首句保留英文。

除上述格式差异外，章节顺序、能力描述、配置说明、注意事项应保持一致。

## 内容策略

### 总体定位

统一介绍页从“通用 IDE 内聊天与上下文管理入口”升级为：

> 在 IDE 内完成 OpenCode 图片生成工作流，同时保留原有聊天、上下文整理与本地 AI 编码能力。

文案不再把图片生成功能作为附属 bullet，而是作为第一层价值表达。

### 核心卖点排序

能力顺序需要从“生图优先”出发，先讲新增工作流，再讲既有上下文能力。推荐排序：

1. 在 IDE 中生成图片
2. 基于已有图片进行编辑
3. 在聊天与插件界面中预览结果
4. 将生成结果保存到项目文件，便于继续引用与协作
5. 拖拽文件进入上下文
6. 将当前文件、已打开文件、选中代码加入上下文
7. 使用独立输入区整理提示词

## 统一章节结构

两份共享文档统一采用以下结构：

1. 英文标题或英文首句
2. `## 概览`
3. `## 核心能力`
4. `## 生图配置要点`
5. `## 重要说明`
6. `## 标准版说明`
7. `## 适用人群`

## 各章节设计

### 1. 英文标题 / 英文首句

用于满足既有品牌一致性与 JetBrains Marketplace 校验。

建议保留当前英文主体，不在本次修改中替换：

- README 标题：`# OpenCode UI (unofficial)`
- 英文首句：`OpenCode UI (unofficial) brings local OpenCode AI workflows into IDEs with chat, context management, image generation, and bundled backend binaries.`

说明：首句需要纳入 image generation，使英文层面也能反映本次重点更新。

### 2. `## 概览`

概览用于用一小段中文说明插件定位，重点表达：

- 这是一个把 OpenCode 带进 IDE 的非官方插件。
- 用户可以在编辑器内直接完成聊天、上下文整理与图片生成相关工作。
- 新版重点是把图片生成工作流直接放进 IDE，而不是要求用户切换到外部工具。

### 3. `## 核心能力`

核心能力列表应以用户感知能力为中心，不使用内部实现术语。

必须覆盖以下要点：

- 在 IDE 中直接生成图片
- 基于已有图片继续编辑
- 在聊天和插件界面中预览生成结果
- 将生成结果保存到项目文件，便于继续引用、提交或协作
- 通过拖拽文件快速补充上下文
- 通过命令或快捷操作添加当前文件、已打开文件和选中代码到上下文
- 使用独立输入区更方便地整理和编辑提示词

其中，前四条必须体现“完整生图链路”的连续性，而不是彼此孤立的功能点。

### 4. `## 生图配置要点`

这是本次新增章节，目标是让用户看完后知道“为什么我这里能不能用”与“要先配什么”。

本节只承载最小必要信息，必须包含：

- 需要在 OpenCode 中配置支持图片生成的 provider / model。
- 图片生成能力依赖当前 OpenCode 的模型配置是否可用。
- 如果要做图片编辑，需要提供已有图片作为输入。
- 生成结果会进入当前工作流，并保存到项目中的 `.opencode/generated-images/`。

本节不应扩展为操作手册，不列出：

- 具体 provider 名单
- 详细参数说明
- 模型尺寸限制
- 各厂商差异

### 5. `## 重要说明`

本节继续保留统一风险提示，至少包含：

- 这是非官方插件。
- 只安装一个 OpenCode IDE 变体，避免重复功能或行为冲突。

### 6. `## 标准版说明`

本节继续说明当前发行形态，避免用户误解安装方式。

至少保留：

- 当前 standard release 会为受支持平台内置 OpenCode backend。
- 插件会在本地运行时启动该 backend。

### 7. `## 适用人群`

本节用于收束定位，建议强调：

- 面向已经在使用 OpenCode 的开发者
- 适合希望留在 IDE 内完成聊天、上下文管理与图片生成工作的用户

## 文件级设计

### `docs/release-content/README.shared.md`

该文件作为双平台 README 的共享主体：

- 保留英文标题
- 保留英文首句
- 后续全部采用中文正文
- 内容结构与 `description.shared.md` 一致

因为用户已明确要求两份文档内容保持一致，所以 README 不再承担额外的扩展说明职责，不额外增加比 description 更多的章节或操作细节。

### `docs/release-content/description.shared.md`

该文件作为 JetBrains Marketplace 描述源：

- 第一行保留英文首句，满足现有发布校验
- 后续全部采用中文正文
- 内容结构与 `README.shared.md` 一致

不再特意压缩为更短的商店版文本，而是与 README 共享同一套主体内容，降低后续维护成本。

## 与现有发布链路的关系

本次只修改共享文案源，不调整同步机制。

现有影响路径保持不变：

- `README.shared.md` -> `hosts/vscode-plugin/README.md`
- `README.shared.md` -> `hosts/jetbrains-plugin/README.md`
- `description.shared.md` -> `hosts/jetbrains-plugin/description.html`

因此，本次改动完成后，VSCode Marketplace 的 README 展示内容与 JetBrains Marketplace 的描述内容会同步体现新的中文文案与生图重点。

## 验收标准

完成后的共享文案应满足以下标准：

1. 两份共享文件都改为“英文标题/首句 + 中文正文”的形式。
2. 两份文件的主体章节与内容保持一致。
3. 核心能力中将完整生图链路放在最前面。
4. 文案中新增“生图配置要点”章节，并包含最小必要配置说明。
5. `description.shared.md` 第一行仍以 `OpenCode UI` 开头，不破坏 JetBrains Marketplace 校验。
6. 不引入过细技术实现细节，不把 Marketplace 文案写成内部技术文档。

## 风险与控制

### 风险 1：JetBrains Marketplace 描述校验失败

如果将 `description.shared.md` 第一行完全改为中文，会导致发布流程失败。

控制方式：

- 保留以 `OpenCode UI` 开头的英文首句。

### 风险 2：README 与 description 再次漂移

如果两份文件分别手写不同版本，后续迭代容易再次失配。

控制方式：

- 本次设计明确两份共享文档主体内容保持一致。
- 后续仅允许保留标题/首句层面的最小格式差异。

### 风险 3：文案过于技术化

如果将 provider 名单、参数、尺寸限制写入 Marketplace 文案，会削弱介绍页可读性。

控制方式：

- “生图配置要点”只保留最小必要启用说明。
- 不引入实现级术语与详细技术约束。

## 实施摘要

本次设计的落地点非常集中：

- 只改 `docs/release-content/README.shared.md`
- 只改 `docs/release-content/description.shared.md`

改动原则是：

- 保留英文标题/英文首句以满足发布约束
- 将正文整体切换为中文
- 将图片生成工作流提升为统一介绍页主卖点
- 新增生图配置要点
- 保持两份共享文档正文一致
