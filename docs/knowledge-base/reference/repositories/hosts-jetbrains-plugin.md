# 仓库参考：hosts/jetbrains-plugin（JetBrains 宿主插件）

## 定位

JetBrains 插件在 Tool Window 中通过 JCEF 加载 `/app`，不只是浏览器包装。它负责 tool window、terminal-backed backend launch、bridge server、上下文 action、设置、backend logs、更新流、插件打包，以及 JetBrains 原生拖拽到 WebGUI。

IDE bridge 协议的业务说明见 [IDE Bridge](../business/ide-bridge.md)，宿主启动与重启可参考 [backend launch](../business/backend-launch.md) 和 [host restart](../business/host-restart.md)。

## 技术栈

- Kotlin 1.9.23，JVM 21，IntelliJ Platform SDK 2024.3+
- 构建：Gradle Wrapper + `org.jetbrains.intellij.platform`（Gradle 插件 2.2.1）
- 序列化：Jackson 2.17.1
- 测试：JUnit 5.10.0 + Mockito 5.5.0

## 身份标识（`META-INF/plugin.xml`）

- `id`: `caiqy.opencode-ui`（旧 `qtkj.opencode-ui` 仅作历史迁移标识，不应出现在运行时代码/更新查询中）
- `name`: `OpenCode UI (unofficial)`，`vendor`: `Caiqy`
- 依赖：`com.intellij.modules.platform`、`org.jetbrains.plugins.terminal`
- 版本按「版本规则」`YY.M.DDNN`，打包时通过 `-Pplugin.version=<版本号>` 传入

## 目录结构 `src/main/kotlin/paviko/opencode/`

| 目录              | 关键文件                                                                                                                                                                                                                                                  | 职责                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `ui/`             | `ChatToolWindowFactory.kt`、`IdeBridge.kt`、`IdeBridgeStorageBackend.kt`、`IdeOpenFilesUpdater.kt`、`DragAndDropInstaller.kt`、`PathInserter.kt`、`BackendLogsErrorView.kt`、`BackendLogsVisibilityController.kt`、`OpenPluginSettings.kt`、`ConnInfo.kt` | 工具窗口、bridge、存储后端、打开文件同步、拖拽、日志懒显示 |
| `backendprocess/` | `BackendLauncher.kt`、`BackendProcess.kt`、`TerminalBackendProcess.kt`、`RunningTerminalBackendProcess.kt`、`TerminalOutputCapture.kt`                                                                                                                    | 后端进程抽象、终端输出捕获、连接地址发现                   |
| `actions/`        | `EditorAddToContextAction.kt`、`EditorAddLinesToContextAction.kt`、`ProjectAddToContextAction.kt`、`ProjectPastePathAction.kt`                                                                                                                            | 编辑器/项目视图右键菜单                                    |
| `settings/`       | `OpenCodeConfigurable.kt`、`OpenCodeSettings.kt`                                                                                                                                                                                                          | 设置页（Tools → OpenCode Plugin）、持久化配置服务          |
| `update/`         | `MarketplaceVersionSource.kt`、`PluginUpdateService.kt`、`PluginUpdateModels.kt`、`PluginVersion.kt`                                                                                                                                                      | Marketplace 版本查询、更新服务                             |
| `util/`           | `ResourceExtractor.kt`                                                                                                                                                                                                                                    | 解压内嵌 backend binary                                    |
| （根）            | `PluginIdentity.kt`                                                                                                                                                                                                                                       | 插件 ID 常量                                               |

## `plugin.xml` 契约

- **4 个 `<action>`**：`ProjectAddToContextAction`、`ProjectPastePathAction`、`EditorAddToContextAction`、`EditorAddLinesToContextAction`
- **6 个 `<keyboard-shortcut>`**（分布在两个 editor action 上，各 3 条：$default / Mac OS X / Mac OS X 10.5+）
- `EditorAddToContextAction`：`ctrl COMMA` / `meta BACK_SLASH` ×2
- `EditorAddLinesToContextAction`：`ctrl shift COMMA` / `meta shift BACK_SLASH` ×2
- extensions：`toolWindow`（id `OpenCode`，anchor right）、`applicationConfigurable`（parentId tools）、`applicationService`（`OpenCodeSettings`）

> 新增右键菜单须同步 `actions/` 下 Kotlin 实现和 `plugin.xml` 的 `<action>` 声明。

## 特有约定

