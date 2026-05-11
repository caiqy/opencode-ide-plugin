import { describe, expect, test } from "bun:test"
import { normalizeImageGenerationOutput } from "../../src/session/generated-image"
import { MessageID, PartID, SessionID } from "../../src/session/schema"

const sessionID = SessionID.zod.parse("ses_01J5Y5H0AH4Q4NXJ6P4C3P5V2K")
const messageID = MessageID.zod.parse("msg_01J5Y5H0AH4Q4NXJ6P4C3P5V2M")
const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAF/gL+ee1vNwAAAABJRU5ErkJggg=="

describe("normalizeImageGenerationOutput", () => {
  test("生成图片时仅输出汇总文案，不附带逐张标题行", () => {
    const result = normalizeImageGenerationOutput({
      tool: "image_generation",
      sessionID,
      messageID,
      output: {
        title: "image_generation",
        metadata: {},
        output: JSON.stringify({ data: [pngBase64] }),
      },
    })

    expect(result.title).toBe("image_generation")
    expect(result.output).toBe("已生成 1 张图片：")
    expect(result.attachments).toHaveLength(1)
    expect(result.attachments?.[0]?.filename).toBe("generated-image-1.png")
  })

  test("结构化 output 也保留原 title metadata 和已有附件", () => {
    const existing = {
      id: PartID.make("prt_existingImage1"),
      sessionID,
      messageID,
      type: "file" as const,
      mime: "image/png",
      filename: "existing.png",
      url: `data:image/png;base64,${pngBase64}`,
    }

    const result = normalizeImageGenerationOutput({
      tool: "image_generation",
      sessionID,
      messageID,
      output: {
        title: "custom image title",
        metadata: { source: "provider" },
        output: { result: pngBase64 },
        attachments: [existing],
      },
    })

    expect(result.title).toBe("custom image title")
    expect(result.metadata).toEqual({ source: "provider" })
    expect(result.output).toBe("已生成 1 张图片：")
    expect(result.attachments).toHaveLength(2)
    expect(result.attachments?.[0]).toBe(existing)
  })

  test("已有图片附件时，新生成图片文件名从下一个编号开始", () => {
    const existing = {
      id: PartID.make("prt_existingImage1"),
      sessionID,
      messageID,
      type: "file" as const,
      mime: "image/png",
      filename: "existing.png",
      url: `data:image/png;base64,${pngBase64}`,
    }

    const result = normalizeImageGenerationOutput({
      tool: "image_generation",
      sessionID,
      messageID,
      output: {
        title: "image_generation",
        metadata: {},
        output: pngBase64,
        attachments: [existing],
      },
    })

    expect(result.attachments?.map((item) => item.filename)).toEqual(["existing.png", "generated-image-2.png"])
  })
})
