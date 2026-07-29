import { $ } from "bun"
import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import { registerDisposer } from "../../src/effect/instance-registry"
import { tmpdir } from "./fixture"

describe("tmpdir", () => {
  test("disables fsmonitor for git fixtures", async () => {
    await using tmp = await tmpdir({ git: true })

    const value = (await $`git config core.fsmonitor`.cwd(tmp.path).quiet().text()).trim()
    expect(value).toBe("false")
  })

  test("removes directories on dispose", async () => {
    const tmp = await tmpdir({ git: true })
    const dir = tmp.path

    await tmp[Symbol.asyncDispose]()

    const exists = await fs
      .stat(dir)
      .then(() => true)
      .catch(() => false)
    expect(exists).toBe(false)
  })

  test("disposes instance state before removing directories", async () => {
    const tmp = await tmpdir()
    let existed = false
    const off = registerDisposer(async (directory) => {
      if (directory !== tmp.path) return
      existed = await fs
        .stat(directory)
        .then(() => true)
        .catch(() => false)
    })

    try {
      await tmp[Symbol.asyncDispose]()
    } finally {
      off()
    }

    expect(existed).toBe(true)
  })
})
