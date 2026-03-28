# WebGUI 插件重启链路修复设计

## 背景

在最新版 VSCode 中，使用 webgui 对应的 VSCode 插件执行“重启”时，用户会看到“关闭窗口需要的时间较长”“正在停止扩展主机”“重启失败，请稍后重试”“连接 OpenCode 服务器失败，正在重试”等现象。仓库内代码与外部 VSCode 社区讨论都表明，问题集中在扩展停用阶段资源释放不完整，以及 `reloadWindow` 与前端 bridge 请求之间的竞态。

## 目标

1. 降低扩展停用时卡住的概率。
2. 避免 webgui 的“重启”请求因为窗口过早 reload 而误判失败。
3. 保证宿主断开时，前端 pending bridge 请求能够及时结束。
4. 尽量以最小改动修复当前链路，不做无关重构。

## 非目标

1. 不重构整个 VSCode 插件架构。
2. 不处理 `sdks/vscode` 轻量扩展。
3. 不新增跨进程持久化协议。

## 设计

### 1. 扩展停用时显式停止 bridge server

当前 `IdeBridgeServer` 有 `stop()`，但未在扩展停用链路中调用。修复时在 `hosts/vscode-plugin` 的扩展释放流程中显式停止 bridge server，并在停止前先释放 webview/controller/session，避免 SSE 客户端、HTTP server、keepalive timer 残留，减轻“正在停止扩展主机”的现象。

### 2. 显式释放 Activity Bar provider

`ActivityBarProvider` 当前未被统一释放。修复时在扩展主类的 `dispose()` 中补齐 provider 的 `dispose()`，确保其内部 controller、bridge session、file monitor 能随停用一起清理。

### 3. 修复 backend terminate 的强杀兜底

`BackendLauncher.terminate()` 在设置强杀定时器后立即清空 `this.currentProcess`，会导致 5 秒后的强杀逻辑可能拿不到原进程。修复时改为保存局部进程引用，对同一个进程执行 graceful shutdown 与 force kill，避免后台进程残留影响重启后的连接。

### 4. 调整 restartHost 的回包时序

当前 bridge 处理 `restartHost` 时先执行 `reloadWindow`，再尝试回复 OK。窗口一旦先 reload，reply 很容易丢失，webgui 就会报“重启失败”。修复时改为先回复成功，再异步触发 reload，使前端在宿主销毁前拿到成功结果。

这里的成功语义定义为：**宿主已接受重启请求，并开始安排 reload**，而不是“窗口已经完成重启”。如果 reload 调用本身抛错，宿主需要留下日志，便于后续排查。

### 5. 提升前端 ideBridge request 健壮性

当前 `ideBridge.request()` 没有 timeout，也不会在连接断开时主动 reject pending request。修复时增加**按请求类型区分**的超时与 pending 清理逻辑，优先覆盖 `restartHost` 这一高风险请求，避免给所有 bridge 请求统一施加新时限，改变既有语义。

### 6. 重启期间的 UX 约束

重启本身会带来一次预期中的断连，因此本次修复不额外引入新的前端状态机，而是限制在以下范围：

1. `restartHost` 被宿主接受后，不再弹出“重启失败，请稍后重试”。
2. 宿主销毁、页面 reload 或 bridge 断开时，当前请求必须结束，不能无限 pending。
3. 若重连很快恢复，允许现有离线 banner 短暂出现；本次不扩展为静默断连模式。

## 影响范围

- `hosts/vscode-plugin/src/extension.ts`
- `hosts/vscode-plugin/src/backend/BackendLauncher.ts`
- `hosts/vscode-plugin/src/ui/WebviewController.ts`
- `hosts/vscode-plugin/src/ui/IdeBridgeServer.ts`
- `packages/opencode/webgui/src/lib/ideBridge.ts`
- 相关测试文件

## 风险与缓解

1. **过早关闭 bridge 导致少量请求失败**
   - 通过“先 reply 再 reload”降低影响。
2. **新增 timeout 改变前端语义**
   - 仅对 `restartHost` 等高风险请求增加超时，并在测试中覆盖。
3. **dispose 顺序引入新竞态**
   - 采用“先 webview/controller，再 bridge server，再 backend”的顺序，并补最小回归测试。

## 验证思路

1. 为 `BackendLauncher.terminate()` 增加测试，验证会针对原进程触发 kill。
2. 为 `IdeBridgeServer` 增加 restart reply 测试，验证回复先于宿主重启动作返回。
3. 为 `ideBridge.request()` 增加 timeout / 断连清理测试。
4. 为扩展释放链路增加测试或最小验证，锁定 `webviewManager.dispose()`、`activityBarProvider.dispose()`、`bridgeServer.stop()`、`backendLauncher.terminate()` 会在停用时执行，且可重复调用。
5. 运行真实重启链路验证矩阵：
   - Activity Bar 入口
   - Panel 入口
   - 点击重启后无失败 toast
   - 不再长时间卡在“正在停止扩展主机”
   - reload 后 bridge 能重新连接
