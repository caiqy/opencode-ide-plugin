# 图片生成结果项目内落盘与路径引用实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `image_generation` 结果自动落盘到当前项目的 `.opencode/generated-images/`，会话历史只保留项目相对路径引用，WebGUI 通过路径加载展示，后续 AI 只回放路径文本。

**Architecture:** 后端在工具完成时先把图片写成项目文件，再把 `relativePath + url + filename + mime` 作为附件保存到会话；`MessageV2.toModelMessagesEffect` 遇到带 `relativePath` 的图片附件时只输出简洁路径文本，不再把图片 media 再次喂给模型。WebGUI 继续渲染图片卡片，但图片源改成专用受限路由生成的可访问 URL。

**Tech Stack:** TypeScript、Effect、Hono、Bun、Vitest、React、Testing Library。

---

## 文件结构

- `packages/opencode/src/session/message-v2.ts`：扩展 `FilePart` schema，给图片附件新增 `relativePath`；调整 `toModelMessagesEffect`，让带路径引用的图片只回放文本，不再作为 media tool result 注入。
- `packages/opencode/src/session/generated-image.ts`：保留图片解析、mime 识别、文件名生成等纯逻辑。
- `packages/opencode/src/session/generated-image-persistence.ts`：新增效应式落盘入口，负责把解析出的图片写入 `.opencode/generated-images/` 并返回带 `relativePath` 的附件。
- `packages/opencode/src/session/processor.ts`：在 `completeToolCall` 中接入图片持久化流程；如果落盘失败，走明确错误分支。
- `packages/opencode/src/server/routes/instance/generated-image.ts`：新增受限二进制图片路由，只服务当前项目下的 `.opencode/generated-images/*`。
- `packages/opencode/src/server/routes/instance/index.ts`：挂载新的图片路由。
- `packages/opencode/webgui/src/lib/fileUtils.ts`：新增 `buildGeneratedImageUrl(relativePath)` 之类的 URL helper。
- `packages/opencode/webgui/src/components/parts/ToolPart/ToolImageAttachments.tsx`：优先按 `relativePath` 生成图片源，显示路径文本，保留旧 data URL 兼容。
- `packages/opencode/webgui/src/components/parts/ImageOverlay.tsx`：如预览加载失败，沿用现有 overlay 能力即可，不必重写。
- `packages/opencode/test/session/generated-image.test.ts`：覆盖图片解析与命名规则。
- `packages/opencode/test/session/generated-image-persistence.test.ts`：覆盖落盘与附件引用。
- `packages/opencode/test/session/prompt.test.ts`：覆盖 `relativePath` 回放文本。
- `packages/opencode/test/server/generated-image-route.test.ts`：覆盖图片路由的 200/404/403 行为。
- `packages/opencode/webgui/src/lib/fileUtils.test.ts`：覆盖 URL helper。
- `packages/opencode/webgui/src/components/parts/ToolPart/ToolImageAttachments.test.tsx`：覆盖路径展示与图片加载。
- `packages/opencode/webgui/src/components/parts/ToolPart/index.test.tsx`：覆盖 ToolPart 集成展示。

---

### Task 1：让图片附件携带项目相对路径，并把路径回放成文本

**Files:**

- Modify: `packages/opencode/src/session/message-v2.ts`
- Modify: `packages/opencode/test/session/prompt.test.ts`

- [ ] **Step 1: 写一个会失败的回放测试**

在 `prompt.test.ts` 里加一条集成测试，构造一个 `tool` 完成态，附件里包含：

```ts
{
  type: "file",
  mime: "image/png",
  filename: "generated-image-msg_123-1.png",
  relativePath: ".opencode/generated-images/generated-image-msg_123-1.png",
  url: "/generated-image?path=.opencode/generated-images/generated-image-msg_123-1.png",
}
```

断言第二轮回放请求体里能看到这行文本：

```text
已生成图片文件：.opencode/generated-images/generated-image-msg_123-1.png
```

同时断言回放时没有再把这张图作为 media file 注入。

运行：

```bash
bun test test/session/prompt.test.ts -t "image_generation 路径回放"
```

预期：失败，提示当前还没识别 `relativePath`。

- [ ] **Step 2: 扩展 `FilePart` schema 与回放逻辑**

把 `FilePart` 扩成：

```ts
export const FilePart = Schema.Struct({
  ...partBase,
  type: Schema.Literal("file"),
  mime: Schema.String,
  filename: Schema.optional(Schema.String),
  url: Schema.String,
  relativePath: Schema.optional(Schema.String),
  source: Schema.optional(_FilePartSource),
})
```

