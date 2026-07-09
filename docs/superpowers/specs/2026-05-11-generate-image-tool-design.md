# `generate_image` 内置生图工具设计

## 背景

当前仓库已经具备一条 OpenAI Responses 专用的 `image_generation` provider tool 链路：当聊天模型支持 OpenAI Responses image generation 时，session 层会注入 provider tool，并把最终图片结果保存为工具附件，WebGUI 也能展示生成图片。

本次需求不同：需要一个 **普通模型可调用的独立内置 tool**，用于调用外部生图接口。它不复用、不依赖、不改造现有 OpenAI Responses 的 `image_generation` provider tool 注入逻辑；两者只是都能产出图片附件，其他链路互相独立。

目标是参考 `gpt-image-2` skill 的能力和约束，为 opencode 增加一个可扩展的生图工具。首版支持 OpenAI-compatible 图片接口，后续可增加其他生图 provider adapter。补充参考 `shinpr/mcp-image` 后，首版只采纳其中与 provider 无关且适合 opencode 的部分：自定义文件名、默认文件名随机后缀、输入图片基础校验；不采纳 Gemini 特有能力。

## 目标

- 新增 builtin tool：`generate_image`。
- 首版支持文生图与图片编辑：
  - `POST /v1/images/generations`
  - `POST /v1/images/edits`
- 通过现有 Provider 解析链路读取连接信息，优先复用 `Provider.Service` 已解析的 provider/model 元数据；必要时再回退到 `opencode.json` 的 provider 配置，尤其是 `provider.<id>.options.apiKey` 与 `provider.<id>.options.baseURL`。
- 通过默认生图模型配置选择 provider/model，工具参数可覆盖。
- 生成结果统一落盘到当前项目 `.opencode/generated-images/`。
- 工具结果通过 `ToolStateCompleted.attachments` 返回项目相对路径附件，复用现有 WebGUI 图片展示能力。
- 权限系统支持 `generate_image`，默认可请求确认，也允许配置自动放行。
- adapter 边界清晰，未来新增其他生图模型或非 OpenAI-compatible API 时，不改工具主契约。

## 非目标

- 不移除、不改名、不合并现有 OpenAI Responses `image_generation` provider tool。
- 首版不实现 Responses API 的高级流程，例如 `POST /v1/responses`、`partial_images` 流式预览、`previous_response_id`。
- 首版不支持远程图片 URL 作为 edit 输入，避免额外下载权限和安全边界。
- 首版不提供 WebGUI 专用配置界面。
- 首版不做生成图片自动清理或资源管理面板。

## 命名

工具名固定为：

```text
generate_image
```

选择该名称是为了避免和 OpenAI Responses provider tool 的 `image_generation` 混淆。新工具通过工具名和工具 metadata 记录来源；图片附件本身必须保持现有 `FilePart` 契约，不新增 `source.tool` 结构。

## 总体架构

新增工具进入现有 `ToolRegistry`，与 `read`、`write`、`webfetch` 等普通工具同级。

```text
generate_image tool
  -> image generation dispatcher
    -> image provider adapter
      -> openai-compatible adapter
  -> persist generated images
  -> return attachments
```

各层职责：

- `generate_image tool`：定义工具参数、执行权限请求、组织返回结果。
- dispatcher：解析默认模型、复用 `Provider.Service` 读取 provider/model 信息、选择 adapter。
- adapter：把通用生成/编辑输入映射到具体 provider API。
- persistence：解码图片、写入 `.opencode/generated-images/`、构造附件。

这种结构保证普通工具契约稳定，provider 差异集中在 adapter 内。

## 配置设计

### 连接信息

复用现有 provider 解析链路，不新增重复的 `apiKey` 或 `baseURL` 顶层字段。实现时优先通过 `Provider.Service.getProvider()` / `Provider.Service.getModel()` 获取已解析信息，再回退到配置字段：

```jsonc
{
  "provider": {
    "openai": {
      "options": {
        "apiKey": "sk-...",
        "baseURL": "https://api.openai.com/v1",
      },
    },
  },
}
```

