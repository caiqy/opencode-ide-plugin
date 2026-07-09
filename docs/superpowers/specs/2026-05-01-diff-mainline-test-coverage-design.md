# Diff 主线需求测试覆盖补齐设计

## 背景

当前工作树里与 Diff 主线直接相关的正式改动，主要来自两轮设计：

1. `2026-04-30-webgui-async-diff-refresh-*`
2. `2026-05-01-session-foreground-read-priority-over-diff-*`

它们共同定义了当前正式产品行为：

- `prompt.ts` / `processor.ts` 只负责 `markDirty(...)`
- `SessionSummaryScheduler` 负责后台 summary/diff 调度
- `/session/visibility` 决定哪些会话允许优先进入后台刷新
- 前端通过 `session.diff.status -> SessionContext.sessionDiffStatus -> FooterPanels/FileChangesPanel` 展示 `updating/latest/failed`
- 当前会话切换、消息读取、历史扫描、首次 diff 读取需要优先于后台 diff 执行

上一轮实现与 review 已经把多个高风险时序洞修掉，但用户现在提出新的要求：

> 检查最近这几组修改的需求，是否都有测试完整覆盖，尽量补齐，避免后续更新导致回归。

同时用户明确缩小范围：

- 只看 **Diff 主线**
- **不做 cleanup** 那组需求覆盖检查

因此这次目标不是继续改产品逻辑，而是把 Diff 主线的需求覆盖系统化梳理一遍，并只补真正缺失或仅间接覆盖的高风险回归测试。

## 目标

- 为 Diff 主线建立一份明确的“需求 -> 测试”覆盖矩阵
- 将每条关键需求判定为：
  - 已直接覆盖
  - 仅间接覆盖
  - 未覆盖
- 只补齐 **未覆盖** 与 **高风险仅间接覆盖** 的测试
- 保持测试改动聚焦，不扩大到 cleanup 或无关工作树改动

## 非目标

- 本轮不重新设计或重写 Diff 主线产品逻辑
- 本轮不评估 cleanup 设计（`2026-04-30-debug-cleanup-after-async-diff-fix-*`）的测试覆盖
- 本轮不为无关工作树改动补测试
- 本轮不追求覆盖率数字，而是追求“关键需求有直接回归锁定”

## 范围

### 纳入范围的 spec / plan

- `docs/superpowers/specs/2026-04-30-webgui-async-diff-refresh-design.md`
- `docs/superpowers/plans/2026-04-30-webgui-async-diff-refresh.md`
- `docs/superpowers/specs/2026-05-01-session-foreground-read-priority-over-diff-design.md`
- `docs/superpowers/plans/2026-05-01-session-foreground-read-priority-over-diff.md`

### 排除范围

- `docs/superpowers/specs/2026-04-30-debug-cleanup-after-async-diff-fix-design.md`
- `docs/superpowers/plans/2026-04-30-debug-cleanup-after-async-diff-fix.md`

## 覆盖判定标准

### 1. 已直接覆盖

测试直接断言该需求本身，而不是顺带经过相关代码。

例如：

- 直接断言 foreground 期间后台 diff 不会进入 `running`
- 直接断言切换会话后当前 session 在 activation 完成前不会进入 visible set
- 直接断言 abort 后不进入 `latest_error` / `older_error`

### 2. 仅间接覆盖

测试路径经过了相关代码，但断言没有锁住该需求语义。

例如：

- 某个 activation 测试顺带跑到了 `scanOlder(...)`
- 某个 context 测试顺带消费了 `session.diff.status`
- 某个路由测试顺带经过 wrapper，但没有断言关键状态序列

这类测试最容易在未来重构时“看起来还绿，但需求已经悄悄坏掉”，因此是本轮重点补强对象。

### 3. 未覆盖

需求目前只能依赖人工 code review、运行日志或推断来相信正确，没有自动化回归直接锁住。

这类需求必须优先补齐。

## 需求分组

### A. 后端调度语义

应覆盖：

- `markDirty(...) -> scheduler -> summarize/diff` 正式闭环
- foreground 期间不启动后台 diff
- foreground 结束后 dirty session 恢复调度
- visible session gating
- latest-wins / rerunNeeded
- delete / failed / retry 正式状态语义

### B. 前端会话切换与前台优先

应覆盖：

- `switchSession()` 不会过早 visible
- activation 的 success / error / fallback / cancel 收口
- imperative `activate()` 取消路径
- stale response 不覆盖当前 session / 选择
- no-op switch 不泄漏 foreground protection
- `messages/diff` 请求 abort 后真正收口，不留下假错误状态

### C. Diff 状态链

应覆盖：

- `session.diff.status`
- `SessionContext.sessionDiffStatus`
- `FooterPanels`
- `FileChangesPanel`
- `updating/latest/failed` 的状态映射与文案

### D. 真实路由 / 集成兜底

应覆盖：

- `messages`
- `diff`
- `/session/visibility`
- bridge / standard 两套入口
- `messages?before=...&limit=...` 对应的历史扫描真实路由分支

## 方案比较

### 方案 A：按 spec 建立需求覆盖矩阵，再补缺口（推荐）

先列出 Diff 主线每条关键需求，再对照现有测试把它们标成“已覆盖 / 间接覆盖 / 未覆盖”，最后只补高风险缺口。

#### 优点

- 可以明确回答“需求是否完整覆盖”
- 与 spec 对齐，后续回归追踪更清晰
- 适合筛出“看起来有测试，实际只是间接覆盖”的伪安全区

