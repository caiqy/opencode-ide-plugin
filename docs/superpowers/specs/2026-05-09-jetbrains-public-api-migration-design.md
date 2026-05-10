# JetBrains Public API Migration Design

## 背景

JetBrains Marketplace Verifier 已记录当前 JetBrains 插件存在 internal API 与 deprecated API 使用。JetBrains 文档要求第三方插件不得使用标记为 `@ApiStatus.Internal` 或 `@IntellijInternalApi` 的 API，因为这些 API 不保证兼容性，后续 IDE 版本可能重命名、变更或移除。

本次目标是按文档要求清理 JetBrains 内部 API 使用，并同步处理当前已知的低风险与终端相关 deprecated API。用户确认可以提高最低 IDE 版本，优先选择合规、稳定、可维护的实现。

## 目标

- 移除 `MarketplaceRequests` 及其相关反射调用。
- 移除 `PluginDownloader` 动态安装链路。
- 保留“检查最新版本”的用户价值：展示最新版本并提醒用户到 IDE 插件管理页面手动更新。
- 提供按钮打开 JetBrains IDE 的 Plugins 设置页，尽可能帮助用户直达插件管理入口。
- 替换 `HideableTitledPanel`。
- 将终端创建逻辑迁移到 JetBrains 推荐的新 Terminal tab API，并提高最低 IDE 版本以避免旧 API fallback。
- 更新测试，保证更新查询、手动更新提示、日志面板和后端启动行为不退化。

## 非目标

- 不在插件内下载或安装 Marketplace 更新。
- 不继续兼容 `sinceBuild=243`。
- 不引入对 JetBrains internal API 的反射调用作为 fallback。
- 不重做 WebGUI 更新 UI 的整体设计，仅调整现有更新入口返回的数据与操作。

## 方案

### 1. 更新检查改为公开 Marketplace 查询 + 手动更新入口

`PluginUpdateService` 不再依赖 IntelliJ 平台内部的 Marketplace 客户端。服务改为使用 Marketplace 公开接口获取版本信息，并用现有 `VersionComparatorUtil` 与当前安装版本比较。

公开查询优先使用 JetBrains 文档列出的 Marketplace HTTP 接口，并封装为可替换的 `MarketplaceVersionSource`。实现优先读取插件公开详情与更新详情接口中的 `version` 字段；如果接口只返回 XML，则只解析本插件条目中的版本字段。若查询失败、插件尚未公开、返回为空或格式变化，服务返回明确的降级结果：不能确认最新版本，但用户仍可打开 Plugins 设置页手动检查。

更新状态语义调整为：

- `supported=true` 表示支持检查最新版本与打开手动更新入口。
- `hasUpdate=true` 时包含 `latest.version`。
- 原来的 `prepareInstall` 自动安装语义改为“准备手动更新”：不再下载或安装插件，而是向 WebGUI 发出可展示事件，由按钮触发“打开插件管理页面”的 IDE Bridge 动作。
- 无法查询时不打断用户，返回可展示的原因与手动检查建议。

### 2. 打开 Plugins 设置页

新增一个小的 JetBrains 设置页打开器，封装公开 Settings API。按钮点击后优先打开 IDE 的 Plugins 设置页；如果当前平台支持定位到指定插件，则定位到 OpenCode UI；否则打开 Plugins 页面并让用户搜索或点击更新。

这层封装使 `IdeBridge` 或更新事件处理不直接依赖设置页实现细节，也便于单元测试中替换为 spy/stub。

### 3. 日志面板替换 deprecated UI 组件

`ChatToolWindowFactory` 使用普通 Swing 组件替代 `HideableTitledPanel`：

- 外层 `JPanel(BorderLayout())`。
- 顶部标题 `JLabel("Backend logs (merged stdout/stderr)")`。
- 中部保留 `JScrollPane(logArea)`。
- `BackendLogsVisibilityController` 继续只负责在出错时将日志面板加入 `BorderLayout.SOUTH`。

这样可以保留当前错误时展开日志的行为，同时清理 deprecated API。

