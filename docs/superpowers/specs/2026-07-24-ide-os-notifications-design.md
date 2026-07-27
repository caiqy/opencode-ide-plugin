# IDE 操作系统通知纠偏设计

## 目标

WebGUI 仅在 VS Code 与 JetBrains 插件内运行时，对 Agent 完成、权限请求和等待用户回答的提问发送操作系统桌面通知。普通网页不通知。点击通知后聚焦对应 IDE、打开 OpenCode 面板，并切换到触发通知的会话。

当前 `showInformationMessage` 与 JetBrains `NotificationGroup` 只产生 IDE 内通知，必须移除，且不得作为系统通知失败时的降级路径。

## 参考行为

Paseo 在 Electron 主进程使用 `Notification`：校验非空标题与正文、显示带应用图标的静音系统通知、持有活动通知对象，并在点击后聚焦窗口和把通知数据回传 renderer。本实现保持相同的宿主所有权、尽力而为和点击回传语义。

## 架构

WebGUI 继续负责从 `session.status`、`permission.asked` 与 `question.asked` 派生通知，并保留现有去重、前台抑制、正文裁剪和易失投递语义。Bridge 消息为 `showSystemNotification`，payload 至少包含 `sessionID`、`title` 和 `body`。

提问通知在首次收到 request ID 时发送，标题为 `Agent has a question`，正文取第一道问题文本；文本为空时使用 `Answer required.`，并沿用 220 字裁剪。重复 `question.asked` 只更新提问卡片，不重复通知；`question.replied`、`question.rejected` 与 `session.deleted` 释放通知去重 ID。当前会话可见且窗口有焦点时与完成/权限通知一样抑制系统通知。`sdk.question.list()` 重连 hydration 只恢复 UI，Bridge 未 ready 时也不迟到补发。

VS Code 宿主在 macOS、Linux 使用 `node-notifier`，Windows 使用随扩展发布的修改版 SnoreToast。通知点击通过扩展命令或 URI handler 聚焦 VS Code、打开 OpenCode 面板，并向对应 WebGUI bridge session 发送 `openSession` 事件。

Windows Toast 使用基于 SnoreToast `v0.7.0` 的 OpenCodeUI x64 二进制。`-install` 确保 `caiqy.opencode-ui` AppUserModelID 与 `OpenCodeUI\\OpenCodeUI.lnk` Start Menu 快捷方式存在；已有快捷方式不再按通知删除重建。快捷方式目标为当前 `Code.exe`，因此顶部显示 `OpenCodeUI` 与 VS Code 小图标；正文继续显示扩展 `resources/icon.png`。扩展直接调用同一二进制，并通过新增的 `-protocol <relay-uri>` 把 relay URI 写入 Toast 根节点的 `launch`，同时设置 `activationType="protocol"`。历史 Toast 的点击不依赖通知进程、named pipe 或 COM activator。VS Code 没有扩展卸载回调，卸载后该快捷方式保留并由用户手动删除。

Windows 通知通过 SnoreToast 已有的 `-pid` 参数传入 `process.ppid`。本地 Extension Host 由 VS Code 主进程直接创建，因此该 PID 对应最终执行 Electron `BrowserWindow.focus()` 的进程。修改版 SnoreToast 在没有显式 `-appID` 时保留 `-pid` 原有的 AppUserModelID 查询语义；同时提供两者时必须保持显式 `caiqy.opencode-ui` 身份。通知进程仍存活时，`ToastEventHandler::Invoke` 在 protocol 激活前定向调用 `AllowSetForegroundWindow(pid)`；进程退出后，Action Center 点击由 Windows 作为用户发起的 protocol 激活直接打开 relay URI，不依赖后台进程再次授权。

通知创建前通过 `vscode.env.asExternalUri(...)` 把 URI 绑定到产生通知的窗口；SnoreToast 只把该 relay URI 交给 Windows protocol 激活，由 VS Code 使用 `windowId` 选择并前置来源窗口，再打开 OpenCode 面板并切换会话。不得使用 `ASFW_ANY`、PowerShell、Win32 窗口枚举、窗口标题匹配或其他窗口启发式。

SnoreToast 进程会在弹窗超时或用户操作后退出；进程寿命不是通知有效期。弹窗期点击可同时进入 `ToastEventHandler::Invoke` 并由 Windows 打开 protocol URI，进程退出后从 Action Center 点击仍由 Windows 打开同一 URI。两条路径必须使用同一 relay，不得回退到 named pipe 或 COM activator。