#### 缺点

- 前期梳理比直接写测试更慢一点

### 方案 B：只补高风险时序回归

只围绕 visible race、stale response、abort/cancel、status chain 补测试，不建立完整矩阵。

#### 优点

- 快
- 对时序类 bug 命中率高

#### 缺点

- 无法系统回答“需求是否完整覆盖”
- 容易遗漏非时序但同样关键的正式语义

### 方案 C：主要补更高层 smoke / integration

尽量少写低层测试，更多依赖跨 Context / 路由 / 状态链的集成测试。

#### 优点

- 路径更接近真实使用

#### 缺点

- 定位失败原因更慢
- 对“哪条需求没被锁住”说明力较弱
- 更容易脆

## 设计决策

采用 **方案 A：按 spec 建立需求覆盖矩阵，再补缺口**，但执行顺序会参考方案 B 的优先级：

1. 先建立需求覆盖矩阵
2. 再优先补：
   - reviewer 曾经抓出来、但当时没有第一时间被测试锁住的点
   - 只有 hook/context 间接覆盖、没有真实路由或底层直接测试兜底的点
   - 状态链“看起来有测试”，但断言不够贴需求语言的点

## 预计检查与补测文件

### 后端

#### `packages/opencode/test/server/httpapi-session.test.ts`

重点检查：

- `messages` foreground 保护
- `diff` foreground 保护
- bridge / standard 双入口一致性
- `messages?before=...&limit=...` 的真实路由级历史扫描保护

若最后一项目前只是间接覆盖，本轮应补最小真实路由回归。

#### `packages/opencode/test/session/summary-scheduler.test.ts`

重点检查：

- foreground gating
- foreground 结束后恢复调度
- visible gating
- latest-wins / rerunNeeded
- delete / failed / retry 正式状态语义

若某条正式调度语义仍只靠 `summary.test.ts` 或 reviewer 推断，本轮补到 scheduler 层直接测试。

#### `packages/opencode/test/session/summary.test.ts`

重点检查：

- `canWrite`
- stale write 防回写
- summary/diff 正式闭环

### 前端

#### `packages/opencode/webgui/src/hooks/useSessionVisibilitySync.test.tsx`

重点检查：

- activation 中不进入 visible set
- 收口后再纳入 visible set
- inFlight / retry / latest 收敛逻辑未回退

#### `packages/opencode/webgui/src/state/useSessionActivation.test.tsx`

重点检查：

- success / error / fallback / cancel 收口
- imperative `activate()` 路径
- stale selection response 不覆盖当前选择

#### `packages/opencode/webgui/src/state/MessagesContext.pagination.test.tsx`

重点检查：

- `loadLatest`
- `loadOlder`
- `scanOlder`
- abort reject
- abort `{ error }` resolve
- abort 后不落错误态 / 不误标 loaded

#### `packages/opencode/webgui/src/state/SessionContext.test.tsx`

重点检查：

- `switchSession()` foreground 保护
- no-op switch
- stale remote switch response
- 首次 diff 的 success / error / cancel 收口
- `session.diff.status -> sessionDiffStatus` 映射

#### `packages/opencode/webgui/src/components/MessageInput/FooterPanels.test.tsx`

#### `packages/opencode/webgui/src/components/FileChangesPanel.test.tsx`

重点检查：

- `updating/latest/failed` 状态透传与 UI 文案
- 是否需要补一条更贴“前台优先修复不回退状态链”的断言

## 补测优先级

### 最高优先级

1. reviewer 曾经指出过、但后续只是靠修补修掉的需求点
2. 当前只有间接覆盖的时序风险点
3. 真实路由 before 分支（`messages?before=...`）若尚无直接回归

### 中优先级

1. 状态链断言不够贴需求语言的测试
2. scheduler 正式语义中仍靠其他测试间接兜底的部分

### 低优先级

1. 仅为了提高覆盖率数字的重复断言
2. cleanup 或无关工作树改动的补测

## 验证策略

本轮完成后，需要至少重新运行：

- `bun run --cwd packages/opencode test test/server/httpapi-session.test.ts test/session/summary-scheduler.test.ts test/session/summary.test.ts test/session/prompt.test.ts test/session/processor-effect.test.ts`
- `bun run --cwd packages/opencode/webgui test:run src/hooks/useSessionVisibilitySync.test.tsx src/state/useSessionActivation.test.tsx src/state/MessagesContext.pagination.test.tsx src/state/SessionContext.test.tsx src/components/MessageInput/FooterPanels.test.tsx src/components/FileChangesPanel.test.tsx`
- `bun run --cwd packages/opencode typecheck`
- `bun run --cwd packages/opencode/webgui build`

## 成功标准

只有同时满足以下条件，才算这次“测试补齐”完成：

- Diff 主线关键需求都有明确矩阵归类
- 未覆盖与高风险仅间接覆盖的需求已补上直接回归测试
- 不因补测试引入无关产品改动
- 后端真实路由、前端状态链、调度语义三类关键验证都重新通过

## 结论

这次工作的本质不是“再多写几条测试”，而是把 Diff 主线的正式需求从“实现过、review 过”升级为“有系统的自动化回归锁住”。通过建立覆盖矩阵并只补真正缺失的高价值测试，可以在不扩大范围到 cleanup 或无关改动的前提下，显著降低后续继续跟上游、继续调时序、继续收敛前台/后台边界时的回归风险。
