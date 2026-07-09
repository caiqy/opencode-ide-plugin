import { afterEach, describe, expect, test } from "bun:test"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import fs from "node:fs/promises"
import path from "node:path"
import { Cause, Effect, Exit, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Config } from "../../src/config"
import { Permission } from "../../src/permission"
import { Instance } from "../../src/project/instance"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { InstanceState } from "../../src/effect/instance-state"
import { generatedImageRelativePath } from "../../src/session/generated-image"
import { buildToolPermissionAsk } from "../../src/session/tool-permission"
import { MessageID, SessionID } from "../../src/session/schema"
import { GenerateImageTool } from "../../src/tool/generate-image"
import { persistImages } from "../../src/tool/generate-image/persist"
import { Truncate } from "../../src/tool/truncate"
import { provideTmpdirInstance, tmpdir } from "../fixture/fixture"
import { ProviderTest } from "../fake/provider"
import { testEffect } from "../lib/effect"

const ModelID = ModelV2.ID
const ProviderID = ProviderV2.ID

const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAF/gL+ee1vNwAAAABJRU5ErkJggg=="
const jpegBase64 = "/9j/"
const pngBytes = new Uint8Array(Buffer.from(pngBase64, "base64"))

function filePath(root: string, filename: string) {
  return path.join(root, ...generatedImageRelativePath(filename).split("/"))
}

