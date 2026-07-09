# GPT 图片生成展示与上下文回放 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 支持 GPT 图片生成最终结果在 WebGUI 中直接展示为图片缩略图，并通过现有 tool attachments 机制进入后续上下文，同时增强图片查看器的保存、缩放和平移能力。

**Architecture:** 后端把 `image_generation` 工具结果中的 base64 图片规范化为 `MessageV2.FilePart[]`，挂到 `ToolStateCompleted.attachments`；前端在 `ToolPart` 下方渲染图片附件网格，并复用增强后的 `ImageOverlay` 查看图片。初版只处理最终图，不处理 partial image，不自动保存到工作区。

**Tech Stack:** TypeScript、Effect、Bun test、React 19、Vitest、Testing Library、Tailwind CSS。

---

## 当前状态（2026-05-11）

已完成：

- session 层已通过 `packages/opencode/src/session/prompt.ts` 注入 OpenAI Responses `image_generation` provider tool。
- `packages/opencode/src/provider/sdk/copilot/responses/openai-responses-language-model.ts` 已只在最终 `response.output_item.done.item.result` 到达时产出最终 `tool-result`，`partial_image` 不再被当作完成结果。
- `packages/opencode/src/session/generated-image.ts` 已兼容裸 base64、data URL、JSON 结构、raw provider output、structured provider output，并保留 `title` / `metadata` / 既有 `attachments`。
- 新生成图片文件名会在已有图片附件之后顺延编号。
- completed tool summary 已调整为仅 `已生成 N 张图片：`，不再重复列出文件名；UI 仍显示 `Image #N` 和文件名。
- WebGUI 已完成图片缩略图网格、查看器保存/缩放/平移能力；`ImageOverlay` 默认打开即“适应窗口”。
- 工具名 `image_generation` 已在 UI 中显示为“图片生成”，并去掉重复标题展示。

已验证：

- `cd packages/opencode/webgui && bun test:run src/components/parts/ToolPart/index.test.tsx src/components/parts/ImageOverlay.test.tsx src/components/parts/ToolPart/ToolImageAttachments.test.tsx src/lib/fileUtils.test.ts`
- `cd packages/opencode/webgui && bun run build`
- `cd packages/opencode && bun test test/session/generated-image.test.ts`
- `cd packages/opencode && bun typecheck`

剩余收尾：

- 同步 `packages/opencode/test/session/processor-effect.test.ts` 的旧断言到新摘要契约。
- 重跑 `generated-image` + `processor-effect` 相关后端测试，确认无回归。

## 与原计划相比的落地调整

- provider tool 的正确接入点不是 `providerOptions.openai.imageGeneration`，而是 session 层 `resolveTools` 后追加 OpenAI Responses `image_generation` provider tool。
- 后端摘要文本不再生成 `Image #N` 行；这些索引只保留在附件文件名和 UI 展示中。
- `generated-image` helper 需要兼容 provider-executed 原始结果形态，因此 `output` 输入从原计划中的 `string` 扩展为 `unknown` / structured output。
- 图片查看器虽然仍支持“重置到 100%”，但默认打开态改为“适应窗口”。

## 文件结构

- 创建：`packages/opencode/src/session/generated-image.ts`
  - 纯函数：识别 `image_generation` 输出、提取单张/多张图片、生成有序 `FilePart[]`、保留原 `title` / `metadata` / `attachments`，并生成汇总摘要。
- 创建：`packages/opencode/test/session/generated-image.test.ts`
  - 覆盖单图、多图、data URL、JSON 响应、structured provider output、已有附件顺延编号、异常输入。
- 修改：`packages/opencode/src/session/processor.ts`
  - 在 `completeToolCall` 写入 completed state 前调用规范化函数。
- 修改：`packages/opencode/src/session/prompt.ts`
  - 在 session 解析工具后按模型能力注入 OpenAI Responses `image_generation` provider tool。
- 修改：`packages/opencode/test/session/prompt.test.ts`
  - 覆盖 GPT 图片请求时注入 provider tool 的回归测试。
- 修改：`packages/opencode/src/provider/sdk/copilot/responses/openai-responses-language-model.ts`
  - 忽略 `partial_image` 的最终化，只在最终结果事件生成 `tool-result`。
- 修改：`packages/opencode/test/provider/copilot/openai-responses-language-model.test.ts`
  - 覆盖最终 `image_generation_call`、先 tool call 后最终结果、忽略 `partial_image` 的回归测试。