修改版 SnoreToast 的对应源码、LGPL 许可证和可复现 Windows 构建脚本保存在 `hosts/vscode-plugin/native/snoretoast`。构建使用现有 Visual Studio 2017 Build Tools、CMake 和静态 MSVC runtime，不增加运行时依赖；产物与第三方许可说明放在 `hosts/vscode-plugin/resources/windows`。本发布仍只构建 Windows x64 VSIX。

JetBrains 宿主使用标准库 `SystemTray`/`TrayIcon` 显示系统通知并接收点击事件。点击后前置项目窗口、打开 OpenCode Tool Window，并向对应 bridge session 发送相同的 `openSession` 事件。`SystemTray` 不可用时记录并无操作，不得显示 `NotificationGroup` IDE 气泡。

WebGUI 收到 `openSession` 后复用现有会话切换路径。失效或已删除的 session 安全无操作。

## 错误处理

系统通知不可用、权限被拒绝、外部 notifier 缺失或发送失败时只记录日志并返回 bridge 错误或无操作，不改变会话、权限、提问和消息状态，也不降级为 IDE 内通知。通知仍是易失事件，不排队、不重试。

Windows AppUserModelID 快捷方式注册或 `asExternalUri` 解析失败时同样只记录并跳过该通知，不退回 SnoreToast 默认身份，也不打开其他 VS Code 窗口。

`AllowSetForegroundWindow` 失败时不得阻断 protocol 激活，保留 Windows 默认的用户激活或任务栏闪烁行为。原生失败写入 SnoreToast 调试日志；无效或已经退出的目标 PID 不触发 HWND 查找或全局前台授权。

## 验证

- WebGUI：完成、权限和提问 payload；request ID 去重；reply/reject/session delete 后释放；前台抑制；Bridge 未 ready 与 hydration 不迟到补发；`openSession` 路由及失效 session。
- VS Code：三平台 adapter 选择、OS notifier 参数、失败无降级、点击聚焦/打开面板/切换会话；Windows 不加载 `node-notifier` 点击回调。
- VS Code Windows：用修改版 SnoreToast 以 `-install` 确保 `caiqy.opencode-ui`、`OpenCodeUI\\OpenCodeUI.lnk` 和当前 `Code.exe` 已注册，不删除已有快捷方式；随后用相同 `appID`、`pid: process.ppid` 和 `-protocol` 发送 Toast，且 protocol 参数必须等于 `asExternalUri` 为来源窗口生成的 relay URI。
- SnoreToast：构建 x64 静态二进制并运行 `snoretoast-x64.exe -v` 健康检查；确认显式 `appID` 不被 `pid` 查询结果覆盖，`-protocol` 生成正确的 `launch` 与 `activationType="protocol"`，弹窗期用户激活只对指定 PID 执行 `AllowSetForegroundWindow(pid)`，dismiss、timeout 和失败事件不授权，Action Center 激活不依赖 COM 或 named pipe。
- JetBrains：系统通知映射、失败无 IDE 气泡、点击前置窗口/打开 Tool Window/切换会话。
- Windows 使用真实 `question.asked` 通知做端到端桌面测试：在两个 VS Code 窗口中分别验证弹窗期立即点击和弹窗消失后从 Action Center 点击；来源窗口被其他应用遮挡时，两条路径都必须前置准确窗口、不创建空白窗口，并打开 OpenCode、目标会话与待回答提问。重复验证最小化恢复。macOS/Linux 在平台 CI 或可用环境验证 adapter，并保留可运行的窄范围测试。

## 发布

已生成的 `26.7.2400` VSIX，以及 SHA-256 为 `EF8AB9C5E019D8FDBA06240A11F03DC69A134850647286E63CCE6EF39FBEF804`、`4B4F04F08F8347472AD7A8F026B0C74D892D58184DD828B1F970F2600151DEF4` 和 `4C81429BF618EFF5AF94A9A65127FD9632B6E223A840193701894A9A64D1BB84` 的中间 `26.7.2401` VSIX 作废。protocol 激活与提问通知完成并验证后保持两个版本 manifest 为 `26.7.2401`，重新打包 Windows x64 VSIX。
