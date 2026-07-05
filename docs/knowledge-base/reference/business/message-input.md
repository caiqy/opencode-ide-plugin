# 能力：消息输入、附件、mention、command 与快捷短语

> **象限**：Reference（能力参考）
> **能力编号**：B6 + B7（见 [capabilities-index](../capabilities-index.md)）
> **基线状态**：B6 基线；B7 **新增**

## 代码真源

| 角色 | 文件 |
|------|------|
| 输入区壳层 | `packages/opencode/webgui/src/components/MessageInput/index.tsx` |
| Lexical 配置 | `packages/opencode/webgui/src/components/MessageInput/EditorConfig.ts` |
| 发送/abort/command 逻辑 | `packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.ts` |
| 消息 part 提取 | `packages/opencode/webgui/src/components/MessageInput/hooks/useMessageParts.ts` |
| `/command` 精确解析 | `packages/opencode/webgui/src/components/MessageInput/hooks/resolveSlashInput.ts` |
| 附件节点与上传 | `packages/opencode/webgui/src/components/attachment/`、`MessageInput/hooks/useFileAttachment.ts` |
| mention 搜索与节点 | `packages/opencode/webgui/src/components/mention/`、`hooks/useMentionSearch.ts` |
| 快捷短语状态与 UI | `packages/opencode/webgui/src/state/repo/quickPhraseRepo.ts`、`components/MessageInput/QuickPhraseBar.tsx`、`components/settings/QuickPhrasesTab.tsx` |
| 草稿状态 | `packages/opencode/webgui/src/state/repo/draftRepo.ts` |

> 命名交叉核验（Step 5）：B6 的 MessageInput 使用 LexicalComposer（`index.tsx` 第 46-59 行）；B7 的 quick phrase 全局 key 是 `opencode:webgui:global:quick_phrase:v1`（`quickPhraseRepo.ts` 第 4 行），能力为新增。

## 意图

提供 IDE 聊天的主要输入面：富文本编辑、上下文 mention、附件、slash command、会话草稿和快捷短语都在同一输入区完成，并在 busy/selection restore/load error 时保护发送。

## 行为契约

- Lexical 编辑器注册 `MentionNode` 与 `AttachmentNode`，namespace 固定为 `MessageInput`（`EditorConfig.ts` 第 13-21 行）。
- 输入草稿按 sessionID 存在 workspace drafts；空内容删除当前 session 草稿，首条消息前会保存 draft session id（`MessageInput/index.tsx` 第 106-128、210-227 行；`draftRepo.ts` 第 3-4、30-63 行）。
- 发送前调用 `resolveSlashInput`；只有 `/name` 精确命中 command 真源才走 `sdk.session.command`，否则按普通 prompt 发送并保留前导 `/`（`resolveSlashInput.ts` 第 9-51 行；`useMessageInput.ts` 第 68-144 行）。
- editor 发送普通消息时先插入 optimistic user message；command 和 quick phrase 不插入 editor optimistic message（`useMessageInput.ts` 第 73-96 行）。
- command 请求体包含 command、arguments、agent，并在已选择模型/variant 时附带 model/variant（`useMessageInput.ts` 第 98-118 行）。
- prompt 请求体来自 `extractMessageParts()`，包含 text、file/agent/symbol mention、attachment file part，并附带 agent/model/variant（`useMessageInput.ts` 第 120-144 行；`useMessageParts.ts` 第 13-225 行）。
- mention 搜索同时查文件/目录、agent、symbol，并把 IDE opened files 放在前面；agent mention 排除 hidden 和 primary agent（`useMentionSearch.ts` 第 42-75、98-155 行）。
- 文件和 symbol mention 会转为 file part；symbol source 带 name/range/kind，agent mention 转为 agent part（`useMessageParts.ts` 第 113-201 行）。
- 附件上传只接受 image/PDF/text；不支持类型直接 toast，text attachment MIME 统一归一为 `text/plain`（`useFileAttachment.ts` 第 26-42 行；`fileUtils.ts` 第 53-76 行）。
- abort 当前会话前会先 reject 该 session 下仍未回答的 question，再调用 `sdk.session.abort`，避免 UI 留下阻塞问题卡片（`useMessageInput.ts` 第 224-251 行）。
- 快捷短语由 preset 与 custom 合并；preset 可隐藏，custom 可新增/编辑/删除，排序和隐藏状态写 global scoped storage（`quickPhraseRepo.ts` 第 57-96、125-231 行）。
- 输入区监听 `quick_phrase_updated_event`，设置页保存后无需刷新 WebGUI 即可更新快捷短语栏（`MessageInput/index.tsx` 第 229-246 行）。
- 快捷短语左键双击立即发送，右键 400ms 内双击回填输入框；disabled 时两者都不执行（`QuickPhraseBar.tsx` 第 16、59-73、88-99 行）。

## 边界与约束

- `/command` 补全和真实发送必须共用 command 真源；不要只按文本前缀判断 command。
- 附件是 data URL 进入消息 part；目录/文件路径上下文主要通过 mention part 表达，不等同于上传本地文件内容。
- 快捷短语是 WebGUI global UI 状态，不写 opencode config；B7 是新增能力，旧基线文档可能没有。
- quick phrase 发送走 `source: "quick_phrase"`，不会清空当前 editor，也不会写 editor optimistic message（`useMessageInput.ts` 第 68-80、190-205 行）。
- 输入 locked 条件包含 busy、外部 blocked、selection restore pending；locked 时 editor 设为不可编辑，拖拽/插入/快捷短语发送都受保护（`MessageInput/index.tsx` 第 198-208、337-340、431-455 行）。
- 快捷短语 custom 的空 title/body 更新会被忽略并返回当前状态（`quickPhraseRepo.ts` 第 158-164、189-195 行）。
- 输入系统约束已内化到本文；WebGUI 组件入口见 [packages-opencode 参考](../repositories/packages-opencode.md)。

## 静态核验点

- `resolveSlashInput` 有测试文件 `resolveSlashInput.test.ts`，用于锁定“精确命中才是 command”的合同。
- `QuickPhraseBar.test.tsx` 锁定左键双击发送、右键双击回填和 disabled 行为。
- `useFileAttachment` 在每轮 file input change 末尾清空 input value，允许重复选择同一文件（`useFileAttachment.ts` 第 68-71 行）。

## 漂移风险

- 改 Lexical node metadata 时，必须同步 `useMessageParts`，否则 mention/attachment 发送 part 会丢 source 定位。
- 改 command 搜索缓存时，必须保留 resolve 失败后 force refresh 的路径，避免新 command 误发成普通消息。

## 运行时待核验

- [ ] `@目录`、PDF、图片、文本、其他二进制 mention 到后端后的实际分流顺序是否完全符合本文约束（`待运行时核验`：前端只静态确认 part 组装，后端读取策略需端到端验证）。
- [ ] 右键双击快捷短语在 VSCode webview 与 JetBrains JCEF 中是否都不会被宿主 context menu 抢占（`待运行时核验`：需要宿主实机）。

## 相关

- 会话与聊天：[session-chat](session-chat.md)
- 上下文插入：[context-insertion](context-insertion.md)
- scoped storage：[scoped-storage](scoped-storage.md)
- 宿主动作与文件打开：[host-actions](host-actions.md)
