# 能力：工具卡片渲染与流式预览

> **象限**：Reference（能力参考）
> **能力编号**：C1、C2（见 [capabilities-index](../capabilities-index.md)）
> **基线状态**：C1 基线；C2 **新增**（2026-05-26 流式工具预览）

## 代码真源

| 角色                | 文件                                                                            |
| ------------------- | ------------------------------------------------------------------------------- |
| ToolPart 分发与组合 | `packages/opencode/webgui/src/components/parts/ToolPart/index.tsx`              |
| 标题与中文名规则    | `packages/opencode/webgui/src/components/parts/ToolPart/utils.tsx`              |
| 卡片头部与文件链接  | `packages/opencode/webgui/src/components/parts/ToolPart/ToolHeader.tsx`         |
| 前端流式输入 hook   | `packages/opencode/webgui/src/components/parts/ToolPart/usePartialToolInput.ts` |
| partial JSON 解析   | `packages/opencode/webgui/src/lib/partial-tool-input.ts`                        |
| 后端流式工具常量    | `packages/opencode/src/session/streamable-tools.ts`                             |

## 意图

把 opencode 的 tool part 映射成 IDE WebGUI 可读的工具卡片：标题可扫、权限入口可见、写文件类工具在参数还没完整结束时就能预览内容。

## 行为契约

- `ToolPart` 按 `part.tool` 组合专用组件：`bash` 走 `BashTool`，`write` 走 `WriteTool`，`edit/multiedit` 可展示 diff，`task/question/todo` 有专用分支，未知输出落到 `GenericOutput`（`ToolPart/index.tsx` 第 254-278 行）。
- `read/glob/list/grep/webfetch` 是 header-only 工具，不渲染通用展开输出（`ToolPart/index.tsx` 第 236-245 行、第 491-500 行）。
- `edit/multiedit/write/apply_patch` 是 content-only 工具，跳过 generic output，避免重复展示（`ToolPart/index.tsx` 第 243-256 行）。
- 工具标题先调用 `getToolDisplayName(part.tool, part.state.input, part.state.title, part.state.output)`，所以后端回写的 `state.title` 是标题真源，前端只在缺 title 时从 input 推导（`ToolPart/index.tsx` 第 89 行；`utils.tsx` 第 139-183 行）。
- `utils.tsx` 是中文工具名集中表，`image_generation` 显示“模型内置生图”，`generate_image` 显示“图片生成”，`apply_patch` 显示“文件补丁”（`utils.tsx` 第 3-29 行）。
- `skill` 工具标题会去掉 `Loaded skill:`、`Loading skill:`、`加载技能：` 前缀，避免重复显示（`utils.tsx` 第 147-155 行）。
- `todoread/todowrite` 在 output 是 todo JSON 数组时显示完成数/总数（`utils.tsx` 第 163-175 行）。
- `grep` 标题会把 `include` 追加到 pattern 后，便于区分搜索范围（`utils.tsx` 第 177-180 行、第 197-201 行）。
- `bash` 在没有 title 时使用 `input.description` 提前形成“执行命令：...”标题，不读取完整命令作为标题（`utils.tsx` 第 188-192 行）。
- `ToolHeader` 对 `read/write/edit/multiedit` 显示可点击文件名，对 `apply_patch` 显示补丁涉及的去重文件名；点击通过 `useOpenFile` 打开宿主文件（`ToolHeader.tsx` 第 77-79 行、第 105-145 行）。
- 文件链接显示 basename，tooltip 保留 display path，打开时传原始 path 与 display path（`ToolHeader.tsx` 第 24-25 行、第 58-66 行、第 116-120 行）。
- 前端只把 `write/edit/apply_patch` 视为流式工具；pending 状态下从 `state.raw` best-effort 解析 partial JSON，其他状态回退到 `state.input`（`usePartialToolInput.ts` 第 4-28 行）。
- `usePartialToolInput` 用 `useDeferredValue` 降低高频 delta 对滚动和输入交互的影响（`usePartialToolInput.ts` 第 1-3 行、第 13-28 行）。
- partial JSON 解析使用 `partial-json`，失败返回空对象且不抛错；行数用 `countLines` 统计换行（`partial-tool-input.ts` 第 11-20 行、第 27-32 行）。
- 后端 `STREAMABLE_TOOLS` 也只包含 `write/edit/apply_patch`，注释要求与前端 mirror 同步（`streamable-tools.ts` 第 1-14 行）。
- `write/edit/apply_patch` 在 pending 时自动展开一次，并用 `(已接收 N 行)` 替代普通行号提示；内容区实时显示 `content/newString/patchText|patch`（`ToolPart/index.tsx` 第 173-179 行、第 340-355 行、第 447-479 行）。
- `apply_patch` 的文件名优先来自 `metadata.files`，再从 partial patch 文本中的 `*** Add/Update/Delete File` 与 `*** Move to` 解析补齐（`ToolPart/index.tsx` 第 93-129 行）。
- completed 且非 header-only 的工具附件在展开内容内渲染；header-only 附件直接跟在头部后面（`ToolPart/index.tsx` 第 481-494 行）。

## 边界与约束

- 流式预览只覆盖写文件类大参数工具；新增工具若进入后端 `STREAMABLE_TOOLS`，必须同步前端 `STREAMABLE` 集合。
- `state.raw` 是 pending 预览输入，不是 completed 阶段真源；completed 后仍以 `state.input` / `state.metadata` 为准。
- 权限横幅在卡片内独立渲染，不能因折叠内容隐藏授权入口（`ToolPart/index.tsx` 第 452-457 行）。
- `apply_patch` 同时兼容当前 `patchText` 和 legacy `patch` 字段（`ToolPart/index.tsx` 第 293-305 行）。

## 运行时待核验

- [ ] 在真实 SSE token delta 下，`write/edit/apply_patch` 自动展开、行数递增、滚动稳态是否符合预期（`待运行时核验`：需要实际模型流）。

## 相关

- 子任务抽屉：[subtask-drawer](subtask-drawer.md)
- 图片生成：[generated-image](generated-image.md)
- Diff / 文件变更：[diff-file-changes](diff-file-changes.md)
