# repowiki 更新与本地逻辑回归锁定设计

## 背景

最近半个月，本仓库围绕以下主题持续演进：

- `generate_image`、图片附件、项目内落盘、预览与保存链路
- VSCode / JetBrains 宿主版本、更新、bridge 能力与 user agent 对齐
- non-git 项目按目录隔离与开发态 project path override
- WebGUI 的 scroll / overlay / retry / 状态展示稳定化

这些能力大多属于本 fork 为 IDE/WebGUI 场景补上的本地逻辑。它们一部分已经写入 `docs/superpowers/` 的 spec/plan，一部分已有回归测试，但当前 `docs/repowiki/` 对近期状态的同步不完整，测试也缺少一部分“直接命中本地契约”的断言。后续同步上游时，如果只依赖零散 spec、提交记录或间接测试，容易出现行为回退但维护者没有第一时间发现。

本次工作的目标，是把近期本地逻辑同时沉淀为：

1. **RepoWiki 护栏**：说明当前真实行为、关键文件、维护入口、上游同步风险。
2. **测试护栏**：用直接回归断言锁住高风险本地语义，避免被上游改动无声覆盖。

## 目标

### 目标 1：同步近期本地行为到 repowiki

把近半个月新增或明显收口过的本地逻辑补充到现有 `docs/repowiki/` 章节中，不新增百科式新章，不复述上游通用能力。

### 目标 2：补齐高风险本地逻辑的直接回归断言

围绕近期主题盘点“已直接覆盖 / 仅间接覆盖 / 未覆盖”，补齐缺失的关键测试，使后续更新上游代码时能够快速判断本地契约是否被破坏。

### 目标 3：建立 repowiki 与测试的映射关系

为后续维护保留一份 coverage 风格的对照结果，明确：

- 哪些本地逻辑已被记录
- 靠哪些测试锁住
- 哪些章节对应哪些风险点

## 非目标

本次不做以下事情：

- 不重构生产实现，只在补测试必要时做最小调整。
- 不把 `docs/superpowers/` 的 spec/plan 原样搬进 repowiki。
- 不追求大而全的集成测试闭环，以“直接命中本地语义”为主。
- 不把 opencode 上游通用实现扩写成项目百科。

## 范围

本次范围按主题分为 4 组，三组都做，允许整体改动面较大，但每组都遵守“文档同步 + 直接测试锁定”的双护栏策略。

### A. 图片链路

覆盖以下能力：

- `generate_image` 工具
- tool result -> attachments -> project file persistence
- generated image route / Markdown 与 tool attachment 预览入口
- `ImageOverlay` 关闭、缩放、保存等交互
- host `saveImage` bridge 能力
- readonly image inputs 兼容

### B. 宿主链路

覆盖以下能力：

- VSCode `OPENCODE_UI_VERSION` / UI user agent 版本注入
- `getExtensionVersion`
- JetBrains public API 更新链路
- 空 marketplace 结果视为已是最新
- plugin id / vendor / version / bridge version 对齐

### C. 同步隔离链路

覆盖以下能力：

- non-git 项目按目录隔离
- project/session/workspace 身份不坍缩到全局
- 开发态 project path override 与路径展示语义

### D. WebGUI 稳定性链路

覆盖以下能力：

- tail follow / scroll anchoring / resize 后自动跟随
- aborted message load retry
- assistant completed time 展示
- bash 运行中标题展示
- status popover backend 目标与状态语义
- overlay 阴影点击关闭

## 方案选择

本次考虑过三种推进方式：

### 方案 A：主题驱动的“文档 + 直接回归断言”双矩阵（推荐）

按主题拆成图片链路、宿主链路、同步隔离链路、WebGUI 稳定性链路四组。每组都同时做 repowiki 同步与测试补强。

优点：

- 与近期提交主题一致，便于对照近半个月的本地改动。
- 文档和测试可以围绕同一主题收口，后续上游同步更容易检查。
- 更适合建立“本地逻辑点 → repowiki 章节 → 测试文件”的映射。

缺点：

- 文档改动范围较大。
- 需要先做覆盖盘点，设计成本高于局部修补。

### 方案 B：按 repowiki 章节驱动

先逐章补 repowiki，再从章节反推测试。

