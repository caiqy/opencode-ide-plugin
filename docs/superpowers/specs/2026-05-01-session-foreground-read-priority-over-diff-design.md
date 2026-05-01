# 会话前台读取优先于后台 Diff 的设计

## 背景

上一轮已经把 Diff 计算从会话主输出链路中挪到后台调度：

- `prompt.ts` / `processor.ts` 只负责 `markDirty(...)`
- `SessionSummaryScheduler` 在后台执行 `summary.summarize(...)`
- 前端通过 `/session/visibility` 告诉后端当前哪些会话值得优先刷新
- Diff 面板通过 `session.diff.status` 显示 `updating` / `latest` / `failed`

这解决了“Diff 卡住会话输出”的主问题，但仍留下新的前台竞争：

- 会话切换时，`useSessionVisibilitySync()` 会立即把当前会话上报给 `/session/visibility`
- 后端可能立刻对该会话启动后台 summary/diff
- 与此同时，前端还在执行会话切换的关键前台读取：
  - `GET /session/:id/messages` 首屏加载
  - `useSessionActivation()` 的 `scanOlder(...)` 历史扫描
  - `GET /session/:id/diff` 当前会话首次 Diff 读取
- 结果是：Diff 不再卡会话输出，但仍可能卡住“会话切换加载”和“底部 agent/model 恢复”

因此本轮目标不是继续异步化 Diff，而是把“后台 Diff 让路给前台会话读取”的策略补齐到所有关键前台链路。

## 目标

- 确保会话切换时的关键前台读取优先于后台 summary/diff
- 确保底部 agent/model 恢复流程不会被后台 Diff 拖住
- 保持现有异步 Diff 正式链路不回退：
  - 会话输出不再被 Diff 卡住
  - `session.diff.status` 状态链不变
  - `SessionSummaryScheduler` 合并调度语义不变
- 一次性补齐同类前台会话读取入口，避免只修单一页面路径

## 非目标

- 本轮不重写 `SessionSummaryScheduler` 为可抢占/可取消架构
- 本轮不引入新的 Diff 触发源
- 本轮不把所有 HTTP 请求都视为 foreground；仅覆盖关键前台会话读取
- 本轮不调整 Diff 面板 UI 文案和状态模型

## 现状与根因

### 1. 真正卡住的不是 provider/model 列表加载

底部“正在切换会话设置…”并不是 `sdk.config.providers()` 自己卡住，而是 `useSessionActivation()` 在等待：

1. `ensureSession(sessionID)` 拉最近一页消息
2. 必要时继续 `scanOlder(sessionID, before)` 向前扫描
3. 从消息中恢复该会话最后一次 user message 的 `agent / provider / model / variant`
4. 最后才 `resolveSelections(sessionID, ...)`

因此只要消息读取链路被拖住，底部恢复就会一起卡住。

### 2. 当前缺少“会话切换前台读取”的正式让路语义

`prompt.ts` 已经对会话主输出链路做了保护：

- `summaryScheduler.foregroundStart(sessionID)`
- `summaryScheduler.foregroundFinish(sessionID)`

所以后台 Diff 不会再卡住会话输出。

但会话切换使用的前台读取链路目前没有等价保护：

- `session.messages`
- `session.diff`
- `useSessionActivation()` 历史扫描期间的分页读取

与此同时，`useSessionVisibilitySync()` 又会过早把当前会话放入 background visible set，导致 scheduler 很可能在前台读取尚未完成前就启动后台 summary/diff。

### 3. 问题不是“后台任务太多并发”，而是“后台启动时机太早”

当前 `summary-scheduler.ts` 已具备以下合并语义：

- 同一 session 不会并发跑多个 diff
- 单实例同一时刻只跑一个后台 diff（`backgroundRunning`）
- 重复 `markDirty(...)` 只会合并为最新版本（`dirty / rerunNeeded / version / runVersion`）

所以本轮不是为了解决“任务堆积并发爆炸”，而是为了解决：

- 可见会话一上报，后台 diff 启动得过早
- 前台读取与后台 diff 抢占同一实例的处理时间

## 方案比较

### 方案 A：只在后端读取路由上加 foreground 保护

对 `session.messages` / `session.diff`（必要时 `session.get`）统一包 `foregroundStart/foregroundFinish`。

#### 优点

- 改动集中在后端
- 所有客户端都会受益，不只 WebGUI

#### 缺点

- 无法完全阻断竞态窗口
- 如果 `/session/visibility` 已经先触发后台 diff，前台读取随后才开始，则已启动的后台 diff 仍然可能先占住资源

### 方案 B：前端延后 visibility 同步 + 后端关键读取保护（推荐）