在 `toModelMessagesEffect` 里把带 `relativePath` 的图片拆成“路径文本”和“不可回放 media”：

```ts
const pathAttachments = attachments.filter((a) => typeof a.relativePath === "string")
const replayText =
  pathAttachments.length === 0
    ? outputText
    : `${outputText}\n${pathAttachments.map((a) => `已生成图片文件：${a.relativePath}`).join("\n")}`

const replayableAttachments = attachments.filter((a) => typeof a.relativePath !== "string")
```

对 `supportsMediaInToolResults` 为 `true` 的 provider，也不要把 `relativePath` 图片继续当 media 注入；路径引用只作为文本上下文。

- [ ] **Step 3: 重新运行回放测试**

运行：

```bash
bun test test/session/prompt.test.ts -t "image_generation 路径回放"
```

预期：通过，且输出里只剩路径文本，没有 media 注入。

- [ ] **Step 4: 同步已有相关测试**

如断言里出现旧的 `data:image/...` 预期，把它们改成“路径文本 + 仍兼容旧 data URL”的双格式断言。

运行：

```bash
bun test test/session/prompt.test.ts test/session/message-v2.test.ts
```

预期：通过。

- [ ] **Step 5: 提交这个阶段的改动**

建议提交信息：

```bash
git add packages/opencode/src/session/message-v2.ts packages/opencode/test/session/prompt.test.ts
git commit -m "feat: replay generated images as project paths"
```

---

### Task 2：把图片真正落到项目目录里，并生成路径引用附件

**Files:**

- Create: `packages/opencode/src/session/generated-image-persistence.ts`
- Modify: `packages/opencode/src/session/generated-image.ts`
- Modify: `packages/opencode/src/session/processor.ts`
- Modify: `packages/opencode/test/session/generated-image.test.ts`
- Create: `packages/opencode/test/session/generated-image-persistence.test.ts`
- Modify: `packages/opencode/test/session/processor-effect.test.ts`

- [ ] **Step 1: 写一个会失败的落盘测试**

新增 `generated-image-persistence.test.ts`，用 `tmpdir({ git: true })` 生成一个临时项目，调用新的持久化入口，断言：

1. 文件真实写到了 `tmp/.opencode/generated-images/`。
2. 结果附件里有 `relativePath`。
3. 结果附件里的 `filename` 形如 `generated-image-<messageID>-1.png`。

示例断言：

```ts
expect(result.attachments?.[0]).toMatchObject({
  mime: "image/png",
  filename: `generated-image-${messageID}-1.png`,
  relativePath: `.opencode/generated-images/generated-image-${messageID}-1.png`,
})
```

运行：

```bash
bun test test/session/generated-image-persistence.test.ts
```

预期：失败，因为还没有持久化逻辑。

- [ ] **Step 2: 拆出纯解析和效应式落盘两层**

在 `generated-image.ts` 里保留纯逻辑：解析 `data URL` / 裸 base64 / structured result，生成 `ImageData[]`、汇总输出文案、顺延文件名。

新增 `generated-image-persistence.ts`，把纯解析结果写到项目内目录，并返回新的附件：

```ts
export const persistImageGenerationOutput = Effect.fn("SessionGeneratedImagePersistence.persistImageGenerationOutput")(
  function* (input: {
    directory: string
    sessionID: SessionID
    messageID: MessageID
    output: unknown
    attachments?: MessageV2.FilePart[]
  }) {
    const fs = yield* AppFileSystem.Service
    const normalized = normalizeImageGenerationOutput({
      tool: "image_generation",
      sessionID: input.sessionID,
      messageID: input.messageID,
      output: input.output,
    })
    const targetDir = path.join(input.directory, ".opencode", "generated-images")
    yield* fs.makeDirectory(targetDir, { recursive: true })

    const persisted = yield* Effect.forEach(extractGeneratedImages(normalized), (image, index) =>
      Effect.gen(function* () {
        const filename = `generated-image-${input.messageID}-${index + 1}.${extension(image.mime)}`
        const relativePath = `.opencode/generated-images/${filename}`
        const absolutePath = path.join(input.directory, relativePath)
        yield* fs.writeWithDirs(absolutePath, Buffer.from(image.base64, "base64"))
        return {
          id: PartID.ascending(),
          sessionID: input.sessionID,
          messageID: input.messageID,
          type: "file" as const,
          mime: image.mime,
          filename,
          relativePath,
          url: `/generated-image?path=${encodeURIComponent(relativePath)}`,
        }
      }),
    )

    return {
      ...normalized,
      attachments: [...(input.attachments ?? []), ...persisted],
    }
  },
)
```

