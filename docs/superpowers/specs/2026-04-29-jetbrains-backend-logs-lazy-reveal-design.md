# JetBrains 后端日志面板按失败懒显示设计

> 日期：2026-04-29
> 状态：待审阅

## 问题

当前 JetBrains 插件在 `ChatToolWindowFactory` 创建工具窗口内容时，会立即创建并挂载一个底部可折叠面板：`Backend logs (merged stdout/stderr)`。

它虽然默认是折叠态，但标题栏始终可见，因此在正常启动、正常使用时，用户也会一直看到一块与主流程无关的诊断 UI。

这带来两个问题：

- 对普通用户而言，这块区域属于实现细节，常态暴露会增加界面噪音
- 用户即使没有遇到问题，也会误以为这是需要关注或操作的主界面元素

但另一方面，这块能力背后承载的“读取后端输出”逻辑又不是纯展示：插件当前依赖后端输出中的

- `opencode server listening on http://...`

来解析端口与 `/app` 地址，并建立 JCEF browser 连接。因此本次不能把日志链路整体删除，只能调整其**UI 暴露时机**。

用户确认的目标是：

- **正常情况下界面上完全看不到这块日志区域**
- **只有发生启动失败或运行错误时，才把日志区域显示出来**
- **一旦显示出来，就保留，方便继续查看错误上下文**

## 范围

本次只处理 **JetBrains 插件工具窗口中后端日志区域的显示时机**。

包含：

- 调整 `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/ChatToolWindowFactory.kt` 中日志面板的挂载策略
- 保留现有后端日志采集、缓冲、展示能力
- 保留基于后端输出解析连接地址的现有逻辑
- 让错误状态下自动显示日志区域，并在显示后保留

不包含：

- 删除或替换后端日志采集机制
- 修改后端启动方式、Terminal 集成方式或 `BackendLauncher` 行为
- 改名日志标题、增加设置项或新增手动开关
- 重做错误页面视觉设计
- 修改 VSCode 插件或 WebGUI 行为

## 方案

采用“**日志继续后台采集，日志面板仅在错误时懒挂载到界面**”的方案。

核心规则：

1. 启动阶段不把日志面板加入 `mainPanel`
2. 正常连接成功时，界面始终只显示主 browser 内容
3. 发生错误时，先显示错误信息，再把日志面板动态加入底部
4. 日志面板一旦被显示，就不再自动移除

### 为什么选择这个方案

- 它最符合“界面上看不到它”的目标，而不是仅仅“默认折叠”
- 它不破坏现有后端连接判定链路，风险显著低于删除日志逻辑
- 它只改变 UI 装配时机，改动集中，容易验证
- 错误发生后继续保留日志面板，能兼顾诊断效率与常态界面简洁度

## 备选方案与取舍

### 方案 A：按失败懒挂载日志面板（采用）

- 启动时创建日志组件，但不挂到主界面
- 错误发生时再挂到 `BorderLayout.SOUTH`
- 显示后保持可见

优点：

- 满足“平时完全不可见”
- 保留现有日志组件与缓冲逻辑
- 实现复杂度适中

缺点：

- 需要把当前 `showError()` 和面板装配逻辑做一次小重构

### 方案 B：保留现状，只是默认折叠

- 继续像现在一样始终挂载日志面板
- 依赖折叠态降低存在感

优点：

- 改动最少

缺点：

- 不满足“界面上看不到它”
- 标题栏仍然长期占用界面空间

### 方案 C：错误时用独立弹窗或对话框显示日志

- 主界面永远不出现日志区域
- 错误时弹出单独窗口展示日志

优点：

- 主界面最干净

缺点：

- 交互更重，排查链路更打断
- 偏离当前工具窗口内展示错误信息的模式
- 改动范围更大，不适合作为本次最小修复

## 设计细节

### UI 装配策略

当前实现会在工具窗口初始化时立即执行：

- 创建 `logArea` / `logScroll` / `logsPanel`
- 创建 `hideableLogs`
- `mainPanel.add(hideableLogs, BorderLayout.SOUTH)`

本次改为：

- 仍然创建这些组件，保证日志缓冲与后续展示复用现有对象
- 但初始化阶段**不**把 `hideableLogs` 挂到 `mainPanel`
- 只有在错误路径中，才统一调用一个“确保日志面板已显示”的辅助逻辑，把它插入到底部

这意味着“组件存在”和“组件已显示”两个概念要显式分离，避免现在这种“只要创建就立刻可见”的耦合。

### 错误展示策略

当前 `showError(mainPanel, hideableLogs, message)` 默认会把错误内容放到中心区，再把日志面板放到底部。

本次建议把它收敛成更明确的职责：

1. 负责清空并重建错误中心内容
2. 调用统一的日志面板显示逻辑
3. 保证日志面板显示后继续保留

这样可以让以下错误场景行为一致：