在前端把“正在激活/读取中的当前会话”暂时排除在 background visible set 之外；等关键前台读取完成后，再纳入 `/session/visibility` 上报集合。与此同时，后端关键读取路由继续包一层 foreground 保护。

#### 优点

- 直接解决“可见会话上报过早”的根因
- 后端仍提供统一兜底，防止未来其他入口重犯
- 不改变现有 diff 合并语义，也不新增任务队列

#### 缺点

- 需要前后端一起改动
- 需要定义清晰的“激活完成”边界

### 方案 C：重做为可抢占/可取消后台 Diff

让 foreground 请求到来时中断 `summary.summarize()` / `snapshot.diffFull()`。

#### 优点

- 理论上优先级最强

#### 缺点

- 架构改动明显超出本轮范围
- 需要触碰底层 summary/diff 的可中断性与状态一致性
- 风险大、回报不成比例

## 设计决策

采用 **方案 B：前端延后 visibility 同步 + 后端关键读取保护**。

核心规则是：

> 后台 Diff 只能在“当前没有关键前台会话读取”时启动。

这条规则只改变后台 diff 的**执行时机**，不改变 dirty 判定，不改变 diff 状态模型，不改变最终会执行这一事实。

## 详细设计

### 1. 定义关键前台会话读取范围

本轮按用户确认的 `1/A` 范围，统一覆盖以下前台读取：

1. **会话消息首屏加载**
   - WebGUI：`MessagesContext.ensureSession()` / `loadLatest()`
   - 后端：`GET /session/:id/messages?limit=...`

2. **会话激活时的历史扫描**
   - WebGUI：`useSessionActivation()` 中的 `scanOlder(...)`
   - 后端：`GET /session/:id/messages?before=...&limit=...`

3. **当前会话 Diff 首次读取**
   - WebGUI：`SessionContext` 在 `currentSession` 变化后触发的 `sdk.session.diff(...)`
   - 后端：`GET /session/:id/diff`

4. **必要时的当前会话基础读取**
   - 若某些切换路径会稳定命中 `GET /session/:id`，则纳入同类保护
   - 若只是少量 fallback 且无明显竞争，则不强行扩大范围

### 2. 前端：把“当前前台激活中的会话”延后纳入 visibility

#### 新语义

前端需要区分两类“可见”：

- **UI 可见**：用户已切到该会话，界面正在加载它
- **后台可刷新**：该会话已经完成关键前台读取，可以安全交给后台 Diff 调度

当前问题在于这两者被当成同一件事。

#### 设计

在 WebGUI 中新增“foreground-protected / activating session IDs”语义：

- 当会话切换开始，当前目标 session 先进入 activating 集合
- `useSessionVisibilitySync()` 计算上报给 `/session/visibility` 的集合时，需要把这些 activating session 暂时排除
- 待以下关键前台读取完成后，再把该 session 移出 activating 集合，并触发一次 visibility 收口同步：
  - `ensureSession(...)` 完成（成功或明确失败）
  - `useSessionActivation()` 的选择恢复流程完成（成功恢复或明确 fallback）
  - 当前会话首次 `diff` 读取完成（成功或失败）

这里的“完成”必须是**收口语义**，不是只看成功路径。否则失败态会让 session 永久停留在 activating 集合里。

### 3. 后端：为关键前台读取补 foreground 保护

沿用 `summaryScheduler.foregroundStart/foregroundFinish` 现有正式语义，把同类保护补到关键读取路由：

- `session.messages`
- `session.diff`
- 如有必要再补 `session.get`

#### 语义要求

- 进入关键前台读取时：`foregroundCount += 1`
- 退出时：`foregroundCount -= 1`
- 只要 `foregroundCount > 0`，scheduler 就不能启动新的后台 diff
- 当 `foregroundCount` 归零时，再统一执行现有的：
  - `scheduleDirty(data)`
  - `signal(data)`

这样可以保证：

- 前台读取期间不会再启动新的后台 diff
- 前台读取结束后，dirty session 仍会自动恢复后台刷新

### 4. 不新增 Diff 触发源，只推迟启动时机

本轮不允许在 foreground 结束时额外补 `markDirty(...)` 或重新发明一套 retry/queue 逻辑。

正式写路径仍然只有：

- `prompt.ts`
- `processor.ts`

foreground 保护只是让现有 dirty session 在“更合适的时间”被调度，不改变 dirty 的来源。

### 5. 避免 visibility / wake 抖动

本轮需要控制的不是后台并发数量，而是重复抖动：

#### 前端侧

- `useSessionVisibilitySync()` 只在 activating 集合变化或 openTabs/currentSession 变化后做一次收口同步
- 不因为前台加载过程中的每个子步骤都单独上报一次 visibility