优点：

- 文档结构整齐。
- 适合知识沉淀。

缺点：

- 容易把跨章节主题拆散。
- 测试优先级会被文档结构牵引，风险导向不够强。

### 方案 C：测试优先，文档随后收口

先补测试，再统一更新 repowiki。

优点：

- 最快锁住行为。
- 风险最低。

缺点：

- 文档会滞后。
- 维护者中途不容易理解为什么这些测试存在。

### 选型结论

采用 **方案 A**。原因：本次明确要求“全面同步 repowiki”“近期主题全覆盖”“三组都要”“验收以直接回归断言为准”，方案 A 最符合这些约束。

## repowiki 更新设计

保持现有 8 章结构，不新增大而空的新章节。每章只补本地逻辑、入口、风险和维护点。

### `docs/repowiki/README.md`

补一段近期高风险主题索引，挂出以下入口：

- 图片生成 / 预览 / 保存链路
- 宿主版本 / 更新 / bridge 能力
- non-git 项目隔离
- WebGUI 稳定性补丁

目标是让维护者一眼看到“最近哪些本地逻辑最不能丢”。

### `docs/repowiki/01-webgui-architecture.md`

补两类入口：

- `WebGUI: dev` + 源码 backend 联调时的 project path override / `x-opencode-directory` 语义
- Markdown / tool attachment / generated image 进入统一预览层的架构链路

### `docs/repowiki/02-ide-bridge.md`

补 bridge 新增或近期收紧的能力契约：

- `saveImage`
- `getExtensionVersion`
- 双宿主是否都支持
- 失败或不支持时的回退语义

### `docs/repowiki/03-state-storage.md`

补 non-git 项目不再坍缩到全局 identity 的状态真相：

- workspace 状态按目录隔离
- 对 tabs、草稿、selection、session/project 识别的影响
- 上游若改 project identity / path normalize，容易回退这些本地逻辑

### `docs/repowiki/04-session-chat.md`

补聊天主链行为：

- assistant `completedAt` 展示
- `stream_timeout` 自动重试
- 图片如何作为消息/工具结果进入聊天展示
- aborted message load retry 收口规则
- scroll / follow / anchoring 的近期稳定性约束

### `docs/repowiki/05-subtasks-tools-mcp.md`

作为图片链路文档主场，补以下内容：

- `generate_image` 是本地新增的重要工具能力
- tool result -> attachments -> preview 的展示契约
- `ImageOverlay` 阴影点击关闭、缩放、保存
- 图片预览与普通附件、Markdown 图片的关系
- 工具标题 / 摘要 / 图片展示的当前语义

### `docs/repowiki/06-settings-update-localization.md`

更新 JetBrains 更新语义：

- 使用公开 Marketplace 查询 / public API
- 空 marketplace 结果视为已是最新
- Marketplace 安装版与本地 ZIP / 开发版的能力差异
- 移除或改写过时更新模型描述

### `docs/repowiki/07-host-plugins.md`

作为宿主链路文档主场，补以下内容：

- VSCode `OPENCODE_UI_VERSION` / UI user agent 注入
- JetBrains `getExtensionVersion`
- plugin id / vendor / version / bridge version 的一致性要求
- `WebGUI: dev` + backend source 启动约定
- 发布内容转向图片生成工作流相关表达

### `docs/repowiki/08-upstream-adaptations.md`

作为上游同步风险总表，新增或强化以下必须保留的本地适配：

- `generate_image`
- generated image project-file persistence
- generated image route / 预览入口
- readonly image inputs 兼容
- non-git project identity
- `stream_timeout` 自动重试
- 宿主版本注入与 bridge 扩展能力

## 测试补强设计

### 总体原则

- 先盘点已有覆盖，再补高风险缺口。
- 只补本地语义，不顺手重构测试架构。
- 能落低层就不抬高层。
- 覆盖判定按三类：`已直接覆盖`、`仅间接覆盖`、`未覆盖`。
- 对高风险本地语义，`仅间接覆盖` 也视为需要补直接断言。

### A. 图片链路补测

优先补：

1. `generate_image` readonly 输入兼容
   - 直接断言 `readonly images` 可执行
   - 确认不改写入参