- backend 启动失败
- backend 连接超时
- browser 创建失败
- backend 输出读取异常 / 通信错误

这些场景已经都集中在 `ChatToolWindowFactory` 内触发错误 UI，因此无需扩散到其他类。

### 成功路径行为

成功路径保持现有核心逻辑不变：

- 后台读取 `proc.inputStream`
- 继续匹配 `opencode server listening on ...`
- 成功后建立 `JBCefBrowser`
- 把 browser 作为中心内容加载 `/app`

唯一变化是：

- 成功路径不再把日志面板加入界面

因此正常使用时，用户只会看到：

- 初始的 `Starting backend...`
- 然后切换到正常 Web UI

不会再看到底部日志标题栏。

### 日志数据流保持不变

本次不改动以下机制：

- `BackendLauncher.launchBackend(project)` 启动后端
- `TerminalBackendProcess` / `RunningTerminalBackendProcess` 暴露 `inputStream`
- `TerminalOutputCapture` 从 terminal 收集输出并写入 `PipedOutputStream`
- `ChatToolWindowFactory` 通过 `BufferedReader` 消费日志
- `queueLog()` / `scheduleLogFlush()` 把日志写入 `logArea`

保留这条链路的原因是：

- 它不仅用于给用户看日志
- 还用于从日志中解析 server 地址，属于当前连接建立链路的一部分

因此本次明确只做“显示时机解耦”，不做“日志来源重构”。

### 显示后的保留语义

用户已确认：错误发生后，日志区域应该“显示后保留”。

因此一旦某次错误触发日志面板显示：

- 后续即使界面还会刷新错误内容，也继续保留日志区域
- 本次不引入“恢复成功后再次自动隐藏”的回退逻辑

这样能避免用户正在阅读日志时，面板又被程序自动移除。

### 状态边界

本次需要明确两个 UI 状态：

1. **日志已创建但未显示**
   - 正常启动阶段默认状态
   - 日志仍在后台持续写入 `logArea`

2. **日志已显示且保留**
   - 首次错误发生后进入
   - 日志区域加入 `mainPanel` 底部
   - 当前会话生命周期内不再自动移除

这可以通过一个简单布尔状态或“检查组件是否已挂载”来实现；具体写法属于实现细节，但目标是避免重复 add 和布局抖动。

## 文件改动清单

### 主修改

- `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/ChatToolWindowFactory.kt`

### 预期不修改

- `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/backendprocess/BackendLauncher.kt`
- `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/backendprocess/TerminalBackendProcess.kt`
- `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/backendprocess/RunningTerminalBackendProcess.kt`
- `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/backendprocess/TerminalOutputCapture.kt`

除非实现时发现必须抽辅助方法，否则应尽量把改动集中在工具窗口 UI 层。

## 测试

本次以 JetBrains 插件层的行为验证为主。

### 1. 正常启动路径不显示日志面板

至少覆盖：

1. 初始状态只有 `Starting backend...` 占位内容
2. 成功加载 browser 后，主界面不包含日志面板
3. 后端连接逻辑不受影响

### 2. 启动失败时自动显示日志面板

至少覆盖：

1. `BackendLauncher.launchBackend(project)` 抛错或连接超时
2. 中心区显示错误文案
3. 日志面板被加入到底部

### 3. 运行期错误时自动显示日志面板

至少覆盖：

1. browser 创建失败或日志读取异常
2. 日志面板同样出现
3. 错误场景之间行为一致

### 4. 显示后保留

至少覆盖：

1. 错误触发后日志面板出现
2. 后续重复调用错误展示逻辑不会重复插入组件
3. 日志区域内容继续可滚动查看

如果当前 JetBrains 插件测试基础不方便直接做完整 Swing 组件断言，也可以先将“是否显示日志面板”的判定提炼为可测的小逻辑，再配合手动验证补足 UI 结果。

## 风险与兼容性

### 风险

- 若重构 `showError()` 时误清掉日志组件引用，可能导致错误时无法展示已采集日志
- 若重复把同一组件 add 到容器，可能引入布局异常或不必要的 revalidate/repaint
- 若错误路径和成功路径的面板装配顺序处理不当，可能导致 browser 区域被错误覆盖

### 降低风险的方式

- 把“显示日志面板”收敛成单独辅助逻辑，避免在多个 catch / timeout 分支各自拼装 UI
- 保留现有日志缓冲与 reader 逻辑，只改 `mainPanel` 的 add 时机
- 验证所有已存在的错误入口都走同一套 `showError + ensureLogsVisible` 路径

## 非目标

本次不处理：

- 给日志面板增加设置开关
- 在成功状态下提供“手动展开日志”入口
- 改日志标题文案或做国际化调整
- 替换通过日志解析 server 地址的现有连接方案
- 优化 `OPENCODE_SERVER_PASSWORD is not set` 这类后端输出内容本身
