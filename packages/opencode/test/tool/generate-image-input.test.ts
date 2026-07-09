import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import { decodeImageInput, validateMask, validatePrompt } from "../../src/tool/generate-image/input"
import type { DecodedImage, ImageAction } from "../../src/tool/generate-image/types"

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAF/gL+ee1vNwAAAABJRU5ErkJggg=="
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb]).toString("base64")
const webp = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]).toString("base64")

const validAction = "generate" satisfies ImageAction
void validAction

const validDecodedImage = { mime: "image/png", bytes: new Uint8Array(), filename: "image.png" } satisfies DecodedImage
void validDecodedImage

// @ts-expect-error variation is not allowed in Task 2
const invalidAction = "variation" satisfies ImageAction
void invalidAction

// @ts-expect-error filename is required in DecodedImage
const invalidDecodedImage = { mime: "image/png", bytes: new Uint8Array() } satisfies DecodedImage
void invalidDecodedImage

async function withMockedImageFiles(files: Record<string, Uint8Array>, run: (root: string) => Promise<void>) {
  const root = path.join(process.cwd(), "mock-generate-image-input-root")
  const entries = new Map(Object.entries(files).map(([name, bytes]) => [path.resolve(root, name), bytes]))
  const originalRealpath = fs.realpath
  const originalLstat = fs.lstat
  const originalStat = fs.stat
  const originalReadFile = fs.readFile
  type FilePath = Parameters<typeof fs.realpath>[0]
  const missing = (filePath: string) =>
    Object.assign(new Error(`ENOENT: no such file or directory, stat '${filePath}'`), { code: "ENOENT" })

  fs.realpath = (async (filePath: FilePath) => {
    const resolved = String(filePath)
    if (resolved === root || entries.has(resolved)) {
      return resolved
    }
    throw missing(resolved)
  }) as typeof fs.realpath

  fs.lstat = (async (filePath: FilePath) => {
    const resolved = String(filePath)
    if (entries.has(resolved)) {
      return {} as Awaited<ReturnType<typeof fs.lstat>>
    }
    throw missing(resolved)
  }) as typeof fs.lstat

  fs.stat = (async (filePath: FilePath) => {
    const resolved = String(filePath)
    const bytes = entries.get(resolved)
    if (bytes) {
      return { size: bytes.byteLength } as Awaited<ReturnType<typeof fs.stat>>
    }
    throw missing(resolved)
  }) as typeof fs.stat

  fs.readFile = (async (filePath: FilePath) => {
    const resolved = String(filePath)
    const bytes = entries.get(resolved)
    if (bytes) {
      return Buffer.from(bytes)
    }
    throw missing(resolved)
  }) as typeof fs.readFile

  try {
    await run(root)
  } finally {
    fs.realpath = originalRealpath
    fs.lstat = originalLstat
    fs.stat = originalStat
    fs.readFile = originalReadFile
  }
}

