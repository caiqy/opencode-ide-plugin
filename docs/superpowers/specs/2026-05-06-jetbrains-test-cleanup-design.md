# JetBrains 轻量测试最小清理设计

## 背景

经过前几轮迁移，JetBrains 宿主下的大部分轻量测试已经从 `src/test/kotlin` 迁移到 `src/unitTest/kotlin`，并且运行命令也从 `gradlew test --tests ...` 逐步切换到了 `gradlew unitTest --tests ...`。

当前剩余问题不是“测试体系不可用”，而是存在少量**真实重复文件**与**容易让维护者误解当前状态的说明**：

- 代码层面：仍有历史位置下的重复测试文件残留
- 文档层面：少数内容如果被当作“当前入口说明”阅读，可能与现状不完全一致

同时，仓库里也保留了多份历史 plan/spec 文档，这些文档记录的是“当时怎么迁”，其中包含 `Move:`、`Delete:` 等步骤。它们是历史记录的一部分，不应被当成“错误内容”一并抹掉。

## 目标

做一轮**最小清理**，只解决当前仍会影响维护判断的真实问题：

1. 删除真实重复的旧测试文件
2. 修正仍会被误读为“当前入口”的路径/命令说明
3. 保留历史迁移文档中的 `Move:` / `Delete:` 记录，不篡改演进过程

## 当前问题定位

### 真实重复文件

当前 `hosts/jetbrains-plugin/src/test/kotlin` 下仍残留：

- `hosts/jetbrains-plugin/src/test/kotlin/paviko/opencode/ui/IdeBridgeUpdateTest.kt`

而等价的当前入口文件已经存在于：

- `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/IdeBridgeUpdateTest.kt`

这类重复会造成两个问题：

- 维护者不容易判断哪个目录才是当前真入口
- 后续继续迁移或回归验证时，容易误把 `src/test` 下的旧文件当成有效目标

### 历史文档中的两类内容

需要区分：

1. **当前指导性内容**
   - 例如“现在应该运行哪条命令”“当前文件位于哪里”
   - 这类内容必须与现状保持一致

2. **历史迁移动作记录**
   - 例如 `Move: src/test/... -> src/unitTest/...`
   - 或 `Delete: src/test/...`
   - 这类内容描述的是历史动作，应保留

## 方案比较

### 方案 A：最小清理（推荐）

- 删除真实重复的旧测试文件
- 只改当前仍会误导维护者的文档说明
- 保留历史迁移动作记录

优点：

- 风险最小
- 不破坏历史时间线
- 直接解决当前维护成本问题

缺点：

- 历史文档里仍会出现旧路径，但只作为历史动作存在

### 方案 B：中度清理

在方案 A 基础上，再对历史文档追加“现已迁移到 unitTest”的状态注记。

优点：

- 历史文档更不易误读

缺点：

- 改动面更大
- 需要逐份判断哪些文档值得补注记

### 方案 C：重写历史文档为当前状态

不推荐。这样会让历史文档失去“当时如何演进”的价值，也容易造成事实重写。

## 推荐方案

采用 **方案 A：最小清理**。

理由：

1. 当前真正需要解决的是“现实中还残留重复文件”
2. 历史文档本身不是 bug，误删/误改会损伤演进记录
3. 对维护者来说，只要“当前入口”和“当前命令”不再混乱，就足够实用

## 实施范围

### 代码层

删除：

- `hosts/jetbrains-plugin/src/test/kotlin/paviko/opencode/ui/IdeBridgeUpdateTest.kt`

不动：

- 已在 `src/unitTest/kotlin` 的当前真文件
- 生产代码

### 文档层

只修改以下内容：

- 被当作**当前入口说明**时会误导的路径
- 被当作**当前执行命令**时会误导的命令
- 当前目录归属说明

明确不修改：

- 历史计划文档中的 `Move:` / `Delete:` 步骤
- 纯历史演进描述

## 验收标准

完成后应满足：

1. `src/test/kotlin` 下不再残留 `IdeBridgeUpdateTest.kt` 这种与 `unitTest` 重复的旧文件
2. 当前维护文档中，指向 JetBrains 轻量测试的路径与命令与现状一致
3. 历史迁移文档中的 `Move:` / `Delete:` 记录保持原样
4. `unitTest` 下运行 `IdeBridgeUpdateTest` 仍然通过
