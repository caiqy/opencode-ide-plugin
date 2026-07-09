# `generate_image` 内置生图工具 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增独立 builtin tool `generate_image`，通过 OpenAI-compatible Images API 生成/编辑图片，并把结果保存为项目内路径附件。

**Architecture:** `generate_image` 是普通 opencode tool，不复用现有 OpenAI Responses `image_generation` provider tool。工具层负责参数、权限和返回；`generate-image/` 子模块负责配置解析、输入解析、OpenAI-compatible adapter、落盘和命名。生成附件必须符合现有 `MessageV2.FilePart` 契约。

**Tech Stack:** TypeScript, Bun test, Effect v4, 现有 tool 基础设施, 原生 `fetch`（在 Effect 中包装）, `Provider.Service`, `Config.Service`。

---

## 文件结构与职责

- Modify: `packages/opencode/src/config/config.ts` — 增加顶层 `image_model` 配置字段。
- Modify: `packages/opencode/src/config/permission.ts` — 将 `generate_image` 加入已知 permission key，保持配置 schema/docs 一等支持。
- Create: `packages/opencode/src/tool/generate-image/types.ts` — 共享类型、输入限制常量。
- Create: `packages/opencode/src/tool/generate-image/filename.ts` — 安全文件名清洗、默认命名、冲突后缀。
- Create: `packages/opencode/src/tool/generate-image/input.ts` — prompt、图片输入、mime、大小、路径/realpath 安全校验。
- Create: `packages/opencode/src/tool/generate-image/config.ts` — 解析 provider/model、apiKey/baseURL、adapter 选择。
- Create: `packages/opencode/src/tool/generate-image/openai-compatible.ts` — OpenAI-compatible `/images/generations` 与 `/images/edits` adapter。
- Create: `packages/opencode/src/tool/generate-image/persist.ts` — 复用现有 `generatedImageRelativePath()` 路径规则，写入 `.opencode/generated-images/` 并构造 `FilePart` 附件。
- Create: `packages/opencode/src/tool/generate-image.ts` — tool 定义、参数 schema、权限请求、dispatcher 调用。
- Create: `packages/opencode/src/tool/generate-image.txt` — 面向模型的工具说明。
- Modify: `packages/opencode/src/tool/registry.ts` — 注册 builtin `generate_image`。
- Create: `packages/opencode/test/tool/generate-image-filename.test.ts` — 文件名规则测试。
- Create: `packages/opencode/test/tool/generate-image-input.test.ts` — 输入解析与安全测试。
- Create: `packages/opencode/test/tool/generate-image-config.test.ts` — `image_model`、`permission.generate_image`、provider/model 解析测试。
- Create: `packages/opencode/test/tool/generate-image-openai-compatible.test.ts` — adapter 请求/响应测试。
- Create: `packages/opencode/test/tool/generate-image.test.ts` — tool 集成行为测试。
- Modify: `packages/opencode/test/tool/parameters.test.ts` — tool JSON schema、默认值和整数约束测试。
- Modify: `packages/opencode/test/tool/__snapshots__/parameters.test.ts.snap` — 新增 `generate_image` 参数 schema snapshot。
- Modify: `packages/opencode/test/tool/registry.test.ts` — builtin registry 包含 `generate_image`。

---

### Task 1: 配置 schema 支持 `image_model`

**Files:**

- Modify: `packages/opencode/src/config/config.ts:217-222`
- Modify: `packages/opencode/src/config/permission.ts:24-42`
- Test: `packages/opencode/test/tool/generate-image-config.test.ts`

- [ ] **Step 1: 写失败测试，确认 `image_model` 可从配置加载**

Create `packages/opencode/test/tool/generate-image-config.test.ts` with this initial test:

```ts
import { describe, expect, test } from "bun:test"
import { Config } from "../../src/config"
import { Permission } from "../../src/permission"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Effect } from "effect"

async function getConfig() {
  return AppRuntime.runPromise(
    Effect.gen(function* () {
      const config = yield* Config.Service
      return yield* config.get()
    }),
  )
}

describe("generate_image config", () => {
  test("loads image_model from opencode config", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          `${dir}/opencode.json`,
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            image_model: "openai/gpt-image-2",
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await getConfig()
        expect(config.image_model).toBe("openai/gpt-image-2")
      },
    })
  })

  test("loads generate_image permission config", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          `${dir}/opencode.json`,
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            permission: { generate_image: "allow" },
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await getConfig()
        expect(config.permission?.generate_image).toBe("allow")
      },
    })
  })

  test("maps generate_image allow config into permission rules", () => {
    const rules = Permission.fromConfig({ generate_image: "allow" })
    expect(rules).toEqual([{ permission: "generate_image", pattern: "*", action: "allow" }])
    expect(Permission.evaluate("generate_image", "openai/gpt-image-2", rules).action).toBe("allow")
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run from `packages/opencode`:

```bash
bun test test/tool/generate-image-config.test.ts
```

Expected: FAIL，错误显示 `image_model` 或 `permission.generate_image` 是额外字段或类型上不存在。

- [ ] **Step 3: 增加 config schema 字段**

Modify `packages/opencode/src/config/config.ts` near existing `model` and `small_model`:

```ts
  model: Schema.optional(ConfigModelID).annotate({
    description: "Model to use in the format of provider/model, eg anthropic/claude-2",
  }),
  image_model: Schema.optional(ConfigModelID).annotate({
    description: "Default image generation model in the format of provider/model, eg openai/gpt-image-2",
  }),
  small_model: Schema.optional(ConfigModelID).annotate({
    description: "Small model to use for tasks like title generation in the format of provider/model",
  }),
```

Modify `packages/opencode/src/config/permission.ts` known keys:

```ts
    webfetch: Schema.optional(Action),
    generate_image: Schema.optional(Action),
    websearch: Schema.optional(Action),
```

- [ ] **Step 4: 运行测试，确认通过**

Run:

```bash
bun test test/tool/generate-image-config.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交本任务**

```bash
git add packages/opencode/src/config/config.ts packages/opencode/src/config/permission.ts packages/opencode/test/tool/generate-image-config.test.ts
git commit -m "feat: add image model config"
```

---

### Task 2: 文件名与输入图片纯函数

**Files:**

- Create: `packages/opencode/src/tool/generate-image/types.ts`
- Create: `packages/opencode/src/tool/generate-image/filename.ts`
- Create: `packages/opencode/src/tool/generate-image/input.ts`
- Test: `packages/opencode/test/tool/generate-image-filename.test.ts`
- Test: `packages/opencode/test/tool/generate-image-input.test.ts`

- [ ] **Step 1: 写文件名失败测试**

Create `packages/opencode/test/tool/generate-image-filename.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { buildFilename, sanitizeFilename } from "../../src/tool/generate-image/filename"

describe("generate_image filename", () => {
  test("sanitizes separators, Windows characters, devices, and empty names", () => {
    expect(sanitizeFilename("../bad:name?.png")).toBe("badname.png")
    expect(sanitizeFilename(" CON ")).toBeUndefined()
    expect(sanitizeFilename(" .foo ")).toBe("foo")
    expect(sanitizeFilename("foo. ")).toBe("foo")
    expect(sanitizeFilename("...   ")).toBeUndefined()
  })

  test("builds default names with message id, index, random hex and mime extension", () => {
    const next = buildFilename({ messageID: "msg_test", index: 1, mime: "image/webp", random: "a1b2c3d4" })
    expect(next).toBe("generated-image-msg_test-1-a1b2c3d4.webp")
  })

  test("builds custom single and multi image names", () => {
    expect(
      buildFilename({
        messageID: "msg_test",
        index: 1,
        count: 1,
        mime: "image/png",
        random: "a1b2c3d4",
        filename: "poster",
      }),
    ).toBe("poster-msg_test-a1b2c3d4.png")
    expect(
      buildFilename({
        messageID: "msg_test",
        index: 2,
        count: 3,
        mime: "image/jpeg",
        random: "a1b2c3d4",
        filename: "poster.webp",
      }),
    ).toBe("poster-msg_test-2-a1b2c3d4.jpg")
  })
})
```

