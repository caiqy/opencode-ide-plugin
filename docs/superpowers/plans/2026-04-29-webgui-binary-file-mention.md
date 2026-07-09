# WebGUI 二进制文件 @引用降级实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 WebGUI 的 `@文件` 引用在遇到 `.vsix`、`.zip` 等不支持展开的二进制文件时不再触发 `Cannot read binary file`，同时保持文本文件行号范围与 PDF attachment 行为不变。

**Architecture:** 先把“文本 / PDF / 图片 / 其他二进制”的判定逻辑从 `tool/read.ts` 提炼到共享媒体工具中，让 `read` 与 `session/prompt` 使用同一套分类规则；随后只修改 `SessionPrompt` 的 `file://` 引用分流：文本继续走 Read，PDF / 图片继续转 attachment，其他二进制直接保留原始 file part，不再调用 Read、也不再发布 Session.Error。

**Tech Stack:** TypeScript 5.8, Effect 4, Bun test, opencode SessionPrompt / ReadTool

**Spec:** `docs/superpowers/specs/2026-04-29-webgui-binary-file-mention-design.md`

---

### Task 1: 提取共享文件分类逻辑，并让 ReadTool 继续通过回归测试

**Files:**

- Create: `packages/opencode/test/util/media.test.ts`
- Modify: `packages/opencode/src/util/media.ts`
- Modify: `packages/opencode/src/tool/read.ts`
- Verify: `packages/opencode/test/tool/read.test.ts`

- [ ] **Step 1: 先写失败测试，锁定 `.vsix` / PDF / 文本三种分类结果**

```ts
// packages/opencode/test/util/media.test.ts
import { describe, expect, test } from "bun:test"
import { classifyAttachment } from "../../src/util/media"

describe("util/media classifyAttachment", () => {
  test("treats .vsix zip payloads as binary", () => {
    const bytes = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00])

    expect(classifyAttachment("plugin.vsix", bytes, "text/plain")).toEqual({
      kind: "binary",
      mime: "text/plain",
    })
  })

  test("keeps PDF payloads as pdf attachments", () => {
    const bytes = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n")

    expect(classifyAttachment("manual.pdf", bytes, "text/plain")).toEqual({
      kind: "pdf",
      mime: "application/pdf",
    })
  })

  test("keeps UTF-8 source files as text", () => {
    const bytes = Buffer.from("export const value = 1\n")

    expect(classifyAttachment("index.ts", bytes, "text/plain")).toEqual({
      kind: "text",
      mime: "text/plain",
    })
  })

  test("treats null-byte text extension files as binary", () => {
    const bytes = Uint8Array.from([0x68, 0x69, 0x00, 0x21])

    expect(classifyAttachment("broken.txt", bytes, "text/plain")).toEqual({
      kind: "binary",
      mime: "text/plain",
    })
  })
})
```

- [ ] **Step 2: 运行新测试，确认它先失败**

Run: `bun test test/util/media.test.ts`

Expected: FAIL，报错类似 `classifyAttachment is not exported` 或 `undefined is not a function`。

- [ ] **Step 3: 在 `util/media.ts` 中实现共享分类函数**

