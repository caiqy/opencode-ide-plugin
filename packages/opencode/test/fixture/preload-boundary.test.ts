import { expect, test } from "bun:test"

test("preload only initializes global test environment", async () => {
  const source = await Bun.file(new URL("../preload.ts", import.meta.url)).text()

  expect(source).toContain('process.env["XDG_DATA_HOME"]')
  expect(source).toContain('process.env["OPENCODE_TEST_HOME"]')
  expect(source).toContain('process.env["OPENCODE_TEST_MANAGED_CONFIG_DIR"]')
  expect(source).not.toContain("fsSync.rmSync")
  expect(source).not.toContain("fs.rm(")
  expect(source).not.toContain("EBUSY")
  expect(source).toContain("Database.close")
  expect(source).toContain("cleanupTestDir(")
  expect(source).not.toContain("cleanupTestRuntime(")
  expect(source).not.toContain("spawn(")
})

test("cleanup helper stays decoupled from storage runtime", async () => {
  const source = await Bun.file(new URL("./cleanup.ts", import.meta.url)).text()

  expect(source).not.toContain("storage/db")
  expect(source).not.toContain("Database.close")
})
