本文回答：为什么 OpenCode IDE Plugin 是 opencode 的 IDE fork，以及同步上游时如何保护下游适配。

# 上游适配策略：跟进上游，但守住 IDE 可用性

这个项目选择做 opencode 的 IDE fork，而不是从零写一个独立 AI IDE 产品。

原因很直接：opencode 后端已经提供 Agent、Session、Provider、MCP、Permission、Bus/SSE、Effect service 等核心能力。

IDE Plugin 的价值不是替代这些能力，而是让它们在 WebGUI、VSCode 和 JetBrains 中稳定可用。

fork 的核心矛盾也来自这里。

一方面，要持续跟进上游 opencode，减少底层能力漂移。

另一方面，不能在同步上游时丢掉 IDE/WebGUI 场景需要的下游适配。

如果只保留上游，插件功能会退化；如果只保留下游，项目会逐渐变成无法同步的独立分叉。

所以当前策略不是“尽量少改上游”这么简单，而是明确记录哪些改动是同步时必须保护的适配点。

第一类适配是 `/app` 本地 WebGUI 挂载：插件不能依赖远程 Web App，WebGUI 构建产物要嵌入 opencode 包，并由本地 server 在 `/app` 提供。

同步上游 server 路由时，最容易丢的是挂载点和挂载顺序。

`/app` 必须早于 workspace middleware，否则静态资源请求可能被当成实例 API。

第二类是 config overlay 和 patch 语义。

WebGUI 的 MCP/Skills/工具开关、Agent 配置和配置文件打开依赖后端配置层能表达运行时覆盖。

这不是单纯 UI 状态，而是会影响下一次 agent 行为的配置边界。

第三类是 MCP 和 Skill overlay。

MCP server/tool 启停需要后端、SDK client 和状态面板共同保持同一语义。

Skill 开关还涉及 permission、runtime overlay、system prompt 和 tool permission ask 的优先级。

前端只消费后端算出的 effective enabled，不应该自己复刻 wildcard 或平台大小写规则。

第四类是 Provider patch 和流式兼容。

WebGUI/插件场景依赖稳定的流式输出、工具 part 和错误恢复。

Provider SDK 或上游 provider shape 一变，表面上可能只是后端升级，实际会表现为消息流中断或 UI 状态错误。

第五类是安全边界。

IDE 场景里工具能接触用户项目文件，外部目录、路径逃逸、generated image 路由都不能只靠前端约束。

工具安全边界和 generated-image 项目内路径校验属于必须保留的后端保护。

这里不能为了同步方便降级。

第六类是 foreground 保护。

当前会话首屏读取、历史分页和当前会话 diff 不能被后台 summary/diff 抢占。

这类适配不显眼，但一旦丢失，用户感受到的是切会话卡顿、diff 抖动或首屏加载不稳。

第七类是 IDE 附件与项目 identity。

`file://` mention 在 IDE 里可能是目录、PDF、图片、文本或其他二进制，需要后端按契约分流。

non-git 普通目录必须按目录派生 project id，避免多个临时目录共享 session/workspace 状态。

这些适配点的共同特点是：它们不是上游普通功能，而是 IDE fork 的产品边界。

因此知识库不逐条展开上游内部能力，也不把上游普通实现复制成文档。

只记录本 fork 如何消费上游能力，以及哪些下游差异同步时不能丢。

同步上游时的默认原则是同时保留上游逻辑和插件适配逻辑；如果能通过挂载点、overlay、最小 patch 或 adapter 保持两边，就不要把其中一边直接覆盖掉。

但有些冲突会变成真正的二选一。

例如上游重构了 config merge 生命周期，而下游 runtime overlay 正好挂在旧生命周期上。

这种时候不应该由同步者现场拍板改语义；原则是先提出选择，让维护者决定：跟随上游并重做适配，还是暂缓上游改动并保留下游行为。

这个原则的理由是风险不对称。

同步者看到的是代码冲突，维护者更清楚插件当前承诺的用户行为。

静默选择任何一边，都可能把“编译通过”变成“功能退化”。

维护 fork 时最有价值的文档不是完整复述上游，而是把这些风险点贴在同步路径上。

这样每次上游合并都能问同一组问题：`/app` 还在吗，Bridge 还能连吗，storage 还能读写吗，MCP/Skill 开关还有效吗，foreground 保护还在吗，安全边界还拦得住吗。

上游兼容边界的 reference 见 [upstream-compatibility](../reference/business/upstream-compatibility.md)。

更完整的适配清单和高风险文件见 [upstream-compatibility](../reference/business/upstream-compatibility.md)。
