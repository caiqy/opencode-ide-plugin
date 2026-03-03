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

function requestReply(baseUrl: string, token: string, message: { type: string; payload?: Record<string, unknown> }) {
  return new Promise<any>((resolve, reject) => {
    const id = `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const sse = http.get(`${baseUrl}/events?token=${token}`)
    const timer = setTimeout(() => {
      sse.destroy()
      reject(new Error(`timeout waiting reply: ${message.type}`))
    }, 2000)

    function done(fn: () => void) {
      clearTimeout(timer)
      sse.destroy()
      fn()
    }

    sse.on("response", (res) => {
      res.setEncoding("utf8")
      let buf = ""
      res.on("data", (chunk: string) => {
        buf += chunk
        while (true) {
          const idx = buf.indexOf("\n\n")
          if (idx < 0) break
          const event = buf.slice(0, idx)
          buf = buf.slice(idx + 2)
          const line = event.split("\n").find((item) => item.startsWith("data:"))
          if (!line) continue
          try {
            const msg = JSON.parse(line.slice(5).trim())
            if (msg.replyTo !== id) continue
            done(() => resolve(msg))
            return
          } catch {
            continue
          }
        }
      })

      void post(`${baseUrl}/send?token=${token}`, {
        id,
        type: message.type,
        payload: message.payload,
      }).catch((err) => {
        done(() => reject(err))
      })
    })

    sse.on("error", (err) => {
      done(() => reject(err))
    })
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

suite("IdeBridgeServer scoped storage", () => {
  let baseUrl: string
  let token: string
  let sessionId: string
  let getCalls: any[]
  let setCalls: any[]

  setup(async () => {
    getCalls = []
    setCalls = []
    const global = new Map<string, string>()
    const workspace = new Map<string, string>()
    const mem = new Map<string, string>()

    const pick = (scope: unknown) => {
      if (scope === "global") return global
      if (scope === "workspace") return workspace
      if (scope === "mem") return mem
      return null
    }

    const handlers: SessionHandlers = {
      openFile: async () => {},
      openUrl: async () => {},
      reloadPath: async () => {},
      clipboardWrite: async () => {},
      storageGet: (async (...args: any[]) => {
        getCalls.push(args)
        const scope = args[0]
        const keys = Array.isArray(args[1]) ? args[1] : []
        const store = pick(scope)
        if (!store) return {}
        return Object.fromEntries(keys.map((k: string) => [k, store.get(k)]))
      }) as any,
      storageSet: (async (...args: any[]) => {
        setCalls.push(args)
        const scope = args[0]
        const key = args[1]
        const value = args[2]
        const store = pick(scope)
        if (!store) return
        if (typeof key !== "string" || typeof value !== "string") return
        store.set(key, value)
      }) as any,
    }

    const session = await bridgeServer.createSession(handlers)
    baseUrl = session.baseUrl
    token = session.token
    sessionId = session.sessionId
  })

  teardown(() => {
    bridgeServer.removeSession(sessionId)
  })

  test("仅支持 scoped storage，旧 ui/kv/model 路由返回错误且三域路由正确", async () => {
    const memKey = "opencode:webgui:mem:runtime:v1"
    const globalKey = "opencode:webgui:global:theme:v1"
    const workspaceKey = "opencode:webgui:workspace:tabs:v1"

    const setRes = await requestReply(baseUrl, token, {
      type: "storageSet",
      payload: { scope: "mem", key: memKey, value: "{}" },
    })
    assert.strictEqual(setRes.ok, true)

    const getRes = await requestReply(baseUrl, token, {
      type: "storageGet",
      payload: { scope: "mem", keys: [memKey] },
    })
    assert.strictEqual(getRes.ok, true)
    assert.strictEqual(getRes.result?.[memKey], "{}")

    const setGlobalRes = await requestReply(baseUrl, token, {
      type: "storageSet",
      payload: { scope: "global", key: globalKey, value: '"dark"' },
    })
    assert.strictEqual(setGlobalRes.ok, true)

    const getGlobalRes = await requestReply(baseUrl, token, {
      type: "storageGet",
      payload: { scope: "global", keys: [globalKey] },
    })
    assert.strictEqual(getGlobalRes.ok, true)
    assert.strictEqual(getGlobalRes.result?.[globalKey], '"dark"')

    const setWorkspaceRes = await requestReply(baseUrl, token, {
      type: "storageSet",
      payload: { scope: "workspace", key: workspaceKey, value: "{}" },
    })
    assert.strictEqual(setWorkspaceRes.ok, true)

    const getWorkspaceRes = await requestReply(baseUrl, token, {
      type: "storageGet",
      payload: { scope: "workspace", keys: [workspaceKey] },
    })
    assert.strictEqual(getWorkspaceRes.ok, true)
    assert.strictEqual(getWorkspaceRes.result?.[workspaceKey], "{}")

    assert.strictEqual(setCalls.length >= 3, true)
    assert.strictEqual(getCalls.length >= 3, true)
    assert.strictEqual(setCalls[0]?.[0], "mem")
    assert.strictEqual(setCalls[1]?.[0], "global")
    assert.strictEqual(setCalls[2]?.[0], "workspace")
    assert.strictEqual(getCalls[0]?.[0], "mem")
    assert.strictEqual(getCalls[1]?.[0], "global")
    assert.strictEqual(getCalls[2]?.[0], "workspace")

    const uiRes = await requestReply(baseUrl, token, { type: "uiGetState", payload: {} })
    assert.strictEqual(uiRes.ok, false)

    const uiSetRes = await requestReply(baseUrl, token, { type: "uiSetState", payload: {} })
    assert.strictEqual(uiSetRes.ok, false)

    const kvRes = await requestReply(baseUrl, token, { type: "kv.get", payload: {} })
    assert.strictEqual(kvRes.ok, false)

    const kvUpdateRes = await requestReply(baseUrl, token, { type: "kv.update", payload: {} })
    assert.strictEqual(kvUpdateRes.ok, false)

    const modelRes = await requestReply(baseUrl, token, { type: "model.get", payload: {} })
    assert.strictEqual(modelRes.ok, false)

    const modelUpdateRes = await requestReply(baseUrl, token, { type: "model.update", payload: {} })
    assert.strictEqual(modelUpdateRes.ok, false)
  })
})

suite("IdeBridgeServer restartHost", () => {
  let baseUrl: string
  let token: string
  let sessionId: string
  let restartCalls: number
  let restartErr: Error | null

  setup(async () => {
    restartCalls = 0
    restartErr = null

    const handlers: SessionHandlers = {
      openFile: async () => {},
      openUrl: async () => {},
      reloadPath: async () => {},
      clipboardWrite: async () => {},
      restartHost: async () => {
        if (restartErr) throw restartErr
        restartCalls += 1
      },
    }

    const session = await bridgeServer.createSession(handlers)
    baseUrl = session.baseUrl
    token = session.token
    sessionId = session.sessionId
  })

  teardown(() => {
    bridgeServer.removeSession(sessionId)
  })

  test("restartHost 路由到 handler 并返回 ok", async () => {
    const res = await requestReply(baseUrl, token, { type: "restartHost", payload: {} })

    assert.strictEqual(res.ok, true)
    assert.strictEqual(restartCalls, 1)
  })

  test("restartHost handler 抛错时返回错误 reply", async () => {
    restartErr = new Error("boom")
    const res = await requestReply(baseUrl, token, { type: "restartHost", payload: {} })

    assert.strictEqual(res.ok, false)
    assert.strictEqual(typeof res.error, "string")
    assert.strictEqual(String(res.error).includes("restartHost failed"), true)
  })
})
