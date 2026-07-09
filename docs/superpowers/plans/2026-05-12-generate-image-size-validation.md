# Generate Image Size Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `generate_image` 在调用 OpenAI-compatible `gpt-image-*` 模型前，正确拦截低于/高于官方像素预算的尺寸，并同步更新参数说明与工具文本。

**Architecture:** 继续沿用现有 `openai-compatible.ts` 本地预检入口，只在 `validateSize()` 中补齐缺失的总像素区间校验，不改变 `auto` 或非 `gpt-image-*` 模型的行为。说明层面同时更新 `generate-image.ts` 的参数 description 与 `generate-image.txt` 的工具文本，并用现有参数 schema 测试与 snapshot 固化文案。

**Tech Stack:** TypeScript、Effect Schema、Bun test、Bun snapshots

---

### Task 1: 先写像素预算失败测试

**Files:**

- Modify: `packages/opencode/test/tool/generate-image-openai-compatible.test.ts`
- Reference: `packages/opencode/src/tool/generate-image/openai-compatible.ts`

- [ ] **Step 1: 在 adapter 测试中补 4 个失败/通过场景**

```ts
test("rejects GPT image sizes below minimum pixel budget before provider call", async () => {
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
        size: "512x512",
        quality: "high",
        format: "png",
        n: 1,
      }),
    ),
  ).rejects.toThrow("size total pixels must be >= 655360 for gpt-image models")

  expect(called).toBe(false)
})

test("rejects non-square GPT image sizes below minimum pixel budget", async () => {
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
        size: "640x1008",
        quality: "high",
        format: "png",
        n: 1,
      }),
    ),
  ).rejects.toThrow("size total pixels must be >= 655360 for gpt-image models")

  expect(called).toBe(false)
})

test("rejects GPT image sizes above maximum pixel budget before provider call", async () => {
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
        size: "3840x2176",
        quality: "high",
        format: "png",
        n: 1,
      }),
    ),
  ).rejects.toThrow("size total pixels must be <= 8294400 for gpt-image models")

  expect(called).toBe(false)
})

test("accepts valid custom GPT image sizes that are not from a fixed whitelist", async () => {
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
      model: "gpt-image-2",
      prompt: "draw",
      size: "1280x1024",
      quality: "high",
      format: "png",
      n: 1,
    }),
  )

  expect(body.size).toBe("1280x1024")
})
```

- [ ] **Step 2: 运行测试，确认当前实现真的失败**

Run:

```bash
cd packages/opencode
bun test test/tool/generate-image-openai-compatible.test.ts
```

Expected: FAIL；新加的两个 “below minimum pixel budget” 用例与 “above maximum pixel budget” 用例不会按预期抛错，因为当前 `validateSize()` 还没有总像素上下限校验。

### Task 2: 实现像素预算预检

**Files:**

- Modify: `packages/opencode/src/tool/generate-image/openai-compatible.ts`
- Test: `packages/opencode/test/tool/generate-image-openai-compatible.test.ts`

- [ ] **Step 1: 在 `validateSize()` 中加入总像素区间校验**

在 `packages/opencode/src/tool/generate-image/openai-compatible.ts` 的 `validateSize()` 中，在长宽比检查之后插入：

```ts
const totalPixels = width * height

if (totalPixels < 655360) {
  throw new Error("size total pixels must be >= 655360 for gpt-image models")
}

if (totalPixels > 8294400) {
  throw new Error("size total pixels must be <= 8294400 for gpt-image models")
}
```

完整上下文应保持这种顺序：

```ts
if (width % 16 !== 0 || height % 16 !== 0) {
  throw new Error("size width and height must be multiples of 16")
}

if (Math.max(width, height) > 3840) {
  throw new Error("size longest edge must be <= 3840")
}

if (Math.max(width, height) / Math.min(width, height) > 3) {
  throw new Error("size aspect ratio must be <= 3:1")
}

const totalPixels = width * height

if (totalPixels < 655360) {
  throw new Error("size total pixels must be >= 655360 for gpt-image models")
}

if (totalPixels > 8294400) {
  throw new Error("size total pixels must be <= 8294400 for gpt-image models")
}
```

- [ ] **Step 2: 运行 adapter 测试，确认像素预算与合法自定义尺寸都通过**