- [ ] **Step 2: 写输入解析失败测试**

Create `packages/opencode/test/tool/generate-image-input.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import { decodeImageInput, validateMask, validatePrompt } from "../../src/tool/generate-image/input"

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAF/gL+ee1vNwAAAABJRU5ErkJggg=="

describe("generate_image input", () => {
  test("validates prompt length", () => {
    expect(() => validatePrompt("")).toThrow("prompt must be between 1 and 4000 characters")
    expect(() => validatePrompt("x".repeat(4001))).toThrow("prompt must be between 1 and 4000 characters")
    expect(validatePrompt("draw a cat")).toBe("draw a cat")
  })

  test("decodes data url and naked base64 only when mime is recognized", async () => {
    const data = await decodeImageInput({ root: process.cwd(), input: `data:image/png;base64,${png}` })
    expect(data.mime).toBe("image/png")
    expect(data.bytes.byteLength).toBeGreaterThan(0)

    const naked = await decodeImageInput({ root: process.cwd(), input: png })
    expect(naked.mime).toBe("image/png")

    await expect(
      decodeImageInput({ root: process.cwd(), input: Buffer.from("not an image").toString("base64") }),
    ).rejects.toThrow("unable to detect image mime")
    await expect(decodeImageInput({ root: process.cwd(), input: "data:image/png;base64,%%%%" })).rejects.toThrow(
      "data URL base64 decode failed",
    )
  })

  test("rejects remote URL inputs explicitly", async () => {
    await expect(decodeImageInput({ root: process.cwd(), input: "https://example.com/image.png" })).rejects.toThrow(
      "remote image URL inputs are not supported",
    )
  })

  test("reports missing or non-image files clearly", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "note.txt"), "hello")
        await Bun.write(path.join(dir, "large.png"), new Uint8Array(10 * 1024 * 1024 + 1))
      },
    })
    await expect(decodeImageInput({ root: tmp.path, input: "missing.png" })).rejects.toThrow(
      "image file does not exist",
    )
    await expect(decodeImageInput({ root: tmp.path, input: "note.txt" })).rejects.toThrow("unable to detect image mime")
    await expect(decodeImageInput({ root: tmp.path, input: "large.png" })).rejects.toThrow("image exceeds 10MB limit")
  })

  test("prefers existing project paths over naked base64", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "QUJDREVGR0hJSktMTU5PUA=="), Buffer.from(png, "base64"))
      },
    })
    const image = await decodeImageInput({ root: tmp.path, input: "QUJDREVGR0hJSktMTU5PUA==" })
    expect(image.mime).toBe("image/png")
  })

  test("reads project relative paths and rejects traversal", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "image.png"), Buffer.from(png, "base64"))
      },
    })
    const image = await decodeImageInput({ root: tmp.path, input: "image.png" })
    expect(image.mime).toBe("image/png")
    await expect(decodeImageInput({ root: tmp.path, input: "../image.png" })).rejects.toThrow("outside project")
  })

  test("rejects symlink or junction escapes", async () => {
    await using root = await tmpdir({})
    await using outside = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "image.png"), Buffer.from(png, "base64"))
      },
    })
    await fs.symlink(outside.path, path.join(root.path, "linked"), process.platform === "win32" ? "junction" : "dir")
    await expect(decodeImageInput({ root: root.path, input: "linked/image.png" })).rejects.toThrow("outside project")
  })

  test("requires mask mime to match edit images", () => {
    const bytes = new Uint8Array(Buffer.from(png, "base64"))
    const image = { mime: "image/png" as const, bytes, filename: "image.png" }
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff])
    expect(() => validateMask([image], { mime: "image/jpeg", bytes: jpeg, filename: "mask.jpg" })).toThrow(
      "mask mime must match all edit images",
    )
    expect(validateMask([image], { mime: "image/png", bytes, filename: "mask.png" })).toBeUndefined()
  })
})
```

- [ ] **Step 3: 运行测试，确认失败**

Run:

```bash
bun test test/tool/generate-image-filename.test.ts test/tool/generate-image-input.test.ts
```

Expected: FAIL，模块不存在。

- [ ] **Step 4: 创建共享类型**

Create `packages/opencode/src/tool/generate-image/types.ts`:

```ts
export type ImageAction = "generate" | "edit"
export type ImageFormat = "png" | "jpeg" | "webp"
export type ImageQuality = "auto" | "low" | "medium" | "high"

export type DecodedImage = {
  mime: "image/png" | "image/jpeg" | "image/webp"
  bytes: Uint8Array
  filename: string
}

export const MAX_PROMPT_LENGTH = 4000
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
```

- [ ] **Step 5: 创建文件名 helper**

Create `packages/opencode/src/tool/generate-image/filename.ts`:

```ts
import path from "node:path"

const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

export function extension(mime: string) {
  if (mime === "image/jpeg") return "jpg"
  if (mime === "image/webp") return "webp"
  return "png"
}

export function sanitizeFilename(input: string) {
  const cleaned = input
    .replace(/[\0/\\<>:"|?*]/g, "")
    .split("")
    .filter((char) => {
      const code = char.charCodeAt(0)
      return code > 31 && code !== 127
    })
    .join("")
    .trim()
    .replace(/^\.+|\.+$/g, "")
    .trim()
  if (!cleaned) return
  const base = path.basename(cleaned, path.extname(cleaned))
  if (!base || reserved.test(base)) return
  return cleaned
}

export function buildFilename(input: {
  messageID: string
  index: number
  count?: number
  mime: string
  random: string
  filename?: string
}) {
  const ext = extension(input.mime)
  const safe = input.filename ? sanitizeFilename(input.filename) : undefined
  if (!safe) return `generated-image-${input.messageID}-${input.index}-${input.random}.${ext}`
  const base = path.basename(safe, path.extname(safe))
  const index = (input.count ?? 1) > 1 ? `-${input.index}` : ""
  return `${base}-${input.messageID}${index}-${input.random}.${ext}`
}
```

- [ ] **Step 6: 创建输入解析 helper**

Create `packages/opencode/src/tool/generate-image/input.ts`:

```ts
import fs from "node:fs/promises"
import path from "node:path"
import { MAX_IMAGE_BYTES, MAX_PROMPT_LENGTH, type DecodedImage } from "./types"
import { extension } from "./filename"

const dataUrl = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/i
const base64 = /^[a-z0-9+/]+={0,2}$/i

function decodeBase64(value: string, label: string) {
  const compact = value.replace(/\s/g, "")
  if (compact.length === 0 || compact.length % 4 !== 0 || !base64.test(compact)) {
    throw new Error(`${label} base64 decode failed`)
  }
  return new Uint8Array(Buffer.from(compact, "base64"))
}

export function validatePrompt(prompt: string) {
  if (prompt.length < 1 || prompt.length > MAX_PROMPT_LENGTH) {
    throw new Error(`prompt must be between 1 and ${MAX_PROMPT_LENGTH} characters`)
  }
  return prompt
}

export function detectMime(bytes: Uint8Array): DecodedImage["mime"] | undefined {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png"
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg"
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp"
  }
  return undefined
}

function fromBytes(bytes: Uint8Array, filename = "image") {
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("image exceeds 10MB limit")
  const mime = detectMime(bytes)
  if (!mime) throw new Error("unable to detect image mime")
  return { mime, bytes, filename: `${filename}.${extension(mime)}` } satisfies DecodedImage
}

async function realPath(root: string, input: string, missing: "throw" | "undefined") {
  const absolute = path.resolve(root, input)
  const relative = path.relative(root, absolute)
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("image path is outside project")
  const [realRoot, realFile] = await Promise.all([
    fs.realpath(root),
    fs.realpath(absolute).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" && missing === "undefined") return undefined
      if (error.code === "ENOENT") throw new Error("image file does not exist")
      throw error
    }),
  ])
  if (!realFile) return
  const realRelative = path.relative(realRoot, realFile)
  if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) throw new Error("image path is outside project")
  return realFile
}

async function fromPath(root: string, input: string) {
  const realFile = await realPath(root, input, "throw")
  if (!realFile) throw new Error("image file does not exist")
  const bytes = new Uint8Array(await fs.readFile(realFile))
  return fromBytes(bytes, path.basename(realFile, path.extname(realFile)))
}

export async function decodeImageInput(input: { root: string; input: string }) {
  if (/^https?:\/\//i.test(input.input)) throw new Error("remote image URL inputs are not supported")
  const match = input.input.match(dataUrl)
  if (match) return fromBytes(decodeBase64(match[2], "data URL"))
  const existing = await realPath(input.root, input.input, "undefined")
  if (existing) {
    const bytes = new Uint8Array(await fs.readFile(existing))
    return fromBytes(bytes, path.basename(existing, path.extname(existing)))
  }
  const compact = input.input.replace(/\s/g, "")
  if (compact.length >= 16 && /^[a-z0-9+/=]+$/i.test(compact)) {
    return fromBytes(decodeBase64(compact, "image"))
  }
  return fromPath(input.root, input.input)
}

export function validateMask(images: DecodedImage[], mask?: DecodedImage) {
  if (!mask) return
  if (images.some((image) => image.mime !== mask.mime)) throw new Error("mask mime must match all edit images")
}
```

- [ ] **Step 7: 运行测试，确认通过**

Run:

```bash
bun test test/tool/generate-image-filename.test.ts test/tool/generate-image-input.test.ts
```

Expected: PASS。

- [ ] **Step 8: 提交本任务**

```bash
git add packages/opencode/src/tool/generate-image packages/opencode/test/tool/generate-image-filename.test.ts packages/opencode/test/tool/generate-image-input.test.ts
git commit -m "feat: add image tool input helpers"
```

---

### Task 3: provider/model 与 adapter 配置解析

**Files:**

- Create: `packages/opencode/src/tool/generate-image/config.ts`
- Modify: `packages/opencode/test/tool/generate-image-config.test.ts`

- [ ] **Step 1: 增加解析纯函数失败测试**

Append to `packages/opencode/test/tool/generate-image-config.test.ts`:

```ts
import {
  resolveModelParts,
  normalizeBaseURL,
  pickAdapter,
  resolveCredentials,
  resolveImageFieldStyle,
} from "../../src/tool/generate-image/config"
import { ProviderTest } from "../fake/provider"

describe("generate_image config helpers", () => {
  test("resolves provider and model override matrix", () => {
    expect(resolveModelParts({ imageModel: "openai/gpt-image-2" })).toEqual({
      providerID: "openai",
      modelID: "gpt-image-2",
    })
    expect(resolveModelParts({ imageModel: "openrouter/openai/gpt-image-2" })).toEqual({
      providerID: "openrouter",
      modelID: "openai/gpt-image-2",
    })
    expect(resolveModelParts({ imageModel: "openai/gpt-image-2", provider: "openai" })).toEqual({
      providerID: "openai",
      modelID: "gpt-image-2",
    })
    expect(resolveModelParts({ imageModel: "openai/gpt-image-2", model: "gpt-image-2" })).toEqual({
      providerID: "openai",
      modelID: "gpt-image-2",
    })
    expect(resolveModelParts({ imageModel: "openai/gpt-image-2", provider: "custom", model: "image-x" })).toEqual({
      providerID: "custom",
      modelID: "image-x",
    })
    expect(() => resolveModelParts({ provider: "openai" })).toThrow(
      "model is required when image_model is not configured",
    )
    expect(() => resolveModelParts({ imageModel: "openai/gpt-image-2", provider: "custom" })).toThrow(
      "model is required when provider overrides image_model provider",
    )
  })

  test("normalizes OpenAI-compatible base URL", () => {
    expect(normalizeBaseURL("https://api.openai.com/v1")).toBe("https://api.openai.com/v1")
    expect(normalizeBaseURL("https://api.openai.com")).toBe("https://api.openai.com/v1")
    expect(normalizeBaseURL("https://gateway.example.com/v1/")).toBe("https://gateway.example.com/v1")
  })

  test("resolves credentials fallback order", () => {
    const provider = ProviderTest.info({
      key: "provider-key",
      options: { apiKey: "options-key", baseURL: "https://gateway.example.com" },
    })
    const model = ProviderTest.model({
      api: { id: "openai", url: "https://model.example.com/v1", npm: "@ai-sdk/openai" },
    })
    expect(resolveCredentials({ provider, model }).apiKey).toBe("provider-key")
    expect(resolveCredentials({ provider, model }).baseURL).toBe("https://gateway.example.com/v1")

    const fallbackProvider = ProviderTest.info({
      key: "provider-key",
      options: { apiKey: "options-key", baseURL: "https://gateway.example.com" },
    })
    delete fallbackProvider.key
    fallbackProvider.options = { apiKey: "options-key" }
    expect(resolveCredentials({ provider: fallbackProvider, model }).apiKey).toBe("options-key")
    expect(resolveCredentials({ provider: fallbackProvider, model }).baseURL).toBe("https://model.example.com/v1")
  })

  test("explains missing image credentials", () => {
    const provider = ProviderTest.info({ key: undefined, options: {} })
    const model = ProviderTest.model({ api: { id: "openai", url: "", npm: "@ai-sdk/openai" } })
    expect(() => resolveCredentials({ provider, model })).toThrow("authenticate the provider or configure")
    expect(() => resolveCredentials({ provider: ProviderTest.info({ key: "sk-test", options: {} }), model })).toThrow(
      "configure provider",
    )
  })

  test("picks adapter from explicit options, npm package, or openai provider", () => {
    expect(
      pickAdapter({ providerID: "x", providerOptions: { imageApi: "openai-compatible" }, modelOptions: {}, npm: "x" }),
    ).toBe("openai-compatible")
    expect(
      pickAdapter({ providerID: "x", providerOptions: {}, modelOptions: {}, npm: "@ai-sdk/openai-compatible" }),
    ).toBe("openai-compatible")
    expect(pickAdapter({ providerID: "openai", providerOptions: {}, modelOptions: {}, npm: "x" })).toBe(
      "openai-compatible",
    )
    expect(() => pickAdapter({ providerID: "unknown", providerOptions: {}, modelOptions: {}, npm: "x" })).toThrow(
      "No image adapter configured",
    )
  })

  test("resolves edit image field style", () => {
    expect(resolveImageFieldStyle({ providerOptions: {}, modelOptions: {} })).toBe("brackets")
    expect(resolveImageFieldStyle({ providerOptions: { imageFieldStyle: "repeated" }, modelOptions: {} })).toBe(
      "repeated",
    )
    expect(
      resolveImageFieldStyle({
        providerOptions: { imageFieldStyle: "repeated" },
        modelOptions: { imageFieldStyle: "brackets" },
      }),
    ).toBe("brackets")
    expect(() => resolveImageFieldStyle({ providerOptions: { imageFieldStyle: "indexed" }, modelOptions: {} })).toThrow(
      "Unsupported imageFieldStyle",
    )
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run:

```bash
bun test test/tool/generate-image-config.test.ts
```

Expected: FAIL，模块或函数不存在。

- [ ] **Step 3: 实现配置 helper**

Create `packages/opencode/src/tool/generate-image/config.ts`:

```ts
import { Provider } from "../../provider"

