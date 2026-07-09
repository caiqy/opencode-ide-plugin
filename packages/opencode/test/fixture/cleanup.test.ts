import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { cleanupTestDir } from "./cleanup"
import { tmpdir } from "./fixture"

const exists = (file: string) =>
  fs
    .stat(file)
    .then(() => true)
    .catch(() => false)

test("cleanup helper stays focused on directory cleanup", async () => {
  const source = await Bun.file(new URL("./cleanup.ts", import.meta.url)).text()

  expect(source).not.toContain("storage/db")
  expect(source).not.toContain("cleanupTestRuntime")
})

test("cleanupTestDir retries on win32 EBUSY and succeeds", async () => {
  const calls: string[] = []
  const opts = {
    platform: "win32" as const,
    rm: async () => {
      calls.push("rm")
      if (calls.length > 1) return
      const err = new Error("busy") as NodeJS.ErrnoException
      err.code = "EBUSY"
      throw err
    },
    sleep: async () => {
      calls.push("sleep")
    },
    gc: (full: boolean) => {
      calls.push(full ? "gc" : "gc:false")
    },
  }

  await cleanupTestDir("C:\\tmp\\case", opts)

  expect(calls).toEqual(["rm", "gc", "sleep", "rm"])
})

test("cleanupTestDir removes nested sqlite sidecars before deleting", async () => {
  await using tmp = await tmpdir()
  const child = path.join(tmp.path, "nested")
  const wal = path.join(child, "state.db-wal")
  const shm = path.join(child, "state.db-shm")
  await fs.mkdir(child)
  await Bun.write(wal, "wal")
  await Bun.write(shm, "shm")
  const calls: boolean[][] = []

  await cleanupTestDir(tmp.path, {
    rm: async (dir, opts) => {
      calls.push([await exists(wal), await exists(shm)])
      await fs.rm(dir, opts)
    },
  })

  expect(calls).toEqual([[false, false]])
})

test("tmpdir asyncDispose removes directory through cleanup helper", async () => {
  const tmp = await tmpdir()
  const file = path.join(tmp.path, "keep.txt")
  await Bun.write(file, "x")

  await tmp[Symbol.asyncDispose]()

  expect(await exists(tmp.path)).toBe(false)
})

test("tmpdir cleanup removes sqlite wal workspace", async () => {
  let dir = ""
  let file = ""

  await (async () => {
    await using tmp = await tmpdir()
    dir = tmp.path
    file = path.join(tmp.path, "state.sqlite")
    const db = new Database(file)

    db.exec("PRAGMA journal_mode = WAL")
    db.exec("CREATE TABLE item (id INTEGER PRIMARY KEY, value TEXT)")
    db.exec("INSERT INTO item (value) VALUES ('x')")
    db.close()

    expect(await exists(file)).toBe(true)
  })()

  expect(await exists(dir)).toBe(false)
  expect(await exists(file)).toBe(false)
})

test("cleanupTestDir skips retry path on non-win32", async () => {
  const calls: string[] = []
  const err = new Error("busy") as NodeJS.ErrnoException
  err.code = "EBUSY"

  await expect(
    cleanupTestDir("/tmp/case", {
      platform: "linux",
      rm: async () => {
        calls.push("rm")
        throw err
      },
      sleep: async () => {
        calls.push("sleep")
      },
      gc: (full: boolean) => {
        calls.push(full ? "gc" : "gc:false")
      },
    }),
  ).rejects.toBe(err)

  expect(calls).toEqual(["rm"])
})