- 创建：`packages/opencode/webgui/src/components/parts/ToolPart/ToolImageAttachments.tsx`
  - 专职渲染 completed tool 的图片附件网格。
- 修改：`packages/opencode/webgui/src/components/parts/ToolPart/index.tsx`
  - 扩展本地 props 类型，接入 `ToolImageAttachments`。
- 修改：`packages/opencode/webgui/src/components/parts/ToolPart/utils.tsx`
  - 增加 `image_generation -> 图片生成` 的中文标签。
- 修改：`packages/opencode/webgui/src/components/parts/ToolPart/index.test.tsx`
  - 覆盖图片附件网格展示、摘要去重与工具名展示。
- 修改：`packages/opencode/webgui/src/components/parts/ImageOverlay.tsx`
  - 增加保存、缩放、适应窗口、拖拽平移、双击复位、快捷键，并默认以适应窗口打开。
- 创建：`packages/opencode/webgui/src/components/parts/ImageOverlay.test.tsx`
  - 覆盖查看器按钮、键盘缩放、保存下载回退。
- 修改：`packages/opencode/webgui/src/lib/fileUtils.ts`
  - 增加 data URL 到 Blob、下载文件、文件名清理的小工具。

> Git 提交说明：本计划包含检查点，但默认不执行 `git commit`。只有用户在执行阶段明确要求提交时，才执行提交命令。

---

### Task 1: 后端图片生成结果纯函数

**Files:**

- Create: `packages/opencode/src/session/generated-image.ts`
- Test: `packages/opencode/test/session/generated-image.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `packages/opencode/test/session/generated-image.test.ts`：

```ts
import { describe, expect, test } from "bun:test"
import { MessageID, SessionID } from "../../src/session/schema"
import { normalizeImageGenerationOutput } from "../../src/session/generated-image"

const sessionID = SessionID.make("ses_test")
const messageID = MessageID.make("msg_test")
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="

function output(value: string) {
  return {
    title: "image_generation",
    metadata: {},
    output: value,
  }
}

