import { expect, test } from "bun:test"
import { installs, targets } from "../../script/targets"

test("targets excludes linux entries from --exclude-os", () => {
  const result = targets(["--exclude-os=linux"])
  expect(result.length).toBe(6)
  expect(result.every((item) => item.os !== "linux")).toBe(true)
})

test("targets returns the complete default build matrix", () => {
  expect(targets([])).toEqual([
    { os: "linux", arch: "arm64" },
    { os: "linux", arch: "x64" },
    { os: "linux", arch: "x64", avx2: false },
    { os: "linux", arch: "arm64", abi: "musl" },
    { os: "linux", arch: "x64", abi: "musl" },
    { os: "linux", arch: "x64", abi: "musl", avx2: false },
    { os: "darwin", arch: "arm64" },
    { os: "darwin", arch: "x64" },
    { os: "darwin", arch: "x64", avx2: false },
    { os: "win32", arch: "arm64" },
    { os: "win32", arch: "x64" },
    { os: "win32", arch: "x64", avx2: false },
  ])
})

test("targets keeps single-mode baseline behavior", () => {
  const base = targets(["--single"], "win32", "x64")
  expect(base.length).toBe(1)
  expect(base[0].avx2).toBeUndefined()

  const full = targets(["--single", "--baseline"], "win32", "x64")
  expect(full.length).toBe(2)
})

test("targets includes only the optimized darwin x64 target", () => {
  expect(targets(["--include-target=darwin-x64"])).toEqual([{ os: "darwin", arch: "x64" }])
})

test("targets includes the optimized win32 arm64 target", () => {
  expect(targets(["--include-target=win32-arm64"])).toEqual([{ os: "win32", arch: "arm64" }])
})

test("targets resolves single mode on win32 arm64", () => {
  expect(targets(["--single"], "win32", "arm64")).toEqual([{ os: "win32", arch: "arm64" }])
})

test("installs deduplicates os/cpu pairs from targets", () => {
  const list = targets([])
  const result = installs(list)
  expect(result).toEqual([
    { os: "linux", arch: "arm64" },
    { os: "linux", arch: "x64" },
    { os: "darwin", arch: "arm64" },
    { os: "darwin", arch: "x64" },
    { os: "win32", arch: "arm64" },
    { os: "win32", arch: "x64" },
  ])
})

test("build uses the shared target parser and install list", async () => {
  const source = await Bun.file(new URL("../../script/build.ts", import.meta.url)).text()

  expect(source).toContain('import { installs, targets } from "./targets"')
  expect(source).toContain("targets(process.argv)")
  expect(source).toContain("installs(targetList)")
  expect(source).not.toContain("const allTargets")
})
