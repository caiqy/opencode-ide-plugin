# GPT 图片生成展示与上下文回放设计

## 背景

目标是在本插件中支持 GPT 最新图片生成模型生成的图片直接展示，并允许后续对话可靠引用这些图片，例如“把第二张图改成深色背景”。

调研结论：

- `openai/codex` 内建 `image_generation` 会把生成图片作为会话历史的一部分保留，后续 turn 依赖历史中的图片结果，而不是仅依赖 UI 中的文件路径。
- `anomalyco/opencode` 官方 app 最新代码已有图片附件和预览基础，但尚未形成 Codex 类似的 `image_generation` 展示与上下文回放闭环。
- 本仓库现有 `ToolStateCompleted.attachments` 已是最适合复用的图片上下文通道。
- 当前落地方案是在 session 层按模型能力注入 OpenAI Responses `image_generation` provider tool，而不是在 provider transform 阶段自动篡改 `providerOptions`。
- `response.image_generation_call.partial_image` 只作为中间事件忽略，不作为最终 `tool-result`；最终图片只在 `response.output_item.done.item.result` 到达后写入 completed state。

## 范围

实现方案 A：不自动保存生成图片文件，只做“展示 + 上下文回放 + 手动保存”。

包含：

- 识别 `image_generation` 最终图片结果。
- 将单张或多张最终图片转成 `FilePart[]`。
- 将图片挂到 `ToolStateCompleted.attachments`。
- 在 WebGUI 工具结果下方展示图片缩略图网格。
- 增强现有图片查看器，支持保存、缩放、拖拽平移和快捷键。
- 保持附件顺序和 `Image #N` UI 索引，提升后续编辑时模型引用图片的准确性。

不包含：

- 自动保存到 `generated_images` 目录。
- `partial_image` / `partial_images` 流式预览。
- 专门的 size / quality / mask 配置 UI。
- 独立图片编辑面板。
- Codex 式 artifact 生命周期管理。
- 上下文压缩时的图片持久化策略改造。

## 后端数据流

图片生成最终结果进入会话时，转换为现有附件结构：

```text
provider image_generation result
  -> 识别最终 base64 / data URL / structured result 图片结果
  -> 生成 FilePart[]
  -> 与已有 attachments 合并，并按已有图片数顺延文件名
  -> 写入 ToolStateCompleted.attachments
  -> output 文本归一化为汇总摘要
```

单张图示例：

```ts
{
  type: "file",
  mime: "image/png",
  filename: "generated-image-1.png",
  url: "data:image/png;base64,...",
  source: { type: "tool", ... },
}
```

多张图示例：

```text
已生成 3 张图片：
```

设计要求：

- `attachments` 顺序必须稳定。
- 文件名必须带序号，且已有图片附件存在时从下一个编号继续。
- `output` 文本只保留汇总摘要，不重复列出文件名或 `Image #N`。
- 非图片结果和异常 base64 不能导致会话崩溃。
- raw provider output 与 structured provider output 都必须被兼容并安全归一化。

## 上下文回放

后续上下文复用现有 `ToolStateCompleted.attachments` 逻辑。

预期行为：

- 支持 media tool result 的 provider：图片作为工具结果媒体回放。
- 不支持 media tool result 的 provider：走现有 synthetic user message 逻辑。
- 生成图片不是单纯 UI 状态，而是会话历史的一部分。
- 用户后续说“修改刚才那张图”或“修改第二张图”时，模型可以看到图片附件；UI 仍通过 `Image #N` 帮助用户定位目标图片。

已知限制：

- 长会话 compaction 可能使用 `stripMedia: true`，图片可能被剥离。这是现有系统限制，本次不改造。
- 手动保存到本地文件不影响模型上下文；模型上下文仍以会话附件为准。

## WebGUI 展示

当 completed tool part 的 `part.state.attachments` 包含 `image/*` 文件时，在工具结果下方展示图片缩略图。

展示规则：