```ts
// packages/opencode/src/util/media.ts
import path from "path"

const startsWith = (bytes: Uint8Array, prefix: number[]) => prefix.every((value, index) => bytes[index] === value)

const binaryExtensions = new Set([
  ".zip",
  ".vsix",
  ".tar",
  ".gz",
  ".exe",
  ".dll",
  ".so",
  ".class",
  ".jar",
  ".war",
  ".7z",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".odt",
  ".ods",
  ".odp",
  ".bin",
  ".dat",
  ".obj",
  ".o",
  ".a",
  ".lib",
  ".wasm",
  ".pyc",
  ".pyo",
])

export function isPdfAttachment(mime: string) {
  return mime === "application/pdf"
}

export function isMedia(mime: string) {
  return mime.startsWith("image/") || isPdfAttachment(mime)
}

export function isImageAttachment(mime: string) {
  return mime.startsWith("image/") && mime !== "image/svg+xml" && mime !== "image/vnd.fastbidsheet"
}

export function sniffAttachmentMime(bytes: Uint8Array, fallback: string) {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png"
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg"
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif"
  if (startsWith(bytes, [0x42, 0x4d])) return "image/bmp"
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50])) {
    return "image/webp"
  }

  return fallback
}

export function isBinaryAttachment(filepath: string, bytes: Uint8Array) {
  const ext = path.extname(filepath).toLowerCase()
  if (binaryExtensions.has(ext)) return true
  if (bytes.length === 0) return false

  let nonPrintableCount = 0
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) return true
    if (bytes[i] < 9 || (bytes[i] > 13 && bytes[i] < 32)) {
      nonPrintableCount++
    }
  }

  return nonPrintableCount / bytes.length > 0.3
}

export function classifyAttachment(filepath: string, bytes: Uint8Array, fallbackMime: string) {
  const mime = sniffAttachmentMime(bytes, fallbackMime)

  if (isImageAttachment(mime)) {
    return { kind: "image" as const, mime }
  }

  if (isPdfAttachment(mime)) {
    return { kind: "pdf" as const, mime }
  }

  if (isBinaryAttachment(filepath, bytes)) {
    return { kind: "binary" as const, mime }
  }

  return { kind: "text" as const, mime }
}
```

- [ ] **Step 4: 让 `ReadTool` 改用共享分类逻辑，不保留本地重复实现**

```ts
// packages/opencode/src/tool/read.ts
import { classifyAttachment } from "@/util/media"
```

```ts
// 删除 read.ts 里原本的 const isBinaryFile = ...
```

```ts
// packages/opencode/src/tool/read.ts
const loaded = yield * instruction.resolve(ctx.messages, filepath, ctx.messageID)
const sample = yield * readSample(filepath, Number(stat.size), SAMPLE_BYTES)

const classified = classifyAttachment(filepath, sample, AppFileSystem.mimeType(filepath))
if (classified.kind === "image" || classified.kind === "pdf") {
  const bytes = yield * fs.readFile(filepath)
  const msg = classified.kind === "pdf" ? "PDF read successfully" : "Image read successfully"
  return {
    title,
    output: msg,
    metadata: {
      preview: msg,
      truncated: false,
      loaded: loaded.map((item) => item.filepath),
    },
    attachments: [
      {
        type: "file" as const,
        mime: classified.mime,
        url: `data:${classified.mime};base64,${Buffer.from(bytes).toString("base64")}`,
      },
    ],
  }
}

if (classified.kind === "binary") {
  return yield * Effect.fail(new Error(`Cannot read binary file: ${filepath}`))
}
```

- [ ] **Step 5: 运行 util + read 相关测试，确认共享分类没有破坏既有行为**

Run: `bun test test/util/media.test.ts test/tool/read.test.ts`

Expected: 全部 PASS；`tool.read binary detection` 相关已有测试继续通过。

- [ ] **Step 6: 提交这一小步**

```bash
git add packages/opencode/src/util/media.ts packages/opencode/src/tool/read.ts packages/opencode/test/util/media.test.ts
git commit -m "refactor(prompt): share attachment classification rules"
```

---

### Task 2: 调整 SessionPrompt 的 `file://` 分流，保留文本 / PDF，降级其他二进制

**Files:**

- Modify: `packages/opencode/src/session/prompt.ts`
- Modify: `packages/opencode/test/session/prompt.test.ts`

- [ ] **Step 1: 先写失败测试，覆盖文本范围、PDF、`.vsix` 三条路径**