解析顺序：

1. provider/model 先通过 `Provider.Service` 解析，拿到 `Provider.Info`、`Provider.Model`、`provider.key`、`provider.options`、`model.api`、`model.options`。
2. `apiKey` 优先使用已解析的 `provider.key`，其次使用 `provider.options.apiKey`。
3. `baseURL` 优先使用 `provider.options.baseURL`，其次使用 `model.api.url`；最终请求地址必须等价于 OpenAI-compatible `/v1` 根路径。
4. 如果 `baseURL` 不以 `/v1` 结尾，实现可以规范化追加 `/v1`，但必须避免重复 `/v1/v1`。
5. 若最终仍缺少 `apiKey` 或 `baseURL`，工具失败并给出配置示例。

### 默认生图模型

新增轻量顶层字段：

```jsonc
{
  "image_model": "openai/gpt-image-2",
}
```

解析规则：

1. `provider` 与 `model` 都传入时，直接使用该组合。
2. 两者都未传时，读取 `image_model`。
3. 只传 `provider` 时，使用该 provider，并从 `image_model` 中取默认 model；如果 `image_model` 不存在或 provider 不一致，失败并要求同时传入 `model`。
4. 只传 `model` 时，使用 `image_model` 中的默认 provider；如果 `image_model` 不存在，失败并要求同时传入 `provider`。
5. 解析出的 provider/model 必须能通过 `Provider.Service.getProvider()` 与 `Provider.Service.getModel()` 找到，否则报错。

`image_model` 必须按现有 `Provider.parseModel()` 语义解析：第一个 `/` 前是 provider，后面的完整字符串都是 model id，不能用简单二段 `split("/")` 截断包含 `/` 的 model id。

### adapter 声明

可在模型 options 中声明 adapter：

```jsonc
{
  "provider": {
    "openai": {
      "models": {
        "gpt-image-2": {
          "modalities": {
            "input": ["text", "image"],
            "output": ["image"],
          },
          "options": {
            "imageApi": "openai-compatible",
          },
        },
      },
    },
  },
}
```

首版不强制用户声明 `modalities`。adapter 选择顺序：

1. `model.options.imageApi` 或 `provider.options.imageApi` 显式声明。
2. `model.api.npm` 是 `@ai-sdk/openai` 或 `@ai-sdk/openai-compatible` 时使用 `openai-compatible`。
3. 有限内置白名单：`providerID === "openai"` 时使用 `openai-compatible`。
4. 仍无法判断则报错，提示配置 `imageApi`。

## 工具参数

`generate_image` 使用一个工具覆盖生成和编辑：

```ts
{
  action?: "generate" | "edit"
  prompt: string

  provider?: string
  model?: string

  images?: string[]
  mask?: string

  size?: string
  quality?: "auto" | "low" | "medium" | "high"
  format?: "png" | "jpeg" | "webp"
  n?: number

  filename?: string
}
```

默认值：

- `action`: `"generate"`
- `n`: `1`
- `size`: `"auto"`
- `quality`: `"high"`
- `format`: `"png"`
- `provider/model`: 来自 `image_model`
- `filename`: 未传时使用默认命名策略

参数边界：

- `n` 仅允许整数 `1..10`。
- `generate` 模式下不接受 `images/mask`；如果传入则报错并提示改用 `edit`。
- `edit` 模式下 `images` 必须至少 1 张、最多 10 张；`mask` 可选但若提供则必须与输入图格式兼容。
- `size` 作为 provider 原生尺寸字符串：若未传则按默认值 `auto` 处理；OpenAI-compatible adapter 将 `auto` 发送给支持它的模型，若目标模型不支持则在 adapter 内转换为该模型的安全默认尺寸或报错。
- `format` 表示请求 provider 输出的图片格式。OpenAI-compatible adapter 将其映射为 provider 支持的输出格式字段；最终文件扩展名仍以 provider 实际返回的 mime 为准。

### 文件名参数