- 单图显示为较大的缩略图卡片。
- 多图显示为 2-4 列缩略图网格。
- 每张图显示 `Image #N` 和文件名。
- 工具名 `image_generation` 在 UI 中显示为“图片生成”。
- 工具摘要只显示 `已生成 N 张图片：`，不重复展示标题或文件名。
- 点击缩略图打开图片查看器。
- 非图片附件不受影响。
- 工具仍在运行时不展示最终图片网格。

优先复用现有组件：

- `FilePart`
- `ImageOverlay`
- `fileUtils`

如现有组件能力不足，只做面向本需求的小幅增强，不重写图片系统。

## 图片查看器增强

复用现有图片查看组件并增强为完整查看器。

功能：

- 放大。
- 缩小。
- 重置为 `100%`。
- 适应窗口。
- 默认打开即为“适应窗口”。
- 鼠标滚轮缩放。
- 拖拽平移。
- 双击复位。
- 快捷键：
  - `+` / `=`：放大。
  - `-`：缩小。
  - `0`：重置。
  - `Esc`：关闭。
- 手动保存文件。

保存行为：

- 不自动写入工作区。
- 用户点击保存时触发下载或保存流程。
- 默认文件名来自 `FilePart.filename`。
- 对 data URL 图片转换为 blob 后保存。

## 多图策略

多图采用同一个 `attachments: FilePart[]` 容器，并在 UI 中展示为缩略图网格。

准确性策略：

- 数据层保持数组顺序稳定。
- 文件名使用 `generated-image-N.png`，且 N 在已有图片附件之后继续递增。
- tool output 文本仅保留汇总摘要。
- UI 中展示相同序号。

这样用户说“修改第二张”时，模型上下文和 UI 语言保持一致。

## 错误处理

- 如果 `image_generation` 返回空结果：保留文本输出，不生成图片附件。
- 如果 base64 无法解析：记录调试日志，保留原始工具文本，不阻断会话。
- 如果保存失败：在 UI 中显示 toast 或轻量错误提示，不影响会话中的图片附件。
- 如果浏览器不支持某保存 API：回退到普通 `<a download>` 下载。

## 测试策略

后端测试：

- 单张 base64 结果转成一个 `FilePart`。
- 多张结果转成多个有序 `FilePart`。
- structured provider output 保留原 `title`、`metadata`、`attachments`。
- 已有图片附件时，新生成文件名从下一个编号继续。
- `output` 文本只包含汇总摘要，不泄漏 base64 或重复文件名。
- 异常 base64 不崩溃。

前端测试：

- tool attachments 中的图片会渲染缩略图。
- 多图以网格展示。
- 点击图片打开 overlay。
- 保存按钮使用正确文件名。
- 缩放、重置、关闭交互可用。

集成验证：

- 构造带图片 `attachments` 的 completed tool part。
- WebGUI 可显示缩略图。
- 后续 prompt 回放时图片仍在模型消息中。

## 待实现计划覆盖点

后续实现计划应进一步定位并拆分：

1. `image_generation` 结果到 `ToolStateCompleted.attachments` 的桥接位置。
2. `FilePart` 构造和汇总摘要生成的纯函数。
3. WebGUI tool attachment 图片网格组件。
4. `ImageOverlay` 缩放、平移、保存增强。
5. 后端和前端测试用例。

## 实现状态（2026-05-11）

已落地：

- session 层已按模型条件注入 OpenAI Responses `image_generation` provider tool。
- `generated-image` 归一化逻辑已兼容裸 base64、data URL、JSON 结构、raw provider output、structured provider output。
- completed tool state 已把图片写入 `attachments`，并保留原 `title` / `metadata`。
- WebGUI 已展示图片缩略图网格，支持点击打开查看器。
- `ImageOverlay` 已支持保存、缩放、滚轮、拖拽平移、快捷键，且默认打开即适应窗口。
- 工具名已中文化为“图片生成”，并去掉 `image_generation: image_generation` 这种重复标题展示。

剩余收尾：

- 同步旧的 `processor-effect` 集成测试断言到新摘要契约，避免文档与测试期望不一致。