Run:

```bash
cd packages/opencode
bun test test/tool/generate-image-openai-compatible.test.ts
```

Expected: PASS；`512x512`、`640x1008`、`3840x2176` 在请求发出前失败，`1280x1024` 继续通过。

- [ ] **Step 3: 提交实现改动**

```bash
git add packages/opencode/src/tool/generate-image/openai-compatible.ts packages/opencode/test/tool/generate-image-openai-compatible.test.ts
git commit -m "fix: enforce gpt image pixel budget"
```

### Task 3: 固化参数说明与工具文本

**Files:**

- Modify: `packages/opencode/src/tool/generate-image.ts`
- Modify: `packages/opencode/src/tool/generate-image.txt`
- Modify: `packages/opencode/test/tool/parameters.test.ts`
- Modify: `packages/opencode/test/tool/__snapshots__/parameters.test.ts.snap`

- [ ] **Step 1: 先写一个会失败的参数说明测试**

在 `packages/opencode/test/tool/parameters.test.ts` 的 `describe("generate_image", ...)` 中添加：

```ts
test("documents GPT image size constraints", () => {
  const schema = toJsonSchema(GenerateImage) as {
    properties?: Record<string, { description?: string }>
  }

  expect(schema.properties?.size?.description).toBe(
    "Requested output size. Use auto or WIDTHxHEIGHT. For gpt-image-* models, width and height must be multiples of 16, the longest edge must be <= 3840, aspect ratio must be <= 3:1, and total pixels must be between 655360 and 8294400.",
  )
})
```

- [ ] **Step 2: 运行参数测试，确认当前 description 还没更新**

Run:

```bash
cd packages/opencode
bun test test/tool/parameters.test.ts -t "documents GPT image size constraints"
```

Expected: FAIL；当前 `size` 的 description 仍然是旧文案 `Requested output size. Use auto or WIDTHxHEIGHT when supported by the model.`。

- [ ] **Step 3: 更新参数 description 与工具文本**

把 `packages/opencode/src/tool/generate-image.ts` 中的 `size` description 改成：

```ts
  size: Schema.String.pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed("auto"))).annotate({
    description:
      "Requested output size. Use auto or WIDTHxHEIGHT. For gpt-image-* models, width and height must be multiples of 16, the longest edge must be <= 3840, aspect ratio must be <= 3:1, and total pixels must be between 655360 and 8294400.",
  }),
```

把 `packages/opencode/src/tool/generate-image.txt` 改成单行说明：

```text
Generate or edit images through the configured image provider. Use this tool for text-to-image generation or image edits using project-relative image paths, data URLs, or naked base64 image inputs. Results are saved to .opencode/generated-images/ and returned as image file attachments. For gpt-image-* models, size can be auto or any WIDTHxHEIGHT that satisfies the model constraints: both edges must be multiples of 16, the longest edge must be <= 3840, aspect ratio must be <= 3:1, and total pixels must be between 655360 and 8294400. Do not use this for reading existing images; use the read tool instead.
```

同时把 snapshot 里的 `generate_image` 片段更新为：

```ts
    "size": {
      "default": "auto",
      "description": "Requested output size. Use auto or WIDTHxHEIGHT. For gpt-image-* models, width and height must be multiples of 16, the longest edge must be <= 3840, aspect ratio must be <= 3:1, and total pixels must be between 655360 and 8294400.",
      "type": "string",
    },
```

- [ ] **Step 4: 运行参数测试并更新 snapshot**

Run:

```bash
cd packages/opencode
bun test test/tool/parameters.test.ts -u
```

Expected: PASS；新增说明测试通过，`generate_image` 的 snapshot 同步更新为新 description。

- [ ] **Step 5: 运行最终回归并提交**

Run:

```bash
cd packages/opencode
bun test test/tool/generate-image-openai-compatible.test.ts test/tool/parameters.test.ts
```

Expected: PASS；像素预算预检和参数文案都稳定。

```bash
git add packages/opencode/src/tool/generate-image.ts packages/opencode/src/tool/generate-image.txt packages/opencode/test/tool/parameters.test.ts packages/opencode/test/tool/__snapshots__/parameters.test.ts.snap
git commit -m "docs: clarify generate_image size constraints"
```