```ts
// packages/opencode/test/session/prompt.test.ts
it.live("keeps text file range references readable", () =>
  provideTmpdirInstance(
    (dir) =>
      Effect.gen(function* () {
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const session = yield* sessions.create({})

        const source = path.join(dir, "range.ts")
        yield* Effect.promise(() => Bun.write(source, "one\ntwo\nthree\nfour\n"))

        const url = pathToFileURL(source)
        url.searchParams.set("start", "2")
        url.searchParams.set("end", "3")

        const message = yield* prompt.prompt({
          sessionID: session.id,
          agent: "build",
          noReply: true,
          parts: [
            { type: "text", text: "check the selected lines" },
            { type: "file", mime: "text/plain", filename: "range.ts", url: url.toString() },
          ],
        })

        const stored = MessageV2.get({ sessionID: session.id, messageID: message.info.id })
        const text = stored.parts.filter((part) => part.type === "text").map((part) => part.text)

        expect(text.some((value) => value.includes('"offset":2') && value.includes('"limit":2'))).toBe(true)
        expect(text.some((value) => value.includes("2: two"))).toBe(true)
        expect(text.some((value) => value.includes("3: three"))).toBe(true)
      }),
    { git: true, config: cfg },
  ),
)

it.live("keeps pdf file references as attachments even when mention mime is text/plain", () =>
  provideTmpdirInstance(
    (dir) =>
      Effect.gen(function* () {
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const session = yield* sessions.create({})

        const pdf = path.join(dir, "manual.pdf")
        yield* Effect.promise(() => Bun.write(pdf, Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n")))

        const message = yield* prompt.prompt({
          sessionID: session.id,
          agent: "build",
          noReply: true,
          parts: [
            { type: "text", text: "review the attached manual" },
            { type: "file", mime: "text/plain", filename: "manual.pdf", url: pathToFileURL(pdf).toString() },
          ],
        })

        const stored = MessageV2.get({ sessionID: session.id, messageID: message.info.id })
        const fileParts = stored.parts.filter((part) => part.type === "file")
        const text = stored.parts.filter((part) => part.type === "text").map((part) => part.text)

        expect(text.some((value) => value.includes("PDF read successfully"))).toBe(true)
        expect(
          fileParts.some(
            (part) => part.mime === "application/pdf" && part.url.startsWith("data:application/pdf;base64,"),
          ),
        ).toBe(true)
      }),
    { git: true, config: cfg },
  ),
)

it.live("keeps binary file references as plain path mentions without read failures", () =>
  provideTmpdirInstance(
    (dir) =>
      Effect.gen(function* () {
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const session = yield* sessions.create({})

        const vsix = path.join(dir, "plugin.vsix")
        yield* Effect.promise(() => Bun.write(vsix, Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00])))

        const message = yield* prompt.prompt({
          sessionID: session.id,
          agent: "build",
          noReply: true,
          parts: [
            { type: "text", text: "look at @plugin.vsix" },
            { type: "file", mime: "text/plain", filename: "plugin.vsix", url: pathToFileURL(vsix).toString() },
          ],
        })

        const stored = MessageV2.get({ sessionID: session.id, messageID: message.info.id })
        const text = stored.parts.filter((part) => part.type === "text").map((part) => part.text)
        const fileParts = stored.parts.filter((part) => part.type === "file")

        expect(text.some((value) => value.startsWith("Called the Read tool"))).toBe(false)
        expect(text.some((value) => value.includes("Cannot read binary file"))).toBe(false)
        expect(
          fileParts.some(
            (part) => part.filename === "plugin.vsix" && part.mime === "text/plain" && part.url.startsWith("file://"),
          ),
        ).toBe(true)
      }),
    { git: true, config: cfg },
  ),
)
```

- [ ] **Step 2: 运行 session prompt 测试，确认新增用例先失败**

Run: `bun test test/session/prompt.test.ts`

Expected: 新增的 `.vsix` 用例 FAIL；如果 PDF 用例当前也 FAIL，说明正好捕获到了需要修复的行为差异。

- [ ] **Step 3: 在 `prompt.ts` 里按共享分类结果重排 `file://` 分流**