`filename` 是可选的输出基础文件名，不是路径。即使传入 `filename`，输出目录仍固定为 `.opencode/generated-images/`。

安全规则：

- 移除 null byte、`/`、`\` 和控制字符。
- 移除 Windows 不允许的文件名字符：`<`、`>`、`:`、`"`、`|`、`?`、`*`。
- 避免 Windows 保留设备名：`CON`、`PRN`、`AUX`、`NUL`、`COM1`..`COM9`、`LPT1`..`LPT9`；命中时回退到默认命名或追加安全前缀。
- 去掉首尾点号和空白，避免隐藏文件或相对路径语义。
- 如果清洗后为空，回退到默认命名。
- 如果没有扩展名，按最终图片 mime 自动补扩展。
- 如果用户给了扩展名但和实际 mime 不一致，以实际 mime 为准重写扩展名。

### 文生图

示例：

```json
{
  "action": "generate",
  "prompt": "一张赛博朋克风格的 IDE 插件宣传图",
  "size": "1536x1024",
  "quality": "high",
  "format": "webp"
}
```

映射到 OpenAI-compatible：

```text
POST /v1/images/generations
```

### 图片编辑

示例：

```json
{
  "action": "edit",
  "prompt": "把背景改成深色科技风",
  "images": [".opencode/generated-images/generated-image-msg_abc-1.png"],
  "format": "png"
}
```

映射到 OpenAI-compatible：

```text
POST /v1/images/edits
```

首版 `images` 支持：

- 项目相对路径。
- `data:image/...;base64,...`。
- 裸 base64；必须能从图片魔数识别为 PNG、JPEG 或 WebP，否则报错。

若输入字符串既可能是项目相对路径又像裸 base64，已存在的项目相对路径优先；只有路径不存在且字符串满足 base64 形态时才按裸 base64 解码。

`mask` 支持同样输入来源。若目标 adapter 不支持 mask，返回清晰错误。

### 输入校验

参考 `mcp-image` 的稳定性约束，首版增加以下通用校验：

- `prompt` 长度必须为 `1..4000` 字符。
- 单张输入图最大 `10MB`。
- 输入图格式限制为 PNG、JPEG、WebP。
- 项目相对路径必须解析在当前项目目录内，不允许路径穿越；还必须通过 realpath 校验，防止 symlink / junction 逃逸。
- 裸 base64 只有在能识别出图片 mime 时才放行；识别不出时明确报错，不默认 PNG。
- data URL/base64 解码失败时明确报错。

## OpenAI-compatible adapter

### Generations 请求

请求地址：

```text
{baseURL}/images/generations
```

请求体示例：

```json
{
  "model": "gpt-image-2",
  "prompt": "...",
  "size": "1536x1024",
  "quality": "high",
  "output_format": "webp",
  "n": 1
}
```

对 GPT image 系列默认不传 `response_format`，以兼容 OpenAI 最新图片接口行为。

`format` 映射到 provider 的输出格式参数，例如 OpenAI-compatible 的 `output_format`。如果目标 provider/model 不支持指定格式，adapter 必须在调用前或 provider 返回错误后给出清晰错误；不能只改变本地文件后缀来伪装格式转换。

`size` 若传入，OpenAI-compatible adapter 必须只对已确认的 GPT image 系列模型（例如 model id 以 `gpt-image-` 开头）做客户端约束校验：格式为 `WIDTHxHEIGHT` 或 `auto`，宽高为 16 的倍数，最长边不超过 3840，宽高比不超过 3:1。不要把这些约束一刀切套到所有 OpenAI-compatible 模型，也不要在客户端硬编码未确认来源的总像素范围；若目标 provider/model 还有额外限制，应透传并摘要 provider 错误。

### Edits 请求

请求地址：

```text
{baseURL}/images/edits
```

请求类型为 multipart form data，字段示意：

```text
model=gpt-image-2
prompt=...
image[]=<file1>
image[]=<file2>
mask=<mask file if any>
size=...
quality=...
n=...
output_format=...
```

