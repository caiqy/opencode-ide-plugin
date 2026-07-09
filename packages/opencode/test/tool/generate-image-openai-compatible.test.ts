import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { callOpenAICompatible } from "../../src/tool/generate-image/openai-compatible"

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAF/gL+ee1vNwAAAABJRU5ErkJggg=="

function run<A>(effect: Effect.Effect<A, unknown, never>) {
  return Effect.runPromise(effect)
}

describe("generate_image openai-compatible adapter", () => {
  test("sends generation json request with bearer auth and parses b64_json", async () => {
    let url = ""
    let auth = ""
    let body: Record<string, unknown> = {}

    using server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        url = req.url
        auth = req.headers.get("authorization") ?? ""
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

    expect(url).toBe(`${server.url}v1/images/generations`)
    expect(auth).toBe("Bearer sk-test")
    expect(body).toEqual({
      model: "gpt-image-2",
      prompt: "draw",
      size: "1536x1024",
      quality: "high",
      output_format: "webp",
      n: 1,
    })
    expect(body).not.toHaveProperty("response_format")
    expect(images[0]).toMatchObject({ mime: "image/png", filename: "image.png" })
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

  test("parses data url fields in response data array", async () => {
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

    expect(images[0]).toMatchObject({ mime: "image/png", filename: "image.png" })
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
    expect(images.map((image) => image.filename)).toEqual(["image.png", "image.png"])
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

  test("rejects zero GPT image dimensions before provider call", async () => {
    let called = false

    using server = Bun.serve({
      port: 0,
      fetch: () => {
        called = true
        return Response.json({ data: [{ b64_json: png }] })
      },
    })

    for (const size of ["0x0", "0x16", "16x0"]) {
      await expect(
        run(
          callOpenAICompatible({
            baseURL: `${server.url}v1`,
            apiKey: "sk-test",
            action: "generate",
            model: "gpt-image-2",
            prompt: "draw",
            size,
            quality: "high",
            format: "png",
            n: 1,
          }),
        ),
      ).rejects.toThrow("size width and height must be greater than 0")
    }

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

  test("prefers json error.message over top-level message in provider errors", async () => {
    using server = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(JSON.stringify({ message: "generic", error: { message: "specific" } }), { status: 400 }),
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
    ).rejects.toThrow("image provider returned HTTP 400: specific")
  })

  test("redacts api keys echoed in provider error messages", async () => {
    using server = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(
          JSON.stringify({ error: { message: "bad key sk-test-secret Authorization: Bearer sk-test-secret" } }),
          {
            status: 400,
          },
        ),
    })

    const error = await run(
      Effect.flip(
        callOpenAICompatible({
          baseURL: `${server.url}v1`,
          apiKey: "sk-test-secret",
          action: "generate",
          model: "gpt-image-2",
          prompt: "draw",
          size: "auto",
          quality: "high",
          format: "png",
          n: 1,
        }),
      ),
    )

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).not.toContain("sk-test-secret")
    expect((error as Error).message).toContain("[redacted]")
  })

  test("fails clearly when provider payload does not contain a top-level data array", async () => {
    using fooServer = Bun.serve({ port: 0, fetch: () => Response.json({ foo: [] }) })
    using nullServer = Bun.serve({ port: 0, fetch: () => Response.json({ data: null }) })

    await expect(
      run(
        callOpenAICompatible({
          baseURL: `${fooServer.url}v1`,
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
    ).rejects.toThrow("No image data returned from image provider")

    await expect(
      run(
        callOpenAICompatible({
          baseURL: `${nullServer.url}v1`,
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
    ).rejects.toThrow("No image data returned from image provider")
  })

  test("truncates long provider error summaries", async () => {
    const long = "x".repeat(1200)

    using server = Bun.serve({
      port: 0,
      fetch: () => new Response(JSON.stringify({ error: { message: long } }), { status: 400 }),
    })

    const error = await run(
      Effect.flip(
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
    )

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain("...")
    expect((error as Error).message.length).toBeLessThanOrEqual(540)
  })

  test("sends edit multipart with image brackets and optional mask", async () => {
    let url = ""
    let auth = ""
    let fields:
      | {
          model: FormDataEntryValue | null
          prompt: FormDataEntryValue | null
          size: FormDataEntryValue | null
          quality: FormDataEntryValue | null
          format: FormDataEntryValue | null
          n: FormDataEntryValue | null
          images: number
          hasMask: boolean
        }
      | undefined

    using server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        url = req.url
        auth = req.headers.get("authorization") ?? ""
        const form = await req.formData()
        fields = {
          model: form.get("model"),
          prompt: form.get("prompt"),
          size: form.get("size"),
          quality: form.get("quality"),
          format: form.get("output_format"),
          n: form.get("n"),
          images: form.getAll("image[]").length,
          hasMask: form.get("mask") instanceof File,
        }
        return Response.json({ data: [{ b64_json: png }] })
      },
    })

    const bytes = new Uint8Array(Buffer.from(png, "base64"))
    const images = await run(
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

    expect(url).toBe(`${server.url}v1/images/edits`)
    expect(auth).toBe("Bearer sk-test")
    expect(fields).toEqual({
      model: "gpt-image-2",
      prompt: "edit",
      size: "auto",
      quality: "high",
      format: "png",
      n: "1",
      images: 1,
      hasMask: true,
    })
    expect(images[0]).toMatchObject({ mime: "image/png", filename: "image.png" })
  })

  test("sends edit multipart with repeated image field names without mask", async () => {
    let imageCount = 0
    let repeatedCount = 0
    let hasMask = false

    using server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        const form = await req.formData()
        imageCount = form.getAll("image[]").length
        repeatedCount = form.getAll("image").length
        hasMask = form.has("mask")
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
        n: 2,
        imageFieldStyle: "repeated",
        images: [
          { mime: "image/png", bytes, filename: "input-1.png" },
          { mime: "image/png", bytes, filename: "input-2.png" },
        ],
      }),
    )

    expect(imageCount).toBe(0)
    expect(repeatedCount).toBe(2)
    expect(hasMask).toBe(false)
  })
})
