---
generated_from_state_version: 30
---

# 验证

## 当前结果

- 结果: **未通过**
- 验证情况: **修复未通过的验收项后重新验证**
- 目标周期: 7
- 迭代: 1
- 验证器尝试次数: 1
- 完成时间: 2026-09-15T03:44:17.806Z
- 摘要: 11/12 通过；A2 因 steer 在 pending tool work 前消费而失败，需要移动消费边界并补测试。

## 验收

| 编号 | 结果 | 来源 | 验收项 | 原因 |
| --- | --- | --- | --- | --- |
| A1 | passed | brief.md | A1：空闲时回车直接发送；运行中回车打开“立即补充／排队发送”弹窗；取消保留草稿，确认成功清空并可连续提交；Shift+Enter 换行、IME 回车确认和停止按钮保持正确。 | Busy Enter、取消、IME、Shift+Enter 和草稿保护符合要求。 |
| A2 | failed | brief.md | A2：当前响应与关联工具完成后，只批量接收列表开头连续的补充消息并按顺序作为独立 user 消息进入下一次 LLM 请求；排队消息后的补充不得越过屏障，边界后到达的输入等待后续边界；当前响应自然 stop 时仍处理符合顺序的已接收补充。 | runLoop 在识别并执行 pending tool work 前消费 steer，工具调用响应期间提交的补充可能提前进入该任务的工具后续 provider turn。 |
| A3 | passed | brief.md | A3：排队消息不进入当前任务的工具后续上下文；当前任务自然结束后只启动列表最前的一条排队消息，其执行边界后才允许处理位于其后的补充，完成该条任务后再考虑下一条排队消息；含工具调用的 provider stop 不被误判为任务完成。 | queue 屏障和自然完成判定符合要求。 |
| A4 | passed | brief.md | A4：两种模式共享服务端顺序列表，默认为展开状态并展示全部待发送项及总数，支持手动收起后仅展示首条；补充项显示“转排队／上移／删除”，排队项显示“转补充／上移／删除”，第一项不显示上移，当前模式按钮隐藏；空列表不占位，已消费项移入正式对话；删除成功的任意待发送项按确认结果回填输入框或丢弃。 | 默认展开、手动收起保持和列表控制符合最终 Shape。 |
| A5 | passed | brief.md | A5：模式切换保持 ID、内容和顺序；上移将当前待发送项与前一项原子交换并同步到多窗口，用户把补充移到排队消息前后该补充才可提前释放；删除只在服务端确认成功后回填完整文本和附件，与消费竞争失败时不修改草稿；重排、转换、删除与消费竞争时服务端只接受一个结果，已消费项不可伪装成操作成功。 | 转换、相邻上移、删除 payload 与竞争裁决符合要求。 |
| A6 | passed | brief.md | A6：第一次手动停止即暂停待发送列表，优雅收尾和确认强制终止均不自动消费剩余消息；停止过程中仍可编辑或提交到暂停列表，模式转换不启动 AI，保留既有两阶段停止和审批拒绝行为。 | 优雅/强制停止均先暂停队列。 |
| A7 | passed | brief.md | A7：停止结束后“发送下一条”按展示顺序启动第一条并恢复自动消费，运行中不可重复启动；暂停时手动发送一条新草稿会立即解除暂停，旧列表按既有顺序和模式在后续安全边界自动消费；空列表不显示恢复操作。 | 手动 prompt 激活、首轮跳过旧输入与 stop 回滚符合要求。 |
| A8 | passed | brief.md | A8：终止性执行错误或后端重启后保留未消费输入并暂停，provider 可恢复重试期间不提前派发排队项；刷新、切换会话和跨目录会话恢复列表与暂停状态，多窗口修改可同步；历史已写入但请求未开始即停止/崩溃时，正式消息不重复且可由现有重试/继续入口恢复。 | 重启恢复和 revision 同步符合要求。 |
| A9 | passed | brief.md | A9：提交响应丢失后以同一消息 ID 和完整原始快照重试不重复入队或重复进入历史，不同附件、模型、variant 或原始 delivery 的冲突重试失败；非法模式、空输入、不存在会话及跨会话操作被拒绝；快照/事件乱序不能复活已删除或已消费项；准入、停止和消费竞争有单一会话裁决顺序。 | 幂等、校验、会话隔离和单锁裁决符合要求。 |
| A10 | passed | brief.md | A10：提交时文本、图片、文件引用、Agent、模型、variant 保留；连续补充同批使用最新补充选择驱动下一次 LLM 请求；slash command 保持命令语义，失败保留可恢复提示且不消费后续输入。 | 提交快照与 command 延迟展开符合要求。 |
| A11 | passed | brief.md | A11：弹窗支持键盘选择、Escape 取消、焦点返回；删除时若输入框为空则成功后自动回填，若非空则先选择“覆盖输入框并回填”或“保留当前草稿并丢弃待发送内容”，取消不删除；列表操作有可访问名称、状态反馈，浅色/深色及窄屏不遮挡编辑区或停止操作；请求失败不丢草稿、不误报会话空闲。 | 交互、可访问性、删除回填和迟到响应保护符合要求。 |
| A12 | passed | brief.md | A12：后端边界与竞争测试、WebGUI 提交与恢复交互测试、受影响包类型检查及必要 SDK 生成完成；按用户最新要求，由当前 Agent 自行检查，不启动子代理。 | 生成产物与现有验证证据完整，但缺少工具续轮 steer 顺序回归。 |

