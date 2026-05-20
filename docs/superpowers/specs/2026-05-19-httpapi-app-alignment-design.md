# `test:httpapi` 与 `packages/app` 对齐修复设计

## 背景

在完成 `opencode/dev` 合并后，仓库级扩展验证暴露出两类新失败：

1. `packages/opencode` 下 `bun run test:httpapi` 在模块加载阶段直接失败，报错 `Cannot access 'defaultLayer' before initialization.`。
2. 仓库根 `bun typecheck` 失败，当前集中在 `packages/app`：
   - `terminal.tsx` 仍调用不存在的 `client.pty.connectToken(...)`
   - `global-sync.tsx` 与 `child-store.ts` 中构造的空 `Path` 缺少 `configFile`

这两个问题都不是孤立 typo，而是 merge 后本 fork 与上游当前契约之间出现了结构性错位：

- `packages/opencode` 的 HttpApi / Effect layer 装配边界与上游当前依赖图没有完全对齐
- `packages/app` 对 SDK v2 的 PTY / Path 契约仍残留旧调用面

本次不采用最小补丁思路，而是按“方案 C / 上游对齐重构”处理：围绕失败点做小范围结构化对齐，降低后续继续同步上游时再次出现同类问题的概率。

## 目标

1. 修复 `packages/opencode` 的 `bun run test:httpapi`。
2. 修复仓库根 `bun typecheck` 当前在 `packages/app` 暴露的失败点。
3. 让相关代码边界更接近上游当前结构，而不是继续堆叠兼容补丁。
4. 在不扩散范围的前提下补足 merge 可用性证据。

## 非目标

- 不处理本轮未纳入目标的根仓 `bun lint`。
- 不进行与这两个失败点无关的大范围重构。
- 不重写整个 app / sdk / session 架构，只修正本次已验证暴露的错位边界。

## 方案对比

### 方案 A：最小定点补丁

只在当前报错位置做最小代码修补，让命令先通过。

优点：

- 速度快
- 改动小

缺点：

- 容易继续保留旧调用面
- 下次 merge 仍可能在同一类边界重新出问题

### 方案 B：兼容层兜底

通过 shim / wrapper 保留旧调用面，例如继续模拟 `connectToken()`，或在 layer 边界再套一层兼容 defaultLayer。

优点：

- 上层改动少

缺点：

- 容易隐藏真实契约变化
- 增加后续维护债务
- 对长期 fork 不够健康

### 方案 C：上游对齐重构（采用）

围绕失败点本身做小范围边界对齐：

- 让 `packages/opencode` 的 HttpApi / Effect layer 装配更符合当前依赖图
- 让 `packages/app` 的 PTY / Path 使用面回到当前 SDK v2 契约

优点：

- 能同时解决眼前失败与结构错位
- 更利于后续继续同步上游

缺点：

- 比最小补丁多一些分析和局部整理工作

## 选型结论

采用 **方案 C：上游对齐重构**，但严格控制在这两个已验证失败点及其直接依赖边界内，不借机扩散到无关子系统。

## 设计一：修复 `bun run test:httpapi`

### 现象

`packages/opencode` 下 `bun run test:httpapi` 尚未进入业务断言，就在模块 / layer 初始化阶段报：

- `Cannot access 'defaultLayer' before initialization.`

### 根因判断

当前 `src/server/routes/instance/httpapi/server.ts` 在总 route composition 中直接提供 `SessionSummaryScheduler.defaultLayer`。而 `SessionSummaryScheduler.defaultLayer` 本身又通过 `Layer.suspend(...)` 回拉：

- `Session.defaultLayer`
- `SessionSummary.defaultLayer`
- `Bus.layer`

与此同时，`Session.defaultLayer`、`prompt`、`processor`、`httpapi session` 等链路又会消费 `SessionSummaryScheduler.Service`。这形成了“在总装配边界提前拉起一条会反向依赖 session 子系统的 default graph”的风险，最终在模块初始化期触发 TDZ / 循环初始化错误。

### 设计原则

1. route tree 只在顶层组合自己真正需要的稳定边界。
2. 避免在 `createRoutes()` 里提前拉起会反向依赖 session graph 的完整 `defaultLayer`。
3. 让 `SessionSummaryScheduler` 的提供位置更接近真实消费边界，或让它的默认层不再回拉整套 session default graph。
4. 优先贴近上游 Effect / HttpApi 的分层风格：顶层声明路由与稳定中间件，服务层内部自行组织依赖。

### 具体重构方向

实施时以实际依赖图为准，优先落地下列之一：

#### 方向 1：把 scheduler 装配下沉到 session 子系统

- `httpapi/server.ts` 不再显式提供 `SessionSummaryScheduler.defaultLayer`
- 让 session 相关 defaultLayer 在内部自洽提供 scheduler 所需服务
- HttpApi handler 只消费 `SessionSummaryScheduler.Service`

适用条件：当前 session graph 已经天然是 scheduler 的真正拥有者，只是顶层重复提供导致循环。

#### 方向 2：拆窄 `SessionSummaryScheduler.defaultLayer`

- 将当前 `defaultLayer` 拆成更明确的窄层，例如只提供 `Service` 所需的直接依赖
- 避免它通过 `Session.defaultLayer` 重新回卷进整棵 session graph
- 若需要，保留更清晰命名的 `defaultLayer` / `appLayer` / `live` 分层，以表达“顶层可直接提供的稳定层”与“内部组合层”的区别

适用条件：scheduler 作为独立服务本应存在，但它的 defaultLayer 现在定义得过宽。

### 预期结构结果

- `HttpApi` 路由顶层不再承担 scheduler 的递归装配责任
- `SessionSummaryScheduler` 的依赖边界更清晰
- `bun run test:httpapi` 可以进入真实用例执行，而不是在初始化阶段提前失败