`completeToolCall` 里不再直接写 `data:image/...`，而是先走这个新入口。

- [ ] **Step 3: 让 processor 使用新的持久化入口**

在 `processor.ts` 的 `completeToolCall` 里，把 `image_generation` 的 `output` 先交给持久化 helper；普通工具仍保持原逻辑。

如果文件写入失败，不要回退成 base64 长期存储；直接把该次工具调用标成 error，并把错误传回 UI。

需要补充 `SessionProcessor.layer` 的依赖，让它能拿到文件系统服务（当前仓库里已有 `AppFileSystem.Service` 的用法，可直接按同样模式注入）。

- [ ] **Step 4: 更新现有 helper 测试**

把 `generated-image.test.ts` 里的旧断言改成：

- `output` 仍是 `已生成 N 张图片：`
- `attachments` 保留顺序
- 新附件包含 `relativePath`
- 已有附件时文件名顺延

再在 `processor-effect.test.ts` 里补一条：completed state 里拿到的是路径引用，而不是 `data:image/...`。

- [ ] **Step 5: 重新跑后端测试**

运行：

```bash
bun test test/session/generated-image.test.ts test/session/generated-image-persistence.test.ts test/session/processor-effect.test.ts
```

预期：通过。

- [ ] **Step 6: 提交这个阶段的改动**

建议提交信息：

```bash
git add packages/opencode/src/session/generated-image.ts packages/opencode/src/session/generated-image-persistence.ts packages/opencode/src/session/processor.ts packages/opencode/test/session/generated-image.test.ts packages/opencode/test/session/generated-image-persistence.test.ts packages/opencode/test/session/processor-effect.test.ts
git commit -m "feat: persist generated images in project storage"
```

---

### Task 3：新增专用图片访问路由，保证只读项目内生成图

**Files:**

- Create: `packages/opencode/src/server/routes/instance/generated-image.ts`
- Modify: `packages/opencode/src/server/routes/instance/index.ts`
- Create: `packages/opencode/test/server/generated-image-route.test.ts`

- [ ] **Step 1: 写一个会失败的路由测试**

新增路由测试，准备一个临时项目目录，在 `.opencode/generated-images/` 下写入一张 png，然后请求：

```text
/generated-image?path=.opencode/generated-images/generated-image-msg_123-1.png
```

断言：

1. 存在时返回 `200`。
2. `content-type` 是 `image/png`。
3. `../` 路径逃逸返回 `403` 或 `404`。
4. 缺失文件返回 `404`。

运行：

```bash
bun test test/server/generated-image-route.test.ts
```

预期：失败，因为路由还不存在。

- [ ] **Step 2: 新建受限图片路由**

创建 `generated-image.ts`，只允许 `.opencode/generated-images/` 前缀：

```ts
const relativePath = c.req.valid("query").path
if (!relativePath.startsWith(".opencode/generated-images/")) return c.notFound()

const abs = path.join(Instance.directory, relativePath)
const file = Bun.file(abs)
if (!(await file.exists())) return c.notFound()

return new Response(file, {
  headers: {
    "content-type": mime,
    "cache-control": "no-store",
  },
})
```

建议直接复用现有的 `runRequest(...)` 包装，保持 span/trace 风格统一。

- [ ] **Step 3: 挂载到 instance routes**

在 `instance/index.ts` 里把新路由挂进去，保持和 `FileRoutes()`、`SessionRoutes()` 同级。

- [ ] **Step 4: 重跑路由测试**

运行：

```bash
bun test test/server/generated-image-route.test.ts
```

预期：通过。

- [ ] **Step 5: 提交这个阶段的改动**

建议提交信息：

```bash
git add packages/opencode/src/server/routes/instance/generated-image.ts packages/opencode/src/server/routes/instance/index.ts packages/opencode/test/server/generated-image-route.test.ts
git commit -m "feat: serve generated images from project storage"
```

---

### Task 4：让 WebGUI 通过路径加载图片，并显示引用路径

**Files:**

- Modify: `packages/opencode/webgui/src/lib/fileUtils.ts`
- Modify: `packages/opencode/webgui/src/components/parts/ToolPart/ToolImageAttachments.tsx`
- Modify: `packages/opencode/webgui/src/components/parts/ToolPart/ToolImageAttachments.test.tsx`
- Modify: `packages/opencode/webgui/src/components/parts/ToolPart/index.test.tsx`
- Modify: `packages/opencode/webgui/src/lib/fileUtils.test.ts`

