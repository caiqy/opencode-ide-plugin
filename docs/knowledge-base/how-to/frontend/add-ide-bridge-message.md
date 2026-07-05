# 新增 IDE bridge 消息

适用：WebGUI 需要调用 IDE 宿主能力，或宿主要向 WebGUI 推送新事件。

## 先确认协议位置

1. 打开 [ide-bridge](../../reference/business/ide-bridge.md)。
2. 同时查看相关宿主能力：
   - [context-insertion](../../reference/business/context-insertion.md)
   - [host-actions](../../reference/business/host-actions.md)
   - [host-restart](../../reference/business/host-restart.md)
3. 对照 [CONVENTIONS](../../../../CONVENTIONS.md) 的 IDE 桥接通信约定：EventSource 接收推送，POST + 关联 ID 做请求/响应，指数退避重连。

## 三端同时评估

1. WebGUI：消息是否需要 UI 状态、hook、context 或输入框插入逻辑。
2. VSCode：`hosts/vscode-plugin/src/ui/IdeBridgeServer.ts` 是否能实现同等能力。
3. JetBrains：`hosts/jetbrains-plugin/src/main/kotlin/**/ui/IdeBridge.kt` 是否能实现同等能力。
4. 如果某端不支持，协议响应必须有明确失败语义，不能静默成功。
5. 如果消息会修改文件、关闭窗口、重启宿主、安装更新或执行破坏性动作，必须先回复 WebGUI，再执行动作。

## 设计最小消息形状

1. 复用已有 message envelope 和 request id。
2. payload 只放当前动作需要的数据。
3. 不为未来平台预留字段。
4. 返回值只包含 WebGUI 后续渲染或分支需要的信息。
5. 涉及路径时使用现有路径/URI 表达方式，避免新增第二套格式。

## WebGUI 修改

1. 在 `packages/opencode/webgui` 找到现有 bridge client / context。
2. 新增消息类型和调用函数。
3. 调用点使用现有 toast、loading、错误处理模式。
4. IDE 不可用时保持 browser 模式 fallback 或明确禁用入口。
5. 写 vitest 覆盖成功、失败和 IDE 不可用分支。

## VSCode 修改

1. 在 `hosts/vscode-plugin` 实现对应 bridge handler。
2. 需要 VSCode API 时，使用已有 service / util，不新建并行通道。
3. 涉及 Webview 或 backend reload 时，确认不会破坏现有 `asExternalUri()` / CSP / recovery 逻辑。
4. 写或更新 Mocha 测试，覆盖 handler 行为。

## JetBrains 修改

1. 在 `hosts/jetbrains-plugin` 实现对应 bridge handler。
2. 需要 IDE API 时，确认是否必须跑在 EDT 或需要 IntelliJ service。
3. 能用纯 JVM 隔离的逻辑放 `unitTest`。
4. 必须真实 IDE sandbox / JCEF / ToolWindow 的场景才放 `test`。

## 验证

WebGUI，Working directory: `packages/opencode/webgui`

```powershell
bun typecheck
bun test:run
bun build
```

VSCode，Working directory: `hosts/vscode-plugin`

```powershell
pnpm run compile
pnpm run lint
pnpm test
```

JetBrains，Working directory: `hosts/jetbrains-plugin`

```powershell
./gradlew.bat unitTest --no-daemon --console=plain
./gradlew.bat build --no-daemon --console=plain
```

> 待运行时核验：至少在一个 IDE host 中触发新增 bridge 消息，确认 WebGUI 收到响应且失败态可见。
