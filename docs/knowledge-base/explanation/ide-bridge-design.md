本文回答：为什么 WebGUI 需要 IDE Bridge，以及 token + SSE + POST 的三端协议为什么这样设计。

# IDE Bridge 设计：把浏览器缺的宿主能力补回来

WebGUI 运行在浏览器、VSCode webview 或 JetBrains JCEF 中。

这些环境可以渲染 React，也可以访问同源 HTTP API，但不能自然拥有完整 IDE 权限。

打开项目文件、定位行号、刷新 IDE 文件系统视图、写系统剪贴板、保存图片到用户选择的位置、读取插件持久化状态，都不是普通网页可以稳定完成的事情。

IDE Bridge 的存在就是为了补齐这组宿主能力。

它不是 opencode backend API 的另一种写法。

opencode API 处理 session、message、config、provider、MCP 等后端领域能力。

IDE Bridge 处理“这个页面被 IDE 承载时，如何向宿主要能力”。

把两者分开，可以避免 WebGUI 组件把宿主细节混进业务 API 调用里。

当前传输模型由 Host 启动本地 HTTP server，监听 `127.0.0.1:0` 的临时端口。

每个 WebGUI 页面有独立 session id 和 token。

WebGUI 到 Host 使用 `POST /idebridge/{sessionId}/send?token=...`。

Host 到 WebGUI 使用 `GET /idebridge/{sessionId}/events?token=...` 的 SSE。

token 的作用是把 bridge 限定在 Host 创建的页面会话内。

临时端口减少固定端口冲突；session id 区分多个页面；token 防止同机其他进程随便复用 bridge URL。

SSE 适合 Host -> UI 的持续推送。

例如 `connected` 元数据、`insertPaths`、`pastePath`、`updateOpenedFiles`、更新下载/安装状态，都是 Host 主动告诉 UI 的事件。

POST 适合 UI -> Host 的命令式请求。

例如 `openFile`、`clipboardWrite`、`storageGet`、`storageSet`、`saveImage`、`restartHost`，都是 UI 发起并等待结果的动作。

这比双向 WebSocket 更窄，也更容易在 webview/JCEF 的限制下维护。

协议消息保留 `id`、`replyTo`、`type`、`payload`、`ok`、`error`、`result` 语义。

这让请求响应能跨异步 transport 对齐，也让三端共享同一套错误和结果模型。

SSE 建连后的 `connected` 事件还携带 `minVersion`、`restartMode`、`customApi` 等元数据。

WebGUI 用这些信息做版本门禁、重启按钮语义和能力判断。

三端职责因此很清楚。

WebGUI 负责声明“我要打开文件”“我要写剪贴板”“我要保存状态”，并处理 bridge 不存在时的浏览器降级。

VSCode 插件负责把这些请求映射到 VSCode API，比如 OutputChannel、webview、workspaceState/globalState、commands、externalUri 和更新安装流程。

JetBrains 插件负责把同样的协议映射到 Kotlin/JVM、JCEF、PropertiesComponent、ToolWindow、Marketplace 更新查询和 IDE action。

协议统一，不代表两端宿主实现完全相同。

VSCode 和 JetBrains 的生命周期、更新安装能力、远程开发模型、状态存储 API 都不同。

所以 Bridge 的共同层定义消息语义，各宿主只在自己能可靠完成的范围内实现。

这也是为什么 VSCode 往往先行，JetBrains 再补 parity。

项目的开发和验证路径通常先在 VSCode 上更短：TypeScript 插件、webview、更新安装和 WebGUI 联调都更贴近 WebGUI 的技术栈。

JetBrains 需要经过 Kotlin、Gradle、JCEF、Marketplace 规则和 IDE 重启语义，适配成本更高。

先让 VSCode 跑通能力，再把稳定协议补到 JetBrains，可以减少同时在两套宿主 API 上探索的风险。

这种顺序不改变最终目标：Bridge 是统一协议，JetBrains 需要补齐共同能力的 parity。

设计上还保留浏览器模式。

当 `ideBridge` 不可用时，WebGUI 可以隐藏部分 IDE 专属按钮，文件打开回退为下载，剪贴板使用标准 Clipboard API，图片保存回退下载链接。

这让 WebGUI 仍可在普通浏览器中调试，而不会把每个组件都绑死在 IDE 宿主上。

Bridge 的维护风险主要来自三端协议漂移。

新增消息时不能只改 WebGUI，也不能只改 VSCode。

如果 JetBrains 暂时没有实现，需要明确 unsupported 或降级，而不是让 UI 假设存在。

`restartHost` 这类会中断 transport 的请求，还需要先回复再执行破坏性动作。

否则 UI 看到的是连接失败，而不是一个可解释的重启流程。

更细的协议字段和代码锚点见 [ide-bridge reference](../reference/business/ide-bridge.md)。

逐文件深度说明见 [hosts-vscode-plugin 仓库参考](../reference/repositories/hosts-vscode-plugin.md) 和 [hosts-jetbrains-plugin 仓库参考](../reference/repositories/hosts-jetbrains-plugin.md)。