### 兼容性要求

- 不改变现有 `SessionSummaryScheduler.Service` 的对外接口
- 不改变 foreground/background summary 调度语义
- 不回退已恢复的 `httpapi-session` 与 generated-image 相关 merge 成果

## 设计二：修复根仓 `bun typecheck` 中的 `packages/app` 失败

### 现象

当前 `bun typecheck` 卡在 `packages/app` 的三处错误：

1. `terminal.tsx`：`client.pty.connectToken` 不存在
2. `global-sync.tsx`：`Path` 缺少 `configFile`
3. `child-store.ts`：`Path` 缺少 `configFile`

### 根因判断

这不是三处互不相关的小问题，而是 app 对上游当前 SDK v2 契约没有完全同步：

- PTY 连接调用面已经迁移到新的 SDK 结构，但 app 组件仍使用旧时代的 `connectToken()` 心智模型
- `Path` 的 schema 已新增 `configFile`，但本地空状态和 fallback shape 仍停留在旧结构

### 设计原则

1. app 侧直接对齐当前 SDK v2 契约，不继续保留过时调用名。
2. 对共享数据结构（如 `Path`）统一收口，避免每个调用点各自拼空对象。
3. 保持终端连接行为语义稳定，不因为 API 名称变化而改变错误处理与 ticket 使用逻辑。

### 具体重构方向

#### 2.1 PTY 连接链路对齐

对 `src/components/terminal.tsx`：

- 将 `client.pty.connectToken(...)` 改为当前 SDK 实际暴露的 PTY connect 调用面
- 核对并同步以下契约：
  - 参数命名与路径参数
  - `directory` / `workspace` 的传递方式
  - 票据字段的读取方式
  - 404 / 405 / 403 分支的既有语义
  - websocket URL 中 ticket 的继续使用方式

如果当前 SDK / server 契约已经把“拿 ticket 再连 websocket”固定为新的结构，则 app 按新结构表达，但保留当前用户可感知行为不变：

- 同源安全检查失败仍给出明确错误
- connect endpoint 不支持时仍走兼容分支
- websocket 重连与异常处理逻辑不改变

#### 2.2 `Path` 结构统一收口

对 `global-sync.tsx` 与 `child-store.ts`：

- 不只在两处手填 `configFile`
- 优先抽出统一的空 `Path` 构造方式或常量
- 让所有 fallback 都使用与当前 SDK `Path` 完全一致的 shape：
  - `state`
  - `config`
  - `configFile`
  - `worktree`
  - `directory`
  - `home`

这样做的目的是把未来同类 schema 漏字段问题收敛到一处，而不是再次分散在多个 store / query fallback 里。

### 预期结构结果

- `terminal.tsx` 与当前 SDK PTY 契约一致
- `Path` 空状态在 app 内部有统一来源
- 根仓 `bun typecheck` 不再因这几处错位而失败

## 数据流与边界影响

### `packages/opencode`

- 影响 `HttpApi` 顶层 layer 组装
- 影响 `SessionSummaryScheduler` 的依赖提供边界
- 不应改变对外 API wire shape

### `packages/app`

- 影响 terminal 建立 PTY websocket 之前的 ticket 获取流程
- 影响 global / child store 对 `Path` 查询结果的空态表示
- 不应改变页面状态机与用户交互语义

## 错误处理设计

### `test:httpapi` 侧

- 目标不是吞掉初始化错误，而是消除触发错误的循环装配结构
- 若重构后暴露出新的真实业务失败，应继续按具体失败定位，但初始化期 TDZ 必须先消失

### app 侧

- 保留 terminal 现有 403 / 404 / 405 / network error 处理分支
- `Path` 空态统一后，仍要保证加载中状态与查询完成但为空的语义不混淆

## 验证策略

修复完成后按以下顺序验证：

### 必跑验证

1. `packages/opencode`：`bun run test:httpapi`
2. 仓库根：`bun typecheck`

### 关联回归验证

3. `packages/opencode`：`bun test test/server/generated-image-route.test.ts --timeout 30000`
4. `packages/opencode`：`bun test test/server/httpapi-session.test.ts --timeout 30000`
5. `packages/opencode/webgui`：`bun run test:run`
6. `hosts/vscode-plugin`：`pnpm run compile`

如实施中发现 app 的 PTY 契约修复触及更多 SDK / UI 连接面，再增补最小必要验证，但不主动扩展到根仓 lint。

## 风险与控制

### 风险 1：修掉初始化错误后暴露出更深层 session 行为问题

控制方式：

- 先确认初始化期错误消失
- 再依赖 `test:httpapi` 的真实失败输出来判断下一步，而不是一次性大改 session 行为

### 风险 2：PTY connect 对齐后改变浏览器端连接语义

控制方式：

- 保留现有 ticket / websocket / retry 语义
- 只替换过时 SDK 调用面，不改用户可感知行为

### 风险 3：`Path` 空态统一时影响现有 store 推导逻辑

控制方式：

- 统一空 shape，但不改变 `isLoading` / `data ?? fallback` 的时序语义
- 让改动尽量停留在 fallback 构造边界

## 完成标准

当满足以下条件时，本轮修复可视为完成：

1. `packages/opencode` 的 `bun run test:httpapi` 通过。
2. 仓库根 `bun typecheck` 通过。
3. `generated-image-route` 与 `httpapi-session` 关键回归仍通过。
4. `packages/opencode/webgui` 全量测试仍通过。
5. `hosts/vscode-plugin` compile 仍通过。
6. 修复以边界对齐为主，没有为赶通过而引入新的临时兼容债务。
