import { describe, expect, test } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Effect, Exit } from "effect"
import path from "node:path"
import { persistGeneratedImageAttachments } from "../../src/session/generated-image-persistence"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

const sessionID = SessionID.make("ses_01J5Y5H0AH4Q4NXJ6P4C3P5V2K")
const messageID = MessageID.make("msg_01J5Y5H0AH4Q4NXJ6P4C3P5V2M")
const pngDataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAF/gL+ee1vNwAAAABJRU5ErkJggg=="

async function fileSystem() {
  return Effect.runPromise(
    Effect.gen(function* () {
      return yield* FSUtil.Service
    }).pipe(Effect.provide(LayerNode.compile(FSUtil.node))),
  )
}

describe("persistGeneratedImageAttachments", () => {
  test("rejects unsafe generated image filenames without writing outside generated-images", async () => {
    await using tmp = await tmpdir()
    const fs = await fileSystem()
    const escaped = path.join(tmp.path, ".opencode", "escaped.png")

    const exit = await Effect.runPromise(
      persistGeneratedImageAttachments(fs, tmp.path, [
        {
          id: PartID.make("prt_generated_image_unsafe"),
          sessionID,
          messageID,
          type: "file",
          mime: "image/png",
          filename: "generated-image-nested/../../escaped.png",
          url: pngDataUrl,
        },
      ]).pipe(Effect.exit),
    )

    expect(Exit.isFailure(exit)).toBe(true)
    expect(await Bun.file(escaped).exists()).toBe(false)
  })
})
