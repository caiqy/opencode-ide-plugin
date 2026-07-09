import { expect, test } from "bun:test"

test("preload only initializes global test environment", async () => {
  const source = await Bun.file(new URL("../preload.ts", import.meta.url)).text()

  expect(source).toContain('process.env["XDG_DATA_HOME"]')
  expect(source).toContain('process.env["OPENCODE_TEST_HOME"]')
  expect(source).toContain('process.env["OPENCODE_TEST_MANAGED_CONFIG_DIR"]')
  expect(source).not.toContain("fsSync.rmSync")
  expect(source).toContain("AppRuntime.dispose")
  expect(source).toContain("fs.rm(dir")
  expect(source).toContain("EBUSY")
  expect(source).not.toContain("spawn(")
})

test("preload disposes app runtime before cleanup", async () => {
  const source = await Bun.file(new URL("../preload.ts", import.meta.url)).text()

  expect(source).toContain('await import("../src/effect/app-runtime")')
  expect(source).toContain("AppRuntime.dispose()")
  expect(source.indexOf("AppRuntime.dispose()")).toBeLessThan(source.indexOf("fs.rm(dir"))
})

test("cleanup helper stays decoupled from storage runtime", async () => {
  const source = await Bun.file(new URL("./cleanup.ts", import.meta.url)).text()

  expect(source).not.toContain("storage/db")
  expect(source).not.toContain("Database.close")
})
