# 能力：嵌入式 WebGUI 托管与双模式运行

> **象限**：Reference（能力参考）
> **能力编号**：A1 + A2（见 [capabilities-index](../capabilities-index.md)）
> **基线状态**：基线

## 代码真源

| 角色                       | 文件                                              |
| -------------------------- | ------------------------------------------------- |
| 嵌入资源服务               | `packages/opencode/src/webgui/server/app.ts`      |
| server 挂载点              | `packages/opencode/src/server/server.ts`          |
| WebGUI 构建与 dev proxy    | `packages/opencode/webgui/vite.config.ts`         |
| dev backend 发现           | `packages/opencode/webgui/dev/discoverBackend.ts` |
| React 入口与 Provider 装配 | `packages/opencode/webgui/src/main.tsx`           |
| IDE bridge 运行模式判定    | `packages/opencode/webgui/src/lib/ideBridge.ts`   |

> 命名交叉核验（Step 5）：能力 A1 的 `/app` 托管由 `server.ts` 第 117-132 行显式拦截 `/app` 和 `/app/*`；能力 A2 的 dev backend discovery 只存在于 `webgui/dev/discoverBackend.ts`，生产路径不依赖它。

## 意图

让 IDE 插件和本地浏览器都能从 opencode 本地 server 使用同一套 WebGUI SPA。正式链路把构建产物嵌入 opencode 包并挂到 `/app`；开发链路由 Vite 发现本地 backend 并代理 API/SSE。

## 行为契约

- WebGUI 构建 base 固定为 `/app`（`vite.config.ts` 第 81-88 行），产物输出到 `../webgui-dist`。
- 嵌入服务从 `embed.generated.ts` 读取 base64 文件表；`assets/*` 使用一年 immutable 缓存，其余文件 `no-store`（`app.ts` 第 1-3、37-41 行）。
- `/app` 空路径返回 `index.html`，无扩展名路径走 SPA fallback；`/app/api/*` 不 fallback（`app.ts` 第 17-26 行）。
- server 先处理 `/app`，再落到兼容 app；`/app/generated-image` 被改写到 `/generated-image` 并补 Instance context（`server.ts` 第 117-138 行）。
- Vite serve 模式启动前必须发现 backend；失败时抛出带每个候选端口原因的错误（`vite.config.ts` 第 102-123 行）。
- dev backend 候选端口顺序固定为 `4300, 4096, 4097, 4098, 4099, 4100`，探测 `http://127.0.0.1:<port>/global/config` 并校验 JSON config shape（`discoverBackend.ts` 第 1、49-100 行）。
- dev proxy 覆盖 API、SSE、PTY、generated-image 等 root；`/event` 和 `/pty` 开启 websocket proxy（`vite.config.ts` 第 9-33、40-55 行）。
- React 入口先初始化 `ideBridge`、tooltip polyfill、全局 DnD，再装配 Project/Session/Tabs/Toast/IdeBridge/Providers/Update/UISettings（`main.tsx` 第 19-45 行）。
- IDE bridge 是否安装由 URL 参数 `ideBridge` + `ideBridgeToken` 决定；缺失时 `send` 只记录 warning，`request` reject，前端可按浏览器模式降级（`ideBridge.ts` 第 22-26、46-55、179-183、248-252 行）。

## 边界与约束

- `/app` 本地托管是正式产品链路；Vite backend discovery 只属于 dev tooling，不应进入生产 server。
- `/app/api/*` 被显式排除，避免旧兼容 API 路由吞掉 SPA fallback。
- `OPENCODE_DEV_DIRECTORY_OVERRIDE` 只在 Vite serve proxy 注入 `x-opencode-directory`，正式 build 不读取（`vite.config.ts` 第 35-38、47-51、102 行）。
- dev proxy 中 `/generated-image` 与 `/app/generated-image` 都需要保留，否则 dev WebGUI 和 embedded 路径的图片预览行为会分叉（`vite.config.ts` 第 9-11 行）。
- `discoverBackend` 只探测 `127.0.0.1`，不覆盖 LAN、容器 hostname 或 SSH tunnel 自动发现（`discoverBackend.ts` 第 55 行）。
- server 的 `listen(0)` 仍优先尝试 4096，再退到任意空闲端口；这和 dev discovery 的候选端口列表是两个不同层级（`server.ts` 第 200-205 行）。

## 静态核验点

- `/app` 挂载仍在 `createCompatibilityApp` 内部兼容 app 调用之前（`server.ts` 第 117-138 行）。
- `embed.generated.ts` 是 `webgui/server/app.ts` 的唯一资源输入（`app.ts` 第 1-3 行）。
- Vite build 与 serve 共享 `base: "/app"`，serve 只额外注入 backend URL 和 proxy（`vite.config.ts` 第 81-98、108-117 行）。

## 漂移风险

- 改 asset 路径、Vite base 或 embed 生成脚本时，必须同时核对 `app.ts` 的 path 解析。
- 改 server middleware 顺序时，必须确认 `/app` 没有被 workspace/instance 路由提前接管。
- 改 backend 默认端口时，必须同步 dev discovery 候选端口和 VSCode backend 调试配置。
- 改 generated image 路由时，同时核对 embedded `/app` 与 dev proxy 两条入口。
- 改 IDE bridge URL 参数时，同时核对浏览器模式 `isInstalled()` 的 null bridge 语义。
- 改 `createCompatibilityApp` 时，不要把 `/app/api/*` 重新接回 SPA fallback。

## 运行时待核验

- [ ] VSCode webview 与 JetBrains JCEF 中 `/app/generated-image` 的 query/context 透传是否都能正确预览当前项目图片（`待运行时核验`：需要宿主 webview/JCEF 实机）。
- [ ] 普通浏览器打开 `/app` 时，依赖 IDE bridge 的入口是否都隐藏或降级，无阻塞报错（`待运行时核验`：需要浏览器模式走一遍设置、打开文件、保存图片）。

## 相关

- IDE Bridge 协议：[ide-bridge](ide-bridge.md)
- 宿主 Webview/JCEF 承载：[host-webview-integration](host-webview-integration.md)
- Generated image 预览：[generated-image](generated-image.md)
- 上游兼容边界：[upstream-compatibility](upstream-compatibility.md)
