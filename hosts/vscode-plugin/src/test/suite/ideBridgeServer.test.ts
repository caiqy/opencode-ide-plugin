import * as assert from "assert"
import * as http from "http"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

// We test IdeBridgeServer through its HTTP API directly.
// The server imports `logger` from globals which depends on vscode,
// so we need the vscode test host. That's fine — these tests run via vscode-test.

import { bridgeServer } from "../../ui/IdeBridgeServer"
import type { SessionHandlers } from "../../ui/IdeBridgeServer"

function post(url: string, body: object): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const data = JSON.stringify(body)
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
      },
      (res) => resolve({ status: res.statusCode ?? 0 }),
    )
    req.on("error", reject)
    req.write(data)
    req.end()
  })
}

suite("IdeBridgeServer ensureAndOpenFile", () => {
  let baseUrl: string
  let token: string
  let sessionId: string
  let openFileCalls: string[]
  let tmpDir: string

  setup(async () => {
    openFileCalls = []
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-test-"))

    const handlers: SessionHandlers = {
      openFile: async (p: string) => {
        openFileCalls.push(p)
      },
      openUrl: async () => {},
      reloadPath: async () => {},
      clipboardWrite: async () => {},
    }

    const session = await bridgeServer.createSession(handlers)
    baseUrl = session.baseUrl
    token = session.token
    sessionId = session.sessionId
  })

  teardown(() => {
    bridgeServer.removeSession(sessionId)
    // Clean up temp dir
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test("creates missing file and calls openFile", async () => {
    const target = path.join(tmpDir, "sub", "dir", "newfile.txt")

    // File should not exist yet
    assert.strictEqual(fs.existsSync(target), false)

    const res = await post(`${baseUrl}/send?token=${token}`, {
      id: "msg-1",
      type: "ensureAndOpenFile",
      payload: { path: target },
    })

    assert.strictEqual(res.status, 204)

    // File should now exist
    assert.strictEqual(fs.existsSync(target), true)
    assert.strictEqual(fs.readFileSync(target, "utf-8"), "")

    // openFile should have been called with the resolved path
    assert.strictEqual(openFileCalls.length, 1)
    assert.strictEqual(openFileCalls[0], target)
  })

  test("expands tilde in path", async () => {
    const slug = `opencode-bridge-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const homeDir = path.join(os.homedir(), ".config", slug)
    const target = `~/.config/${slug}/tilde.txt`
    const resolved = path.join(homeDir, "tilde.txt")

    try {
      await post(`${baseUrl}/send?token=${token}`, {
        id: "msg-2",
        type: "ensureAndOpenFile",
        payload: { path: target },
      })

      assert.strictEqual(fs.existsSync(resolved), true)
      assert.strictEqual(openFileCalls.length, 1)
      assert.strictEqual(openFileCalls[0], resolved)
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true })
    }
  })

  test("returns error when path is missing", async () => {
    const res = await post(`${baseUrl}/send?token=${token}`, {
      id: "msg-3",
      type: "ensureAndOpenFile",
      payload: {},
    })

    // Server still returns 204 for the HTTP response (message-level error goes via SSE)
    assert.strictEqual(res.status, 204)

    // openFile should NOT have been called
    assert.strictEqual(openFileCalls.length, 0)
  })

  test("returns error when path is empty string", async () => {
    await post(`${baseUrl}/send?token=${token}`, {
      id: "msg-4",
      type: "ensureAndOpenFile",
      payload: { path: "" },
    })

    assert.strictEqual(openFileCalls.length, 0)
  })

  test("opens existing file without overwriting", async () => {
    const target = path.join(tmpDir, "existing.txt")
    fs.writeFileSync(target, "hello")

    await post(`${baseUrl}/send?token=${token}`, {
      id: "msg-5",
      type: "ensureAndOpenFile",
      payload: { path: target },
    })

    // Content should be preserved
    assert.strictEqual(fs.readFileSync(target, "utf-8"), "hello")
    assert.strictEqual(openFileCalls.length, 1)
    assert.strictEqual(openFileCalls[0], target)
  })
})
