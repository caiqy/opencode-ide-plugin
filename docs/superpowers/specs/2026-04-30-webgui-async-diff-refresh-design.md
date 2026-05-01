# WebGUI 异步 Diff 刷新设计

## 背景

长上下文会话的真实实验已经把跨会话卡顿主因收敛到 `summary.summarize()`，其中最重部分高度怀疑是 `snapshot.diffFull()`。当前实现把这条重链路放在前台会话生成流程里同步执行，导致一个长会话在生成结束后的重计算阶段占用共享工作区资源，并拖慢同工作区其他会话。

本设计目标不是继续细化定位，而是把 WebGUI 的“文件变更 / Diff”刷新从前台热路径移出，改为统一的后台异步刷新模型，从而优先消除全局卡顿。

## 目标

- 所有会话统一改为“回复先完成，Diff 后刷新”
- 前台会话生成链路不再同步等待 `summary.summarize()`
- 同工作区后台 Diff 刷新受控串行，但不能阻塞前台对话
- 避免后台任务按 step 无限堆积
- 明确处理关闭标签、删除会话与后台任务的交互
- WebGUI 第一版只在“文件变更 / Diff”区域给轻提示

## 非目标

- 本轮不做 `diffFull` 增量算法重写
- 本轮不为所有隐藏数据做完整 UI 状态面板
- 本轮不引入聊天区 toast、全局横幅、标题区强提示
- 本轮不保证 Diff 与回复在同一时刻绝对同步更新

## 设计决策

### 1. 统一改成空闲后异步刷新

所有会话统一使用异步 Diff 刷新，不对小会话保留同步实时模式。这样规则最简单，也最不容易留下边角阻塞路径。

前台会话生成结束后只记录“该会话的 Diff 已过期，需要刷新”，不立刻执行重计算。后台仅在工作区空闲窗口中执行刷新。

### 2. 前台优先，后台让路

允许保留底层 `snapshot` / `gitdir` 级别的必要互斥，但不允许前台回复链路继续等待这条重任务。后台刷新必须是低优先级 lane：

- 只要同工作区有前台会话正在处理，后台不启动
- 如果后台运行中前台任务开始，后台应优先被取消或结果丢弃
- 工作区级后台同时最多 1 个任务

### 3. 不排队任务，只保留最新脏状态

不采用“每个 step finish 都 enqueue 一个 Diff 任务”的模型，而是对每个会话维护可合并的脏状态：

- 多次变更只保留一次待刷新语义
- 运行中再次变脏，只在当前任务结束后补跑一次
- 使用 `latest-wins`，只关心最新版本

这可以避免长会话连续多步生成时后台任务堆积。

### 4. 关闭标签与删除会话是显式生命周期事件

- 关闭标签：取消已计划刷新，运行中任务 best-effort 取消；保留 dirty，待重新打开时再恢复调度
- 删除会话：立即让该会话所有后台任务失效，并禁止任何后续回写或事件发出

## 架构

### 新增模块

新增 `packages/opencode/src/session/summary-scheduler.ts`，职责仅为后台 Diff 刷新调度，不承载业务计算。

它负责：

- 接收 session 级 dirty 信号
- 维护 session 任务状态机
- 维护 workspace 级后台限流
- 处理 debounce、取消、latest-wins
- 接收关闭标签 / 删除会话 / 重新打开等生命周期事件

### 现有模块职责调整

- `packages/opencode/src/session/prompt.ts`
  - 首轮不再同步执行 summary
  - 改为只上报 `markDirty(...)`
- `packages/opencode/src/session/processor.ts`
  - step finish 不再同步执行 summary
  - 改为只上报 `markDirty(...)`
- `packages/opencode/src/session/summary.ts`
  - 收敛为单次执行器
  - 输入 session / workspace / version / signal
  - 负责执行一次 summary/diff 刷新与安全回写
- `packages/opencode/src/session/session.ts`
  - 在前台处理链入口/出口通知 scheduler 当前 workspace 的前台 busy/idle 状态
- WebGUI / IDE 宿主前端桥接层
  - 需要在会话标签打开、关闭、重新打开时，把 session 可见性变化通知后端 scheduler
- 会话删除相关路由/服务
  - 在删除时通知 scheduler 立即失效该会话的后台任务

## 状态机

### Session 状态

每个 session 维护轻量状态：

- `dirty`
- `scheduled`
- `running`
- `rerunNeeded`
- `version`
- `runVersion`
- `closed`
- `deleted`
- `timer`

### Workspace 状态

每个 workspace 维护：

- `foregroundCount`
- `backgroundRunning`
- `pendingSessions`

`workspaceKey` 优先使用 `gitdir`，拿不到时退化到 `directory`。

## 数据流

### 前台生成结束