2. 图片工具结果展示语义
   - 多图顺序
   - 标题/摘要不重复污染
   - 预览入口正确

3. `ImageOverlay` 当前交互契约
   - 阴影点击关闭
   - 保持缩放/保存/重置语义不回退

4. host 保存图片参数契约
   - bridge 参数正确
   - 文件名、mime、data/source 语义不漂移

重点测试层：

- `packages/opencode/test/tool/*`
- `packages/opencode/test/session/*`
- `packages/opencode/webgui/src/components/**/*test.tsx`
- `hosts/vscode-plugin/src/test/suite/*`
- JetBrains 可落轻量测试时优先放 `unitTest`

### B. 宿主链路补测

优先补：

1. VSCode UI version / user agent
2. `getExtensionVersion` 契约
3. JetBrains 更新语义
4. plugin id / vendor / version 一致性

重点测试层：

- VSCode：`webviewController.test.ts`、`ideBridgeServer.test.ts`、`updateService.test.ts`
- JetBrains：`src/unitTest/kotlin/...`

### C. 同步隔离链路补测

优先补：

1. non-git 项目按目录隔离
2. workspace 状态按目录隔离的核心语义
3. dev project path override 的最小直接断言（若当前仍缺）

重点测试层：

- `packages/opencode/test/project/*`
- `packages/opencode/test/server/*`
- 必要时 `ProjectContext` / `ideBridge` 测试

### D. WebGUI 稳定性链路补测

优先补：

1. scroll follow / anchoring / resize
2. aborted message load retry
3. assistant completed time
4. bash running title / status popover

重点测试层：

- `MessageList` hooks tests
- `SessionContext` / `MessagesContext` tests
- `CompactHeader` / `StatusPopover` 组件测试
- `ToolPart/utils.test.ts` 或对应展示测试

## 实施顺序

### 第 1 步：覆盖盘点

输出一份 coverage 风格清单，按四大主题列出：

- 本地逻辑点
- 现有测试证据
- 覆盖判断
- 是否需要补测
- 对应 repowiki 章节

### 第 2 步：优先补高风险直接断言

先补：

- 图片链路
- 宿主链路
- non-git 隔离

再补：

- WebGUI 稳定性链路

### 第 3 步：统一更新 repowiki

在测试锁住行为后，再同步文档，避免把“预期设计”误写成“当前已落地行为”。

### 第 4 步：补 coverage / mapping 文档

为后续上游同步保留一份“章节 ↔ 逻辑 ↔ 测试”的导航索引。

## 风险与控制

### 风险 1：改动范围大，容易顺手重构

控制：只为测试和文档同步做必要修改，不借机改写生产结构。

### 风险 2：高频修复点分散，容易漏掉局部本地逻辑

控制：先做 coverage 清单，再动手补测试；没有进入清单的主题不算完成。

### 风险 3：文档跑在实现前面

控制：先补测试，再更新 repowiki，文档以最终实现与测试结论为准。

### 风险 4：测试层级选太高，导致维护成本大

控制：优先低层直接断言；只有在低层无法表达宿主契约时才补宿主层测试。

## 验收口径

### 文档验收

- `docs/repowiki/` 能准确描述近半个月新增或收口后的本地真实行为。
- 每个相关章节都写出关键文件、当前契约、维护/同步风险。

### 测试验收

- 近半个月四大主题的高风险本地逻辑都有明确归属。
- 缺失的关键直接回归断言已补齐。
- 不用“间接覆盖”替代关键本地语义锁定。

### 结果验收

最终至少能给出一份清晰映射：

`本地逻辑点 -> repowiki 页面 -> 测试文件`

## 交付物

本次工作完成后应交付：

1. 更新后的 `docs/repowiki/` 相关章节
2. 新增或补强的直接回归测试
3. 一份 coverage / mapping 风格文档
4. 一份变更总结，说明哪些是新增锁点，哪些是已有覆盖但补充了文档

## 完成定义

以下条件同时成立，才算完成：

- repowiki 已同步到当前真实行为
- 近半个月四大主题的高风险本地逻辑都有明确文档归属
- 缺失的关键直接回归断言已补齐
- 后续维护者可以从文档快速定位到对应测试与风险点