- 后端通过 JetBrains Terminal 插件启动，不直接起独立控制台进程
- backend binary 优先级：`OPENCODE_BIN` 环境变量 > 插件内嵌 binary > 系统 PATH 中的 `opencode`
- 连接建立依赖后端输出中的 `opencode server listening on <url>` 文本；日志采集链路同时承担连接地址发现职责
- backend logs 懒显示：正常运行不可见，仅在启动失败/连接超时/browser 创建失败/通信异常时 reveal
- 存储后端：`global`→`PropertiesComponent`，`workspace`→`PropertiesComponent(project)`，`mem`→`Session.mem`
- 重启：`ApplicationManager.getApplication().restart()`，`restartMode = "ide"`
- `minVersion` 链路：`build.gradle.kts → processResources → opencode-build.properties → IdeBridge.kt`
- URL 可附加 `jcefScrollMultiplier` 调节滚动灵敏度
- 更新：仅用 public Marketplace release 查询；newer release 返回 `manualUpdate=true` 由用户在 Plugins 页面手动更新；空 Marketplace 结果必须清理 cached update

## IDE Bridge 消息清单

传输模型：Host 在 `127.0.0.1:0` 启动 HTTP server；WebGUI 通过 `POST /idebridge/{sessionId}/send?token=<token>` 发请求，Host 通过 `GET /idebridge/{sessionId}/events?token=<token>` 用 SSE 推送事件。鉴权依赖 `sessionId + token`，Host 每 15 秒发送 SSE 注释 ping 保活。协议字段、connected 元数据和 WebGUI 消费点见 [IDE Bridge](../business/ide-bridge.md)。

两端共同支持的 UI → Host 请求：

- `openFile`：在 IDE 中打开文件，支持行号/范围
- `openUrl`：用宿主打开外部 URL
- `reloadPath`：文件写入后刷新 IDE 文件系统视图
- `clipboardWrite`：写系统剪贴板
- `saveImage`：保存 data URL、remote URL 或 generated-image relative URL；取消返回 `{ cancelled: true }`
- `restartHost`：重启 JetBrains IDE
- `ensureAndOpenFile`：确保文件存在并打开
- `storageGet` / `storageSet`：读写 `global | workspace | mem` scoped storage
- `getExtensionVersion`：返回宿主插件真实版本
- `setProjectDirectory`：切换项目目录
- `showDiagnostics`：显示诊断面板
- 更新请求：`getUpdateInfo`、`checkForUpdates`、`installUpdate`

JetBrains 差异：

- `installUpdate` 不执行静默安装；Marketplace 安装版打开 Plugins 页面由用户手动更新
- 本地 ZIP / 开发版更新返回 `unsupported` 或仅支持手动检查提示
- 空 Marketplace 结果视为当前没有可安装更新，不能保留旧 cached update
- JetBrains 不支持 VSCode 的 Remote-SSH/tunnel external URI 语义

Host → UI 推送：

- `insertPaths`：将文件路径插入输入框
- `pastePath`：插入目录路径
- `updateOpenedFiles`：同步 IDE 当前打开文件与当前文件
- 更新事件：`updateAvailable`、`downloading`、`installing`、`success`、`error`

## 测试分层

- `src/unitTest/kotlin/`：轻量 JVM 测试（JUnit/Mockito/Kotlin stdlib/Swing/AWT，mock 轻量接口）
- `src/test/kotlin/`：IntelliJ Platform `TestIdeTask`（真实 sandbox/ApplicationManager/ToolWindow/JCEF/VFS）

## 构建与验证

工作目录 `hosts/jetbrains-plugin`（Windows 所有命令追加 `--no-daemon --console=plain`）：

```powershell
./gradlew.bat unitTest --no-daemon --console=plain
./gradlew.bat build --no-daemon --console=plain
./gradlew.bat buildPlugin "-Pplugin.version=<版本号>" --no-daemon --console=plain
```

> daemon 卡住或文件锁：先 `./gradlew.bat --stop`。`-P...=...` 参数必须加引号。见 `memory/context/gradle.md`。

## 发布

- 共享真源在 `docs/release-content/`：`manifest.json`、`description.shared.md`、`README.shared.md`、`CHANGELOG.md`
- 通过 `script/release-content.ts` / `script/release-content-sync.ts` 同步发布内容；平台目录 README / description / changelog 是生成产物，不手工维护
- Marketplace 组合包：从既有平台产物提取 backend binary，重新构建并签名 Marketplace 专用包
- build/sign/publish Gradle 命令必须注入 `-Pdistribution.channel="marketplace"` 并保留元数据校验
- 当前组合包含 3 个 binary：Windows x64、macOS ARM64、Linux x64
