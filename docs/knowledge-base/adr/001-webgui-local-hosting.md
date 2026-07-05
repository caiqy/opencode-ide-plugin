# ADR 001: WebGUI 本地托管

## 状态

已接受。

## 背景

OpenCode IDE Plugin 需要把 WebGUI 渲染在 IDE 的 webview/JCEF 中。
上游 opencode 的在线应用入口是 `https://app.opencode.ai`。
这个入口在普通浏览器中可用，但不适合作为 IDE 插件的运行依赖。

VSCode webview 和 JetBrains JCEF 都会受到 CSP、网络环境、代理、证书和离线场景影响。
IDE webview 也不能稳定加载外部 URL 并让它访问本地 opencode server。
如果 UI 依赖公网应用，插件可用性会被外部网络和上游部署状态绑定。

当前架构已经把 WebGUI 作为 React SPA 构建。
构建产物经 Vite 输出后，会生成到 opencode 包内的 `embed.generated.ts`。
后端本地服务器再从内存提供这些静态资源。

RepoWiki 将 `/app` 本地 WebGUI 挂载列为必须保留的下游适配。
该适配涉及 `webgui/server/app.ts`、`webgui/embed.generated.ts` 和 `server/server.ts`。
同步上游时，路由重构最容易破坏这一点。

## 决策

将 WebGUI 构建产物嵌入 opencode 包。
由本地 opencode server 在 `/app` 和 `/app/*` 托管 WebGUI。
IDE 插件打开本地 `/app` 页面，而不是依赖 `https://app.opencode.ai`。

`/app` 路由必须保持在 workspace middleware 之前。
这样静态 UI 资源不会被项目目录上下文、鉴权或 workspace 路由误处理。
WebGUI 与同源 opencode server 继续通过 REST/SSE 通信。

## 后果

WebGUI 不再依赖公网应用可用性。
IDE 插件可以随包携带确定版本的 UI。
上游在线应用变化不会直接改变插件 UI 行为。

每次 WebGUI 构建后，必须重新生成 `embed.generated.ts`。
如果只构建前端而不更新嵌入产物，插件包会继续携带旧 UI。

`/app` 挂载顺序是上游同步的高风险点。
同步 `server.ts` 或 web server 路由时，必须确认 `/app` 仍存在且顺序正确。

包体积会随 WebGUI 静态资源增加。
这是可接受代价，因为插件优先保证 IDE 内可用性和版本一致性。

开发调试仍可以使用独立 WebGUI dev server。
但发布包和 IDE 内默认路径必须以嵌入式 `/app` 为准。
文档和检查清单应把 `/app` 作为插件运行时入口记录。
发布前最低检查是打开 IDE 内 WebGUI 并确认静态资源来自 `/app`。

## 相关

- [embedded-webgui-serving](../reference/business/embedded-webgui-serving.md)
- [upstream-compatibility](../reference/business/upstream-compatibility.md)