export type AdapterID = "openai-compatible"

function parseImageModel(imageModel?: string) {
  if (!imageModel) return {}
  const parsed = Provider.parseModel(imageModel)
  if (!parsed.providerID || !parsed.modelID) return {}
  return { defaultProvider: parsed.providerID, defaultModel: parsed.modelID }
}

export function resolveModelParts(input: { imageModel?: string; provider?: string; model?: string }) {
  if (input.provider && input.model) return { providerID: input.provider, modelID: input.model }
  const { defaultProvider, defaultModel } = parseImageModel(input.imageModel)
  if (!input.provider && !input.model) {
    if (!defaultProvider || !defaultModel)
      throw new Error(
        `image_model is required when provider/model are not provided; configure { "image_model": "openai/gpt-image-2" } or pass provider and model`,
      )
    return { providerID: defaultProvider, modelID: defaultModel }
  }
  if (input.provider) {
    if (!defaultModel)
      throw new Error(
        `model is required when image_model is not configured; configure { "image_model": "openai/gpt-image-2" } or pass model`,
      )
    if (defaultProvider !== input.provider)
      throw new Error("model is required when provider overrides image_model provider")
    return { providerID: input.provider, modelID: defaultModel }
  }
  if (!defaultProvider)
    throw new Error(
      `provider is required when image_model is not configured; configure { "image_model": "openai/gpt-image-2" } or pass provider`,
    )
  return { providerID: defaultProvider, modelID: input.model! }
}