### 4. Terminal API 迁移

提高 `build.gradle.kts` 中的 IntelliJ Platform 编译目标和 `sinceBuild`，使代码可直接使用 JetBrains 推荐的新版 Terminal tab API。

`BackendLauncher` 将终端创建职责收敛到一个适配函数：

- 使用 `TerminalToolWindowTabsManager.getInstance(project).createTabBuilder()` 创建 tab。
- 设置工作目录、tab 名称和命令。
- 保持当前行为：后端运行在 “Opencode Backend” tab；若用户原本没有打开 Terminal，则启动后隐藏；若用户原本选中了其他终端 tab，则启动后恢复选中。
- 删除对 `TerminalToolWindowManager.createShellWidget(...)` 的直接调用。

如果新 Terminal API 返回的对象不再是 `ShellTerminalWidget`，需要同步调整 `RunningTerminalBackendProcess` 与日志捕获策略。优先使用新版 API 提供的命令启动方式，避免依赖旧 widget 的 `executeCommand(...)`。日志捕获应继续以用户可诊断为目标：能捕获则捕获，不能捕获时在 UI 中给出清晰错误，避免后台静默失败。

## 数据流

1. WebGUI 通过 IDE Bridge 请求更新信息。
2. JetBrains 端读取当前插件版本。
3. JetBrains 端调用 Marketplace 公开接口获取最新版本。
4. 若发现新版本，返回 `latest.version` 与 `hasUpdate=true`。
5. WebGUI 展示最新版本和“打开插件管理”按钮。
6. 用户点击按钮后，IDE Bridge 调用 JetBrains 设置页打开器，打开 Plugins 设置页。

## 错误处理

- Marketplace 查询失败：返回手动检查建议，不抛出到 UI 顶层。
- Marketplace 返回空：视为无法确认更新，不误报“已是最新”。
- 设置页打开失败：向 WebGUI 返回错误事件，并提示用户手动打开 `Settings | Plugins`。
- Terminal tab 创建失败：保留现有后端启动错误视图并展开后端日志面板。
- 日志捕获不可用：显示启动诊断信息，不影响错误视图渲染。

## 测试计划

- `PluginUpdateServiceTest`
  - 当前版本低于公开查询版本时返回 `hasUpdate=true` 和最新版本。
  - 当前版本不低于公开查询版本时返回无更新。
  - 查询失败时返回可手动检查的降级结果。
  - 自动安装入口不再调用下载或安装逻辑。
- 设置页打开器测试
  - 点击手动更新入口时调用公开 Settings API 封装。
  - 打开失败时返回可展示错误。
- UI/桥接测试
  - WebGUI 能显示最新版本。
  - “打开插件管理”按钮触发 IDE Bridge 消息。
- JetBrains 构建验证
  - `./gradlew unitTest`
  - `./gradlew build`
  - `./gradlew verifyPlugin`

## 风险与缓解

- Marketplace 公开接口返回格式与兼容性过滤有限：把查询结果当作“提示信息”，真正安装仍交给 IDE Plugins 页面完成。
- 提高最低 IDE 版本会影响旧用户：这是用户确认过的取舍，以清理 deprecated Terminal API 并降低长期维护成本。
- 新 Terminal API 可能改变日志捕获方式：实现时优先保持后端启动成功；日志捕获作为诊断增强，失败时必须有清晰提示。
- Plugins 设置页定位能力可能随 IDE 版本变化：封装为最佳努力；最低保证打开 Plugins 页面。

## 验收标准

- 源码中不再引用 `MarketplaceRequests`。
- 源码中不再引用 `PluginDownloader`。
- 源码中不再引用 `HideableTitledPanel`。
- 源码中不再直接调用 `TerminalToolWindowManager.createShellWidget(...)`。
- 更新入口能展示最新版本，或在无法查询时提示用户手动检查。
- 用户可以通过按钮打开 IDE Plugins 设置页。
- JetBrains 插件单元测试、构建和 Plugin Verifier 通过。
