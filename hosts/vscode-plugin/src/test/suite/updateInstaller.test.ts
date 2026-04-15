import * as assert from "assert"
import * as os from "os"
import * as path from "path"
import { promises as fs } from "fs"
import { UpdateInstaller } from "../../update/UpdateInstaller"

suite("UpdateInstaller Test Suite", () => {
  test("会下载 VSIX 并调用 installExtension", async () => {
    const calls: unknown[][] = []
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-update-installer-test-"))

    try {
      const installer = new UpdateInstaller(
        async () =>
          new Response(Uint8Array.from([1, 2, 3, 4]), {
            status: 200,
            headers: { "Content-Type": "application/octet-stream" },
          }),
        async (filePath) => {
          calls.push(["workbench.extensions.installExtension", { fsPath: filePath }])
        },
      )

      const filePath = await installer.install({
        version: "26.4.1405",
        vsixUrl: "https://example.test/opencode.vsix",
        directory: tempRoot,
      })

      const content = await fs.readFile(filePath)

      assert.strictEqual(path.dirname(filePath), tempRoot)
      assert.ok(path.basename(filePath).includes("26.4.1405"))
      assert.deepStrictEqual([...content], [1, 2, 3, 4])
      assert.strictEqual(calls.length, 1)
      assert.strictEqual(calls[0][0], "workbench.extensions.installExtension")
      assert.strictEqual((calls[0][1] as { fsPath: string }).fsPath, filePath)
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true })
    }
  })

  test("会在写入 VSIX 后、调用安装命令前触发 installing 钩子", async () => {
    const steps: string[] = []
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-update-installer-test-"))

    try {
      const installer = new UpdateInstaller(
        async () =>
          new Response(Uint8Array.from([5, 6, 7]), {
            status: 200,
            headers: { "Content-Type": "application/octet-stream" },
          }),
        async (filePath) => {
          steps.push("install-command")
          const content = await fs.readFile(filePath)
          assert.deepStrictEqual([...content], [5, 6, 7])
        },
      )

      const filePath = await installer.install(
        {
          version: "26.4.1405",
          vsixUrl: "https://example.test/opencode.vsix",
          directory: tempRoot,
        },
        {
          onInstalling() {
            steps.push("installing")
          },
        },
      )

      assert.strictEqual(path.dirname(filePath), tempRoot)
      assert.deepStrictEqual(steps, ["installing", "install-command"])
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true })
    }
  })

  test("下载返回非 2xx 时会 reject", async () => {
    const installer = new UpdateInstaller(
      async () =>
        new Response("bad gateway", {
          status: 502,
          headers: { "Content-Type": "text/plain" },
        }),
      async () => {
        throw new Error("installExtension should not run")
      },
    )

    await assert.rejects(
      () =>
        installer.install({
          version: "26.4.1405",
          vsixUrl: "https://example.test/opencode.vsix",
        }),
      /VSIX download failed: 502/,
    )
  })

  test("未指定目录时使用固定临时目录和固定文件名", async () => {
    const version = "26.4.1405"
    const expectedRoot = path.join(os.tmpdir(), "opencode-update")
    const expectedPath = path.join(expectedRoot, `opencode-ui-${version}.vsix`)
    const installer = new UpdateInstaller(
      async () =>
        new Response(Uint8Array.from([9, 8, 7]), {
          status: 200,
          headers: { "Content-Type": "application/octet-stream" },
        }),
      async () => undefined,
    )

    try {
      const filePath = await installer.install({
        version,
        vsixUrl: "https://example.test/opencode.vsix",
      })

      const content = await fs.readFile(filePath)

      assert.strictEqual(filePath, expectedPath)
      assert.deepStrictEqual([...content], [9, 8, 7])
    } finally {
      await fs.rm(expectedRoot, { recursive: true, force: true })
    }
  })
})