describe("normalizeImageGenerationOutput", () => {
  test("把 image_generation 的裸 base64 转成图片附件并替换输出摘要", () => {
    const result = normalizeImageGenerationOutput({
      tool: "image_generation",
      sessionID,
      messageID,
      output: output(png),
    })

    expect(result.attachments).toHaveLength(1)
    expect(result.attachments?.[0]?.type).toBe("file")
    expect(result.attachments?.[0]?.mime).toBe("image/png")
    expect(result.attachments?.[0]?.filename).toBe("generated-image-1.png")
    expect(result.attachments?.[0]?.url).toBe(`data:image/png;base64,${png}`)
    expect(result.output).toContain("已生成 1 张图片")
    expect(result.output).toContain("Image #1 generated-image-1.png")
    expect(result.output).not.toContain(png)
  })

  test("把 JSON data 数组转成多个有序图片附件", () => {
    const result = normalizeImageGenerationOutput({
      tool: "image_generation",
      sessionID,
      messageID,
      output: output(JSON.stringify({ data: [{ b64_json: png }, { b64_json: png }] })),
    })

    expect(result.attachments?.map((item) => item.filename)).toEqual(["generated-image-1.png", "generated-image-2.png"])
    expect(result.output).toContain("已生成 2 张图片")
    expect(result.output).toContain("Image #2 generated-image-2.png")
  })

  test("非 image_generation 工具不改写输出", () => {
    const original = output(png)
    const result = normalizeImageGenerationOutput({
      tool: "bash",
      sessionID,
      messageID,
      output: original,
    })

    expect(result).toBe(original)
  })

  test("无法识别图片时保留原始输出且不抛错", () => {
    const result = normalizeImageGenerationOutput({
      tool: "image_generation",
      sessionID,
      messageID,
      output: output("not an image"),
    })

    expect(result.output).toBe("not an image")
    expect(result.attachments).toBeUndefined()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run from `packages/opencode`:

```bash
bun test test/session/generated-image.test.ts --timeout 30000
```

Expected: FAIL，错误包含 `Cannot find module '../../src/session/generated-image'`。

- [ ] **Step 3: 实现纯函数**

创建 `packages/opencode/src/session/generated-image.ts`：

```ts
import type { MessageV2 } from "./message-v2"
import { PartID, type MessageID, type SessionID } from "./schema"

type ToolOutput = {
  title: string
  metadata: Record<string, any>
  output: string
  attachments?: MessageV2.FilePart[]
}

type Input = {
  tool: string
  sessionID: SessionID
  messageID: MessageID
  output: ToolOutput
}

type ImageCandidate = {
  mime: string
  base64: string
}

const IMAGE_TOOL = "image_generation"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function extension(mime: string) {
  if (mime === "image/jpeg") return "jpg"
  if (mime === "image/webp") return "webp"
  return "png"
}

function fromDataUrl(value: string): ImageCandidate | undefined {
  const match = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\r\n]+)$/)
  if (!match) return undefined
  return { mime: match[1]!, base64: match[2]!.replace(/\s/g, "") }
}

function fromBase64(value: string): ImageCandidate | undefined {
  const compact = value.trim().replace(/\s/g, "")
  if (compact.length < 40) return undefined
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return undefined
  return { mime: "image/png", base64: compact }
}

function candidateFromString(value: string): ImageCandidate | undefined {
  return fromDataUrl(value) ?? fromBase64(value)
}

function collectCandidates(value: unknown): ImageCandidate[] {
  if (typeof value === "string") {
    const direct = candidateFromString(value)
    if (direct) return [direct]
    const parsed = parseJson(value)
    return parsed === undefined ? [] : collectCandidates(parsed)
  }

  if (Array.isArray(value)) return value.flatMap(collectCandidates)

  if (!isRecord(value)) return []

  const result = value.result
  if (typeof result === "string") {
    const image = candidateFromString(result)
    if (image) return [image]
  }

  const b64 = value.b64_json ?? value.b64Json ?? value.base64
  if (typeof b64 === "string") {
    const image = candidateFromString(b64)
    if (image) return [image]
  }

  const data = value.data ?? value.images ?? value.results
  if (Array.isArray(data)) return data.flatMap(collectCandidates)

  return []
}

function imageSummary(files: MessageV2.FilePart[]) {
  const lines = files.map((file, index) => `Image #${index + 1} ${file.filename ?? `generated-image-${index + 1}.png`}`)
  return [`已生成 ${files.length} 张图片：`, ...lines].join("\n")
}

export function normalizeImageGenerationOutput(input: Input): ToolOutput {
  if (input.tool !== IMAGE_TOOL) return input.output

  const candidates = collectCandidates(input.output.output)
  if (candidates.length === 0) return input.output

  const attachments = candidates.map((image, index) => {
    const filename = `generated-image-${index + 1}.${extension(image.mime)}`
    return {
      id: PartID.ascending(),
      sessionID: input.sessionID,
      messageID: input.messageID,
      type: "file",
      mime: image.mime,
      filename,
      url: `data:${image.mime};base64,${image.base64}`,
    } satisfies MessageV2.FilePart
  })

  return {
    ...input.output,
    output: imageSummary(attachments),
    attachments: [...(input.output.attachments ?? []), ...attachments],
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run from `packages/opencode`:

```bash
bun test test/session/generated-image.test.ts --timeout 30000
```

Expected: PASS。

---

### Task 2: 接入 SessionProcessor 完成态写入

**Files:**

- Modify: `packages/opencode/src/session/processor.ts`
- Test: `packages/opencode/test/session/generated-image.test.ts`

- [ ] **Step 1: 扩展测试覆盖已有附件合并**

在 `generated-image.test.ts` 的 `describe` 中追加：

```ts
test("生成图片附件会保留已有附件并追加在后面", () => {
  const existing = {
    id: "prt_existing" as any,
    sessionID,
    messageID,
    type: "file" as const,
    mime: "image/png",
    filename: "existing.png",
    url: `data:image/png;base64,${png}`,
  }

  const result = normalizeImageGenerationOutput({
    tool: "image_generation",
    sessionID,
    messageID,
    output: { ...output(png), attachments: [existing] },
  })

  expect(result.attachments?.map((item) => item.filename)).toEqual(["existing.png", "generated-image-1.png"])
})
```

- [ ] **Step 2: 运行测试确认当前 helper 行为通过**

Run from `packages/opencode`:

```bash
bun test test/session/generated-image.test.ts --timeout 30000
```

Expected: PASS。

- [ ] **Step 3: 修改 processor 调用 helper**

在 `packages/opencode/src/session/processor.ts` 顶部导入：

```ts
import { normalizeImageGenerationOutput } from "./generated-image"
```

将 `completeToolCall` 中的 `session.updatePart` 前增加规范化变量，并替换写入字段：

```ts
const normalized = normalizeImageGenerationOutput({
  tool: match.part.tool,
  sessionID: match.part.sessionID,
  messageID: match.part.messageID,
  output,
})
yield *
  session.updatePart({
    ...match.part,
    state: {
      status: "completed",
      input: match.part.state.input,
      output: normalized.output,
      metadata: normalized.metadata,
      title: normalized.title,
      time: { start: match.part.state.time.start, end: Date.now() },
      attachments: normalized.attachments,
    },
  })
```

- [ ] **Step 4: 运行后端相关测试和类型检查**

Run from `packages/opencode`:

```bash
bun test test/session/generated-image.test.ts test/session/processor-effect.test.ts --timeout 30000
bun typecheck
```

Expected: 两个命令均成功。

---

### Task 3: WebGUI 图片附件网格组件

**Files:**

- Create: `packages/opencode/webgui/src/components/parts/ToolPart/ToolImageAttachments.tsx`
- Modify: `packages/opencode/webgui/src/components/parts/ToolPart/index.test.tsx`

- [ ] **Step 1: 写失败测试**

在 `packages/opencode/webgui/src/components/parts/ToolPart/index.test.tsx` 的 `describe("ToolPart", ...)` 中追加：

```tsx
it("completed tool 的图片附件应显示为 Image 编号缩略图", () => {
  const part = {
    id: "p-image",
    type: "tool",
    callID: "c-image",
    tool: "image_generation",
    state: {
      status: "completed",
      input: {},
      output: "已生成 2 张图片",
      title: "image_generation",
      metadata: {},
      time: { start: 1, end: 2 },
      attachments: [
        {
          id: "f1",
          type: "file",
          mime: "image/png",
          filename: "generated-image-1.png",
          url: "data:image/png;base64,abc",
        },
        {
          id: "f2",
          type: "file",
          mime: "image/png",
          filename: "generated-image-2.png",
          url: "data:image/png;base64,def",
        },
        {
          id: "f3",
          type: "file",
          mime: "text/plain",
          filename: "notes.txt",
          url: "data:text/plain;base64,bm90ZXM=",
        },
      ],
    },
  } as any

  render(<ToolPart part={part} sessionID="s1" messageID="m1" />)

  expect(screen.getByText("Image #1")).toBeInTheDocument()
  expect(screen.getByText("Image #2")).toBeInTheDocument()
  expect(screen.getByText("generated-image-1.png")).toBeInTheDocument()
  expect(screen.queryByText("notes.txt")).not.toBeInTheDocument()
})
```

- [ ] **Step 2: 运行测试确认失败**

Run from `packages/opencode/webgui`:

```bash
bun test:run src/components/parts/ToolPart/index.test.tsx
```

Expected: FAIL，找不到 `Image #1`。

- [ ] **Step 3: 创建 ToolImageAttachments 组件**

创建 `packages/opencode/webgui/src/components/parts/ToolPart/ToolImageAttachments.tsx`：

```tsx
import { useState } from "react"
import { ImageOverlay } from "../ImageOverlay"

type Attachment = {
  id?: string
  mime?: string
  filename?: string
  url?: string
}

interface Props {
  attachments?: Attachment[]
}

function imageAttachments(attachments?: Attachment[]) {
  return (attachments ?? []).filter((item): item is Required<Pick<Attachment, "url">> & Attachment => {
    return typeof item.url === "string" && typeof item.mime === "string" && item.mime.startsWith("image/")
  })
}

export function ToolImageAttachments({ attachments }: Props) {
  const images = imageAttachments(attachments)
  const [preview, setPreview] = useState<null | { url: string; alt: string }>(null)

  if (images.length === 0) return null

  return (
    <div className="border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 px-3 py-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {images.map((image, index) => {
          const label = `Image #${index + 1}`
          const filename = image.filename ?? `generated-image-${index + 1}.png`
          return (
            <button
              key={image.id ?? `${filename}-${index}`}
              type="button"
              className="group overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-left shadow-sm hover:border-blue-400 dark:hover:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              onClick={() => setPreview({ url: image.url, alt: filename })}
            >
              <div className="aspect-video bg-gray-100 dark:bg-gray-800 overflow-hidden">
                <img
                  src={image.url}
                  alt={filename}
                  className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
                />
              </div>
              <div className="px-3 py-2">
                <div className="text-xs font-semibold text-blue-600 dark:text-blue-300">{label}</div>
                <div className="mt-0.5 truncate font-mono text-xs text-gray-600 dark:text-gray-300" title={filename}>
                  {filename}
                </div>
              </div>
            </button>
          )
        })}
      </div>
      {preview && <ImageOverlay url={preview.url} alt={preview.alt} onClose={() => setPreview(null)} />}
    </div>
  )
}
```

- [ ] **Step 4: 运行测试确认仍失败于未接入**

Run from `packages/opencode/webgui`:

```bash
bun test:run src/components/parts/ToolPart/index.test.tsx
```

Expected: FAIL，仍找不到 `Image #1`，因为 `ToolPart` 还未渲染新组件。

