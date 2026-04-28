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

  test("treats .zip payloads as binary", () => {
    const bytes = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00])

    expect(classifyAttachment("archive.zip", bytes, "text/plain")).toEqual({
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
