# 能力：Diff / patch / 文件变更浏览

> **象限**：Reference（能力参考）
> **能力编号**：C5（见 [capabilities-index](../capabilities-index.md)）
> **基线状态**：**新增**（基线 `overview.md` 未收录）

## 代码真源

| 角色                  | 文件                                                                           |
| --------------------- | ------------------------------------------------------------------------------ |
| Diff 弹窗壳层         | `packages/opencode/webgui/src/components/DiffModal/index.tsx`                  |
| Diff 头部             | `packages/opencode/webgui/src/components/DiffModal/DiffHeader.tsx`             |
| 多文件导航            | `packages/opencode/webgui/src/components/DiffModal/DiffNavigation.tsx`         |
| Diff 内容渲染         | `packages/opencode/webgui/src/components/DiffModal/DiffViewer.tsx`、`utils.ts` |
| Diff 数据获取         | `packages/opencode/webgui/src/components/DiffModal/hooks/useDiffData.ts`       |
| Patch part 展示       | `packages/opencode/webgui/src/components/parts/PatchPart.tsx`                  |
| 文件变更面板          | `packages/opencode/webgui/src/components/FileChangesPanel.tsx`                 |
| diff 与 fallback 合并 | `packages/opencode/webgui/src/hooks/useMergedFileDiffs.ts`                     |

## 意图

把会话内文件变更从单个 tool output 提升为可浏览的 diff 与文件变更摘要，方便用户在输入区和 patch 消息处快速定位改动。

## 行为契约

- `PatchPart` 处理顶层 `patch` part，展示 patch hash、修改文件列表，并提供 `View Diff` 打开 `DiffModal`（`PatchPart.tsx` 第 18-29 行、第 147-193 行）。
- 单文件 patch 的标题可点击打开文件；多文件 patch 显示 `Edited N files`，展开后每个文件名都可打开（`PatchPart.tsx` 第 31-48 行、第 71-145 行）。
- `PatchPart` 展开区显示 Modified Files 和 patch hash 前 8 位，文件路径按 worktree 转 display path（`PatchPart.tsx` 第 24-29 行、第 104-152 行）。
- `DiffModal` 打开时调用 `useDiffData(sessionID, messageID, isOpen)`，初始 split 视图，diff 变化后重置为第一个文件（`DiffModal/index.tsx` 第 15-26 行）。
- `useDiffData` 通过 `sdk.session.diff({ id, messageID })` 拉取服务端 `FileDiff[]`，并用 AbortController 避免关闭后提交旧请求（`useDiffData.ts` 第 5-48 行）。
- `useDiffData` 把 SDK error 和异常都转成“加载差异失败：...”文案（`useDiffData.ts` 第 26-38 行）。
- 弹窗支持 Esc 关闭、点击遮罩关闭、loading/error/empty 三类状态展示（`DiffModal/index.tsx` 第 28-42 行、第 65-124 行）。
- Diff 弹窗 footer 显示文件变更数量，并提供关闭按钮（`DiffModal/index.tsx` 第 127-142 行）。
- 多文件 diff 才显示文件导航；导航按钮显示 basename，tooltip 保留完整路径（`DiffNavigation.tsx` 第 9-33 行）。
- `DiffHeader` 展示 patch hash 前 8 位，并支持 split/unified 两种视图切换（`DiffHeader.tsx` 第 9-59 行）。
- 当前 `DiffViewer` 使用 `diff` 包的 `diffLines` 做纯 React split/unified 渲染，不是 Monaco editor（`DiffViewer.tsx` 第 11-39 行；`utils.ts` 第 5-32 行）。
- split 视图左右两栏分别展示 before/after，新增和删除行用 green/red 背景标识（`DiffViewer.tsx` 第 84-139 行）。
- unified 视图用 `+`、`-`、空格前缀区分 added/removed/unchanged（`DiffViewer.tsx` 第 44-82 行）。
- `FileChangesPanel` 接收 `diffs/fallbackFiles/status`，展示文件数量、modified/deleted、总 additions/deletions、net change，并可打开 modified 文件（`FileChangesPanel.tsx` 第 17-31 行、第 65-147 行）。
- `status.type` 为 `updating/latest/failed` 时，面板顶部显示对应刷新提示；没有变更则不渲染（`FileChangesPanel.tsx` 第 22-30 行、第 61-63 行）。
- 文件变更列表按 basename 排序，同名再按规范化路径排序（`FileChangesPanel.tsx` 第 31-43 行）。
- modified 文件以可点击蓝色 chip 展示 additions/deletions；deleted 文件以删除线灰色 chip 展示（`FileChangesPanel.tsx` 第 84-143 行）。
- `useMergedFileDiffs` 以 `session.diff` 的 `diffs` 为主，`fallbackFiles` 只补充 session diff 没覆盖的文件，补充项 additions/deletions 为 0（`useMergedFileDiffs.ts` 第 6-24 行）。
- 输入区 `FooterPanels` 使用 `useMergedFileDiffs(diffs, modifiedFiles)` 判断是否有文件变更，并把 `diffStatus` 传给 `FileChangesPanel`（`MessageInput/FooterPanels.tsx` 第 111-123 行）。
- `computeDiffLines` 保留 `changes` 给 unified 视图，同时生成左右行数组给 split 视图（`DiffModal/utils.ts` 第 5-32 行）。

## 边界与约束

- Diff 弹窗依赖服务端 `session.diff` API；PatchPart 自己只持有 hash 和文件名，不持有 before/after 内容。
- `fallbackFiles` 只用于“看见有文件改过”的兜底，不等价于完整 diff 数据。
- 删除文件在 `FileChangesPanel` 中不可点击打开，只以删除态展示。
- 旧清单中 “Monaco diff editor” 表述与当前代码不一致，维护时以 `DiffViewer.tsx` 为准。

## 运行时待核验

- [ ] 大文件或大量文件 diff 在当前纯 React 渲染下的滚动与性能表现（`待运行时核验`：需要真实大 diff）。
- [ ] 后台 `session.diff.status` 从 updating 到 latest/failed 时输入区提示是否按预期刷新（`待运行时核验`：需要真实后台 diff 调度）。

## 相关

- 工具卡片渲染：[tool-rendering](tool-rendering.md)
- 前台读取优先：[foreground-read-priority](foreground-read-priority.md)