```ts
// packages/opencode/src/session/prompt.ts
import { classifyAttachment } from "@/util/media"
```

```ts
// packages/opencode/src/session/prompt.ts
const FILE_SAMPLE_BYTES = 4096
```

```ts
// packages/opencode/src/session/prompt.ts
const readFileSample = Effect.fn("SessionPrompt.readFileSample")(function* (filepath: string) {
  return yield* fsys.readFile(filepath).pipe(
    Effect.map((bytes) => bytes.subarray(0, Math.min(FILE_SAMPLE_BYTES, bytes.length))),
    Effect.catch(() => Effect.succeed(undefined)),
  )
})
```

```ts
// packages/opencode/src/session/prompt.ts 中 case "file:" 分支，放在 execRead 定义之后、part.mime 判断之前
const sample = yield * readFileSample(filepath)
if (sample) {
  const fallbackMime = part.mime === "text/plain" ? AppFileSystem.mimeType(filepath) : part.mime
  const classified = classifyAttachment(filepath, sample, fallbackMime)

  if (classified.kind === "pdf" || classified.kind === "image") {
    part.mime = classified.mime
  }

  if (classified.kind === "binary") {
    return [{ ...part, messageID: info.id, sessionID: input.sessionID }]
  }
}
```

```ts
// 其余逻辑保持原顺序：
// 1. text/plain -> 继续 Read + range
// 2. application/x-directory -> 继续目录 Read
// 3. 其他（此时只剩 image/pdf 等 media）-> 继续生成 data URL file part
```

实现时注意两点：

1. **不要** 在 `classified.kind === "binary"` 分支里发布 `Session.Event.Error`
2. **不要** 生成 `Called the Read tool...` 或 `Read tool failed to read ...` synthetic text
3. **不要** 让缺失文件在采样阶段提前失败；`sample` 读取不到时应继续走原有 Read 分支，保留现有 missing file 回归行为

- [ ] **Step 4: 运行目标测试，确认文本范围 / PDF / 二进制降级都通过**

Run: `bun test test/util/media.test.ts test/tool/read.test.ts test/session/prompt.test.ts`

Expected: 全部 PASS，且 `.vsix` 用例不再出现 `Cannot read binary file`。

- [ ] **Step 5: 提交这一小步**

```bash
git add packages/opencode/src/session/prompt.ts packages/opencode/test/session/prompt.test.ts
git commit -m "fix(prompt): skip read failures for binary file mentions"
```

---

### Task 3: 做一次最终回归检查，确保 spec 三项要求都被锁定

**Files:**

- Verify only: `packages/opencode/test/util/media.test.ts`
- Verify only: `packages/opencode/test/tool/read.test.ts`
- Verify only: `packages/opencode/test/session/prompt.test.ts`
- Verify only: `docs/superpowers/specs/2026-04-29-webgui-binary-file-mention-design.md`

- [ ] **Step 1: 对照 spec 做人工覆盖检查**

确认下面 3 条都能在测试里找到对应断言：

```md
- `@foo.ts:3-12` 继续读取指定行范围
- `@manual.pdf` 继续作为附件交给模型
- `@plugin.vsix` 不再触发 `Cannot read binary file`
```

- [ ] **Step 2: 运行最终回归命令**

Run: `bun test test/util/media.test.ts test/tool/read.test.ts test/session/prompt.test.ts`

Expected: 全部 PASS；没有新增 flaky 失败。

- [ ] **Step 3: 如果用户要求再提交一次整理提交，使用明确 why 的提交信息**

```bash
git add packages/opencode/src/util/media.ts packages/opencode/src/tool/read.ts packages/opencode/src/session/prompt.ts packages/opencode/test/util/media.test.ts packages/opencode/test/session/prompt.test.ts
git commit -m "fix(webgui): downgrade unsupported binary file mentions to path references"
```

如果前两个任务已经按计划各自提交，这一步保持跳过；只有用户明确要求压缩为单提交时才执行。
