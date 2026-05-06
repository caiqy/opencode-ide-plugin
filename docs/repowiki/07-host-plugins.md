# VSCode 与 JetBrains 宿主插件

VSCode 与 JetBrains 插件负责把 opencode 后端和 WebGUI 连接到 IDE 中。它们不是简单 iframe 包装，还提供启动、桥接、文件上下文、拖拽、持久化、更新、重启等宿主能力。

## VSCode 插件

关键文件：

- `hosts/vscode-plugin/src/extension.ts`
- `hosts/vscode-plugin/src/backend/BackendLauncher.ts`
- `hosts/vscode-plugin/src/ui/WebviewController.ts`
- `hosts/vscode-plugin/src/ui/WebviewManager.ts`
- `hosts/vscode-plugin/src/ui/ActivityBarProvider.ts`
- `hosts/vscode-plugin/src/ui/CommunicationBridge.ts`
- `hosts/vscode-plugin/src/ui/IdeBridgeServer.ts`

职责：

- 启动或连接 opencode 后端。
- 在 editor panel 或 activity bar view 中承载 WebGUI。
- 通过 `asExternalUri()` 兼容 Remote-SSH/tunnel。
- 动态生成 webview HTML 与 CSP。
- 创建 IDE bridge session，并把 session 参数注入 `/app` URL。
- 处理文件打开、URL 打开、剪贴板、reloadPath、storage、更新、重启。

VSCode 稳定性补丁：

- Service Worker InvalidState 双层 retry。
- webview dispose/recreate 竞态保护。
- 动态 CSP origin 拼接。
- panel 与 activity bar 共用 `WebviewController`，减少协议分叉。

### VSCode 本地开发入口约定

关键文件：

- `.vscode/launch.json`
- `.vscode/launch.example.json`

本仓库在 VSCode 中长期区分两类本地开发入口：

- `WebGUI: dev`：只启动 WebGUI 的 Vite dev server。
- `Backend: source web 4300`：只以源码方式启动 opencode backend。

维护约束：

- 两个入口职责分离，不自动互相带起。
- backend 调试入口固定使用开发端口 `4300`，避免与维护者常用的默认 `4096` 冲突。
- 本地开发应优先运行当前工作区源码，而不是历史构建产物或全局安装二进制。

## JetBrains 插件

关键文件：

- `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/ChatToolWindowFactory.kt`
- `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/backendprocess/BackendLauncher.kt`
- `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt`
- `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridgeStorageBackend.kt`
- `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeOpenFilesUpdater.kt`
- `hosts/jetbrains-plugin/src/main/resources/META-INF/plugin.xml`

职责：

- 在 Tool Window 中通过 JCEF 加载 `/app`。
- 创建 IDE bridge session。
- 处理文件打开、URL 打开、剪贴板、reloadPath、storage、重启。
- 通过 `PropertiesComponent` 实现 global/workspace 存储。
- 监听打开文件变化并推送 `updateOpenedFiles`。
- 处理 JetBrains 原生拖拽，向 WebGUI 推送 `insertPaths` / `pastePath`。
- 后端通过 JetBrains Terminal 插件启动，而不是直接起独立控制台进程。
- backend binary 选择优先级为：`OPENCODE_BIN` 环境变量 > 插件内嵌 binary > 系统 PATH 中的 `opencode`。

### JetBrains backend 连接建立依赖

- 连接建立当前依赖后端输出中包含 `opencode server listening on <url>` 文本。
- 日志链路除了诊断，还承担连接地址发现职责；如果上游修改启动日志文案或输出格式，JetBrains 可能无法连上 `/app`。

### JetBrains backend 日志懒显示

关键文件：

- `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/ChatToolWindowFactory.kt`
- `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/backendprocess/BackendLauncher.kt`
- `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/backendprocess/TerminalOutputCapture.kt`

JetBrains 工具窗口中的 backend logs 面板采用“懒显示”规则：

- 正常启动和正常运行时，日志区应完全不可见。
- 启动失败、连接超时、browser 创建失败或后端通信异常时，才 reveal 日志面板。
- 一旦 reveal，在当前工具窗口生命周期内保留，不自动隐藏。

这里只改 **UI 暴露时机**，不改日志采集机制；当前仍依赖后端输出中的监听地址建立 JCEF 连接。

### JetBrains 测试分层约定

JetBrains 宿主测试长期分成两层：

- `unitTest`：普通 JVM `Test` 任务，**优先承载轻量测试**
- `test`：IntelliJ Platform Gradle Plugin 的 `TestIdeTask`，只承载真实 IDE sandbox / 平台集成测试

目录约定：

- `hosts/jetbrains-plugin/src/unitTest/kotlin/`：轻量测试
- `hosts/jetbrains-plugin/src/test/kotlin/`：重型集成测试

放入 `unitTest` 的典型条件：

- 只依赖 JUnit / Mockito / Kotlin 标准库
- 只依赖 Swing / AWT 组件
- 被测对象是纯 Kotlin / 纯 JVM 逻辑类
- 通过构造注入、lambda 注入或 mock 就能隔离外部依赖
- 只 mock `Project` 等轻量接口，不需要真实 IDE 生命周期

必须保留在 `test` 的典型条件：

- 依赖 IntelliJ sandbox 初始化
- 需要真实 `ApplicationManager` 行为
- 需要真实 ToolWindow / JCEF / browser 创建流程
- 需要真实 IntelliJ 平台服务、扩展点、VFS 或 editor 打开流程

常用命令：