---

### Task 4: ToolPart 接入图片附件网格

**Files:**

- Modify: `packages/opencode/webgui/src/components/parts/ToolPart/index.tsx`
- Test: `packages/opencode/webgui/src/components/parts/ToolPart/index.test.tsx`

- [ ] **Step 1: 扩展 ToolPart 本地类型**

在 `ToolPartProps.part.state` 中增加：

```ts
      attachments?: Array<{
        id?: string
        type?: "file"
        mime?: string
        filename?: string
        url?: string
      }>
```

- [ ] **Step 2: 导入并渲染图片附件组件**

在 `packages/opencode/webgui/src/components/parts/ToolPart/index.tsx` 顶部增加：

```ts
import { ToolImageAttachments } from "./ToolImageAttachments"
```

在 root JSX 中，放在 expanded content 之后、read tool error 之前：

```tsx
{
  part.state.status === "completed" && <ToolImageAttachments attachments={part.state.attachments} />
}
```

- [ ] **Step 3: 运行 ToolPart 测试**

Run from `packages/opencode/webgui`:

```bash
bun test:run src/components/parts/ToolPart/index.test.tsx
```

Expected: PASS。

---

### Task 5: 图片保存工具函数

**Files:**

- Modify: `packages/opencode/webgui/src/lib/fileUtils.ts`
- Test: `packages/opencode/webgui/src/components/parts/ImageOverlay.test.tsx`

