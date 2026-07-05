本文回答：OpenCode IDE Plugin 为什么被组织成 IDE Host、WebGUI、opencode server 三层，以及这三层如何一起完成一次聊天交互。

# 架构总览：三层而不是一个“大插件”

OpenCode IDE Plugin 的核心不是把 opencode 改写成另一个 IDE 插件，而是在上游 opencode 后端之上，补出一个能被 IDE 承载的 WebGUI 和宿主集成层。

因此系统天然分成三层：IDE Host、WebGUI、opencode server。

IDE Host 是 VSCode 插件和 JetBrains 插件所在的层。

它负责把界面放进 VSCode webview 或 JetBrains JCEF，也负责提供浏览器本身没有的 IDE 能力。

这些能力包括打开文件、刷新 IDE 文件系统视图、写剪贴板、保存图片、重启宿主、读取和写入宿主 scoped storage。

WebGUI 是 React SPA，入口在 `packages/opencode/webgui/src/main.tsx`。

它是用户主要看到的产品界面：聊天、会话管理、设置、状态面板、模型选择、子任务抽屉、工具结果渲染都在这一层组织。

opencode server 是 Bun/Hono 后端，入口和服务路径由 `packages/opencode/src/index.ts` 与 `packages/opencode/src/server/server.ts` 承担。

它保留上游 opencode 的核心职责：Agent 编排、Session 管理、Provider、MCP、Config、Bus/Event、SQLite 存储和文件系统工具。

这种分层的理由是职责不同，变化频率也不同。

后端要持续跟进上游；WebGUI 要满足 IDE 内的可视化体验；宿主插件要贴近各自 IDE 的 API 和生命周期。

如果把这些逻辑塞进同一层，上游同步、UI 迭代和 IDE 适配会互相拖拽。

现在的分层把“可跟进上游”和“可在 IDE 里用”拆开处理。

用户输入一条消息时，路径大致是从 WebGUI 输入区开始。

WebGUI 通过 SDK client 调用 opencode HTTP API，而不是直接调用后端内部模块。

后端创建或更新 session，Agent 执行过程中把领域事件发布到 Bus。

SSE `/event` 路由通过 `Bus.subscribeAll()` 订阅这些事件，并把消息、状态、工具调用等变化流式推给 WebGUI。

WebGUI 的 MessagesContext 和相关组件消费 SSE 增量，更新消息列表、工具卡片、TypingIndicator、状态提示和 diff 展示。

这条链路让后端仍以事件驱动方式工作，前端只关心可渲染状态。

IDE Bridge 是横跨 IDE Host 和 WebGUI 的旁路，不替代 opencode API。

打开文件、写剪贴板、保存图片、读取宿主存储这类动作不会进入普通浏览器 API，也不属于 opencode server 的核心业务。

它们通过 Host 本地 HTTP+SSE bridge 完成，使 WebGUI 可以在 IDE 模式和浏览器模式之间降级。

WebGUI 的正式交付路径也体现了这个边界。

构建产物由 Vite 生成，嵌入到 `src/webgui/embed.generated.ts`，再由后端在 `/app` 和 `/app/*` 提供。

插件场景不依赖远程 `https://app.opencode.ai`，而是由本地 opencode server 提供同源 SPA 和 API/SSE。

这减少了插件离线、网络、版本不一致带来的风险。

开发模式则允许 Vite dev server 通过 proxy 找到 backend，但它只是联调链路。

正式链路仍是 embedded WebGUI，由 `/app` 本地托管。

状态管理也按层划分。

Session 和消息属于 opencode server 的领域数据。

主题、tab、draft、最近选择这类 UI 恢复状态属于 WebGUI 自身，但持久化要落到宿主 scoped storage。

当前项目目录和 worktree 是多层共享上下文：后端用它做实例隔离，WebGUI 用它展示和构造路径，Host 用它打开或刷新真实文件。

横切关注点也保持了同样的边界。

日志在后端、WebGUI、IDE 插件各自用本层工具记录。

配置在后端走 `opencode.json` 和 XDG，全局 UI 偏好走 scoped storage，IDE 插件设置走各自宿主配置系统。

认证也分开：Provider 使用 OAuth/API key，server 可用 `OPENCODE_SERVER_PASSWORD`，IDE Bridge 使用每会话随机 token。

这个架构最重要的理解点是：WebGUI 不是后端的薄皮，也不是 IDE 插件的模板页。

它是 IDE 场景的产品层，向下消费 opencode API/SSE，向上通过 Bridge 请求宿主能力。

维护时判断一个改动放哪一层，通常看它依赖什么能力。

依赖 Agent、Provider、Session、MCP 的，通常在 opencode server 或 SDK client 边界。

依赖渲染、交互、可恢复 UI 状态的，通常在 WebGUI。

依赖 VSCode/JCEF/剪贴板/IDE 文件系统刷新/插件更新的，通常在 Host 和 IDE Bridge。

更多能力索引见 [capabilities-index](../reference/capabilities-index.md)。

仓库结构参考见 [packages-opencode](../reference/repositories/packages-opencode.md)、[hosts-vscode-plugin](../reference/repositories/hosts-vscode-plugin.md)、[hosts-jetbrains-plugin](../reference/repositories/hosts-jetbrains-plugin.md)。
