import { expect, test } from "bun:test"
import { installs, targets } from "../../script/targets"

test("targets excludes linux entries from --exclude-os", () => {
  const result = targets(["--exclude-os=linux"])
  expect(result.length).toBe(5)
  expect(result.every((item) => item.os !== "linux")).toBe(true)
})

test("targets keeps single-mode baseline behavior", () => {
  const base = targets(["--single"], "win32", "x64")
  expect(base.length).toBe(1)
  expect(base[0].avx2).toBeUndefined()

  const full = targets(["--single", "--baseline"], "win32", "x64")
  expect(full.length).toBe(2)
})

test("installs deduplicates os/cpu pairs from targets", () => {
  const list = targets([])
  const result = installs(list)
  expect(result).toEqual([
    { os: "linux", arch: "arm64" },
    { os: "linux", arch: "x64" },
    { os: "darwin", arch: "arm64" },
    { os: "darwin", arch: "x64" },
    { os: "win32", arch: "x64" },
  ])
})
