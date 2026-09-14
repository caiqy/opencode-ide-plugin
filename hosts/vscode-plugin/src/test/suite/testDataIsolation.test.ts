import * as assert from "assert"
import * as os from "os"
import * as path from "path"

const isolated = ["XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_STATE_HOME"] as const

suite("Test data isolation", () => {
  test("后端全局目录被隔离到临时目录", () => {
    for (const name of isolated) {
      const value = process.env[name]
      assert.ok(value, `${name} should be set by the test harness`)

      const relative = path.relative(os.tmpdir(), value!)
      assert.ok(
        relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative),
        `${name} should live under the temp directory, got ${value}`,
      )
    }

    const dataHome = process.env.XDG_DATA_HOME!
    assert.ok(
      path.basename(path.relative(os.tmpdir(), dataHome)).startsWith("opencode-vscode-test-data-"),
      `XDG_DATA_HOME should use the isolated test data directory, got ${dataHome}`,
    )
  })
})