- [ ] **Step 1: 增加保存工具函数**

在 `packages/opencode/webgui/src/lib/fileUtils.ts` 追加：

```ts
export function sanitizeFilename(filename: string): string {
  const cleaned = filename.replace(/[\\/:*?"<>|]/g, "-").trim()
  return cleaned.length > 0 ? cleaned : "image.png"
}

export function dataUrlToBlob(url: string): Blob {
  const [header, data] = url.split(",")
  if (!header || !data) throw new Error("Invalid data URL")
  const mime = header.match(/^data:([^;]+)/)?.[1] ?? "application/octet-stream"
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return new Blob([bytes], { type: mime })
}

export function downloadUrl(url: string, filename: string): void {
  const safe = sanitizeFilename(filename)
  const objectUrl = url.startsWith("data:") ? URL.createObjectURL(dataUrlToBlob(url)) : url
  const anchor = document.createElement("a")
  anchor.href = objectUrl
  anchor.download = safe
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  if (objectUrl !== url) URL.revokeObjectURL(objectUrl)
}
```

- [ ] **Step 2: 类型检查 WebGUI**

Run from `packages/opencode/webgui`:

```bash
bun run build
```

Expected: build 成功。

---

### Task 6: 增强 ImageOverlay 查看器

**Files:**

- Modify: `packages/opencode/webgui/src/components/parts/ImageOverlay.tsx`
- Create: `packages/opencode/webgui/src/components/parts/ImageOverlay.test.tsx`

- [ ] **Step 1: 写失败测试**

创建 `packages/opencode/webgui/src/components/parts/ImageOverlay.test.tsx`：