- 轻量测试：`./gradlew[.bat] unitTest --tests "<FullyQualifiedTestClass>"`
- 重型集成测试：`./gradlew[.bat] test --tests "<FullyQualifiedTestClass>"`

维护约束：

- 新增 JetBrains 测试时，先判断依赖边界，再决定放入 `unitTest` 或 `test`
- 不再为了“一条命令跑完”把明显轻量测试塞回 `test`
- 混合验证场景应拆成 `unitTest` 与 `test` 两条命令

## 发布内容与 Marketplace

关键文件：

- `docs/release-content/manifest.json`
- `docs/release-content/description.shared.md`
- `docs/release-content/README.shared.md`
- `docs/release-content/CHANGELOG.md`
- `script/release-content.ts`
- `script/release-content-sync.ts`
- `.github/workflows/release.yml`
- `hosts/vscode-plugin/package.json`
- `hosts/jetbrains-plugin/build.gradle.kts`

双宿主插件的发布内容共享单一内容源，避免 VSCode / JetBrains 的 README、描述和 changelog 漂移。

长期约定：

- 共享真源位于 `docs/release-content/`。
- 平台目录中的 README / description / changelog 更接近生成产物，不应作为长期手工维护真源。
- 共享 release-content 真源统一使用 `OpenCode UI (unofficial)` 及其“非官方”语义；JetBrains `plugin.xml` 中的插件显示名也已对齐为英文。

`release.yml` 的职责边界：

- `push` 到 `v*` tag 是唯一自动发版入口；手动触发继续保留。
- tag 名带 `-` 视为 prerelease。
- `build-vscode` 只负责构建 5 个平台定向 `.vsix`。
- `build-jetbrains` 只负责构建 JetBrains 插件产物。
- GitHub Release 与 VSCode Marketplace 只消费已有 artifact；JetBrains Marketplace 会从既有平台产物中提取 backend binary，再重新构建并签名一个 Marketplace 专用组合包。

Marketplace 规则：

- VSCode 只发 Visual Studio Marketplace，不发 Open VSX。
- VSCode 继续发布 5 个平台定向包，不引入通用 fallback 包。
- VSCode 对外 Unique Identifier 为 `caiqy.opencode-ui`（`publisher/name`）。
- JetBrains 当前技术插件 ID 也使用 `caiqy.opencode-ui`；旧 `qtkj.opencode-ui` 只作为历史迁移标识保留，不应再出现在运行时代码或更新查询中。
- JetBrains Marketplace 额外发布一个组合包：先从既有平台插件产物中提取 backend binary，再重新构建并签名一个 Marketplace 专用插件包。
- JetBrains Marketplace build/sign/publish 的 Gradle 命令都必须注入 `-Pdistribution.channel="marketplace"`，并保留产物内 `distribution.channel=marketplace` 元数据校验。
- 当前 JetBrains Marketplace 组合包只包含 3 个 binary：Windows x64、macOS ARM64、Linux x64。
- 任一 Marketplace job 失败时，整个 Release workflow 应失败；但 GitHub Release 可能已先创建，这是允许的流程结果，不做自动回滚。

## 双端差异

| 能力          | VSCode                           | JetBrains                           |
| ------------- | -------------------------------- | ----------------------------------- |
| UI 容器       | Webview iframe                   | JCEF browser                        |
| bridge server | Node `http.createServer`         | `com.sun.net.httpserver.HttpServer` |
| Remote 支持   | `asExternalUri()`                | 本地 IDE 语义                       |
| 存储          | `globalState/workspaceState/Map` | `PropertiesComponent/Session.mem`   |
| 重启          | reload window                    | restart IDE                         |
| 更新          | 支持 GitHub Release `.vsix` 更新 | JetBrains Marketplace 安装版支持站内更新；本地 ZIP / 开发版返回 `unsupported` |
| 打开文件列表  | `FileMonitor`                    | `IdeOpenFilesUpdater`               |

## URL 注入

宿主加载 WebGUI 时会在 `/app` URL 上附加：

- `ideBridge`
- `ideBridgeToken`

VSCode 还会处理：

- `mode`
- cache buster，例如插件版本。
- external URI tunnel。

JetBrains 可能附加：

- `jcefScrollMultiplier`

JetBrains 还会在 IDE bridge 的 `connected` 事件里下发 `minVersion`；该值来自 `build.gradle.kts -> processResources -> opencode-build.properties -> IdeBridge.kt` 这条链路。

## 维护注意点

- WebGUI 新增宿主能力时，必须明确 VSCode 和 JetBrains 是否都支持。
- `getUpdateInfo` / `checkForUpdates` / `installUpdate` 现已由 VSCode 与 JetBrains 共同支持，但 JetBrains 只对 Marketplace 安装版开放站内更新。
- 不要删除 VSCode 的 SW/CSP/Remote 兼容代码；这些看似“包装细节”，实际是插件可用性的关键。
- 调整 JetBrains backend 启动 UI 时，不要把“日志面板懒显示”改回默认常驻，也不要移除监听地址解析所需的日志采集链路。
- JetBrains 站内更新只对 Marketplace 包生效；调整构建链路时不要移除 `distribution.channel=marketplace` 注入。
- 调整 JetBrains 发布或更新逻辑时，不要把运行时 plugin ID 改回 `qtkj.opencode-ui`；若需提及旧 ID，只能放在迁移说明中。
- 修改发布流程时，要同时检查共享内容真源、release workflow 职责边界，以及 VSCode / JetBrains Marketplace 是否仍消费已有 artifact。
