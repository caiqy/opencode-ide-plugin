import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

const pngBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+tmKsAAAAASUVORK5CYII=",
  "base64",
)

function request(directory: string, imagePath: string) {
  const url = new URL("http://localhost/generated-image")
  url.searchParams.set("path", imagePath)

  return Server.createApp({}).request(url, {
    headers: {
      "x-opencode-directory": directory,
    },
  })
}

function requestViaApp(directory: string, imagePath: string) {
  const url = new URL("http://localhost/app/generated-image")
  url.searchParams.set("path", imagePath)

  return Server.createApp({}).request(url, {
    headers: {
      "x-opencode-directory": directory,
    },
  })
}

async function requestViaListener(
  listener: { url: URL },
  directory: string,
  imagePath: string,
  route = "/generated-image",
) {
  const url = new URL(route, listener.url)
  url.searchParams.set("path", imagePath)

  return fetch(url, {
    headers: {
      "x-opencode-directory": directory,
    },
  })
}

afterEach(async () => {
  await Instance.disposeAll()
  await resetDatabase()
})

describe("generated image route", () => {
  test("serves generated images from the project directory", async () => {
    await using tmp = await tmpdir({ git: true })
    const relativePath = ".opencode/generated-images/generated-image-msg_123-1.png"
    const absolutePath = path.join(tmp.path, ".opencode", "generated-images", "generated-image-msg_123-1.png")

    await fs.mkdir(path.dirname(absolutePath), { recursive: true })
    await Bun.write(absolutePath, pngBytes)

    const response = await request(tmp.path, relativePath)

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("image/png")
    expect(Buffer.from(await response.arrayBuffer())).toEqual(pngBytes)
  })

  test("serves generated images through the /app base path without SPA fallback", async () => {
    await using tmp = await tmpdir({ git: true })
    const relativePath = ".opencode/generated-images/generated-image-msg_123-1.png"
    const absolutePath = path.join(tmp.path, ".opencode", "generated-images", "generated-image-msg_123-1.png")

    await fs.mkdir(path.dirname(absolutePath), { recursive: true })
    await Bun.write(absolutePath, pngBytes)

    const response = await requestViaApp(tmp.path, relativePath)

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("image/png")
    expect(Buffer.from(await response.arrayBuffer())).toEqual(pngBytes)
  })

  test("serves generated images through Server.listen on /generated-image", async () => {
    await using tmp = await tmpdir({ git: true })
    const relativePath = ".opencode/generated-images/generated-image-msg_123-1.png"
    const absolutePath = path.join(tmp.path, ".opencode", "generated-images", "generated-image-msg_123-1.png")

    await fs.mkdir(path.dirname(absolutePath), { recursive: true })
    await Bun.write(absolutePath, pngBytes)

    const listener = await Server.listen({ hostname: "127.0.0.1", port: 0 })
    try {
      const response = await requestViaListener(listener, tmp.path, relativePath)

      if (response.status !== 200) throw new Error(await response.text())
      expect(response.status).toBe(200)
      expect(response.headers.get("content-type")).toContain("image/png")
      expect(Buffer.from(await response.arrayBuffer())).toEqual(pngBytes)
    } finally {
      await listener.stop(true)
    }
  })

  test("serves generated images through Server.listen on /app/generated-image", async () => {
    await using tmp = await tmpdir({ git: true })
    const relativePath = ".opencode/generated-images/generated-image-msg_123-1.png"
    const absolutePath = path.join(tmp.path, ".opencode", "generated-images", "generated-image-msg_123-1.png")

    await fs.mkdir(path.dirname(absolutePath), { recursive: true })
    await Bun.write(absolutePath, pngBytes)

    const listener = await Server.listen({ hostname: "127.0.0.1", port: 0 })
    try {
      const response = await requestViaListener(listener, tmp.path, relativePath, "/app/generated-image")

      if (response.status !== 200) throw new Error(await response.text())
      expect(response.status).toBe(200)
      expect(response.headers.get("content-type")).toContain("image/png")
      expect(Buffer.from(await response.arrayBuffer())).toEqual(pngBytes)
    } finally {
      await listener.stop(true)
    }
  })

  test("serves generated images from the worktree root when instance directory is a project subdirectory", async () => {
    await using tmp = await tmpdir({ git: true })
    const instanceDir = path.join(tmp.path, "packages", "feature")
    const relativePath = ".opencode/generated-images/generated-image-msg_123-1.png"
    const absolutePath = path.join(tmp.path, ".opencode", "generated-images", "generated-image-msg_123-1.png")

    await fs.mkdir(instanceDir, { recursive: true })
    await fs.mkdir(path.dirname(absolutePath), { recursive: true })
    await Bun.write(absolutePath, pngBytes)

    const response = await request(instanceDir, relativePath)

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("image/png")
    expect(Buffer.from(await response.arrayBuffer())).toEqual(pngBytes)
  })

  test("serves generated images from the current directory for non-git projects", async () => {
    await using tmp = await tmpdir()
    const relativePath = ".opencode/generated-images/generated-image-msg_plain-1.png"
    const absolutePath = path.join(tmp.path, ".opencode", "generated-images", "generated-image-msg_plain-1.png")

    await fs.mkdir(path.dirname(absolutePath), { recursive: true })
    await Bun.write(absolutePath, pngBytes)

    const response = await request(tmp.path, relativePath)

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("image/png")
    expect(Buffer.from(await response.arrayBuffer())).toEqual(pngBytes)
  })

  test("returns 404 when the generated image does not exist", async () => {
    await using tmp = await tmpdir({ git: true })

    const response = await request(tmp.path, ".opencode/generated-images/missing.png")

    expect(response.status).toBe(404)
  })

  test("rejects non-image files inside generated-images", async () => {
    await using tmp = await tmpdir({ git: true })
    const relativePath = ".opencode/generated-images/generated-image-msg_123-1.txt"
    const absolutePath = path.join(tmp.path, ".opencode", "generated-images", "generated-image-msg_123-1.txt")

    await fs.mkdir(path.dirname(absolutePath), { recursive: true })
    await Bun.write(absolutePath, "not an image")

    const response = await request(tmp.path, relativePath)

    expect(response.status).toBe(403)
  })

  test("rejects files whose extension looks like an image but content is not an image", async () => {
    await using tmp = await tmpdir({ git: true })
    const relativePath = ".opencode/generated-images/generated-image-msg_123-1.png"
    const absolutePath = path.join(tmp.path, ".opencode", "generated-images", "generated-image-msg_123-1.png")

    await fs.mkdir(path.dirname(absolutePath), { recursive: true })
    await Bun.write(absolutePath, "not an image")

    const response = await request(tmp.path, relativePath)

    expect(response.status).toBe(403)
  })

  test("rejects paths outside the generated-images directory", async () => {
    await using tmp = await tmpdir({ git: true })
    const escapedPath = path.join(tmp.path, ".opencode", "secrets.png")
    const wrongPrefixPath = path.join(tmp.path, ".opencode", "other", "secret.png")

    await fs.mkdir(path.dirname(wrongPrefixPath), { recursive: true })
    await Bun.write(escapedPath, pngBytes)
    await Bun.write(wrongPrefixPath, pngBytes)

    const [escaped, wrongPrefix] = await Promise.all([
      request(tmp.path, ".opencode/generated-images/../secrets.png"),
      request(tmp.path, ".opencode/other/secret.png"),
    ])

    expect([403, 404]).toContain(escaped.status)
    expect([403, 404]).toContain(wrongPrefix.status)
    expect(escaped.status).not.toBe(200)
    expect(wrongPrefix.status).not.toBe(200)
  })

  test("rejects paths that escape via realpath through a symlink or junction", async () => {
    await using tmp = await tmpdir({ git: true })
    const generatedImagesDir = path.join(tmp.path, ".opencode", "generated-images")
    const outsideDir = path.join(tmp.path, "outside-generated-images")
    const linkPath = path.join(generatedImagesDir, "escape")

    await fs.mkdir(generatedImagesDir, { recursive: true })
    await fs.mkdir(outsideDir, { recursive: true })
    await Bun.write(path.join(outsideDir, "leak.png"), pngBytes)
    await fs.symlink(outsideDir, linkPath, process.platform === "win32" ? "junction" : "dir")

    const response = await request(tmp.path, ".opencode/generated-images/escape/leak.png")

    expect(response.status).toBe(403)
  })

  test("does not read file bytes before rejecting a realpath escape", async () => {
    await using tmp = await tmpdir({ git: true })
    const generatedImagesDir = path.join(tmp.path, ".opencode", "generated-images")
    const outsideDir = path.join(tmp.path, "outside-generated-images")
    const linkPath = path.join(generatedImagesDir, "escape")
    const originalFile = Bun.file

    await fs.mkdir(generatedImagesDir, { recursive: true })
    await fs.mkdir(outsideDir, { recursive: true })
    await Bun.write(path.join(outsideDir, "leak.png"), pngBytes)
    await fs.symlink(outsideDir, linkPath, process.platform === "win32" ? "junction" : "dir")

    Bun.file = ((target: unknown) => {
      const file = originalFile(target as never)
      return {
        ...file,
        exists: () => Promise.resolve(true),
        bytes: async () => {
          throw new Error("bytes should not be read before boundary checks")
        },
      }
    }) as typeof Bun.file

    try {
      const response = await request(tmp.path, ".opencode/generated-images/escape/leak.png")
      expect(response.status).toBe(403)
    } finally {
      Bun.file = originalFile
    }
  })

  test("does not call exists before rejecting a realpath escape", async () => {
    await using tmp = await tmpdir({ git: true })
    const generatedImagesDir = path.join(tmp.path, ".opencode", "generated-images")
    const outsideDir = path.join(tmp.path, "outside-generated-images")
    const linkPath = path.join(generatedImagesDir, "escape")
    const originalFile = Bun.file

    await fs.mkdir(generatedImagesDir, { recursive: true })
    await fs.mkdir(outsideDir, { recursive: true })
    await Bun.write(path.join(outsideDir, "leak.png"), pngBytes)
    await fs.symlink(outsideDir, linkPath, process.platform === "win32" ? "junction" : "dir")

    Bun.file = ((target: unknown) => {
      const file = originalFile(target as never)
      return {
        ...file,
        exists: async () => {
          throw new Error("exists should not be checked before boundary checks")
        },
      }
    }) as typeof Bun.file

    try {
      const response = await request(tmp.path, ".opencode/generated-images/escape/leak.png")
      expect(response.status).toBe(403)
    } finally {
      Bun.file = originalFile
    }
  })

  test("rejects images when generated-images root itself is a junction to outside the project", async () => {
    await using tmp = await tmpdir({ git: true })
    await using outside = await tmpdir()
    const opencodeDir = path.join(tmp.path, ".opencode")
    const generatedImagesDir = path.join(opencodeDir, "generated-images")

    await fs.mkdir(opencodeDir, { recursive: true })
    await Bun.write(path.join(outside.path, "generated-image-msg_123-1.png"), pngBytes)
    await fs.symlink(outside.path, generatedImagesDir, process.platform === "win32" ? "junction" : "dir")

    const response = await request(tmp.path, ".opencode/generated-images/generated-image-msg_123-1.png")

    expect(response.status).toBe(403)
  })
})