#### 后端侧

- 继续沿用现有 scheduler 合并语义
- 不新增额外后台 worker
- foreground 结束只走现有 `scheduleDirty() + signal()` 收口路径

### 6. 对现有正式行为的影响边界

#### 保持不变

- 会话输出不再被 diff 卡住
- `session.diff.status` 仍按 `scheduled/running/idle/failed/deleted` 发布
- `SessionContext.sessionDiffStatus` 仍映射为 `updating/latest/failed`
- `FileChangesPanel` UI 不变

#### 将被修正

- 会话切换时的“正在加载会话内容…”不应被后台 Diff 长时间阻塞
- 底部“正在切换会话设置…”不应被后台 Diff 长时间悬挂
- 当前会话首次 Diff 读取不应与后台 Diff 抢跑

## 实现边界建议

### 前端建议触点

- `packages/opencode/webgui/src/hooks/useSessionVisibilitySync.ts`
- `packages/opencode/webgui/src/state/useSessionActivation.ts`
- `packages/opencode/webgui/src/state/MessagesContext.tsx`
- `packages/opencode/webgui/src/state/SessionContext.tsx`
- 如有必要，新增一个轻量的 foreground activation 协调状态存放点

### 后端建议触点

- `packages/opencode/src/server/routes/instance/httpapi/session.ts`
- 如非 httpapi 路由也暴露同类读取语义，需保持两个入口一致
- `packages/opencode/src/session/summary-scheduler.ts` 本轮原则上只复用现有能力，不重构核心状态模型

## 风险与防护

### 风险 1：会话一直停留在 activating 状态

若前端只在成功路径清除 activating，会导致：

- 该 session 永远不再被纳入 background visible set
- 后台 diff 可能长期不再恢复

#### 防护

- activating 的释放必须覆盖 success / error / fallback 三条收口路径

### 风险 2：foreground 范围过大导致后台 Diff 长期饥饿

如果把 config/path/provider 等轻量接口也算入 foreground，会导致后台 diff 被无意义延后。

#### 防护

- 只保护关键前台会话读取，不扩大到所有 HTTP 请求

### 风险 3：只修前端或只修后端导致竞态仍残留

#### 防护

- 前端负责防止“过早上报 visible 触发后台 diff”
- 后端负责防止“前台读取开始后又启动新的后台 diff”
- 两侧都要补齐，不能只做单边修复

## 验证矩阵

### 1. 前端行为测试

- `useSessionVisibilitySync`：
  - activating session 不应立即进入 `syncVisible` 集合
  - 激活完成后应进入 `syncVisible` 集合

- `useSessionActivation`：
  - `ensureSession(...)` / `scanOlder(...)` 未收口前，selection 仍 pending
  - 收口后正确 `restoreSelections(...)` 或 `resolveSelections(...)`

- `SessionContext` / `App`：
  - 会话切换时 loading gate 最终解除
  - diff status 仍可正常显示 `updating/latest/failed`

### 2. 后端接口测试

- `session.messages` 前台读取期间不会启动新的后台 diff
- `session.diff` 前台读取期间不会启动新的后台 diff
- foreground 结束后 dirty session 会恢复调度
- 多次 foreground 进入/退出时，只有计数归零后才统一恢复后台调度

### 3. 回归验证

- 原有“Diff 不再卡会话输出”的正式回归不退化
- 当前会话首次进入时，消息加载、selection 恢复、diff 首次读取均能完成
- 不出现大量并发后台 diff 或无穷重试

### 4. 构建与类型

- `bun run --cwd packages/opencode typecheck`
- `bun run --cwd packages/opencode/webgui test:run ...`（受影响测试集）
- `bun run --cwd packages/opencode/webgui build`

## 成功标准

只有同时满足以下条件，才算本轮完成：

- 切换到大 Diff 会话时，不再长期停在“正在加载会话内容…”
- 切回来时，底部 agent/model 恢复不再长期停在“正在切换会话设置…”
- 当前会话首次 Diff 读取不再被后台 Diff 抢跑
- 后台 Diff 最终仍会在前台读取结束后自动执行
- 不新增新的 Diff 触发源，不破坏现有 scheduler 合并语义
- 原有“Diff 不再卡会话输出”的正式修复不回退

## 结论

本轮不是继续把 Diff 做得“更异步”，而是给现有异步 Diff 补上**前台读取优先级**。通过“前端延后 visibility 上报 + 后端关键读取 foreground 保护”的双保险，可以把后台 Diff 的启动时机稳定地推迟到关键前台会话读取之后，同时保留现有 scheduler 的合并执行模型，避免重新引入会话输出卡顿、会话切换卡顿或后台任务堆积三类问题。