- [ ] **Step 1: 写一个会失败的前端 helper 测试**

给 `fileUtils.test.ts` 加一个测试，断言 URL helper 会把相对路径编码成专用路由：

```ts
expect(buildGeneratedImageUrl(".opencode/generated-images/a b.png")).toBe(
  "/generated-image?path=.opencode%2Fgenerated-images%2Fa%20b.png",
)
```

运行：

```bash
cd packages/opencode/webgui
bun test:run src/lib/fileUtils.test.ts
```

预期：失败，因为 helper 还没加。

- [ ] **Step 2: 增加路径 URL helper**

在 `fileUtils.ts` 里加：

```ts
export function buildGeneratedImageUrl(relativePath: string): string {
  return `/generated-image?path=${encodeURIComponent(relativePath)}`
}
```

如果 `attachment.relativePath` 存在，就用这个 helper；否则保持对旧 `attachment.url` 的兼容。

- [ ] **Step 3: 让图片附件组件显示路径并使用新 URL**

在 `ToolImageAttachments.tsx` 里把附件类型扩成：

```ts
type Attachment = {
  id?: string
  mime?: string
  filename?: string
  url?: string
  relativePath?: string
}
```

渲染时优先用：

```ts
const src = attachment.relativePath ? buildGeneratedImageUrl(attachment.relativePath) : attachment.url
```

并在卡片下方显示相对路径（如果存在）：

```tsx
{
  attachment.relativePath ? (
    <div className="truncate text-xs text-gray-500 dark:text-gray-400">{attachment.relativePath}</div>
  ) : null
}
```

如果路径图片加载失败，显示“预览不可用”，不要让整张卡片崩掉。

- [ ] **Step 4: 更新组件测试**

补充这些断言：

1. `relativePath` 会显示在卡片里。
2. 缩略图 `img src` 来自专用路由，而不是 `data:image/...`。
3. 旧 `data URL` 附件继续正常显示。

运行：

```bash
cd packages/opencode/webgui
bun test:run src/lib/fileUtils.test.ts src/components/parts/ToolPart/ToolImageAttachments.test.tsx src/components/parts/ToolPart/index.test.tsx
```

预期：通过。

- [ ] **Step 5: 做一次 WebGUI 构建验证**

运行：

```bash
cd packages/opencode/webgui
bun run build
```

预期：通过，且只有常规 chunk size warning（如果还存在的话）。

- [ ] **Step 6: 提交这个阶段的改动**

建议提交信息：

```bash
git add packages/opencode/webgui/src/lib/fileUtils.ts packages/opencode/webgui/src/components/parts/ToolPart/ToolImageAttachments.tsx packages/opencode/webgui/src/components/parts/ToolPart/ToolImageAttachments.test.tsx packages/opencode/webgui/src/components/parts/ToolPart/index.test.tsx packages/opencode/webgui/src/lib/fileUtils.test.ts
git commit -m "feat: render generated images from project paths"
```

---

### Task 5：做端到端验证，确认新旧格式都能工作

**Files:**

- Modify: 仅在必要时修复前面各任务留下的断言

- [ ] **Step 1: 跑后端完整相关测试**

运行：

```bash
bun test test/session/generated-image.test.ts test/session/generated-image-persistence.test.ts test/session/prompt.test.ts test/session/processor-effect.test.ts test/server/generated-image-route.test.ts
```

预期：全部通过。

- [ ] **Step 2: 跑 WebGUI 相关测试**

运行：

```bash
cd packages/opencode/webgui
bun test:run src/lib/fileUtils.test.ts src/components/parts/ToolPart/ToolImageAttachments.test.tsx src/components/parts/ToolPart/index.test.tsx
```

预期：全部通过。

- [ ] **Step 3: 跑类型检查**

运行：

```bash
bun typecheck
```

预期：通过。

- [ ] **Step 4: 最后检查旧格式兼容性**

确认 `ToolImageAttachments` 仍能渲染旧的 `data:image/...` 附件；确认 `toModelMessagesEffect` 不会把 `relativePath` 图片当作 media 再次喂给模型。

- [ ] **Step 5: 如果你要合并这批改动，再统一做一次最终提交**

建议提交信息：

```bash
git add .
git commit -m "feat: persist generated images as project files"
```