```tsx
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ImageOverlay } from "./ImageOverlay"

describe("ImageOverlay", () => {
  it("显示保存和缩放控制", () => {
    render(<ImageOverlay url="data:image/png;base64,abc" alt="generated-image-1.png" onClose={vi.fn()} />)

    expect(screen.getByRole("button", { name: "保存图片" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "放大" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "缩小" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "重置缩放" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "适应窗口" })).toBeInTheDocument()
  })

  it("键盘加减号可调整缩放，0 可重置", () => {
    render(<ImageOverlay url="data:image/png;base64,abc" alt="generated-image-1.png" onClose={vi.fn()} />)

    fireEvent.keyDown(document, { key: "+" })
    expect(screen.getByText("125%")).toBeInTheDocument()

    fireEvent.keyDown(document, { key: "-" })
    expect(screen.getByText("100%")).toBeInTheDocument()

    fireEvent.keyDown(document, { key: "+" })
    fireEvent.keyDown(document, { key: "0" })
    expect(screen.getByText("100%")).toBeInTheDocument()
  })

  it("Esc 关闭查看器", () => {
    const onClose = vi.fn()
    render(<ImageOverlay url="data:image/png;base64,abc" alt="generated-image-1.png" onClose={onClose} />)

    fireEvent.keyDown(document, { key: "Escape" })

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run from `packages/opencode/webgui`:

```bash
bun test:run src/components/parts/ImageOverlay.test.tsx
```

Expected: FAIL，找不到保存和缩放按钮。

- [ ] **Step 3: 替换 ImageOverlay 实现**

将 `packages/opencode/webgui/src/components/parts/ImageOverlay.tsx` 替换为：

```tsx
import { useCallback, useEffect, useMemo, useState, type PointerEvent, type WheelEvent } from "react"
import { downloadUrl } from "../../lib/fileUtils"

interface Props {
  url: string
  alt: string
  onClose: () => void
}

const minScale = 0.25
const maxScale = 5
const step = 0.25

function clamp(value: number) {
  return Math.min(maxScale, Math.max(minScale, value))
}

export function ImageOverlay({ url, alt, onClose }: Props) {
  const [scale, setScale] = useState(1)
  const [fit, setFit] = useState(false)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [drag, setDrag] = useState<null | { x: number; y: number; startX: number; startY: number }>(null)

  const percent = `${Math.round(scale * 100)}%`
  const transform = useMemo(() => {
    if (fit) return `translate(${offset.x}px, ${offset.y}px) scale(1)`
    return `translate(${offset.x}px, ${offset.y}px) scale(${scale})`
  }, [fit, offset.x, offset.y, scale])

  const zoomIn = useCallback(() => {
    setFit(false)
    setScale((value) => clamp(value + step))
  }, [])

  const zoomOut = useCallback(() => {
    setFit(false)
    setScale((value) => clamp(value - step))
  }, [])

  const reset = useCallback(() => {
    setFit(false)
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [])

  const fitWindow = useCallback(() => {
    setFit(true)
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [])

  const save = useCallback(() => {
    downloadUrl(url, alt)
  }, [alt, url])

  useEffect(() => {
    const handler = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose()
      if (event.key === "+" || event.key === "=") zoomIn()
      if (event.key === "-") zoomOut()
      if (event.key === "0") reset()
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [onClose, reset, zoomIn, zoomOut])

  const handleWheel = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      event.preventDefault()
      if (event.deltaY < 0) zoomIn()
      else zoomOut()
    },
    [zoomIn, zoomOut],
  )

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId)
      setDrag({ x: event.clientX, y: event.clientY, startX: offset.x, startY: offset.y })
    },
    [offset.x, offset.y],
  )

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!drag) return
      setOffset({ x: drag.startX + event.clientX - drag.x, y: drag.startY + event.clientY - drag.y })
    },
    [drag],
  )

  const handlePointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.releasePointerCapture(event.pointerId)
    setDrag(null)
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex items-center justify-between gap-3 border-b border-white/10 bg-black/40 px-4 py-3"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="min-w-0 truncate font-mono text-sm text-white/80">{alt}</span>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={zoomOut}
            className="rounded bg-white/10 px-2 py-1 text-sm text-white hover:bg-white/20"
            aria-label="缩小"
          >
            −
          </button>
          <button
            type="button"
            onClick={reset}
            className="rounded bg-white/10 px-2 py-1 text-sm text-white hover:bg-white/20"
            aria-label="重置缩放"
          >
            {percent}
          </button>
          <button
            type="button"
            onClick={zoomIn}
            className="rounded bg-white/10 px-2 py-1 text-sm text-white hover:bg-white/20"
            aria-label="放大"
          >
            ＋
          </button>
          <button
            type="button"
            onClick={fitWindow}
            className="rounded bg-white/10 px-2 py-1 text-sm text-white hover:bg-white/20"
            aria-label="适应窗口"
          >
            适应
          </button>
          <button
            type="button"
            onClick={save}
            className="rounded bg-blue-600 px-2 py-1 text-sm text-white hover:bg-blue-500"
            aria-label="保存图片"
          >
            保存
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded bg-white/10 px-2 py-1 text-sm text-white hover:bg-white/20"
            aria-label="关闭"
          >
            ×
          </button>
        </div>
      </div>
      <div
        className="flex flex-1 cursor-grab items-center justify-center overflow-hidden active:cursor-grabbing"
        onClick={(event) => event.stopPropagation()}
        onWheel={handleWheel}
        onDoubleClick={reset}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <img
          src={url}
          alt={alt}
          className={
            fit
              ? "max-h-[88vh] max-w-[94vw] rounded object-contain shadow-2xl"
              : "max-h-none max-w-none rounded shadow-2xl"
          }
          style={{ transform, transformOrigin: "center", transition: drag ? "none" : "transform 120ms ease" }}
          draggable={false}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 运行 ImageOverlay 测试**