export function normalizeBaseURL(url: string) {
  const trimmed = url.replace(/\/+$/, "")
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`
}

export function pickAdapter(input: {
  providerID: string
  providerOptions: Record<string, unknown>
  modelOptions: Record<string, unknown>
  npm: string
}): AdapterID {
  const configured = input.modelOptions.imageApi ?? input.providerOptions.imageApi
  if (configured === "openai-compatible") return "openai-compatible"
  if (input.npm === "@ai-sdk/openai" || input.npm === "@ai-sdk/openai-compatible") return "openai-compatible"
  if (input.providerID === "openai") return "openai-compatible"
  throw new Error("No image adapter configured; set provider.<id>.models.<model>.options.imageApi to openai-compatible")
}

export type ImageFieldStyle = "brackets" | "repeated"

export function resolveImageFieldStyle(input: {
  providerOptions: Record<string, unknown>
  modelOptions: Record<string, unknown>
}): ImageFieldStyle {
  const value = input.modelOptions.imageFieldStyle ?? input.providerOptions.imageFieldStyle ?? "brackets"
  if (value === "brackets" || value === "repeated") return value
  throw new Error("Unsupported imageFieldStyle; expected brackets or repeated")
}

export function resolveCredentials(input: { provider: Provider.Info; model: Provider.Model }) {
  const apiKey = input.provider.key ?? input.provider.options.apiKey
  const baseURL = input.provider.options.baseURL ?? input.model.api.url
  if (typeof apiKey !== "string" || apiKey.length === 0) {
    throw new Error(
      `Missing apiKey for image provider ${input.provider.id}; authenticate the provider or configure opencode.json like { "provider": { "${input.provider.id}": { "options": { "apiKey": "sk-..." } } } }`,
    )
  }
  if (typeof baseURL !== "string" || baseURL.length === 0) {
    throw new Error(
      `Missing baseURL for image provider ${input.provider.id}; configure opencode.json like { "provider": { "${input.provider.id}": { "options": { "baseURL": "https://api.openai.com/v1" } } } } or set the model api url`,
    )
  }
  return { apiKey, baseURL: normalizeBaseURL(baseURL) }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run:

```bash
bun test test/tool/generate-image-config.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交本任务**

```bash
git add packages/opencode/src/tool/generate-image/config.ts packages/opencode/test/tool/generate-image-config.test.ts
git commit -m "feat: resolve image tool provider config"
```

---

### Task 4: OpenAI-compatible adapter

**Files:**

- Create: `packages/opencode/src/tool/generate-image/openai-compatible.ts`
- Test: `packages/opencode/test/tool/generate-image-openai-compatible.test.ts`

- [ ] **Step 1: 写 adapter 失败测试**

Create `packages/opencode/test/tool/generate-image-openai-compatible.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { callOpenAICompatible } from "../../src/tool/generate-image/openai-compatible"

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAF/gL+ee1vNwAAAABJRU5ErkJggg=="

function run<A>(effect: Effect.Effect<A, unknown, never>) {
  return Effect.runPromise(effect)
}

describe("generate_image openai-compatible adapter", () => {
  test("sends generation request with output_format and parses b64_json", async () => {
    let body: Record<string, unknown> = {}
    using server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        body = await req.json()
        return Response.json({ data: [{ b64_json: png }] })
      },
    })

    const images = await run(
      callOpenAICompatible({
        baseURL: `${server.url}v1`,
        apiKey: "sk-test",
        action: "generate",
        model: "gpt-image-2",
        prompt: "draw",
        size: "1536x1024",
        quality: "high",
        format: "webp",
        n: 1,
      }),
    )
    expect(body).toMatchObject({ model: "gpt-image-2", prompt: "draw", output_format: "webp", n: 1 })
    expect(body).not.toHaveProperty("response_format")
    expect(images[0].mime).toBe("image/png")
  })

  test("rejects remote url only responses", async () => {
    using server = Bun.serve({
      port: 0,
      fetch: () => Response.json({ data: [{ url: "https://example.com/image.png" }] }),
    })
    await expect(
      run(
        callOpenAICompatible({
          baseURL: `${server.url}v1`,
          apiKey: "sk-test",
          action: "generate",
          model: "gpt-image-2",
          prompt: "draw",
          size: "auto",
          quality: "high",
          format: "png",
          n: 1,
        }),
      ),
    ).rejects.toThrow("remote image URLs are not supported")
  })

  test("parses data URL fields in response data array", async () => {
    using server = Bun.serve({
      port: 0,
      fetch: () => Response.json({ data: [{ url: `data:image/png;base64,${png}` }] }),
    })
    const images = await run(
      callOpenAICompatible({
        baseURL: `${server.url}v1`,
        apiKey: "sk-test",
        action: "generate",
        model: "gpt-image-2",
        prompt: "draw",
        size: "auto",
        quality: "high",
        format: "png",
        n: 1,
      }),
    )
    expect(images[0].mime).toBe("image/png")
  })

  test("parses b64Json and data fields in response data array", async () => {
    using server = Bun.serve({ port: 0, fetch: () => Response.json({ data: [{ b64Json: png }, { data: png }] }) })
    const images = await run(
      callOpenAICompatible({
        baseURL: `${server.url}v1`,
        apiKey: "sk-test",
        action: "generate",
        model: "gpt-image-2",
        prompt: "draw",
        size: "auto",
        quality: "high",
        format: "png",
        n: 2,
      }),
    )
    expect(images.map((image) => image.mime)).toEqual(["image/png", "image/png"])
  })

  test("reports invalid provider base64 clearly", async () => {
    using server = Bun.serve({ port: 0, fetch: () => Response.json({ data: [{ b64_json: "%%%%" }] }) })
    await expect(
      run(
        callOpenAICompatible({
          baseURL: `${server.url}v1`,
          apiKey: "sk-test",
          action: "generate",
          model: "gpt-image-2",
          prompt: "draw",
          size: "auto",
          quality: "high",
          format: "png",
          n: 1,
        }),
      ),
    ).rejects.toThrow("provider image base64 decode failed")
  })

  test("only applies GPT image size preflight to GPT image models", async () => {
    let body: Record<string, unknown> = {}
    using server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        body = await req.json()
        return Response.json({ data: [{ b64_json: png }] })
      },
    })
    await run(
      callOpenAICompatible({
        baseURL: `${server.url}v1`,
        apiKey: "sk-test",
        action: "generate",
        model: "custom-image-model",
        prompt: "draw",
        size: "1024x777",
        quality: "high",
        format: "png",
        n: 1,
      }),
    )
    expect(body.size).toBe("1024x777")
  })

  test("rejects invalid GPT image sizes before provider call", async () => {
    let called = false
    using server = Bun.serve({
      port: 0,
      fetch: () => {
        called = true
        return Response.json({ data: [{ b64_json: png }] })
      },
    })
    await expect(
      run(
        callOpenAICompatible({
          baseURL: `${server.url}v1`,
          apiKey: "sk-test",
          action: "generate",
          model: "gpt-image-2",
          prompt: "draw",
          size: "1024x777",
          quality: "high",
          format: "png",
          n: 1,
        }),
      ),
    ).rejects.toThrow("size width and height must be multiples of 16")
    expect(called).toBe(false)
  })

  test("summarizes provider errors such as unsupported output format", async () => {
    using server = Bun.serve({
      port: 0,
      fetch: () => new Response(JSON.stringify({ error: { message: "unsupported output_format" } }), { status: 400 }),
    })
    await expect(
      run(
        callOpenAICompatible({
          baseURL: `${server.url}v1`,
          apiKey: "sk-test",
          action: "generate",
          model: "gpt-image-2",
          prompt: "draw",
          size: "auto",
          quality: "high",
          format: "webp",
          n: 1,
        }),
      ),
    ).rejects.toThrow("image provider returned HTTP 400: unsupported output_format")
  })

  test("sends edit multipart with image brackets and optional mask", async () => {
    let fields: { images: number; hasMask: boolean; format: FormDataEntryValue | null } | undefined
    using server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        const form = await req.formData()
        fields = {
          images: form.getAll("image[]").length,
          hasMask: form.get("mask") instanceof File,
          format: form.get("output_format"),
        }
        return Response.json({ data: [{ b64_json: png }] })
      },
    })

    const bytes = new Uint8Array(Buffer.from(png, "base64"))
    await run(
      callOpenAICompatible({
        baseURL: `${server.url}v1`,
        apiKey: "sk-test",
        action: "edit",
        model: "gpt-image-2",
        prompt: "edit",
        size: "auto",
        quality: "high",
        format: "png",
        n: 1,
        imageFieldStyle: "brackets",
        images: [{ mime: "image/png", bytes, filename: "input.png" }],
        mask: { mime: "image/png", bytes, filename: "mask.png" },
      }),
    )
    expect(fields).toEqual({ images: 1, hasMask: true, format: "png" })
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run:

```bash
bun test test/tool/generate-image-openai-compatible.test.ts
```

Expected: FAIL，adapter 不存在。

- [ ] **Step 3: 实现 adapter**

Create `packages/opencode/src/tool/generate-image/openai-compatible.ts`:

```ts
import { Effect } from "effect"
import { detectMime } from "./input"
import type { ImageFieldStyle } from "./config"
import type { DecodedImage, ImageAction, ImageFormat, ImageQuality } from "./types"

type Request = {
  baseURL: string
  apiKey: string
  action: ImageAction
  model: string
  prompt: string
  size: string
  quality: ImageQuality
  format: ImageFormat
  n: number
  images?: DecodedImage[]
  mask?: DecodedImage
  imageFieldStyle?: ImageFieldStyle
}

function validateSize(size: string, model: string) {
  if (!/^gpt-image-/i.test(model)) return
  if (size === "auto") return
  const match = size.match(/^(\d+)x(\d+)$/)
  if (!match) throw new Error("size must be auto or WIDTHxHEIGHT")
  const width = Number(match[1])
  const height = Number(match[2])
  if (width % 16 !== 0 || height % 16 !== 0) throw new Error("size width and height must be multiples of 16")
  if (Math.max(width, height) > 3840) throw new Error("size longest edge must be <= 3840")
  if (Math.max(width, height) / Math.min(width, height) > 3) throw new Error("size aspect ratio must be <= 3:1")
}

function parseImages(value: unknown) {
  const items = Array.isArray((value as { data?: unknown })?.data) ? (value as { data: unknown[] }).data : []
  return items.map((item) => {
    const record = item as Record<string, unknown>
    const raw = record.b64_json ?? record.b64Json ?? record.data ?? record.url
    if (typeof raw !== "string") throw new Error("No image data returned from image provider")
    if (/^https?:\/\//.test(raw)) throw new Error("remote image URLs are not supported")
    const data = raw.match(/^data:(image\/[a-z0-9.+-]+);base64,(.*)$/i)?.[2] ?? raw
    const compact = data.replace(/\s/g, "")
    if (compact.length === 0 || compact.length % 4 !== 0 || !/^[a-z0-9+/]+={0,2}$/i.test(compact)) {
      throw new Error("provider image base64 decode failed")
    }
    const bytes = new Uint8Array(Buffer.from(compact, "base64"))
    const mime = detectMime(bytes)
    if (!mime) throw new Error("unable to detect image mime")
    return { mime, bytes, filename: `image.${mime === "image/jpeg" ? "jpg" : mime.slice("image/".length)}` }
  })
}

function providerError(status: number, body: string) {
  const message = body.match(/"message"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/)?.[1]?.replace(/\\"/g, '"') ?? body.trim()
  const summary = message.length > 500 ? `${message.slice(0, 500)}...` : message
  return new Error(`image provider returned HTTP ${status}${summary ? `: ${summary}` : ""}`)
}

export const callOpenAICompatible = Effect.fn("GenerateImage.openaiCompatible")(function* (input: Request) {
  validateSize(input.size, input.model)
  const headers = { Authorization: `Bearer ${input.apiKey}` }
  if (input.action === "generate") {
    const json = yield* Effect.tryPromise({
      try: async () => {
        const response = await fetch(`${input.baseURL}/images/generations`, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({
            model: input.model,
            prompt: input.prompt,
            size: input.size,
            quality: input.quality,
            output_format: input.format,
            n: input.n,
          }),
        })
        if (!response.ok) throw providerError(response.status, await response.text())
        return response.json()
      },
      catch: (cause) => new Error(cause instanceof Error ? cause.message : "image generation request failed"),
    })
    return parseImages(json)
  }

  const form = new FormData()
  form.set("model", input.model)
  form.set("prompt", input.prompt)
  form.set("size", input.size)
  form.set("quality", input.quality)
  form.set("output_format", input.format)
  form.set("n", String(input.n))
  const imageField = (input.imageFieldStyle ?? "brackets") === "brackets" ? "image[]" : "image"
  for (const image of input.images ?? [])
    form.append(imageField, new Blob([image.bytes], { type: image.mime }), image.filename)
  if (input.mask) form.set("mask", new Blob([input.mask.bytes], { type: input.mask.mime }), input.mask.filename)
  const json = yield* Effect.tryPromise({
    try: async () => {
      const response = await fetch(`${input.baseURL}/images/edits`, { method: "POST", headers, body: form })
      if (!response.ok) throw providerError(response.status, await response.text())
      return response.json()
    },
    catch: (cause) => new Error(cause instanceof Error ? cause.message : "image edit request failed"),
  })
  return parseImages(json)
})
```

- [ ] **Step 4: 运行测试，确认通过**

Run:

```bash
bun test test/tool/generate-image-openai-compatible.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交本任务**

```bash
git add packages/opencode/src/tool/generate-image/openai-compatible.ts packages/opencode/test/tool/generate-image-openai-compatible.test.ts
git commit -m "feat: add openai compatible image adapter"
```

---

### Task 5: 图片落盘与附件构造

**Files:**

- Create: `packages/opencode/src/tool/generate-image/persist.ts`
- Test: `packages/opencode/test/tool/generate-image.test.ts`

- [ ] **Step 1: 写落盘失败测试**

Create `packages/opencode/test/tool/generate-image.test.ts` with this first test:

```ts
import { describe, expect, test } from "bun:test"
import path from "node:path"
import { persistImages } from "../../src/tool/generate-image/persist"
import { MessageID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

describe("generate_image tool", () => {
  test("persists images as FilePart attachments with relative path and route url", async () => {
    await using tmp = await tmpdir({ git: true })
    const result = await persistImages({
      root: tmp.path,
      messageID: MessageID.make("msg_test"),
      filename: undefined,
      images: [{ mime: "image/png", bytes, filename: "image.png" }],
      random: () => "a1b2c3d4",
    })
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      type: "file",
      mime: "image/png",
      filename: "generated-image-msg_test-1-a1b2c3d4.png",
      relativePath: ".opencode/generated-images/generated-image-msg_test-1-a1b2c3d4.png",
      url: "/generated-image?path=.opencode%2Fgenerated-images%2Fgenerated-image-msg_test-1-a1b2c3d4.png",
    })
    expect(await Bun.file(path.join(tmp.path, result[0].relativePath!)).exists()).toBe(true)
    expect(result[0]).not.toHaveProperty("source")
  })

  test("does not overwrite existing generated image filenames", async () => {
    await using tmp = await tmpdir({ git: true })
    const first = await persistImages({
      root: tmp.path,
      messageID: MessageID.make("msg_collision"),
      filename: "poster",
      images: [{ mime: "image/png", bytes, filename: "image.png" }],
      random: () => "aaaaaaaa",
    })
    const second = await persistImages({
      root: tmp.path,
      messageID: MessageID.make("msg_collision"),
      filename: "poster",
      images: [{ mime: "image/png", bytes, filename: "image.png" }],
      random: () => "aaaaaaaa",
    })
    expect(first[0].filename).toBe("poster-msg_collision-aaaaaaaa.png")
    expect(second[0].filename).toBe("poster-msg_collision-aaaaaaaa-2.png")
    expect(await Bun.file(path.join(tmp.path, first[0].relativePath!)).exists()).toBe(true)
    expect(await Bun.file(path.join(tmp.path, second[0].relativePath!)).exists()).toBe(true)
  })

  test("allocates unique filenames under concurrent writes", async () => {
    await using tmp = await tmpdir({ git: true })
    const results = await Promise.all(
      [1, 2].map(() =>
        persistImages({
          root: tmp.path,
          messageID: MessageID.make("msg_concurrent"),
          filename: "poster",
          images: [{ mime: "image/png", bytes, filename: "image.png" }],
          random: () => "bbbbbbbb",
        }),
      ),
    )
    const filenames = results.map((result) => result[0].filename)
    expect(new Set(filenames).size).toBe(2)
    expect(filenames.sort()).toEqual(["poster-msg_concurrent-bbbbbbbb-2.png", "poster-msg_concurrent-bbbbbbbb.png"])
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run:

```bash
bun test test/tool/generate-image.test.ts
```

Expected: FAIL，`persistImages` 不存在。

- [ ] **Step 3: 实现落盘 helper**

Create `packages/opencode/src/tool/generate-image/persist.ts`:

```ts
import path from "node:path"
import crypto from "node:crypto"
import fs from "node:fs/promises"
import type { MessageV2 } from "../../session/message-v2"
import { generatedImageRelativePath } from "../../session/generated-image"
import type { MessageID } from "../../session/schema"
import type { DecodedImage } from "./types"
import { buildFilename } from "./filename"

type NodeError = Error & { code?: string }

async function writeUnique(root: string, filename: string, bytes: Uint8Array) {
  const ext = path.extname(filename)
  const base = filename.slice(0, filename.length - ext.length)
  for (let index = 1; index < 1000; index++) {
    const next = index === 1 ? filename : `${base}-${index}${ext}`
    const handle = await fs.open(path.join(root, generatedImageRelativePath(next)), "wx").catch((error: NodeError) => {
      if (error.code === "EEXIST") return undefined
      throw error
    })
    if (!handle) continue
    await handle.writeFile(bytes).finally(() => handle.close())
    return next
  }
  throw new Error("unable to allocate generated image filename")
}

export async function persistImages(input: {
  root: string
  messageID: MessageID
  filename?: string
  images: DecodedImage[]
  random?: () => string
}): Promise<Omit<MessageV2.FilePart, "id" | "sessionID" | "messageID">[]> {
  const dir = path.join(input.root, generatedImageRelativePath("."))
  await fs.mkdir(dir, { recursive: true })
  const random = input.random ?? (() => crypto.randomBytes(4).toString("hex"))
  const attachments = []
  for (let index = 0; index < input.images.length; index++) {
    const image = input.images[index]
    const filename = await writeUnique(
      input.root,
      buildFilename({
        messageID: input.messageID,
        index: index + 1,
        count: input.images.length,
        mime: image.mime,
        random: random(),
        filename: input.filename,
      }),
      image.bytes,
    )
    const relativePath = generatedImageRelativePath(filename)
    attachments.push({
      type: "file" as const,
      mime: image.mime,
      filename,
      relativePath,
      url: `/generated-image?path=${encodeURIComponent(relativePath)}`,
    })
  }
  return attachments
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run:

```bash
bun test test/tool/generate-image.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交本任务**

```bash
git add packages/opencode/src/tool/generate-image/persist.ts packages/opencode/test/tool/generate-image.test.ts
git commit -m "feat: persist generated image tool outputs"
```

---

### Task 6: `generate_image` tool 与 registry 集成

**Files:**

- Create: `packages/opencode/src/tool/generate-image.ts`
- Create: `packages/opencode/src/tool/generate-image.txt`
- Modify: `packages/opencode/src/tool/registry.ts`
- Modify: `packages/opencode/test/tool/generate-image.test.ts`
- Modify: `packages/opencode/test/tool/parameters.test.ts`
- Modify: `packages/opencode/test/tool/__snapshots__/parameters.test.ts.snap`
- Modify: `packages/opencode/test/tool/registry.test.ts`

- [ ] **Step 1: 写 registry 失败测试**

Append to `packages/opencode/test/tool/registry.test.ts`:

```ts
it.live("includes generate_image as builtin tool", () =>
  provideTmpdirInstance(() =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()
      expect(ids).toContain("generate_image")
    }),
  ),
)
```

- [ ] **Step 2: 写 tool 参数 schema 失败测试**

Modify `packages/opencode/test/tool/parameters.test.ts` imports:

```ts
import { Parameters as GenerateImage } from "../../src/tool/generate-image"
```

Add to `describe("JSON Schema (wire shape)")`:

```ts
test("generate_image", () => expect(toJsonSchema(GenerateImage)).toMatchSnapshot())
```

Add a new describe block near other tool parameter blocks:

```ts
describe("generate_image", () => {
  test("accepts prompt-only and applies defaults", () => {
    expect(parse(GenerateImage, { prompt: "draw" })).toMatchObject({
      action: "generate",
      size: "auto",
      quality: "high",
      format: "png",
      n: 1,
    })
  })
  test("rejects fractional n", () => {
    expect(accepts(GenerateImage, { prompt: "draw", n: 1.5 })).toBe(false)
  })
  test("rejects n outside 1..10", () => {
    expect(accepts(GenerateImage, { prompt: "draw", n: 0 })).toBe(false)
    expect(accepts(GenerateImage, { prompt: "draw", n: 11 })).toBe(false)
  })
  test("rejects empty or too long prompt", () => {
    expect(accepts(GenerateImage, { prompt: "" })).toBe(false)
    expect(accepts(GenerateImage, { prompt: "x".repeat(4001) })).toBe(false)
  })
})
```

- [ ] **Step 3: 写 tool 执行校验失败测试**

Append to `packages/opencode/test/tool/generate-image.test.ts`:

```ts
import { Effect, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { Config } from "../../src/config"
import { Instance } from "../../src/project/instance"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { GenerateImageTool } from "../../src/tool/generate-image"
import { Truncate } from "../../src/tool"
import { SessionID } from "../../src/session/schema"
import { ProviderTest } from "../fake/provider"

test("rejects generate action with images before provider call", async () => {
  const ctx = {
    sessionID: SessionID.make("ses_test"),
    messageID: MessageID.make("msg_test"),
    callID: "call_test",
    agent: "build",
    abort: AbortSignal.any([]),
    messages: [],
    metadata: () => Effect.void,
    ask: () => Effect.void,
  }
  await expect(
    GenerateImageTool.pipe(
      Effect.flatMap((info) => info.init()),
      Effect.flatMap((tool) => tool.execute({ action: "generate", prompt: "draw", images: ["image.png"] }, ctx)),
      Effect.provide(
        Layer.mergeAll(Config.defaultLayer, ProviderTest.fake().layer, Truncate.defaultLayer, Agent.defaultLayer),
      ),
      Effect.runPromise,
    ),
  ).rejects.toThrow("images can only be used with edit action")
})

test("requests generate_image permission with provider metadata", async () => {
  using server = Bun.serve({
    port: 0,
    fetch: () =>
      Response.json({
        data: [
          {
            b64_json:
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAF/gL+ee1vNwAAAABJRU5ErkJggg==",
          },
        ],
      }),
  })
  await using tmp = await tmpdir({ git: true, config: { image_model: "openai/gpt-image-2" } })
  const model = ProviderTest.model({
    id: ModelID.make("gpt-image-2"),
    providerID: ProviderID.make("openai"),
    api: { id: "openai", url: `${server.url}v1`, npm: "@ai-sdk/openai" },
  })
  const fake = ProviderTest.fake({ model, info: ProviderTest.info({ key: "sk-test" }, model) })
  let asked: unknown
  const ctx = {
    sessionID: SessionID.make("ses_test"),
    messageID: MessageID.make("msg_permission"),
    callID: "call_test",
    agent: "build",
    abort: AbortSignal.any([]),
    messages: [],
    metadata: () => Effect.void,
    ask: (input: unknown) =>
      Effect.sync(() => {
        asked = input
      }),
  }
  await Instance.provide({
    directory: tmp.path,
    fn: () =>
      GenerateImageTool.pipe(
        Effect.flatMap((info) => info.init()),
        Effect.flatMap((tool) => tool.execute({ prompt: "draw" }, ctx)),
        Effect.provide(Layer.mergeAll(Config.defaultLayer, fake.layer, Truncate.defaultLayer, Agent.defaultLayer)),
        Effect.runPromise,
      ),
  })
  expect(asked).toMatchObject({
    permission: "generate_image",
    patterns: ["openai/gpt-image-2"],
    metadata: {
      provider: "openai",
      model: "gpt-image-2",
      action: "generate",
      n: 1,
      size: "auto",
      quality: "high",
      format: "png",
      filename: false,
      images: false,
      mask: false,
    },
  })
})
```

- [ ] **Step 4: 运行测试，确认失败**

Run:

```bash
bun test test/tool/generate-image.test.ts test/tool/registry.test.ts test/tool/parameters.test.ts
```

Expected: FAIL，tool 不存在或 registry 未包含。

- [ ] **Step 5: 创建 tool 描述**

Create `packages/opencode/src/tool/generate-image.txt`:

```text
Generate or edit images through the configured image provider. Use this tool for text-to-image generation or image edits using project-relative image paths or data URLs. Results are saved to .opencode/generated-images/ and returned as image file attachments. Do not use this for reading existing images; use the read tool instead.
```

- [ ] **Step 6: 创建 tool 定义**

Create `packages/opencode/src/tool/generate-image.ts`:

```ts
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./generate-image.txt"
import { Config } from "../config"
import { Provider } from "../provider"
import { ProviderID, ModelID } from "../provider/schema"
import { Instance } from "../project/instance"
import { callOpenAICompatible } from "./generate-image/openai-compatible"
import { decodeImageInput, validateMask, validatePrompt } from "./generate-image/input"
import { persistImages } from "./generate-image/persist"
import { pickAdapter, resolveCredentials, resolveImageFieldStyle, resolveModelParts } from "./generate-image/config"
import { MAX_PROMPT_LENGTH } from "./generate-image/types"

export const Parameters = Schema.Struct({
  action: Schema.Literals(["generate", "edit"]).pipe(
    Schema.optional,
    Schema.withDecodingDefault(Effect.succeed("generate" as const)),
  ),
  prompt: Schema.String.check(Schema.isLengthBetween(1, MAX_PROMPT_LENGTH)),
  provider: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  images: Schema.optional(Schema.Array(Schema.String)),
  mask: Schema.optional(Schema.String),
  size: Schema.String.pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed("auto"))),
  quality: Schema.Literals(["auto", "low", "medium", "high"]).pipe(
    Schema.optional,
    Schema.withDecodingDefault(Effect.succeed("high" as const)),
  ),
  format: Schema.Literals(["png", "jpeg", "webp"]).pipe(
    Schema.optional,
    Schema.withDecodingDefault(Effect.succeed("png" as const)),
  ),
  n: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(10)).pipe(
    Schema.optional,
    Schema.withDecodingDefault(Effect.succeed(1)),
  ),
  filename: Schema.optional(Schema.String),
})

