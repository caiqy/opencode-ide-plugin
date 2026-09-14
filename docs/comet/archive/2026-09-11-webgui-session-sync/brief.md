# 目标

修复 WebGUI 会话“后台正常执行、界面卡死”的问题，按上游 `packages/app` 已验证的做法对齐：

- 事件源从目录级 `/event` 改为全项目事件流（`/global/event`），客户端解包 `{ directory, project, payload }` 并按事件自带的目录分发，使同一后端进程内任意目录创建的会话都能实时更新；
- 新建/复用空会话限定在当前 WebGUI 实例目录内，不再跨目录复用（尤其是测试遗留的空会话）；
- VS Code 插件自动化测试使用隔离的数据目录，不再向用户真实数据库写入测试会话；
- Composer 对不完整消息数据与激活异常做兜底，任何情况下都能恢复可交互状态，不永久停留在“正在切换会话设置…”。

# 范围

- WebGUI 事件流：从目录级 `/event` 切换为全项目事件流（v1 SDK `sdk.global.event()`），在客户端解包信封后交给现有事件分发链路；保留 `server.connected`、忽略 heartbeat 等既有语义。
- 事件覆盖：同一后端进程内、其他目录（例如 `hosts/vscode-plugin/test-fixtures`）创建的会话，其 `message.updated`、`message.part.*`、`session.status`、`session.idle` 等事件能到达 WebGUI，当前显示的会话实时更新并在完成后结束“生成中”。
- 新建/复用目录作用域：`handleNewSession` 的草稿复用检查与空会话兜底扫描只匹配当前 WebGUI 实例目录；其他目录的空会话不被复用。
- 测试数据隔离：VS Code 插件测试启动的后端使用临时数据目录（通过 `XDG_*` 环境变量注入），测试产生的会话、消息与数据库不写入用户真实数据目录。
- Composer 兜底：会话设置恢复遇到缺少 `model`/`agent` 的不完整用户消息（例如乐观消息）不抛异常；激活流程发生任何异常时仍将 `selectionSessionId` 收敛到当前会话，Composer 解除禁用。
- 为 WebGUI 与 VS Code 插件补充覆盖上述行为的自动化测试。

# 非目标

- 不修改上游 `packages/app`。
- 不改服务端 `/event` 的目录级语义，不新增服务端事件端点或参数；WebGUI 改用既有 `/global/event`。
- 不照搬上游的 per-directory store 架构；WebGUI 保持按 sessionID 索引的单一消息 store。
- 不改变会话列表“跨目录可见”的既有行为，不把会话列表或标签限定为当前目录。
- 不实现不同后端进程（多个 VS Code 窗口各自后端）之间的实时事件同步；本次只保证同一后端进程内的实时事件。
- 不引入新的运行时依赖；不改附件协议、消息提交、停止生成、上下文统计与压缩等既有行为。

# 验收示例

- A1：同一后端进程内、其他目录创建的会话在后台执行时，WebGUI 打开的会话界面无需刷新即可实时显示流式消息，并在执行完成后自动结束“生成中”。
- A2：在该跨目录会话后台执行期间切走到其他会话、再切回时，界面显示已产生的后台内容，不再残留“生成中”，Composer 可以继续输入。
- A3：在当前目录点击“+”，只复用当前目录内的空会话；其他目录的空会话不会被选中或切换。
- A4：当恢复的草稿指针指向其他目录的会话时，新建流程不复用该会话，而是在当前目录创建或复用会话。
- A5：运行 VS Code 插件自动化测试后，用户真实数据目录不产生测试遗留会话（测试数据写入隔离的临时目录）。
- A6：当消息缓存中只有缺少 `model`/`agent` 的乐观用户消息时，切换或恢复该会话不抛异常，Composer 不会停留在“正在切换会话设置…”。
- A7：会话设置恢复过程发生任意异常时，Composer 自动解除禁用并可继续输入，不会永久锁死。
- A8：WebGUI 与 VS Code 插件的新增与既有自动化测试通过；会话列表跨目录可见、消息提交、停止生成等既有行为不回归。

# 约束与不变量

- 上游事实基线：`packages/app` 使用单一全项目事件流（v1 `eventSdk.global.event()` / v2 `eventApi.event.subscribe()`），并从事件中提取目录进行分发（`packages/app/src/context/server-sdk.tsx:275-287`）；会话创建显式携带 `location: { directory }`（`packages/app/src/components/prompt-input/submit.ts:402-408`）。
- WebGUI 使用 v1 旧 SDK（`@opencode-ai/sdk/client`），`sdk.global.event()` 已存在（`packages/sdk/js/src/gen/sdk.gen.ts:233-237`）。
- `/global/event` 信封为 `{ directory, project, payload }`，必须解包后交给现有 emitter；只改 URL 会导致事件 `type` 为空而全部失效。
- 服务端 `/event` 的目录过滤语义保持不变（`packages/opencode/src/server/routes/instance/httpapi/handlers/event.ts:35-39`）。
- 目录比较必须对 Windows 路径做归一化（大小写、分隔符），避免 `D:\...` 与 `D:/...` 误判。
- 测试隔离通过 `XDG_DATA_HOME` 等环境变量指向临时目录实现；`Global` 路径由 `xdg-basedir` 提供（`packages/core/src/global.ts:3-14`），测试后端继承扩展宿主的 `process.env`。
- 保持既有行为：消息提交、停止生成、会话设置恢复、Agent/模型/variant 选择、上下文统计、压缩、文件读取与草稿恢复语义不变；不引入新上传协议、附件结构或运行时依赖。
- Composer 兜底不吞错：必要异常仍记录日志，只保证 pending 状态收敛与可交互。

# 决策

- 已确认：采用“全面对齐上游”方案；保留跨目录会话在列表中的可见与可操作性，不做“窗口只属于自己目录”的收敛。
- 已确认：事件源改为全项目事件流并在客户端按目录分发。
- 已确认：新建/复用会话限定当前实例目录；保留本仓库已有的空会话复用机制（不改为每次强制新建）。
- 已确认：VS Code 插件测试使用隔离数据目录，测试不得写入用户真实 `opencode.db`。
- 已确认：Composer 对不完整消息与激活异常做兜底，保证可交互状态必然恢复。
- 代理决定：客户端仅处理与当前项目相关的事件；多窗口跨进程实时同步不在本次范围。

# 待解决问题

# 验证预期

- WebGUI（`packages/opencode/webgui`，`bun run test:run`）：覆盖事件信封解包与分发、跨目录事件处理、目录限定的会话复用、乐观消息与激活异常兜底。
- VS Code 插件（`hosts/vscode-plugin`，`pnpm test`）：覆盖测试数据隔离（后端启动环境）与既有套件不回归。
- 集成验证：同一后端进程内，在 WebGUI 打开并向一个其他目录（如 `hosts/vscode-plugin/test-fixtures`）的会话发送消息，观察实时流式更新与“生成中”正确结束；运行 VS Code 测试前后对比，确认用户真实数据目录无新增测试会话。