Run from `packages/opencode/webgui`:

```bash
bun test:run src/components/parts/ImageOverlay.test.tsx
```

Expected: PASS。

---

### Task 7: 完整前端验证

**Files:**

- Verify: `packages/opencode/webgui/src/components/parts/ToolPart/index.test.tsx`
- Verify: `packages/opencode/webgui/src/components/parts/ImageOverlay.test.tsx`

- [ ] **Step 1: 运行相关前端测试**

Run from `packages/opencode/webgui`:

```bash
bun test:run src/components/parts/ToolPart/index.test.tsx src/components/parts/ImageOverlay.test.tsx
```

Expected: PASS。

- [ ] **Step 2: 运行 WebGUI build**

Run from `packages/opencode/webgui`:

```bash
bun run build
```

Expected: `tsc -b` 和 `vite build` 均成功。

---

### Task 8: 端到端静态验证与回归检查

**Files:**

- Verify: `packages/opencode/src/session/generated-image.ts`
- Verify: `packages/opencode/src/session/processor.ts`
- Verify: `packages/opencode/webgui/src/components/parts/ToolPart/ToolImageAttachments.tsx`
- Verify: `packages/opencode/webgui/src/components/parts/ImageOverlay.tsx`

- [ ] **Step 1: 运行后端相关测试**

Run from `packages/opencode`:

```bash
bun test test/session/generated-image.test.ts test/session/processor-effect.test.ts --timeout 30000
```

Expected: PASS。

- [ ] **Step 2: 运行后端类型检查**

Run from `packages/opencode`:

```bash
bun typecheck
```

Expected: PASS。

- [ ] **Step 3: 运行前端相关测试和构建**

Run from `packages/opencode/webgui`:

```bash
bun test:run src/components/parts/ToolPart/index.test.tsx src/components/parts/ImageOverlay.test.tsx
bun run build
```

Expected: PASS。

- [ ] **Step 4: 检查差异中没有无关改动**

Run from repository root:

```bash
git diff -- docs/superpowers/specs/2026-05-10-gpt-image-generation-display-design.md docs/superpowers/plans/2026-05-10-gpt-image-generation-display.md packages/opencode/src/session/generated-image.ts packages/opencode/src/session/processor.ts packages/opencode/test/session/generated-image.test.ts packages/opencode/webgui/src/components/parts/ToolPart/ToolImageAttachments.tsx packages/opencode/webgui/src/components/parts/ToolPart/index.tsx packages/opencode/webgui/src/components/parts/ToolPart/index.test.tsx packages/opencode/webgui/src/components/parts/ImageOverlay.tsx packages/opencode/webgui/src/components/parts/ImageOverlay.test.tsx packages/opencode/webgui/src/lib/fileUtils.ts
```

Expected: diff 只包含本功能相关变更。

---

## 自检记录

- Spec 覆盖：后端桥接、上下文回放、WebGUI 网格、查看器增强、多图顺序、手动保存、测试策略均有任务覆盖。
- 范围控制：未加入自动保存、partial image、专用编辑 UI、artifact 管理。
- 类型一致性：后端使用 `MessageV2.FilePart`、`ToolStateCompleted.attachments`；前端使用局部 attachment 结构并只消费 `mime/url/filename/id`。
- 完整性扫描：计划中没有未定义的任务；每个代码修改步骤包含具体代码或明确插入位置。
