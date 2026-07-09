# 能力：`generate_image` 与图片预览/保存

> **象限**：Reference（能力参考）
> **能力编号**：C4（见 [capabilities-index](../capabilities-index.md)）
> **基线状态**：基线

## 代码真源

| 角色              | 文件                                                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 生成图片工具模块  | `packages/opencode/src/tool/generate-image/`                                                                           |
| 图片文件持久化    | `packages/opencode/src/tool/generate-image/persist.ts`、`packages/opencode/src/session/generated-image-persistence.ts` |
| 会话附件归一化    | `packages/opencode/src/session/generated-image.ts`                                                                     |
| 专用读取路由      | `packages/opencode/src/server/routes/instance/generated-image.ts`                                                      |
| 工具附件缩略图    | `packages/opencode/webgui/src/components/parts/ToolPart/ToolImageAttachments.tsx`                                      |
| Markdown 图片入口 | `packages/opencode/webgui/src/components/MarkdownRenderer.tsx`                                                         |
| 图片预览层        | `packages/opencode/webgui/src/components/parts/ImagePreview.tsx`、`ImageOverlay.tsx`                                   |
| 保存与路由 URL    | `packages/opencode/webgui/src/lib/fileUtils.ts`                                                                        |

## 意图

让模型生成或返回的图片成为项目内可引用文件，而不是只停留在一次性 data URL。WebGUI 负责缩略图、全屏预览和宿主保存分流。

## 行为契约

- 生成图片持久化目录固定为项目根下 `.opencode/generated-images/`；relativePath 由 `generatedImageRelativePath(filename)` 生成（`generated-image.ts` 第 70-72 行）。
- `persistImages` 会 realpath 项目根，创建目录前后都校验目录仍在项目内，再写入图片（`persist.ts` 第 22-30 行）。
- 图片写入先写临时文件，再优先 hard-link publish；不支持 hard link 时用 lock + rename fallback（`persist.ts` 第 75-90 行、第 145-217 行）。
- 文件名冲突会追加 `-2`、`-3` 等 attempt 后缀，最多尝试 999 次（`persist.ts` 第 9 行、第 64-66 行、第 127-131 行）。
- 每张图片返回 file attachment，包含 `mime/filename/relativePath/url`，其中 `url` 是 `/generated-image?path=...`（`persist.ts` 第 91-97 行）。
- 老的 `image_generation` 输出如果只有 data URL，会被归一化成图片 attachment；输出摘要为“已生成 N 张图片：”，图片计数只统计 image attachment（`generated-image.ts` 第 36-64 行、第 110-119 行、第 238-240 行）。
- 可持久化的模型内置图片 mime 限定为 png/jpeg/gif/webp（`generated-image.ts` 第 31-35 行）。
- 历史 data URL attachment 可由 `persistGeneratedImageAttachments` 写入 `.opencode/generated-images`，补上 `relativePath` 并改走专用路由（`generated-image-persistence.ts` 第 28-47 行）。
- 历史附件持久化要求 filename 只有 basename，拒绝 `.`、`..` 或带路径分隔符的 filename（`generated-image-persistence.ts` 第 7-15 行、第 35-38 行）。
- `readGeneratedImage` 只接受 `.opencode/generated-images/` 前缀，先做 path resolve 边界校验，再做 realpath 校验，最后还会检测实际文件 mime 必须是 image（`generated-image.ts` route 第 14-63 行）。
- 读取路由找不到文件返回 404，越界或非图片返回 403（`generated-image.ts` route 第 16-18 行、第 36-39 行、第 52-57 行）。
- WebGUI 工具附件优先使用 `attachment.relativePath` 生成带 `directory/worktree` 的 generated-image URL；没有 `relativePath` 时保留旧 `url`（`ToolImageAttachments.tsx` 第 31-45 行、第 48-50 行）。
- 工具附件只保留 image mime 且存在 url 或 relativePath 的项，text attachment 不参与 Image #N 计数（`ToolImageAttachments.tsx` 第 25-40 行）。
- MarkdownRenderer 会识别 `.opencode/generated-images/`、`./.opencode/generated-images/`、`../.opencode/generated-images/` 形式，并转成同一个专用路由（`MarkdownRenderer.tsx` 第 37-65 行、第 245-250 行）。
- Markdown 的 urlTransform 允许 generated-image 相对路径、data image 和 blob image 作为 img src（`MarkdownRenderer.tsx` 第 78-88 行）。
- `image_generation` 与 `generate_image` 的 UI 显示名不同：前者“模型内置生图”，后者“图片生成”（`ToolPart/utils.tsx` 第 17-18 行）。
- `ImagePreview` 点击后通过 portal 打开 `ImageOverlay`，失败时显示 fallback（`ImagePreview.tsx` 第 57-83 行）。
- `ImageOverlay` 支持保存、缩放、重置、适应窗口、滚轮缩放、拖拽平移、Esc 关闭；点击背景关闭，点击图片本体或工具栏不关闭（`ImageOverlay.tsx` 第 59-84 行、第 105-253 行）。
- 保存链路在 IDE bridge 可用时调用 `ideBridge.request("saveImage")`，普通浏览器回退为下载链接（`fileUtils.ts` 第 137-149 行）。
- `getGeneratedImageUrl` 会把 `directory` 放进 query，并尊重 Vite `BASE_URL`（`fileUtils.ts` 第 83-88 行）。

## 边界与约束

- `decodeImageInput` 不支持远程图片 URL，只接受项目相对路径、data URL 或裸 base64；文件输入会 realpath 校验不出项目（`input.ts` 第 24-55 行、第 57-80 行）。
- 文件名会移除路径分隔符、Windows 保留字符、控制字符和设备名；自定义文件名仍会追加 messageID/random 后缀（`filename.ts` 第 20-43 行）。
- 多项目/非 git 目录下必须带 `directory` 查询上下文，否则 generated-image 可能读错实例。
- 图片输入大小限制为 10MB，mime 通过文件头检测，不信任扩展名（`input.ts` 第 64-74 行、第 99-125 行、第 137-163 行）。

## 运行时待核验

- [ ] IDE bridge `saveImage` 在 VSCode 与 JetBrains 下的保存对话框、取消返回值和错误提示（`待运行时核验`：需要宿主插件）。
- [ ] dev proxy 下 `/generated-image` 与 `/app/generated-image` 是否同时可预览（`待运行时核验`：需要 Vite dev + backend）。

## 相关

- 工具卡片渲染：[tool-rendering](tool-rendering.md)
- 宿主动作：[host-actions](host-actions.md)