首版使用 `image[]` 字段风格。若后续遇到兼容网关字段差异，可通过 provider/model options 扩展：

```jsonc
{
  "options": {
    "imageApi": "openai-compatible",
    "imageFieldStyle": "brackets",
  },
}
```

### 响应解析

adapter 输出统一的图片数组。解析时兼容常见结构：

- `data[].b64_json`
- `data[].b64Json`
- `data[].data`
- `data[].url` 为 data URL 时直接解析
- 上述字段中的 data URL 或裸 base64

首版只解析顶层 `data[]` 数组内的上述字段，不递归扫描任意嵌套结构。首版不下载远程 URL 响应。如果 provider 只返回远程 URL，工具失败并说明当前 adapter 需要 base64 或 data URL 图片数据。

## 落盘与返回结构

所有生成结果写入当前项目：

```text
.opencode/generated-images/
```

默认文件名综合 opencode 会话追踪和 `mcp-image` 的随机后缀策略：

```text
generated-image-<messageID>-<index>-<random8hex>.<ext>
```

其中：

- `<messageID>` 用于追踪生成来源。
- `<index>` 保持多图顺序稳定。
- `<random8hex>` 使用 4 字节随机数转十六进制，降低并发和重试碰撞。
- `<ext>` 由最终图片 mime 推导。

如果用户传入 `filename`，则以清洗后的基础名作为前缀，但仍保留 `messageID` 和随机后缀：

```text
<safe-filename>-<messageID>-<random8hex>.<ext>
<safe-filename>-<messageID>-<index>-<random8hex>.<ext>
```

单图可以省略 `<index>`；多图必须包含 `<index>`。如果目标文件名仍已存在，在扩展名前追加 `-<retry>`，例如 `-2`、`-3`，直到得到不存在的文件名；不能覆盖旧文件。

生成的附件必须符合现有 `MessageV2.FilePart` 契约：必须包含 `type`、`mime`、`filename`、`relativePath`、`url`，不新增 `source.tool`。如果要记录工具来源，使用 tool part 的 `tool` 字段和工具结果 `metadata`。

工具返回：

```ts
{
  title: "generate_image",
  output: "已生成 1 张图片：",
  attachments: [
    {
      type: "file",
      mime: "image/webp",
      filename: "generated-image-msg_abc-1-a1b2c3d4.webp",
      relativePath: ".opencode/generated-images/generated-image-msg_abc-1-a1b2c3d4.webp",
      url: "/generated-image?path=.opencode%2Fgenerated-images%2Fgenerated-image-msg_abc-1-a1b2c3d4.webp"
    }
  ],
  metadata: {
    provider: "openai",
    model: "gpt-image-2",
    action: "generate",
    count: 1
  }
}
```

附件不保存长期 base64。WebGUI 继续通过现有图片附件展示与项目路径访问能力显示缩略图和预览。

## 权限策略

`generate_image` 会调用外部 API 并可能产生费用，因此需要权限请求：

```text
permission: "generate_image"
```

权限请求 metadata 包含：

- provider
- model
- action
- n
- size
- quality
- format
- filename 是否存在
- 是否包含输入图
- 是否包含 mask

允许用户通过配置自动放行：

```jsonc
{
  "permission": {
    "generate_image": "allow",
  },
}
```

工具是否启用仍遵循现有 `tools` 配置：

```jsonc
{
  "tools": {
    "generate_image": true,
  },
}
```

## 错误处理

错误策略是显式失败，不静默降级。