export const GenerateImageTool = Tool.define(
  "generate_image",
  Effect.gen(function* () {
    const config = yield* Config.Service
    const providers = yield* Provider.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const prompt = validatePrompt(params.prompt)
          if (params.n < 1 || params.n > 10) throw new Error("n must be between 1 and 10")
          if (params.action === "generate" && params.images && params.images.length > 0) {
            throw new Error("images can only be used with edit action")
          }
          if (params.action === "generate" && params.mask) throw new Error("mask can only be used with edit action")
          if (params.action === "edit" && (!params.images || params.images.length === 0)) {
            throw new Error("images are required for edit action")
          }
          if (params.action === "edit" && params.images && params.images.length > 10) {
            throw new Error("edit action supports at most 10 images")
          }

          const cfg = yield* config.get()
          const parts = resolveModelParts({
            imageModel: cfg.image_model,
            provider: params.provider,
            model: params.model,
          })
          const provider = yield* providers.getProvider(ProviderID.make(parts.providerID))
          const model = yield* providers.getModel(ProviderID.make(parts.providerID), ModelID.make(parts.modelID))
          const adapter = pickAdapter({
            providerID: parts.providerID,
            providerOptions: provider.options,
            modelOptions: model.options,
            npm: model.api.npm,
          })
          const imageFieldStyle = resolveImageFieldStyle({
            providerOptions: provider.options,
            modelOptions: model.options,
          })
          const creds = resolveCredentials({ provider, model })

          const images = params.images
            ? yield* Effect.promise(() =>
                Promise.all(params.images!.map((item) => decodeImageInput({ root: Instance.worktree, input: item }))),
              )
            : undefined
          const mask = params.mask
            ? yield* Effect.promise(() => decodeImageInput({ root: Instance.worktree, input: params.mask! }))
            : undefined
          validateMask(images ?? [], mask)

          yield* ctx.ask({
            permission: "generate_image",
            patterns: [`${parts.providerID}/${parts.modelID}`],
            always: ["*"],
            metadata: {
              provider: parts.providerID,
              model: parts.modelID,
              action: params.action,
              n: params.n,
              size: params.size,
              quality: params.quality,
              format: params.format,
              filename: Boolean(params.filename),
              images: Boolean(images?.length),
              mask: Boolean(mask),
            },
          })

          if (adapter !== "openai-compatible") throw new Error(`Unsupported image adapter: ${adapter}`)
          const generated = yield* callOpenAICompatible({
            baseURL: creds.baseURL,
            apiKey: creds.apiKey,
            action: params.action,
            model: parts.modelID,
            prompt,
            size: params.size,
            quality: params.quality,
            format: params.format,
            n: params.n,
            images,
            mask,
            imageFieldStyle,
          })
          if (generated.length === 0) throw new Error("No image data returned from image provider")
          const attachments = yield* Effect.promise(() =>
            persistImages({
              root: Instance.worktree,
              messageID: ctx.messageID,
              filename: params.filename,
              images: generated,
            }),
          )
          return {
            title: "generate_image",
            output: `已生成 ${attachments.length} 张图片：`,
            metadata: {
              provider: parts.providerID,
              model: parts.modelID,
              action: params.action,
              count: attachments.length,
            },
            attachments,
          }
        }),
    }
  }),
)
```

- [ ] **Step 7: 更新参数 snapshot**

Run:

```bash
bun test test/tool/parameters.test.ts --update-snapshots
```

Expected: PASS，并更新 `packages/opencode/test/tool/__snapshots__/parameters.test.ts.snap` 中的 `generate_image` snapshot。

- [ ] **Step 8: 注册 builtin tool**

Modify `packages/opencode/src/tool/registry.ts`:

```ts
import { GenerateImageTool } from "./generate-image"
```

Add initialization near other builtin tools:

```ts
const generateImage = yield * GenerateImageTool
```

Add to `Effect.all`:

```ts
          generateImage: Tool.init(generateImage),
