# JetBrains 测试分层与后续迁移设计

## 背景

当前 `hosts/jetbrains-plugin` 已同时存在两类测试入口：

- `test`：走 IntelliJ Platform Gradle Plugin 的 `TestIdeTask`
- `unitTest`：走普通 JVM `Test` 任务

在 Windows + IntelliJ Platform 2024.3 + `org.jetbrains.intellij.platform` 2.2.x 组合下，`TestIdeTask` 存在已知的 bundled plugin 扫描性能/卡顿问题。之前已经把以下轻量测试迁移到了 `unitTest`，并验证可稳定通过：

- `IdeBridgeUpdateTest`
- `IdeBridgeRestartHostTest`
- `IdeBridgeStorageScopeTest`
- `BackendLogsVisibilityControllerTest`
- `BackendLogsErrorViewTest`

但仓库里还没有一份稳定、明确、长期可维护的“JetBrains 测试应该放哪一层”的规则说明，导致后续新增测试时容易再次误放到 `test`，把不需要 IDE sandbox 的轻量测试重新拖回慢路径。

## 目标

建立一套清晰的 JetBrains 测试分层规则，并据此继续筛选 `src/test/kotlin` 中剩余测试：

1. 明确哪些测试必须保留在 `test`
2. 明确哪些测试应该优先放在 `unitTest`
3. 把规则写进仓库文档，作为后续新增测试的约定
4. 仅迁移“明显安全”的下一批轻量测试，不做无边界大搬迁

## 当前测试现状

### `src/test/kotlin`

当前剩余测试文件：

- `hosts/jetbrains-plugin/src/test/kotlin/paviko/opencode/update/PluginUpdateServiceTest.kt`

其中：

- `PluginUpdateServiceTest` 目前只依赖 JUnit、线程同步原语、纯 Kotlin service 注入，不依赖 IntelliJ sandbox，天然更接近 `unitTest`

### `src/unitTest/kotlin`

当前已在 `unitTest` 的测试：

- `IdeBridgeUpdateTest`
- `IdeBridgeRestartHostTest`
- `IdeBridgeStorageScopeTest`
- `BackendLogsVisibilityControllerTest`
- `BackendLogsErrorViewTest`
- `StandaloneMessageTest`（历史自定义 main 入口示例）

这说明项目已经具备“轻量测试放入 `unitTest`”的可行基础，不需要新增第二套机制。

## 分层规则

### 应放入 `unitTest` 的测试

满足以下任一组合时，应优先放入 `src/unitTest/kotlin`：

- 只依赖 JUnit / Mockito / Kotlin 标准库
- 只依赖 Swing/AWT 组件（如 `JPanel`、`JLabel`、`BorderLayout`）
- 被测对象是纯 Kotlin / 纯 JVM 逻辑类
- 通过构造注入、lambda 注入或 mock 就能隔离外部依赖
- 只 mock `Project` 或类似轻量接口，不需要真实 IDE 生命周期

典型例子：

- bridge 协议 roundtrip
- storage scope 路由
- restart/update service 编排
- backend logs UI reveal 时机

### 必须保留在 `test` 的测试

满足以下任一条件时，应保留在 `src/test/kotlin`：

- 依赖 IntelliJ sandbox 初始化
- 需要真实 `ApplicationManager` / IDE 应用对象行为
- 需要真实 ToolWindow / JCEF / browser 创建流程
- 需要真实 IntelliJ 平台服务、扩展点、VFS、editor 打开流程
- 需要验证插件与 IntelliJ 平台之间的集成 wiring，而不是本地逻辑本身

## 迁移策略

### 第一原则：先分类，再迁移

后续不再采用“看起来能迁就顺手迁”的方式，而是遵循：

1. 先判断依赖边界
2. 再决定所属测试层
3. 最后迁移文件和命令

### 第二原则：只迁移明显安全的测试

本轮只处理明显符合 `unitTest` 条件的测试，例如：

- `PluginUpdateServiceTest`

而不把所有 JetBrains 测试一口气搬空。

### 第三原则：文档先行

在继续迁移下一批测试前，先把规则写入长期文档，避免后续新增测试再次进入错误层级。

## 文档落点

建议把规则写入：

- `docs/repowiki/07-host-plugins.md`

新增一个简洁小节，例如：

- `JetBrains 测试分层约定`

内容包含：

- `unitTest` 与 `test` 的职责区别
- 目录约定
- 常用命令
- 新增测试时的判断标准

## 推荐的下一批迁移对象

当前最推荐的下一批对象是：

- `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/update/PluginUpdateServiceTest.kt`

原因：

1. 纯 service 测试，无 IntelliJ sandbox 依赖
2. 已经使用依赖注入替代真实平台依赖
3. 与已迁走的 `IdeBridge*` / `BackendLogs*` 一样属于典型轻量 JVM 测试

## 风险与约束

### 风险

- 若误把真实 IntelliJ 集成测试迁到 `unitTest`，可能造成“测试看似快了，但不再覆盖真实平台接线”

### 控制方式

- 每次迁移前先检查是否依赖真实平台对象
- 混合命令拆分为 `unitTest` 与 `test` 两条，不再为了“一条命令跑完”牺牲分层清晰度

## 验收标准

完成本设计后的后续实施应满足：

1. `docs/repowiki/07-host-plugins.md` 明确写出 JetBrains 测试分层规则
2. `PluginUpdateServiceTest` 等明显轻量测试迁移到 `unitTest`
3. 文档中的 JetBrains 轻量测试命令优先使用 `gradlew[.bat] unitTest --tests ...`
4. 保留真正依赖 IntelliJ sandbox 的测试在 `test`