- 缺少 `image_model` 且工具参数没有 provider/model：提示配置示例。
- provider 不存在：提示检查 `provider.<id>`。
- 按解析顺序仍缺少 `apiKey` 或 `baseURL`：提示配置 `provider.<id>.options.apiKey/baseURL` 或检查 provider auth/env。
- adapter 不支持当前模型/API：提示配置 `options.imageApi`。
- provider/model 不支持指定 `format`：参数校验失败或 provider 错误摘要。
- `edit` 没有 `images`：参数校验失败。
- `generate` 传入 `images`：参数校验失败并提示改用 `edit`。
- `n` 不是整数或不在 `1..10`：参数校验失败。
- `edit` 的 `images` 为空或超过 10 张：参数校验失败。
- `size` 不符合 GPT Image 2 约束：参数校验失败。
- `prompt` 为空或超过 `4000` 字符：参数校验失败。
- 输入图超过 `10MB`：拒绝调用。
- 输入图格式不是 PNG、JPEG、WebP：拒绝调用。
- 裸 base64 识别不出图片 mime：参数校验失败。
- data URL/base64 解码失败：参数校验失败。
- 项目路径越界或 realpath 指向项目外：拒绝读取。
- 输入文件不存在或不是图片：拒绝调用。
- provider API 返回错误：返回不含密钥的错误摘要。
- provider 返回空图片：工具失败，说明未收到图片数据。
- 落盘失败：工具失败，不回退为 base64 附件。

## 测试策略

### 配置解析

- 从 `image_model` 解析 provider/model。
- 只传 provider、只传 model、两者都传、两者都不传的解析矩阵。
- 工具参数覆盖默认模型。
- 缺失配置时报清晰错误。
- 优先复用 `Provider.Service` 解析结果。
- `provider.key`、`provider.options.apiKey`、`provider.options.baseURL`、`model.api.url` 的 fallback 顺序。
- adapter 显式配置优先于自动判断。

### OpenAI-compatible adapter

- generations 请求体包含正确字段。
- edits multipart 字段包含 `image[]` 与可选 `mask`。
- 不向 GPT image 系列发送 `response_format`。
- `format` 映射到 provider 输出格式参数，且不会伪装本地扩展名。
- provider 不支持指定 `format` 时给出清晰错误。
- 响应中的 `b64_json`、`data`、data URL 均可解析。
- 只返回远程 URL 时给出当前不支持的错误。
- `n`、`size` 和 `generate`/`edit` 字段组合的合法/非法场景。
- `size` 未传、显式 `auto`、合法尺寸、非法尺寸的行为。

### 输入图片解析

- 项目相对路径可读。
- data URL 可读。
- 裸 base64 可读。
- 超过 `10MB` 的输入图被拒绝。
- 非 PNG/JPEG/WebP 输入图被拒绝。
- 裸 base64 但无法识别图片 mime 时被拒绝。
- 路径越界被拒绝。
- symlink / junction 指向项目外时被拒绝。
- 非图片文件被拒绝。

### 落盘

- 图片写入 `.opencode/generated-images/`。
- 附件符合现有 `MessageV2.FilePart` 契约，包含 `url` 和 `relativePath`，不含长期 base64。
- 文件名不覆盖已有文件。
- 冲突时按 `-2`、`-3` 规则追加唯一后缀。
- 默认文件名包含 messageID、图片序号和随机后缀。
- 自定义 `filename` 被安全清洗，不能改变输出目录。
- Windows 非法字符和保留设备名会被清洗或回退。
- 自定义 `filename` 缺少扩展名时按 mime 自动补扩展。
- 自定义 `filename` 扩展名与 mime 不一致时以 mime 为准。

### 权限

- 调用前请求 `generate_image` 权限。
- 权限 metadata 包含 provider/model/action/n 等信息。
- 配置 allow 后可自动放行。

### 回归

- 现有 OpenAI Responses `image_generation` provider tool 注入逻辑不变。
- 现有生成图展示可渲染 `generate_image` 产生的附件。
- 现有 `image_generation` 的最终图归一化、项目落盘、路径附件回放仍通过测试。
- 现有 `partial_image` / `partial_images` 行为不被 `generate_image` 改动。

## 兼容性与迁移

该设计新增独立工具，不改变现有会话中的 `image_generation` tool part，也不迁移历史消息。

未来可以在 adapter 层新增：

- 其他 OpenAI-compatible 网关差异选项。
- 非 OpenAI-compatible 生图 provider。
- Responses API adapter。
- 远程 URL 输入下载能力，但需要单独权限设计。