function generatedImagesDir(root: string) {
  return path.dirname(filePath(root, "placeholder"))
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function squashedMessage(exit: Exit.Exit<unknown, unknown>) {
  expect(Exit.isFailure(exit)).toBe(true)
  if (!Exit.isFailure(exit)) {
    throw new Error("expected tool execution to fail")
  }
  const error = Cause.squash(exit.cause)
  if (!(error instanceof Error)) {
    throw new Error("expected squashed cause to be an Error")
  }
  return error.message
}

function requireValue<T>(value: T | undefined, message: string): T {
  if (value === undefined) {
    throw new Error(message)
  }
  return value
}

afterEach(async () => {
  await Instance.disposeAll()
})

const toolCtx = {
  sessionID: SessionID.make("ses_test-generate-image"),
  messageID: MessageID.make("msg_test-generate-image"),
  callID: "call_test-generate-image",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
}

const it = testEffect(
  LayerNode.compile(LayerNode.group([Config.node, Permission.node, EventV2Bridge.node, CrossSpawnSpawner.node, Truncate.node, Agent.node])),
)

function providerLayer(baseURL: string) {
  const model = ProviderTest.model({
    id: ModelID.make("gpt-image-2"),
    providerID: ProviderID.make("openai"),
    api: { id: ModelID.make("gpt-image-2"), url: baseURL, npm: "@ai-sdk/openai" },
  })

  return ProviderTest.fake({
    model,
    info: ProviderTest.info({ options: { apiKey: "sk-test", baseURL } }, model),
  }).layer
}

const initTool = (provider = providerLayer("https://example.com")) =>
  Effect.gen(function* () {
    const info = yield* GenerateImageTool
    return yield* info.init()
  }).pipe(Effect.provide(provider))

describe("generate_image persist", () => {
  test("writes images into .opencode/generated-images and returns file attachments without source metadata", async () => {
    await using tmp = await tmpdir()

    const [attachment] = await persistImages({
      root: tmp.path,
      messageID: "msg_test",
      random: () => "a1b2c3d4",
      images: [{ mime: "image/png", bytes: pngBytes }],
    })

    expect(attachment).toEqual({
      type: "file",
      mime: "image/png",
      filename: "generated-image-msg_test-1-a1b2c3d4.png",
      relativePath: ".opencode/generated-images/generated-image-msg_test-1-a1b2c3d4.png",
      url: "/generated-image?path=.opencode%2Fgenerated-images%2Fgenerated-image-msg_test-1-a1b2c3d4.png",
    })
    expect(attachment).not.toHaveProperty("source")
    expect(attachment).not.toHaveProperty("source.tool")
    const filename = requireValue(attachment.filename, "expected generated attachment filename")
    expect(await Bun.file(filePath(tmp.path, filename)).bytes()).toEqual(pngBytes)
  })

  test("uses generated-image default naming when no custom filename is provided", async () => {
    await using tmp = await tmpdir()

    const [attachment] = await persistImages({
      root: tmp.path,
      messageID: "msg_test",
      random: () => "a1b2c3d4",
      images: [{ mime: "image/png", bytes: pngBytes }],
    })

    expect(attachment.filename).toBe("generated-image-msg_test-1-a1b2c3d4.png")
  })

  test("does not overwrite an existing file and allocates a numbered suffix", async () => {
    await using tmp = await tmpdir()
    const existingName = "poster-msg_collision-aaaaaaaa.png"
    const existingPath = filePath(tmp.path, existingName)
    await fs.mkdir(path.dirname(existingPath), { recursive: true })
    await Bun.write(existingPath, new Uint8Array([1, 2, 3]))

    const [attachment] = await persistImages({
      root: tmp.path,
      messageID: "msg_collision",
      filename: "poster",
      random: () => "aaaaaaaa",
      images: [{ mime: "image/png", bytes: new Uint8Array([4, 5, 6]) }],
    })

    expect(attachment.filename).toBe("poster-msg_collision-aaaaaaaa-2.png")
    expect(await Bun.file(existingPath).bytes()).toEqual(new Uint8Array([1, 2, 3]))
    const filename = requireValue(attachment.filename, "expected collision attachment filename")
    expect(await Bun.file(filePath(tmp.path, filename)).bytes()).toEqual(new Uint8Array([4, 5, 6]))
  })

  test("keeps the final filename invisible until the write is fully published", async () => {
    await using tmp = await tmpdir()
    const finalFilename = "generated-image-msg_atomic-1-a1b2c3d4.png"
    const finalPath = filePath(tmp.path, finalFilename)
    const writeStarted = deferred()
    const releaseWrite = deferred()
    const originalOpen = fs.open

    fs.open = (async (...args: Parameters<typeof fs.open>) => {
      const handle = await originalOpen(...args)
      return new Proxy(handle, {
        get(target, prop, receiver) {
          if (prop === "writeFile") {
            return async (...writeArgs: Parameters<typeof target.writeFile>) => {
              writeStarted.resolve()
              await releaseWrite.promise
              return target.writeFile(...writeArgs)
            }
          }

          const value = Reflect.get(target, prop, receiver)
          return typeof value === "function" ? value.bind(target) : value
        },
      })
    }) as typeof fs.open

    try {
      const pending = persistImages({
        root: tmp.path,
        messageID: "msg_atomic",
        random: () => "a1b2c3d4",
        images: [{ mime: "image/png", bytes: pngBytes }],
      })

      await writeStarted.promise
      expect(await Bun.file(finalPath).exists()).toBe(false)

      releaseWrite.resolve()
      await pending
      expect(await Bun.file(finalPath).exists()).toBe(true)
    } finally {
      fs.open = originalOpen
    }
  })

  test("cleans up failed writes without leaving final or temp files", async () => {
    await using tmp = await tmpdir()
    const finalFilename = "generated-image-msg_cleanup-1-a1b2c3d4.png"
    const finalPath = filePath(tmp.path, finalFilename)
    const dir = generatedImagesDir(tmp.path)
    const originalOpen = fs.open
    const originalRm = fs.rm
    const openPaths = new Set<string>()

    fs.open = (async (...args: Parameters<typeof fs.open>) => {
      const filePath = args[0] as string
      const handle = await originalOpen(...args)
      openPaths.add(filePath)
      return new Proxy(handle, {
        get(target, prop, receiver) {
          if (prop === "writeFile") {
            return async () => {
              throw new Error("write failed")
            }
          }

          if (prop === "close") {
            return async (...closeArgs: Parameters<typeof target.close>) => {
              openPaths.delete(filePath)
              return target.close(...closeArgs)
            }
          }

          const value = Reflect.get(target, prop, receiver)
          return typeof value === "function" ? value.bind(target) : value
        },
      })
    }) as typeof fs.open

    fs.rm = (async (...args: Parameters<typeof fs.rm>) => {
      const targetPath = args[0] as string
      if (openPaths.has(targetPath)) {
        const error = Object.assign(new Error("file is busy"), { code: "EBUSY" })
        throw error
      }

      return originalRm(...args)
    }) as typeof fs.rm

    try {
      await expect(
        persistImages({
          root: tmp.path,
          messageID: "msg_cleanup",
          random: () => "a1b2c3d4",
          images: [{ mime: "image/png", bytes: pngBytes }],
        }),
      ).rejects.toThrow("write failed")

      expect(await Bun.file(finalPath).exists()).toBe(false)
      expect(await fs.readdir(dir)).toEqual([])
    } finally {
      fs.open = originalOpen
      fs.rm = originalRm
    }
  })

  test("encodes slash-based relative paths and url round-trips for special filenames", async () => {
    await using tmp = await tmpdir()

    const [attachment] = await persistImages({
      root: tmp.path,
      messageID: "msg_test",
      filename: "海报 终稿.png",
      random: () => "a1b2c3d4",
      images: [{ mime: "image/png", bytes: pngBytes }],
    })

    expect(attachment.filename).toBe("海报 终稿-msg_test-a1b2c3d4.png")
    expect(attachment.relativePath).toBe(".opencode/generated-images/海报 终稿-msg_test-a1b2c3d4.png")
    const relativePath = requireValue(attachment.relativePath, "expected generated attachment relative path")
    const url = requireValue(attachment.url, "expected generated attachment url")
    expect(relativePath.includes("\\")).toBe(false)
    expect(attachment.url).toBe(
      "/generated-image?path=.opencode%2Fgenerated-images%2F%E6%B5%B7%E6%8A%A5%20%E7%BB%88%E7%A8%BF-msg_test-a1b2c3d4.png",
    )
    expect(decodeURIComponent(url.slice("/generated-image?path=".length))).toBe(relativePath)
  })

  test("falls back to lock plus rename when hard links are unsupported", async () => {
    await using tmp = await tmpdir()
    const dir = generatedImagesDir(tmp.path)
    const originalLink = fs.link

    fs.link = (async () => {
      const error = Object.assign(new Error("hard links unsupported"), { code: "EPERM" })
      throw error
    }) as typeof fs.link

    try {
      const [attachment] = await persistImages({
        root: tmp.path,
        messageID: "msg_fallback",
        filename: "poster",
        random: () => "aaaaaaaa",
        images: [{ mime: "image/png", bytes: pngBytes }],
      })

      expect(attachment).toEqual({
        type: "file",
        mime: "image/png",
        filename: "poster-msg_fallback-aaaaaaaa.png",
        relativePath: ".opencode/generated-images/poster-msg_fallback-aaaaaaaa.png",
        url: "/generated-image?path=.opencode%2Fgenerated-images%2Fposter-msg_fallback-aaaaaaaa.png",
      })
      const filename = requireValue(attachment.filename, "expected fallback attachment filename")
      expect(await Bun.file(filePath(tmp.path, filename)).exists()).toBe(true)
      expect((await fs.readdir(dir)).some((entry) => entry.endsWith(".lock") || entry.includes(".tmp-"))).toBe(false)
    } finally {
      fs.link = originalLink
    }
  })

  test("allocates unique filenames when fallback publish handles concurrent same-name writes", async () => {
    await using tmp = await tmpdir()
    const finalFilename = "poster-msg_fallback-aaaaaaaa.png"
    const finalPath = filePath(tmp.path, finalFilename)
    const dir = generatedImagesDir(tmp.path)
    const originalLink = fs.link
    const originalRename = fs.rename
    const renameStarted = deferred()
    const releaseRename = deferred()
    let delayed = false

    fs.link = (async () => {
      const error = Object.assign(new Error("hard links unsupported"), { code: "EPERM" })
      throw error
    }) as typeof fs.link

    fs.rename = (async (...args: Parameters<typeof fs.rename>) => {
      const to = args[1] as string
      if (!delayed && to === finalPath) {
        delayed = true
        renameStarted.resolve()
        await releaseRename.promise
      }

      return originalRename(...args)
    }) as typeof fs.rename

    try {
      const first = persistImages({
        root: tmp.path,
        messageID: "msg_fallback",
        filename: "poster",
        random: () => "aaaaaaaa",
        images: [{ mime: "image/png", bytes: new Uint8Array([1]) }],
      })

      await renameStarted.promise

      const second = persistImages({
        root: tmp.path,
        messageID: "msg_fallback",
        filename: "poster",
        random: () => "aaaaaaaa",
        images: [{ mime: "image/png", bytes: new Uint8Array([2]) }],
      })

      releaseRename.resolve()
      const [firstResult, secondResult] = await Promise.all([first, second])

      const filenames = [
        requireValue(firstResult[0].filename, "expected first fallback filename"),
        requireValue(secondResult[0].filename, "expected second fallback filename"),
      ].sort()
      expect(filenames).toEqual(["poster-msg_fallback-aaaaaaaa-2.png", "poster-msg_fallback-aaaaaaaa.png"])
      expect((await fs.readdir(dir)).some((entry) => entry.endsWith(".lock") || entry.includes(".tmp-"))).toBe(false)
    } finally {
      fs.link = originalLink
      fs.rename = originalRename
    }
  })

  test("fails loudly when fallback lock cleanup cannot delete the lock file", async () => {
    await using tmp = await tmpdir()
    const originalLink = fs.link
    const originalRm = fs.rm

    fs.link = (async () => {
      const error = Object.assign(new Error("hard links unsupported"), { code: "EPERM" })
      throw error
    }) as typeof fs.link

    fs.rm = (async (...args: Parameters<typeof fs.rm>) => {
      const targetPath = args[0] as string
      if (targetPath.endsWith(".lock")) {
        const error = Object.assign(new Error("lock cleanup failed"), { code: "EBUSY" })
        throw error
      }

      return originalRm(...args)
    }) as typeof fs.rm

    try {
      await expect(
        persistImages({
          root: tmp.path,
          messageID: "msg_lock_cleanup",
          filename: "poster",
          random: () => "aaaaaaaa",
          images: [{ mime: "image/png", bytes: pngBytes }],
        }),
      ).rejects.toThrow(/lock|cleanup/i)
    } finally {
      fs.link = originalLink
      fs.rm = originalRm
    }
  })

  test("still attempts lock deletion when lock handle close throws", async () => {
    await using tmp = await tmpdir()
    const originalLink = fs.link
    const originalOpen = fs.open
    const originalRm = fs.rm
    let lockDeleteAttempts = 0

    fs.link = (async () => {
      const error = Object.assign(new Error("hard links unsupported"), { code: "EPERM" })
      throw error
    }) as typeof fs.link

    fs.open = (async (...args: Parameters<typeof fs.open>) => {
      const filePath = args[0] as string
      const handle = await originalOpen(...args)
      if (!filePath.endsWith(".lock")) {
        return handle
      }

      return new Proxy(handle, {
        get(target, prop, receiver) {
          if (prop === "close") {
            return async (...closeArgs: Parameters<typeof target.close>) => {
              await target.close(...closeArgs)
              throw new Error("lock close failed")
            }
          }

          const value = Reflect.get(target, prop, receiver)
          return typeof value === "function" ? value.bind(target) : value
        },
      })
    }) as typeof fs.open

    fs.rm = (async (...args: Parameters<typeof fs.rm>) => {
      const targetPath = args[0] as string
      if (targetPath.endsWith(".lock")) {
        lockDeleteAttempts += 1
      }

      return originalRm(...args)
    }) as typeof fs.rm

    try {
      await expect(
        persistImages({
          root: tmp.path,
          messageID: "msg_lock_close",
          filename: "poster",
          random: () => "aaaaaaaa",
          images: [{ mime: "image/png", bytes: pngBytes }],
        }),
      ).rejects.toThrow(/lock|close|cleanup/i)

      expect(lockDeleteAttempts).toBe(1)
    } finally {
      fs.link = originalLink
      fs.open = originalOpen
      fs.rm = originalRm
    }
  })

  test("does not delete another writer's fallback lock when lock acquisition loses the race", async () => {
    await using tmp = await tmpdir()
    const winnerFinalPath = filePath(tmp.path, "poster-msg_lock_race-aaaaaaaa.png")
    const winnerLockPath = `${winnerFinalPath}.lock`
    const originalLink = fs.link
    const originalOpen = fs.open
    const originalRename = fs.rename
    const originalRm = fs.rm
    const winnerLockHeld = deferred()
    const loserSawExistingLock = deferred()
    const releaseRename = deferred()
    let winnerReleased = false
    let prematureWinnerLockDeletes = 0
    let lockOpenCount = 0

    fs.link = (async () => {
      const error = Object.assign(new Error("hard links unsupported"), { code: "EPERM" })
      throw error
    }) as typeof fs.link

    fs.open = (async (...args: Parameters<typeof fs.open>) => {
      const filePath = args[0] as string
      if (filePath !== winnerLockPath) {
        return originalOpen(...args)
      }

      lockOpenCount += 1
      if (lockOpenCount === 1) {
        const handle = await originalOpen(...args)
        winnerLockHeld.resolve()
        return handle
      }

      loserSawExistingLock.resolve()
      const error = Object.assign(new Error("lock already exists"), { code: "EEXIST" })
      throw error
    }) as typeof fs.open

    fs.rename = (async (...args: Parameters<typeof fs.rename>) => {
      const to = args[1] as string
      if (!winnerReleased && to === winnerFinalPath) {
        await loserSawExistingLock.promise
        await releaseRename.promise
        winnerReleased = true
      }

      return originalRename(...args)
    }) as typeof fs.rename

    fs.rm = (async (...args: Parameters<typeof fs.rm>) => {
      const targetPath = args[0] as string
      if (targetPath === winnerLockPath && !winnerReleased) {
        prematureWinnerLockDeletes += 1
      }

      return originalRm(...args)
    }) as typeof fs.rm

    try {
      const first = persistImages({
        root: tmp.path,
        messageID: "msg_lock_race",
        filename: "poster",
        random: () => "aaaaaaaa",
        images: [{ mime: "image/png", bytes: new Uint8Array([1]) }],
      })

      await winnerLockHeld.promise

      const second = persistImages({
        root: tmp.path,
        messageID: "msg_lock_race",
        filename: "poster",
        random: () => "aaaaaaaa",
        images: [{ mime: "image/png", bytes: new Uint8Array([2]) }],
      })

      releaseRename.resolve()
      await Promise.all([first, second])

      expect(prematureWinnerLockDeletes).toBe(0)
    } finally {
      fs.link = originalLink
      fs.open = originalOpen
      fs.rename = originalRename
      fs.rm = originalRm
    }
  })

  test("attempts temp cleanup when temp handle close throws", async () => {
    await using tmp = await tmpdir()
    const originalOpen = fs.open
    const originalRm = fs.rm
    let tempDeleteAttempts = 0

    fs.open = (async (...args: Parameters<typeof fs.open>) => {
      const filePath = args[0] as string
      const handle = await originalOpen(...args)
      if (!filePath.includes(".tmp-")) {
        return handle
      }

      return new Proxy(handle, {
        get(target, prop, receiver) {
          if (prop === "close") {
            return async (...closeArgs: Parameters<typeof target.close>) => {
              await target.close(...closeArgs)
              throw new Error("temp close failed")
            }
          }

          const value = Reflect.get(target, prop, receiver)
          return typeof value === "function" ? value.bind(target) : value
        },
      })
    }) as typeof fs.open

    fs.rm = (async (...args: Parameters<typeof fs.rm>) => {
      const targetPath = args[0] as string
      if (targetPath.includes(".tmp-")) {
        tempDeleteAttempts += 1
      }

      return originalRm(...args)
    }) as typeof fs.rm

    try {
      await expect(
        persistImages({
          root: tmp.path,
          messageID: "msg_temp_close",
          random: () => "a1b2c3d4",
          images: [{ mime: "image/png", bytes: pngBytes }],
        }),
      ).rejects.toThrow(/temp|close|cleanup/i)

      expect(tempDeleteAttempts).toBe(1)
    } finally {
      fs.open = originalOpen
      fs.rm = originalRm
    }
  })

  test("propagates non-collision fallback lock open errors instead of retrying as collisions", async () => {
    await using tmp = await tmpdir()
    const originalLink = fs.link
    const originalOpen = fs.open

    fs.link = (async () => {
      const error = Object.assign(new Error("hard links unsupported"), { code: "EPERM" })
      throw error
    }) as typeof fs.link

    fs.open = (async (...args: Parameters<typeof fs.open>) => {
      const filePath = args[0] as string
      if (filePath.endsWith(".lock")) {
        const error = Object.assign(new Error("EACCES lock open failed"), { code: "EACCES" })
        throw error
      }

      return originalOpen(...args)
    }) as typeof fs.open

    try {
      const error = await persistImages({
        root: tmp.path,
        messageID: "msg_lock_open",
        filename: "poster",
        random: () => "aaaaaaaa",
        images: [{ mime: "image/png", bytes: pngBytes }],
      }).catch((error) => error)

      expect(error).toBeInstanceOf(Error)
      expect(error.message).toMatch(/EACCES|lock|fallback/i)
      expect(error.message).not.toContain("Unable to persist generated image")
    } finally {
      fs.link = originalLink
      fs.open = originalOpen
    }
  })

  test("allocates unique filenames for concurrent writes to the same target", async () => {
    await using tmp = await tmpdir()

    const [first, second] = await Promise.all([
      persistImages({
        root: tmp.path,
        messageID: "msg_collision",
        filename: "poster",
        random: () => "aaaaaaaa",
        images: [{ mime: "image/png", bytes: new Uint8Array([1]) }],
      }),
      persistImages({
        root: tmp.path,
        messageID: "msg_collision",
        filename: "poster",
        random: () => "aaaaaaaa",
        images: [{ mime: "image/png", bytes: new Uint8Array([2]) }],
      }),
    ])

    const filenames = [
      requireValue(first[0].filename, "expected first concurrent filename"),
      requireValue(second[0].filename, "expected second concurrent filename"),
    ].sort()
    expect(filenames).toEqual(["poster-msg_collision-aaaaaaaa-2.png", "poster-msg_collision-aaaaaaaa.png"])

    const contents = await Promise.all(
      filenames.map(async (filename) => Array.from(await Bun.file(filePath(tmp.path, filename)).bytes())),
    )
    expect(contents.sort((a, b) => a[0] - b[0])).toEqual([[1], [2]])
  })

  test("rejects generated-images directory symlink or junction escapes before writing files", async () => {
    await using root = await tmpdir()
    await using outside = await tmpdir()
    const opencodeDir = path.join(root.path, ".opencode")
    const generatedImagesDir = path.join(opencodeDir, "generated-images")

    await fs.mkdir(opencodeDir, { recursive: true })
    await fs.symlink(outside.path, generatedImagesDir, process.platform === "win32" ? "junction" : "dir")

    await expect(
      persistImages({
        root: root.path,
        messageID: "msg_escape",
        random: () => "a1b2c3d4",
        images: [{ mime: "image/png", bytes: pngBytes }],
      }),
    ).rejects.toThrow("generated image directory is outside project")

    expect(await fs.readdir(outside.path)).toEqual([])
  })

  test("rejects opencode directory symlink or junction escapes before creating generated-images", async () => {
    await using root = await tmpdir()
    await using outside = await tmpdir()
    const opencodeDir = path.join(root.path, ".opencode")

    await fs.symlink(outside.path, opencodeDir, process.platform === "win32" ? "junction" : "dir")

    await expect(
      persistImages({
        root: root.path,
        messageID: "msg_escape_parent",
        random: () => "d4c3b2a1",
        images: [{ mime: "image/png", bytes: pngBytes }],
      }),
    ).rejects.toThrow("generated image directory is outside project")

    expect(await fs.readdir(outside.path)).toEqual([])
  })

  test("rejects broken generated-images symlink or junction before creating files", async () => {
    await using root = await tmpdir()
    await using outside = await tmpdir()
    const opencodeDir = path.join(root.path, ".opencode")
    const generatedImagesDir = path.join(opencodeDir, "generated-images")

    await fs.mkdir(opencodeDir, { recursive: true })
    await fs.symlink(outside.path, generatedImagesDir, process.platform === "win32" ? "junction" : "dir")
    await fs.rm(outside.path, { recursive: true, force: true })

    await expect(
      persistImages({
        root: root.path,
        messageID: "msg_broken_escape",
        random: () => "b1b2b3b4",
        images: [{ mime: "image/png", bytes: pngBytes }],
      }),
    ).rejects.toThrow("generated image directory is outside project")

    expect(await Bun.file(path.join(outside.path, "generated-image-msg_broken_escape-1-b1b2b3b4.png")).exists()).toBe(
      false,
    )
  })

  test("rejects broken opencode symlink or junction before creating generated-images", async () => {
    await using root = await tmpdir()
    await using outside = await tmpdir()
    const opencodeDir = path.join(root.path, ".opencode")

    await fs.symlink(outside.path, opencodeDir, process.platform === "win32" ? "junction" : "dir")
    await fs.rm(outside.path, { recursive: true, force: true })

    await expect(
      persistImages({
        root: root.path,
        messageID: "msg_broken_parent_escape",
        random: () => "b4b3b2b1",
        images: [{ mime: "image/png", bytes: pngBytes }],
      }),
    ).rejects.toThrow("generated image directory is outside project")

    expect(await Bun.file(path.join(outside.path, "generated-images")).exists()).toBe(false)
  })
})

describe("generate_image tool", () => {
  it.live("rejects generate action images before provider call", () =>
    Effect.gen(function* () {
      let called = false
      using server = Bun.serve({
        port: 0,
        fetch: () => {
          called = true
          return Response.json({ data: [] })
        },
      })

      const tool = yield* initTool(providerLayer(String(server.url)))
      const exit = yield* tool
        .execute(
          {
            prompt: "draw a cat",
            provider: "openai",
            model: "gpt-image-2",
            images: ["data:image/png;base64,aaa="],
          },
          {
            ...toolCtx,
            ask: () => Effect.void,
          },
        )
        .pipe(Effect.exit)

      expect(squashedMessage(exit)).toBe("images can only be used with edit action")
      expect(called).toBe(false)
    }),
  )

  it.live("treats empty generate helper fields as omitted", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          let body = ""
          using server = Bun.serve({
            port: 0,
            fetch: async (request) => {
              body = await request.text()
              return Response.json({ data: [{ b64_json: pngBase64 }] })
            },
          })

          const tool = yield* initTool(providerLayer(String(server.url)))
          const result = yield* tool.execute(
            {
              action: "generate",
              prompt: "draw",
              provider: "",
              model: "",
              images: [],
              mask: "",
            },
            {
              ...toolCtx,
              ask: () => Effect.void,
            },
          )

          expect(JSON.parse(body)).toEqual({
            model: "gpt-image-2",
            prompt: "draw",
            size: "auto",
            quality: "high",
            output_format: "png",
            n: 1,
          })
          expect(result.output).toBe("已生成 1 张图片：")
          expect(result.attachments).toHaveLength(1)
        }),
      { config: { image_model: "openai/gpt-image-2" } },
    ),
  )

  it.live("still rejects non-empty generate masks", () =>
    Effect.gen(function* () {
      using server = Bun.serve({
        port: 0,
        fetch: () => Response.json({ data: [] }),
      })

      const tool = yield* initTool(providerLayer(String(server.url)))
      const exit = yield* tool
        .execute(
          {
            action: "generate",
            prompt: "draw",
            mask: "image.png",
          },
          {
            ...toolCtx,
            ask: () => Effect.void,
          },
        )
        .pipe(Effect.exit)

      expect(squashedMessage(exit)).toBe("mask can only be used with edit action")
    }),
  )

  it.live("requires images for edit action", () =>
    Effect.gen(function* () {
      using server = Bun.serve({
        port: 0,
        fetch: () => Response.json({ data: [] }),
      })

      const tool = yield* initTool(providerLayer(String(server.url)))
      const exit = yield* tool
        .execute(
          {
            action: "edit",
            prompt: "draw",
          },
          {
            ...toolCtx,
            ask: () => Effect.void,
          },
        )
        .pipe(Effect.exit)

      expect(squashedMessage(exit)).toBe("images are required for edit action")
    }),
  )

  it.live("requires images for edit action even when images is an empty array", () =>
    Effect.gen(function* () {
      using server = Bun.serve({
        port: 0,
        fetch: () => Response.json({ data: [] }),
      })

      const tool = yield* initTool(providerLayer(String(server.url)))
      const exit = yield* tool
        .execute(
          {
            action: "edit",
            prompt: "edit",
            images: [],
          },
          {
            ...toolCtx,
            ask: () => Effect.void,
          },
        )
        .pipe(Effect.exit)

      expect(squashedMessage(exit)).toBe("images are required for edit action")
    }),
  )

  it.live("rejects empty-string edit image inputs clearly", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const tool = yield* initTool(providerLayer("https://example.com"))
        const exit = yield* tool
          .execute(
            {
              action: "edit",
              prompt: "edit",
              provider: "openai",
              model: "gpt-image-2",
              images: [""],
            },
            {
              ...toolCtx,
              ask: () => Effect.void,
            },
          )
          .pipe(Effect.exit)

        expect(squashedMessage(exit)).toBe("image input cannot be empty")
      }),
    ),
  )

  it.live("asks permission before reading edit image paths", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const tool = yield* initTool(providerLayer("https://example.com"))
        const exit = yield* tool
          .execute(
            {
              action: "edit",
              prompt: "edit",
              provider: "openai",
              model: "gpt-image-2",
              images: ["missing.png"],
            },
            {
              ...toolCtx,
              ask: () => Effect.die(new Error("denied")),
            },
          )
          .pipe(Effect.exit)

        expect(squashedMessage(exit)).toBe("denied")
      }),
    ),
  )

  it.live("asks permission before reading edit mask paths", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const tool = yield* initTool(providerLayer("https://example.com"))
        const asks: unknown[] = []
        const exit = yield* tool
          .execute(
            {
              action: "edit",
              prompt: "edit",
              provider: "openai",
              model: "gpt-image-2",
              images: [`data:image/png;base64,${pngBase64}`],
              mask: "missing-mask.png",
            },
            {
              ...toolCtx,
              ask: (req) =>
                Effect.sync(() => {
                  asks.push(req)
                  throw new Error("denied")
                }),
            },
          )
          .pipe(Effect.exit)

        expect(asks).toEqual([
          {
            permission: "generate_image",
            patterns: ["openai/gpt-image-2"],
            always: ["*"],
            metadata: {
              provider: "openai",
              model: "gpt-image-2",
              action: "edit",
              n: 1,
              size: "auto",
              quality: "high",
              format: "png",
              filename: undefined,
              images: {
                count: 1,
                inputs: [`data:image/png;base64,${pngBase64}`],
              },
              mask: "missing-mask.png",
            },
          },
        ])
        expect(squashedMessage(exit)).toBe("denied")
      }),
    ),
  )

  it.live("rejects edit actions with more than 10 images", () =>
    Effect.gen(function* () {
      using server = Bun.serve({
        port: 0,
        fetch: () => Response.json({ data: [] }),
      })

      const tool = yield* initTool(providerLayer(String(server.url)))
      const exit = yield* tool
        .execute(
          {
            action: "edit",
            prompt: "draw",
            images: Array.from({ length: 11 }, () => `data:image/png;base64,${pngBase64}`),
          },
          {
            ...toolCtx,
            ask: () => Effect.void,
          },
        )
        .pipe(Effect.exit)

      expect(squashedMessage(exit)).toBe("edit action supports at most 10 images")
    }),
  )

  it.live("rejects edit masks whose mime does not match images", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          using server = Bun.serve({
            port: 0,
            fetch: () => Response.json({ data: [] }),
          })

          const tool = yield* initTool(providerLayer(String(server.url)))
          const exit = yield* tool
            .execute(
              {
                action: "edit",
                prompt: "draw",
                images: [`data:image/png;base64,${pngBase64}`],
                mask: `data:image/jpeg;base64,${jpegBase64}`,
              },
              {
                ...toolCtx,
                ask: () => Effect.void,
              },
            )
            .pipe(Effect.exit)

          expect(squashedMessage(exit)).toBe("mask mime must match all edit images")
        }),
      {
        config: {
          image_model: "openai/gpt-image-2",
        },
      },
    ),
  )

  it.live("fails when the provider returns an empty image list", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          using server = Bun.serve({
            port: 0,
            fetch: () => Response.json({ data: [] }),
          })

          const tool = yield* initTool(providerLayer(String(server.url)))
          const exit = yield* tool
            .execute(
              {
                action: "generate",
                prompt: "draw",
              },
              {
                ...toolCtx,
                ask: () => Effect.void,
              },
            )
            .pipe(Effect.exit)

          expect(squashedMessage(exit)).toBe("No image data returned from image provider")
        }),
      {
        config: {
          image_model: "openai/gpt-image-2",
        },
      },
    ),
  )

  it.live("requests generate_image permission and persists generated attachment", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          let requestBody: Record<string, unknown> | undefined
          const asks: unknown[] = []
          const worktree = (yield* InstanceState.context).worktree

          using server = Bun.serve({
            port: 0,
            fetch: async (req) => {
              requestBody = await req.json()
              return Response.json({
                data: [
                  {
                    b64_json: Buffer.from(pngBytes).toString("base64"),
                  },
                ],
              })
            },
          })

          const tool = yield* initTool(providerLayer(String(server.url)))
          const result = yield* tool.execute(
            {
              prompt: "draw a cat",
            },
            {
              ...toolCtx,
              messageID: MessageID.make("msg_generate-image"),
              ask: (req) =>
                Effect.sync(() => {
                  asks.push(req)
                }),
            },
          )

          expect(asks).toEqual([
            {
              permission: "generate_image",
              patterns: ["openai/gpt-image-2"],
              always: ["*"],
              metadata: {
                provider: "openai",
                model: "gpt-image-2",
                action: "generate",
                n: 1,
                size: "auto",
                quality: "high",
                format: "png",
                filename: undefined,
                images: {
                  count: 0,
                  inputs: [],
                },
                mask: undefined,
              },
            },
          ])
          expect(requestBody).toEqual({
            model: "gpt-image-2",
            prompt: "draw a cat",
            size: "auto",
            quality: "high",
            output_format: "png",
            n: 1,
          })
          expect(result.title).toBe("generate_image")
          expect(result.output).toBe("已生成 1 张图片：")
          expect(result.metadata).toMatchObject({
            provider: "openai",
            model: "gpt-image-2",
            action: "generate",
            count: 1,
            n: 1,
            size: "auto",
            quality: "high",
            format: "png",
            filename: undefined,
            images: {
              count: 0,
              inputs: [],
            },
            mask: undefined,
          })
          const attachments = requireValue(result.attachments, "expected generated attachments")
          expect(attachments).toHaveLength(1)
          const attachment = attachments[0]
          if (!attachment) {
            throw new Error("expected first generated attachment")
          }
          expect(result.metadata.count).toBe(attachments.length)
          expect(attachment.type).toBe("file")
          expect(attachment.mime).toBe("image/png")
          expect(attachment.filename).toEqual(expect.stringMatching(/^generated-image-msg_generate-image-1-/))
          expect(attachment.relativePath).toEqual(expect.stringMatching(/^\.opencode\/generated-images\//))
          expect(yield* Effect.promise(() => Bun.file(path.join(worktree, attachment.relativePath)).bytes())).toEqual(pngBytes)
        }),
      {
        config: {
          image_model: "openai/gpt-image-2",
        },
      },
    ),
  )

  it.live("auto-allows generate_image when permission config is allow", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          using server = Bun.serve({
            port: 0,
            fetch: () =>
              Response.json({
                data: [
                  {
                    b64_json: Buffer.from(pngBytes).toString("base64"),
                  },
                ],
              }),
          })

          const permission = yield* Permission.Service
          const config = yield* Config.Service
          const ruleset = Permission.fromConfig((yield* config.get()).permission ?? {})
          const tool = yield* initTool(providerLayer(String(server.url)))
          const result = yield* tool.execute(
            { prompt: "draw a cat" },
            {
              ...toolCtx,
              ask: (req) =>
                permission
                  .ask(
                    buildToolPermissionAsk({
                      req,
                      sessionID: toolCtx.sessionID,
                      messageID: toolCtx.messageID,
                      callID: toolCtx.callID,
                      ruleset,
                    }),
                  )
                  .pipe(Effect.orDie),
            },
          )

          expect(yield* permission.list()).toEqual([])
          expect(result.attachments).toHaveLength(1)
        }),
      {
        config: {
          image_model: "openai/gpt-image-2",
          permission: { generate_image: "allow" },
        },
      },
    ),
  )

  it.live("accepts readonly edit image inputs without mutating the caller array", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          let imageFieldNames: string[] = []
          const readonlyImages = Object.freeze([`data:image/png;base64,${pngBase64}`] as string[])

          using server = Bun.serve({
            port: 0,
            fetch: async (request) => {
              const form = await request.formData()
              imageFieldNames = form.getAll("image[]").map((value) => {
                if (value instanceof File) {
                  return value.name
                }
                return String(value)
              })

              return Response.json({
                data: [
                  {
                    b64_json: Buffer.from(pngBytes).toString("base64"),
                  },
                ],
              })
            },
          })

          const tool = yield* initTool(providerLayer(String(server.url)))
          const result = yield* tool.execute(
            {
              action: "edit",
              prompt: "make the image darker",
              provider: "openai",
              model: "gpt-image-2",
              images: readonlyImages as unknown as string[],
            },
            {
              ...toolCtx,
              messageID: MessageID.make("msg_readonly-edit-image"),
              ask: () => Effect.void,
            },
          )

          expect(readonlyImages).toEqual([`data:image/png;base64,${pngBase64}`])
          expect(imageFieldNames).toEqual(["image.png"])
          expect(result.output).toBe("已生成 1 张图片：")
          expect(result.attachments).toHaveLength(1)
        }),
      {
        config: {
          image_model: "openai/gpt-image-2",
        },
      },
    ),
  )
})
