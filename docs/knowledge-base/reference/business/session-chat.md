# 能力：会话、消息流与多标签聊天

> **象限**：Reference（能力参考）
> **能力编号**：B1 + B2 + B3 + B5（见 [capabilities-index](../capabilities-index.md)）
> **基线状态**：基线

## 代码真源

| 角色 | 文件 |
|------|------|
| 会话状态与生命周期 | `packages/opencode/webgui/src/state/SessionContext.tsx` |
| 消息流、分页、SSE 事件 | `packages/opencode/webgui/src/state/MessagesContext.tsx` |
| 消息 store 纯逻辑 | `packages/opencode/webgui/src/lib/messagesStore.ts` |
| 多标签状态 | `packages/opencode/webgui/src/state/tabStore.ts` |
| 标签淘汰策略 | `packages/opencode/webgui/src/state/tabPolicy.ts` |
| 滚动稳态 | `packages/opencode/webgui/src/components/MessageList/hooks/useMessageScroll.ts` |

> 命名交叉核验（Step 5）：`SessionContext` 暴露 create/switch/fork/revert/retry/delete 等会话生命周期 API（第 96-109 行）；`MessagesContext` 暴露 latest/older/scanOlder 分页 API（第 72-80 行）；`tabPolicy.ts` 第 6 行定义 `MAX_OPEN_TABS = 6`。

## 意图

在上游 opencode session 之上提供 IDE 友好的多会话聊天工作台：会话生命周期、消息增量、历史分页、多标签恢复与滚动稳态在前端收口，避免用户切换项目/会话时丢上下文。

## 行为契约

- 会话列表过滤 subagent session；`isSubagentSession` 用 `parentID` 和标题 `(@... subagent)` 判定，`listSessions` 写入状态前过滤（`SessionContext.tsx` 第 172-176、697-707 行）。
- `switchSession` 优先使用本地 session list，缺失时调用 `sdk.session.get`；并用 token 避免旧请求覆盖新切换（`SessionContext.tsx` 第 790-830 行）。
- 创建 session 成功后只设置 current session，不直接插入列表，等待 `session.created` 事件避免重复（`SessionContext.tsx` 第 766-772 行）。
- 消息分页页大小为 50，分页状态区分 `latest_loading/latest_error` 与 `older_loading/older_error`（`MessagesContext.tsx` 第 24-34 行）。
- `loadLatest` 只加载最近一页；如果传入 AbortSignal 已 abort，不把结果标为 loaded 或 error（`MessagesContext.tsx` 第 654-823 行）。
- `loadOlder` 使用 cursor + `before` 拉更早页，并对同会话并发 older 请求去重；abort 只清 loading，不误标 error（`MessagesContext.tsx` 第 837-935 行）。
- `scanOlder` 只返回 rows/cursor，不写 visible messages，也不改分页状态，供选择恢复后台扫描使用（`MessagesContext.tsx` 第 938-959 行）。
- SSE 事件会 upsert message/part、追加 text delta、移除 message/part，并把 `session.error` 合成 `session-error` part（`MessagesContext.tsx` 第 480-608 行）。
- 多标签只是 UI 工作台状态，关闭 tab 不删除 session；打开已有 tab 只激活，新 tab 超过 6 个时淘汰一个旧 tab（`tabStore.ts` 第 115-147 行；`tabPolicy.ts` 第 6-31 行）。
- tabs 持久化到 repo，并在 reorder 时 500ms debounce，卸载时 flush（`tabStore.ts` 第 14、47-65、91-101 行）。
- 滚动 hook 用 following/detached/seeking 三态；用户向上滚动、scrollbar、键盘意图会脱离底部自动跟随（`useMessageScroll.ts` 第 59-67、138-147、341-355 行）。
- tail 区变化在用户仍贴底时 pin bottom；history restore/trim 和 programmatic scroll 有独立 cause，避免历史加载把用户强拉到底部（`useMessageScroll.ts` 第 195-241、257-337 行）。

## 边界与约束

- `SessionContext` 管会话元数据、生命周期、busy/reasoning/diff；`MessagesContext` 管消息内容、分页、permission/question，这是维护边界。
- `MAX_OPEN_TABS = 6` 是硬策略，不是用户偏好配置。
- 消息历史不是一次性全量加载；依赖全历史的逻辑必须使用分页 cursor 或后台 scan，不要假设 visible messages 完整。
- `scanOlder` 是后台读取工具，不更新 `sessionPageRef`、`messages` 或 UI loading 状态（`MessagesContext.tsx` 第 938-959 行）。
- 关闭 tab 只改 `tabStore`/`tabsRepo`，真实删除 session 必须走 `deleteSession`（`tabStore.ts` 第 128-159 行；`SessionContext.tsx` 第 926-955 行）。
- abort 导致的 latest/older 返回不会标成真实错误；真实错误才写 `latest_error` 或 `older_error`。
- 会话聊天约束已内化到本文；状态作用域见 [scoped-storage 能力参考](scoped-storage.md)。

## 静态核验点

- 消息分页测试锁定 abort、older 去重和 latest/older 语义：`packages/opencode/webgui/src/state/MessagesContext.pagination.test.tsx`。
- tab 策略是纯函数，可用 `tabPolicy.ts` 独立核验上限与淘汰规则。
- `useMessageScroll` 直接读取 `jcefScrollMultiplier` URL 参数，只有运行在 JCEF/浏览器时才生效（`useMessageScroll.ts` 第 6-13、81 行）。

## 漂移风险

- 修改 SSE event type 或 SDK message shape 时，必须同步 `MessagesContext` 的 event handlers 和 `messagesStore`。
- 修改会话列表展示时，不要移除 subagent session 过滤，否则主会话历史会混入子任务。
- 修改滚动 hook 时，要分别验证 tail 自动跟随和 history anchor，不要用一个全局 scroll-to-bottom 规则覆盖。
- 修改 tab 持久化时，保持 active tab 与 open tabs 同步校验，避免恢复到不存在的会话 id。
- 修改 retry/revert/fork UI 时，先确认 `SessionContext` 对应方法是否仍返回最新 session。
- 修改 message part adapter 时，同步检查 SSE delta 与 full part update 两条路径。
- 修改 pagination cursor header 时，同步 `nextCursor` 的大小写读取逻辑。

## 运行时待核验

- [ ] JCEF `jcefScrollMultiplier` 在真实 JetBrains 鼠标/触控板滚动下是否仍保持滚动距离自然（`待运行时核验`：需要 JetBrains JCEF 实机）。
- [ ] 多 tab 快速切换 + SSE 高频增量时，foreground 保护和滚动跟随是否无可见跳动（`待运行时核验`：需要长会话实时流场景）。

## 相关

- 模型/Agent/Variant 选择恢复：[model-selection](model-selection.md)
- 消息输入：[message-input](message-input.md)
- scoped storage：[scoped-storage](scoped-storage.md)
- 前台读取优先级：[foreground-read-priority](foreground-read-priority.md)