describe("generate_image input", () => {
  test("validates prompt length", () => {
    expect(() => validatePrompt("")).toThrow("prompt must be between 1 and 4000 characters")
    expect(() => validatePrompt("x".repeat(4001))).toThrow("prompt must be between 1 and 4000 characters")
    expect(validatePrompt("draw a cat")).toBe("draw a cat")
  })

  test("decodes data url and naked base64 only when mime is recognized", async () => {
    const data = await decodeImageInput({ root: process.cwd(), input: `data:image/png;base64,${png}` })
    expect(data.mime).toBe("image/png")
    expect(data.filename).toBe("image.png")
    expect(data.bytes.byteLength).toBeGreaterThan(0)

    const naked = await decodeImageInput({ root: process.cwd(), input: png })
    expect(naked.mime).toBe("image/png")
    expect(naked.filename).toBe("image.png")

    const jpegImage = await decodeImageInput({ root: process.cwd(), input: jpeg })
    expect(jpegImage.mime).toBe("image/jpeg")
    expect(jpegImage.filename).toBe("image.jpg")

    const webpImage = await decodeImageInput({ root: process.cwd(), input: webp })
    expect(webpImage.mime).toBe("image/webp")
    expect(webpImage.filename).toBe("image.webp")

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

  test("rejects whitespace-only inputs", async () => {
    await expect(decodeImageInput({ root: process.cwd(), input: "  \n\t  " })).rejects.toThrow(
      "image input cannot be empty",
    )
  })

  test("uses the original relative path without trimming surrounding spaces", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "spaced.png"), Buffer.from(jpeg, "base64"))
        await Bun.write(path.join(dir, " spaced.png"), Buffer.from(png, "base64"))
      },
    })

    const image = await decodeImageInput({ root: tmp.path, input: " spaced.png" })
    expect(image.mime).toBe("image/png")
    expect(image.filename).toBe(" spaced.png")
  })

  test("does not trim trailing spaces from relative paths", async () => {
    await withMockedImageFiles(
      {
        "image.png": new Uint8Array(Buffer.from(jpeg, "base64")),
        "image.png ": new Uint8Array(Buffer.from(png, "base64")),
      },
      async (root) => {
        const image = await decodeImageInput({ root, input: "image.png " })
        expect(image.mime).toBe("image/png")
        expect(image.filename).toBe("image.png ")
      },
    )
  })

  test("does not trim leading and trailing spaces from relative paths", async () => {
    await withMockedImageFiles(
      {
        "image.png": new Uint8Array(Buffer.from(jpeg, "base64")),
        " image.png ": new Uint8Array(Buffer.from(png, "base64")),
      },
      async (root) => {
        const image = await decodeImageInput({ root, input: " image.png " })
        expect(image.mime).toBe("image/png")
        expect(image.filename).toBe(" image.png ")
      },
    )
  })

  test("does not accept data urls or base64 strings with surrounding whitespace", async () => {
    await using tmp = await tmpdir()

    await expect(decodeImageInput({ root: tmp.path, input: `  data:image/png;base64,${png}  ` })).rejects.toThrow(
      "image file does not exist",
    )
    await expect(decodeImageInput({ root: tmp.path, input: `  ${png}  ` })).rejects.toThrow("image file does not exist")
  })

  test("rejects oversized non-file inputs", async () => {
    const bytes = new Uint8Array(10 * 1024 * 1024 + 1)
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const base64 = Buffer.from(bytes).toString("base64")
    const originalBufferFrom = Buffer.from

    Buffer.from = ((
      value: string | ArrayBuffer | SharedArrayBuffer | ArrayLike<number>,
      encodingOrOffset?: BufferEncoding | number,
      length?: number,
    ) => {
      if (typeof value === "string" && encodingOrOffset === "base64" && value === base64) {
        throw new Error("base64 should not be decoded before size check")
      }

      return originalBufferFrom(value as never, encodingOrOffset as never, length as never)
    }) as typeof Buffer.from

    try {
      await expect(decodeImageInput({ root: process.cwd(), input: base64 })).rejects.toThrow("image exceeds 10MB limit")
      await expect(decodeImageInput({ root: process.cwd(), input: `data:image/png;base64,${base64}` })).rejects.toThrow(
        "image exceeds 10MB limit",
      )
    } finally {
      Buffer.from = originalBufferFrom
    }
  })

  test("rejects oversized files before reading bytes", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "large.png"), new Uint8Array(10 * 1024 * 1024 + 1))
      },
    })
    const originalReadFile = fs.readFile
    fs.readFile = (async () => {
      throw new Error("readFile should not run before size check")
    }) as typeof fs.readFile

    try {
      await expect(decodeImageInput({ root: tmp.path, input: "large.png" })).rejects.toThrow("image exceeds 10MB limit")
    } finally {
      fs.readFile = originalReadFile
    }
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

  test("reads long but legal project relative paths", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "image.png"), Buffer.from(png, "base64"))
      },
    })

    const input = `${"./".repeat(130)}image.png`
    expect(input.length).toBeGreaterThan(255)

    const image = await decodeImageInput({ root: tmp.path, input })
    expect(image.mime).toBe("image/png")
    expect(image.filename).toBe("image.png")
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
