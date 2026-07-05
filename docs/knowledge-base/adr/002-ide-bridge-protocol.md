# ADR 002: IDE Bridge 本地协议

## 状态

已接受。

## 背景

WebGUI 运行在 IDE 宿主提供的 webview/JCEF 中。
它需要调用宿主能力，例如打开文件、复制文本、保存图片、刷新路径和插入 IDE 上下文。
VSCode webview 原生提供 `postMessage`。
JetBrains JCEF 不提供与 VSCode 等价的 `postMessage` 宿主 API。

如果 WebGUI 分别使用 VSCode `postMessage` 和 JetBrains 专用桥接，前端会形成两套通信模型。
每个宿主动作都要维护两套调用路径。
新增能力时也更容易出现 VSCode 可用、JetBrains 漏实现的分叉。

当前架构要求 WebGUI 尽量共享同一套运行时。
宿主差异应收敛在插件层。
WebGUI 只应面对一个稳定的 IDE Bridge 协议。

IDE Bridge 运行在本机临时端口。
协议使用随机 UUID token 做会话鉴权。
宿主通过 SSE 推送事件，WebGUI 通过 HTTP POST 发送请求。

## 决策

采用本地 `127.0.0.1:0` HTTP+SSE 协议作为 WebGUI 与宿主的通信层。
不把 VSCode `postMessage` 作为 WebGUI 的主协议。

VSCode 插件和 JetBrains 插件分别实现同一套 IDE Bridge 语义。
WebGUI 只消费 bridge URL、token 和统一消息格式。

HTTP POST 用于 WebGUI 主动调用宿主动作。
SSE 用于宿主向 WebGUI 推送上下文插入、打开文件变化等事件。
连接通过 keepalive 维持，断开后由 WebGUI 按当前协议重连。

## 后果

WebGUI、VSCode、JetBrains 三端需要共同维护协议契约。
新增 bridge 消息时，至少要检查三端实现是否一致。

前端不需要为 VSCode 和 JetBrains 分别分叉通信代码。
宿主差异主要落在 bridge server 和 handler 内。
这减少了长期维护成本。

VSCode Remote-SSH 需要额外适配。
本地 bridge URL 不能直接暴露给远端 webview 时，VSCode 侧必须使用 `asExternalUri` 转换。

本地 HTTP 端口必须只绑定 `127.0.0.1`。
随机 token 是协议安全边界的一部分，不能省略。

如果某个宿主需要额外能力，应先扩展统一协议。
WebGUI 不应直接依赖 VSCode 或 JetBrains 专有对象。

## 相关

- [ide-bridge](../reference/business/ide-bridge.md)
- [host-actions](../reference/business/host-actions.md)
- [host-webview-integration](../reference/business/host-webview-integration.md)