```

Add to `builtin` after `tool.fetch`:

```ts
            tool.generateImage,
```

- [ ] **Step 9: 运行测试，确认通过**

Run:

```bash
bun test test/tool/generate-image.test.ts test/tool/registry.test.ts test/tool/parameters.test.ts
```

Expected: PASS。

- [ ] **Step 10: 提交本任务**

```bash
git add packages/opencode/src/tool/generate-image.ts packages/opencode/src/tool/generate-image.txt packages/opencode/src/tool/registry.ts packages/opencode/test/tool/generate-image.test.ts packages/opencode/test/tool/parameters.test.ts packages/opencode/test/tool/__snapshots__/parameters.test.ts.snap packages/opencode/test/tool/registry.test.ts
git commit -m "feat: register generate image tool"
```

---

### Task 7: 回归验证与收尾

**Files:**

- Modify: `packages/opencode/test/tool/generate-image.test.ts`
- Existing tests: `packages/opencode/test/session/generated-image.test.ts`, `packages/opencode/test/session/processor-effect.test.ts`, `packages/opencode/test/session/prompt.test.ts`, `packages/opencode/test/provider/copilot/openai-responses-language-model.test.ts`

- [ ] **Step 1: 增加 tool 不影响 `image_generation` 的断言**

Append to `packages/opencode/test/tool/generate-image.test.ts`:

```ts
test("generate_image attachments use FilePart contract without source.tool", async () => {
  await using tmp = await tmpdir({ git: true })
  const result = await persistImages({
    root: tmp.path,
    messageID: MessageID.make("msg_contract"),
    filename: "contract",
    images: [{ mime: "image/png", bytes, filename: "image.png" }],
    random: () => "ffffffff",
  })
  expect(result[0].url).toBe("/generated-image?path=.opencode%2Fgenerated-images%2Fcontract-msg_contract-ffffffff.png")
  expect(result[0].relativePath).toBe(".opencode/generated-images/contract-msg_contract-ffffffff.png")
  expect(result[0]).not.toHaveProperty("source")
})
```

- [ ] **Step 2: 跑新工具测试**

Run:

```bash
bun test test/tool/generate-image-filename.test.ts test/tool/generate-image-input.test.ts test/tool/generate-image-config.test.ts test/tool/generate-image-openai-compatible.test.ts test/tool/generate-image.test.ts test/tool/parameters.test.ts test/tool/registry.test.ts
```

Expected: PASS。

- [ ] **Step 3: 跑生成图回归测试**

Run:

```bash
bun test test/session/generated-image.test.ts test/session/processor-effect.test.ts test/session/prompt.test.ts test/provider/copilot/openai-responses-language-model.test.ts
```

Expected: PASS。确认现有 OpenAI Responses `image_generation`、项目落盘、路径附件、`partial_image` 行为不受影响。

- [ ] **Step 4: 运行类型检查**

Run from `packages/opencode`:

```bash
bun typecheck
```

Expected: PASS，无 TypeScript 错误。

- [ ] **Step 5: 提交收尾**

```bash
git add packages/opencode/test/tool/generate-image.test.ts
git commit -m "test: cover generate image tool contract"
```

---

## 实现顺序

1. Task 1：配置 schema。
2. Task 2：文件名和输入解析纯函数。
3. Task 3：provider/model 配置解析。
4. Task 4：OpenAI-compatible adapter。
5. Task 5：落盘和附件。
6. Task 6：tool 和 registry。
7. Task 7：回归验证与类型检查。

## 风险与注意事项

- 不要修改 `packages/opencode/src/session/prompt.ts` 中现有 `image_generation` provider tool 注入逻辑。
- 不要让 `generate_image` 生成的附件写入不存在的 `source.tool`。
- 不要把裸 base64 无法识别的内容默认当作 PNG。
- 不要把远程 URL provider 响应下载为图片；首版明确失败。
- `apiKey`、provider 错误信息和 request body 日志不得打印密钥。
- adapter 内部用 `Effect.tryPromise` 包装原生 `fetch`，避免依赖当前 Effect 版本中未验证的 multipart body helper；不要记录包含 `Authorization` 的 request 信息。

## 自检清单

- Spec 覆盖：配置、命名、参数、输入校验、OpenAI-compatible adapter、落盘、权限、错误处理、测试策略均有对应任务。
- 无占位内容：所有任务给出文件路径、测试代码、实现代码、运行命令和预期结果。
- 类型一致：`filename`、`format`、`image_model`、`relativePath`、`url` 与设计文档一致。