## 检查

_没有记录 Runtime 检查。_

### Builder 报告的证据

以下为 Builder 报告，不等同于 Runtime 检查凭据或独立验收结果。

- Manual prompt resume and stop race: passed — 先红后绿；完整 prompt.test.ts 69 passed/14 skipped，覆盖 paused->active、首轮跳过旧 steer、steer/queue 边界和 stop 回滚
- OpenCode typecheck: passed — —
- Pending list default expanded: passed — 先红后绿；MessageInput 定向 63 tests passed，覆盖默认展开、手动收起、跨会话保持
- WebGUI typecheck: passed — —
- WebGUI production build: passed — build passed；仅既有 bundle size warning
- Browser desktop and narrow: passed — 1920px 与窄窗均默认展开两项、可收起、无编辑区遮挡，console 无 error/warn；临时队列数据已删除
- User browser verification: passed — 用户实际确认暂停状态发送消息后正确转为等待发送
- Independent reviews: passed — 暂停恢复 ref ses_f5d01c704ffeEbOe9B6WLVGpLy；默认展开 ref ses_f5cec4d9dffeDFZygCd6eZYCWg
- Previous complete candidate: passed — WebGUI full 1615 tests、OpenCode queue/HttpApi、Protocol/Client/SDK/WebGUI typechecks、SDK generation、build 与 desktop/375px browser 均通过
- git diff --check: passed — —
- 已知限制: WebGUI 全仓 lint 存在既有错误；本轮改动不新增依赖，相关测试、类型检查和 build 通过。
- 已知限制: PendingInputBar 两个既有文件不完全匹配当前 Prettier 输出；为避免无关整文件格式化未改写。
- 已知限制: 未使用真实外部 provider，provider 顺序由 TestLLMServer 验证。

## 阻塞项

_无。_

## 风险与跳过的工作

- 缺少工具续轮期间 leading steer 不提前晋升的确定性回归。

## 之前的迭代

| 目标周期 | 迭代 | 尝试 | 结果 | 未解决项 | 摘要 | 完成时间 |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 1 | 0 | recovery | — | Native confirmed acceptance criteria changed | 2026-09-15T00:45:41.326Z |
| 2 | 1 | 1 | fail | A2, A3, A8, A12 | 独立只读 Verifier 确认 state -> add/snapshot -> useInputQueue 的暂停回归，候选需退回 Build 修复空队列 owner 交接。 | 2026-09-15T00:59:02.475Z |
| 2 | 2 | 0 | recovery | — | 用户新增并确认待发送消息上移功能和严格顺序语义：每条非首项可向上移动一位并持久化；排队消息作为屏障，其后的补充不得越过提前释放，只有手动移到屏障前才可提前释放。 | 2026-09-15T01:16:52.091Z |
| 3 | 0 | 0 | recovery | — | Native confirmed acceptance criteria changed | 2026-09-15T01:41:43.353Z |
| 4 | 1 | 1 | pass | — | 独立只读 Verifier 核实候选满足相邻上移、严格 queue 屏障、删除 payload、草稿恢复和并发回填保护，结论 pass。 | 2026-09-15T02:40:15.502Z |
| 4 | 1 | 1 | recovery | — | 用户实测发现：队列已暂停时手动发送新消息后，旧待发送列表仍显示已暂停，未恢复为等待发送；返回 Build 修复该状态转换并补回归验证。 | 2026-09-15T02:45:13.698Z |
| 4 | 2 | 0 | recovery | — | Native confirmed acceptance criteria changed | 2026-09-15T03:12:52.277Z |
| 5 | 0 | 0 | recovery | — | Native confirmed acceptance criteria changed | 2026-09-15T03:18:28.056Z |
| 6 | 1 | 0 | recovery | — | Native Shape artifacts changed | 2026-09-15T03:37:38.154Z |
| 7 | 1 | 1 | fail | A2 | 11/12 通过；A2 因 steer 在 pending tool work 前消费而失败，需要移动消费边界并补测试。 | 2026-09-15T03:44:17.806Z |



## 结论

11/12 通过；A2 因 steer 在 pending tool work 前消费而失败，需要移动消费边界并补测试。
