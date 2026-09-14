# 目标

在 WebGUI 对话界面中实现优雅打断（Graceful Stop）与强制打断（Force Abort）的两阶段打断机制。第一次点击停止按钮发起优雅打断，等待当前大模型文本输出与伴随的工具调用完整执行落库后，不再启动后续大模型推理，安全平滑收尾；按钮变为醒目警示红并提供微动效果，输入框上方展示等待收尾的提示横幅；在等待期间，若用户再次点击红色按钮，弹出确认弹窗，经用户确认后执行强制打断，立即中断服务端 Fiber 与子进程；未决的问题（Question）与权限审批（Permission）在优雅打断触发时自动拒绝，消除流程阻塞。

# 范围

- **后端服务端能力扩展（packages/opencode）**：
  - 扩展 `POST /session/:sessionID/abort` 接口的 Schema 与处理器，支持可选请求体 `{ graceful?: boolean }`，缺省为 `false`（保持既有强制打断向下兼容）。
  - 在 `SessionPrompt` / `SessionRunState` 运行时层维护会话的优雅打断标记 `gracefulStoppingSessions`。
  - 在 `SessionPrompt.run` 的 prompt 核心执行循环中，在每轮 step/turn 的边界（大模型流式输出完毕且当前轮次关联工具执行完成后）检测优雅打断标记，若命中则安全 break 退出循环，完成 Assistant 消息正常落库，会话恢复为 `idle` 状态。
- **前端状态与交互（packages/opencode/webgui）**：
  - 在 `SessionContext` 中维护 `gracefulStoppingSessions: Set<string>` 内存状态，支持多标签页会话切换时保持状态。
  - 扩展 `useMessageInput.ts`：第一次点击停止按钮时调用 `sdk.session.abort({ path: { id: sessionID }, body: { graceful: true } })` 并自动拒绝未决 Question 和 Permission；再次点击红色按钮唤起全局 `ConfirmModal` 强停确认弹窗；确认后调用 `sdk.session.abort`（无 graceful 或 `graceful: false`）执行强制打断。
  - 升级 `MessageActions.tsx`：当会话处于优雅打断等待中时，停止按钮样式切换为警示红（`bg-red-500 hover:bg-red-600 text-white`）并带有微动效果，Tooltip 动态显示为“已请求停止，再次点击强制打断”。
  - 新增/集成提示横幅：在 `MessageInput` 输入框上方展示优雅打断等待横幅（`⏸️ 正在等待当前操作完成以优雅停止... 若需立即终止，请点击右下角红色按钮`）；当等待超过 30 秒时自动强化提示。
  - 会话转为空闲（`idle`）时，自动清除优雅打断状态，横幅平滑淡出，按钮无缝恢复为发送箭头，并自动重新聚焦输入框。
- **自动化测试**：
  - 为 WebGUI 前端（`useMessageInput.test.tsx`、`MessageActions.test.tsx`、`MessageInput/index.test.tsx` 等）补充单元测试。
  - 为后端 `abort` API 与 prompt 循环退出逻辑补充针对性单测。

# 非目标

- 不修改 `@opencode-ai/schema` 的跨进程核心协议结构（如不向 `SessionStatus` 增加公共 `stopping` 状态，避免污染 CLI/TUI 等外部宿主）。
- 优雅打断单向不可逆，不提供“撤销停止 / 恢复执行”操作（用户若需继续，待其停下后重新发消息即可）。
- 不破坏现有直接调用 `POST /session/:sessionID/abort` 强停接口的旧客户端向下兼容性。
- 横幅内不放置多余操作按钮，所有点击交互统一汇聚在右下角停止按钮与强停确认弹窗。

# 验收示例

- A1：在 WebGUI 对话中当 AI 正在生成时，点击停止按钮触发优雅打断，按钮变为红色微动状态，输入框上方展示等待收尾的提示横幅，Tooltip 变为“已请求停止，再次点击强制打断”。
- A2：在优雅打断等待期间，大模型当前文字输出正常完成，伴随发起的工具调用正常执行完毕并写盘落库，服务端不在当前回合结束后启动下一轮 LLM 推理，会话平滑退出回到 Idle 状态。
- A3：在优雅打断等待期间，输入框保持可编辑状态，允许用户提前输入文本草稿；当会话转为 Idle 后，红色按钮自动恢复为常规发送箭头，输入框自动获得焦点，且 Assistant 消息正常展示完成耗时（不打红色 interrupted 标记）。
- A4：在优雅打断等待期间，若用户再次点击红色停止按钮，界面弹出全局 ConfirmModal 确认弹窗；用户点击“取消”时关闭弹窗并继续保持优雅打断等待状态。
- A5：在确认弹窗中用户点击“强制打断”时，系统立即调用底层强制打断，立即中断服务端 Fiber 并停止会话。
- A6：在优雅打断触发时，若当前会话存在未决的 Question 提问或 Permission 权限审批，系统自动将其拒绝，避免会话卡在等待审批。
- A7：当优雅打断等待时长超过 30 秒时，横幅文本自动更新并高亮强调工具执行耗时较长，引导用户可通过红色按钮强制打断。
- A8：服务端 `POST /session/:sessionID/abort` 接受可选 `{ graceful: boolean }` 请求体；在 `graceful: true` 时标记当前会话在当前回合结束后优雅退出，在缺省或 `false` 时执行立即强杀。

# 约束与不变量

- 遵循 OpenCode 现有 HttpApi 与 Effect 架构，不破坏现有的类型推导与错误处理边界。
- 优雅打断完成后的 Assistant 消息不包含 `interrupted` 状态，完整保留本回合上下文与工具调用返回值。
- 状态管理在 `SessionContext` 级别集中维护，页面在切换会话 Tab 时能准确保持当前会话的打断状态。
- 强制打断必须经过 `ConfirmModal` 确认，杜绝误触毁坏未落盘命令或文件。

# 决策

- 已确认：采用全链路改造，后端提供优雅退出机制，前端提供两阶段交互。
- 已确认：停止边界为当前回合完整收尾（LLM 输出完毕 + 伴随工具执行完成 + 不开启下轮）。
- 已确认：后端 API 复用并扩展 `POST /session/:sessionID/abort` 接口，支持 `{ graceful?: boolean }` 请求体。
- 已确认：前端通过 `SessionContext` 内存跟踪 `gracefulStoppingSessions: Set<string>`。
- 已确认：再次点击红钮使用 `ConfirmModal` 弹窗进行二次确认。
- 已确认：等待提示采用输入框上方横幅展示，横幅内不设额外按钮，超过 30 秒强化提示。
- 已确认：优雅打断触发时自动 Reject 关联的待办 Question 与 Permission。
- 已确认：优雅停止单向不可逆，收尾转 Idle 后静默恢复并聚焦输入框。

# 待解决问题

# 验证预期

- 运行 WebGUI 单元测试，覆盖 `MessageActions` 红钮渲染、`useMessageInput` 优雅打断请求与确认强停分支、未决审批拒绝、30秒长耗时横幅切换等逻辑。
- 运行后端 session abort 接口与 prompt 循环单测，验证 `{ graceful: true }` 在回合边界切断循环、`graceful: false` 强退的正确性。
- 运行 packages/opencode 与 packages/opencode/webgui 的类型检查与自动化测试。
