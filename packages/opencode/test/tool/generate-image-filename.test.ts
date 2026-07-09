import { describe, expect, test } from "bun:test"
import { buildFilename, sanitizeFilename } from "../../src/tool/generate-image/filename"

describe("generate_image filename", () => {
  test("sanitizes separators, Windows characters, devices, and empty names", () => {
    expect(sanitizeFilename("../bad:name?.png")).toBe("badname.png")
    expect(sanitizeFilename(" CON ")).toBeUndefined()
    expect(sanitizeFilename(" .foo ")).toBe("foo")
    expect(sanitizeFilename("foo. ")).toBe("foo")
    expect(sanitizeFilename(" . foo . ")).toBe("foo")
    expect(sanitizeFilename("bad\u0000\u0007name.png")).toBe("badname.png")
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

  test("caps long custom filenames while preserving suffix metadata", () => {
    const next = buildFilename({
      messageID: "msg_test",
      index: 2,
      count: 3,
      mime: "image/png",
      random: "a1b2c3d4",
      filename: `${"poster".repeat(80)}.webp`,
    })

    expect(next.length).toBeLessThanOrEqual(240)
    expect(next).toContain("msg_test")
    expect(next).toContain("a1b2c3d4")
    expect(next.endsWith(".png")).toBe(true)
  })
})