1. 前台 step 完成
2. `prompt.ts` 或 `processor.ts` 调用 `markDirty(sessionID, workspaceKey)`
3. scheduler 将 session 标记为 dirty，更新 `version`
4. 若当前未运行，则进入 `scheduled`
5. 经过 debounce 等待工作区空闲

### 后台刷新启动

1. scheduler 检查 session 未删除、未过期、允许运行
2. scheduler 检查 workspace 当前无前台任务
3. 若允许，则进入 `running`
4. 调用 `summary.ts` 执行一次 summary/diff 刷新
5. 完成后若中途再次变脏，仅补跑一次最新版本

### 结果写回保护

后台结果写回前必须再次检查：

- session 仍存在
- `deleted = false`
- `runVersion === currentVersion`

任一不满足时：

- 直接丢弃结果
- 不写 DB
- 不发 Diff 事件

## 与关闭标签 / 删除会话的交互

### 关闭标签信号来源

`关闭标签` 是前端会话可见性事件，不应靠后端猜测。第一版需要由 WebGUI / IDE 宿主在标签关闭、重新打开时显式通知后端 scheduler。

如果极端情况下该信号丢失，系统仍保持正确，只是会退化为“该会话可能继续在空闲窗口刷新一次 Diff”，不会影响删除会话的强一致性规则。

### 关闭标签

关闭标签不等于删除会话。第一版设计中，关闭标签会让该会话停止积极后台刷新：

- 已 `scheduled`：取消调度
- 已 `running`：best-effort abort；若无法及时中止，则写回前丢弃
- 保留 `dirty`
- 重新打开该标签时，如果仍 dirty，则重新调度

这样可以避免为当前没人查看的会话持续消耗共享 Diff 资源。

### 删除会话

删除会话是强终止事件：

- 标记 `deleted = true`
- 取消 timer / scheduled
- 运行中任务立即 abort 或在写回前强制丢弃
- 不允许再写 `session_diff`
- 不允许再发相关 Diff 事件

## 错误处理

- 后台 Diff 刷新失败不能影响前台聊天回复成败
- 取消、被抢占、版本过期、会话删除都视为正常退出，不记为错误
- 真正失败后保留 dirty，但采用冷却后再试，避免后台风暴
- 需要新增后台 trace 事件，区分：
  - `summary.bg.scheduled`
  - `summary.bg.start`
  - `summary.bg.finish`
  - `summary.bg.cancelled`
  - `summary.bg.superseded`
  - `summary.bg.deleted`
  - `summary.bg.failed`

## WebGUI 前端表现

当前 WebGUI / IDE 插件界面没有独立 summary 面板，因此第一版只在“文件变更 / Diff”区域增加轻提示，不在聊天区、不在标题区做额外提示。

第一版状态仅保留三类：

1. `更新中`
   - 示例文案：`差异仍在后台刷新，当前显示的是上一版结果`
2. `已最新`
   - 示例文案：`已是最新结果`
3. `刷新失败`
   - 示例文案：`刷新失败，将在空闲后重试`

采用的视觉方向是“仅面板内提示条”，不做全局胶囊，不污染聊天区。

## 测试策略

### 调度器单测

覆盖：

- 多次 `markDirty` 仅合并成一次调度
- `running` 中再次变脏仅补跑一次
- `closeSession` 取消 scheduled
- `deleteSession` 取消 scheduled/running 并禁止回写
- 同 workspace 后台最多 1 个任务
- 前台 busy 时后台不启动
- 前台结束后后台恢复
- 版本过期结果丢弃

### summary 执行链单测

覆盖：

- 正常执行并写回
- 被 abort 后不写回
- session 不存在时丢弃
- `runVersion < currentVersion` 时丢弃
- 失败后进入冷却并保持 dirty

### 集成测试

覆盖：

- `prompt/processor` 只标脏，不同步等待 summary
- 删除会话与后台任务交互
- 后台任务已计划时前台开始生成，后台延后
- 后台运行中前台开始，后台被取消或结果被丢弃
- 关闭标签后停止积极后台刷新，重开后恢复

### 回归重点

- Diff 永远不刷新
- 删除会话后出现幽灵 Diff / event
- 小会话频繁切换时状态机卡死
- 长会话持续生成时后台任务重新堆积

## 上线顺序

### 第 1 阶段

- 前台链路改为只标脏
- 新增后台调度器
- 接入 latest-wins
- 接入删除会话/关闭标签的生命周期保护
- 接入最小 trace
- WebGUI 仅在 Diff 区域展示轻提示

### 第 2 阶段

- 优化 abort 粒度
- 优化冷却/退避参数
- 视需要再研究 `diffFull` 增量化

## 结论

本方案不追求让 Diff 永远实时，而是把“会话回复”与“重 Diff 刷新”从同一前台链路解耦。最终保留的是后台受控串行，而不是前台全局阻塞。这样更符合当前目标：优先彻底消除长上下文会话对同工作区其他对话的拖慢。
