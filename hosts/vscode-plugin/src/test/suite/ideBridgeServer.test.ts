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

const TIMEOUT = 2000

type Scope = "global" | "workspace" | "mem"

type Reply = {
  replyTo: string
  ok: boolean
  error?: string
  result?: Record<string, unknown>
}

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
  return new Promise<Reply>((resolve, reject) => {
    const id = `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const sse = http.get(`${baseUrl}/events?token=${token}`)
    const timer = setTimeout(() => {
      sse.destroy()
      reject(new Error(`timeout waiting reply: ${message.type}`))
    }, TIMEOUT)

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
            const msg = JSON.parse(line.slice(5).trim()) as Reply
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

function requestRoundtrip(
  baseUrl: string,
  token: string,
  message: { type: string; payload?: Record<string, unknown> },
) {
  return new Promise<{ status: number; reply: Reply }>((resolve, reject) => {
    const id = `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const sse = http.get(`${baseUrl}/events?token=${token}`)
    const timer = setTimeout(() => {
      sse.destroy()
      reject(new Error(`timeout waiting roundtrip: ${message.type}`))
    }, TIMEOUT)
    let status: number | null = null
    let reply: Reply | null = null

    function done(err?: unknown) {
      clearTimeout(timer)
      sse.destroy()
      if (err) {
        reject(err)
        return
      }
      resolve({ status: status ?? 0, reply: reply as Reply })
    }

    function flush() {
      if (status === null || !reply) return
      done()
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
            const msg = JSON.parse(line.slice(5).trim()) as Reply
            if (msg.replyTo !== id) continue
            reply = msg
            flush()
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
      })
        .then((res) => {
          status = res.status
          flush()
        })
        .catch((err) => done(err))
    })

    sse.on("error", (err) => {
      done(err)
    })
  })
}

function wait(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {}
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function tick() {
  return new Promise<void>((resolve) => setImmediate(resolve))
}

function openSSE(url: string) {
  return new Promise<{ req: http.ClientRequest; res: http.IncomingMessage }>((resolve, reject) => {
    const req = http.get(url)
    req.on("response", (res) => resolve({ req, res }))
    req.on("error", reject)
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
    const res = await requestRoundtrip(baseUrl, token, {
      type: "ensureAndOpenFile",
      payload: {},
    })

    assert.strictEqual(res.status, 204)
    assert.strictEqual(res.reply.ok, false)
    assert.strictEqual(res.reply.error, "Missing path")
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
  let getCalls: Array<[Scope, string[]]>
  let setCalls: Array<[Scope, string, string]>

  setup(async () => {
    getCalls = []
    setCalls = []
    const global = new Map<string, string>()
    const workspace = new Map<string, string>()
    const mem = new Map<string, string>()

    const pick = (scope: Scope) => {
      if (scope === "global") return global
      if (scope === "workspace") return workspace
      if (scope === "mem") return mem
      throw new Error(`Invalid scope: ${scope}`)
    }

    const handlers: SessionHandlers = {
      openFile: async () => {},
      openUrl: async () => {},
      reloadPath: async () => {},
      clipboardWrite: async () => {},
      storageGet: async (scope, keys) => {
        getCalls.push([scope, keys])
        const store = pick(scope)
        return Object.fromEntries(keys.map((k) => [k, store.get(k)]))
      },
      storageSet: async (scope, key, value) => {
        setCalls.push([scope, key, value])
        const store = pick(scope)
        store.set(key, value)
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

suite("IdeBridgeServer saveImage", () => {
  let baseUrl: string
  let token: string
  let sessionId: string
  let calls: Array<{ url: string; filename: string }>

  setup(async () => {
    calls = []

    const handlers = {
      openFile: async () => {},
      openUrl: async () => {},
      reloadPath: async () => {},
      clipboardWrite: async () => {},
      saveImage: async (url: string, filename: string) => {
        calls.push({ url, filename })
        return { cancelled: false } as const
      },
    } as unknown as SessionHandlers

    const session = await bridgeServer.createSession(handlers)
    baseUrl = session.baseUrl
    token = session.token
    sessionId = session.sessionId
  })

  teardown(() => {
    bridgeServer.removeSession(sessionId)
  })

  test("routes saveImage to the session handler", async () => {
    const response = await requestRoundtrip(baseUrl, token, {
      type: "saveImage",
      payload: { url: "https://example.com/image.png", filename: "image.png" },
    })

    assert.strictEqual(response.status, 204)
    assert.strictEqual(response.reply.ok, true)
    assert.deepStrictEqual(response.reply.result, { cancelled: false })
    assert.deepStrictEqual(calls, [{ url: "https://example.com/image.png", filename: "image.png" }])
  })

  test("returns an error when saveImage payload is incomplete", async () => {
    const response = await requestRoundtrip(baseUrl, token, {
      type: "saveImage",
      payload: { url: "https://example.com/image.png" },
    })

    assert.strictEqual(response.status, 204)
    assert.strictEqual(response.reply.ok, false)
    assert.strictEqual(response.reply.error, "Missing url or filename")
    assert.deepStrictEqual(calls, [])
  })

  test("returns an error when saveImage payload uses blank strings", async () => {
    const response = await requestRoundtrip(baseUrl, token, {
      type: "saveImage",
      payload: { url: "   ", filename: "image.png" },
    })

    assert.strictEqual(response.status, 204)
    assert.strictEqual(response.reply.ok, false)
    assert.strictEqual(response.reply.error, "Missing url or filename")
    assert.deepStrictEqual(calls, [])
  })

  test("returns a dedicated error when saveImage has no handler", async () => {
    bridgeServer.removeSession(sessionId)

    const session = await bridgeServer.createSession({
      openFile: async () => {},
      openUrl: async () => {},
      reloadPath: async () => {},
      clipboardWrite: async () => {},
    })
    baseUrl = session.baseUrl
    token = session.token
    sessionId = session.sessionId

    const response = await requestRoundtrip(baseUrl, token, {
      type: "saveImage",
      payload: { url: "https://example.com/image.png", filename: "image.png" },
    })

    assert.strictEqual(response.status, 204)
    assert.strictEqual(response.reply.ok, false)
    assert.strictEqual(response.reply.error, "saveImage not supported")
  })

  test("returns structured cancel state instead of an empty save success", async () => {
    bridgeServer.removeSession(sessionId)

    const session = await bridgeServer.createSession({
      openFile: async () => {},
      openUrl: async () => {},
      reloadPath: async () => {},
      clipboardWrite: async () => {},
      saveImage: async () => ({ cancelled: true }) as const,
    } as unknown as SessionHandlers)
    baseUrl = session.baseUrl
    token = session.token
    sessionId = session.sessionId

    const response = await requestRoundtrip(baseUrl, token, {
      type: "saveImage",
      payload: { url: "https://example.com/image.png", filename: "image.png" },
    })

    assert.strictEqual(response.status, 204)
    assert.strictEqual(response.reply.ok, true)
    assert.deepStrictEqual(response.reply.result, { cancelled: true })
  })
})

suite("IdeBridgeServer restartHost", () => {
  let baseUrl: string
  let token: string
  let sessionId: string
  let restartCalls: number
  let restartErr: Error | null
  let restartDone: (() => void) | null
  let restartStarted: Promise<void>
  let markStarted: (() => void) | null
  let restartWait: boolean

  setup(async () => {
    restartCalls = 0
    restartErr = null
    restartDone = null
    markStarted = null
    restartWait = false
    const started = wait()
    restartStarted = started.promise
    markStarted = started.resolve

    const handlers: SessionHandlers = {
      openFile: async () => {},
      openUrl: async () => {},
      reloadPath: async () => {},
      clipboardWrite: async () => {},
      restartHost: async () => {
        if (restartErr) throw restartErr
        restartCalls += 1
        markStarted?.()
        if (!restartWait) return
        await new Promise<void>((resolve) => {
          restartDone = resolve
        })
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
    await restartStarted

    assert.strictEqual(res.ok, true)
    assert.strictEqual(restartCalls, 1)
  })

  test("restartHost 会在 handler 完成前返回 ok，且 handler 最终仍会被调用", async () => {
    restartWait = true
    const req = requestReply(baseUrl, token, { type: "restartHost", payload: {} })
    let replied = false
    void req.then(() => {
      replied = true
    })

    await restartStarted
    assert.strictEqual(restartCalls, 1)
    await tick()
    assert.strictEqual(replied, true)

    restartDone?.()
    const res = await req
    assert.strictEqual(res.ok, true)
    assert.strictEqual(restartCalls, 1)
  })

  test("restartHost handler 抛错时仍先返回 ok", async () => {
    restartErr = new Error("boom")
    const res = await requestReply(baseUrl, token, { type: "restartHost", payload: {} })

    assert.strictEqual(res.ok, true)
  })
})

suite("IdeBridgeServer showSystemNotification", () => {
  let baseUrl: string
  let token: string
  let sessionId: string
  let notifications: Array<{ sessionID: string; title: string; body: string }>

  setup(async () => {
    notifications = []
    const session = await bridgeServer.createSession({
      openFile: async () => {},
      openUrl: async () => {},
      reloadPath: async () => {},
      clipboardWrite: async () => {},
      showSystemNotification: async (targetSessionID, title, body) => {
        notifications.push({ sessionID: targetSessionID, title, body })
      },
    } as SessionHandlers & {
      showSystemNotification: (sessionID: string, title: string, body: string) => Promise<void>
    })
    baseUrl = session.baseUrl
    token = session.token
    sessionId = session.sessionId
  })

  teardown(() => bridgeServer.removeSession(sessionId))

  test("showSystemNotification 路由统一 sessionID、标题和正文", async () => {
    const res = await requestReply(baseUrl, token, {
      type: "showSystemNotification",
      payload: {
        sessionID: "  session-123  ",
        title: "  Agent finished  ",
        body: "  Finished working.  ",
      },
    })

    assert.strictEqual(res.ok, true)
    assert.deepStrictEqual(notifications, [
      { sessionID: "session-123", title: "Agent finished", body: "Finished working." },
    ])
  })

  ;[
    {
      name: "缺少 sessionID",
      payload: { title: "Agent finished", body: "Finished working." },
    },
    {
      name: "空白 sessionID",
      payload: { sessionID: " ", title: "Agent finished", body: "Finished working." },
    },
    {
      name: "非字符串 sessionID",
      payload: { sessionID: 1, title: "Agent finished", body: "Finished working." },
    },
    {
      name: "缺少 title",
      payload: { sessionID: "session-123", body: "Finished working." },
    },
    {
      name: "空白 title",
      payload: { sessionID: "session-123", title: " ", body: "Finished working." },
    },
    {
      name: "非字符串 title",
      payload: { sessionID: "session-123", title: 1, body: "Finished working." },
    },
    {
      name: "缺少 body",
      payload: { sessionID: "session-123", title: "Agent finished" },
    },
    {
      name: "空白 body",
      payload: { sessionID: "session-123", title: "Agent finished", body: " " },
    },
    {
      name: "非字符串 body",
      payload: { sessionID: "session-123", title: "Agent finished", body: 1 },
    },
  ].forEach(({ name, payload }) => {
    test(`showSystemNotification 拒绝${name}`, async () => {
      const res = await requestReply(baseUrl, token, {
        type: "showSystemNotification",
        payload,
      })

      assert.strictEqual(res.ok, false)
      assert.deepStrictEqual(notifications, [])
    })
  })
})

suite("IdeBridgeServer update bridge", () => {
  let baseUrl: string
  let token: string
  let sessionId: string
  let installCalls: string[]
  let checkCalls: number
  let extensionVersionCalls: number

  setup(async () => {
    installCalls = []
    checkCalls = 0
    extensionVersionCalls = 0

    const handlers: SessionHandlers = {
      openFile: async () => {},
      openUrl: async () => {},
      reloadPath: async () => {},
      clipboardWrite: async () => {},
      getExtensionVersion: async () => {
        extensionVersionCalls += 1
        return { version: "26.4.1503" }
      },
      checkForUpdates: async () => {
        checkCalls += 1
        return {
          checkedAt: "2026-04-14T00:00:00.000Z",
          hasUpdate: true,
        }
      },
      getUpdateInfo: async () => ({
        latest: { version: "26.4.1406" },
        hasUpdate: true,
      }),
      installUpdate: async (version) => {
        installCalls.push(version)
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

  test("getUpdateInfo 返回 result", async () => {
    const res = await requestRoundtrip(baseUrl, token, {
      type: "getUpdateInfo",
      payload: {},
    })

    assert.strictEqual(res.status, 204)
    assert.strictEqual(res.reply.ok, true)
    assert.deepStrictEqual(res.reply.result, {
      latest: { version: "26.4.1406" },
      hasUpdate: true,
    })
  })

  test("getExtensionVersion 返回 result", async () => {
    const res = await requestRoundtrip(baseUrl, token, {
      type: "getExtensionVersion",
      payload: {},
    })

    assert.strictEqual(res.status, 204)
    assert.strictEqual(res.reply.ok, true)
    assert.deepStrictEqual(res.reply.result, {
      version: "26.4.1503",
    })
    assert.strictEqual(extensionVersionCalls, 1)
  })

  test("checkForUpdates 返回 result", async () => {
    const res = await requestRoundtrip(baseUrl, token, {
      type: "checkForUpdates",
      payload: {},
    })

    assert.strictEqual(res.status, 204)
    assert.strictEqual(res.reply.ok, true)
    assert.deepStrictEqual(res.reply.result, {
      checkedAt: "2026-04-14T00:00:00.000Z",
      hasUpdate: true,
    })
    assert.strictEqual(checkCalls, 1)
  })

  test("installUpdate 返回 ok", async () => {
    const res = await requestRoundtrip(baseUrl, token, {
      type: "installUpdate",
      payload: { version: "26.4.1406" },
    })

    assert.strictEqual(res.status, 204)
    assert.strictEqual(res.reply.ok, true)
    assert.deepStrictEqual(installCalls, ["26.4.1406"])
  })
})

suite("IdeBridgeServer protocol", () => {
  teardown(() => {
    bridgeServer.stop()
  })

  test("createSession 并发时不会返回 port 0", async () => {
    bridgeServer.stop()

    const wait = global.setTimeout
    const listen = http.Server.prototype.listen
    const gate =
      wait === undefined
        ? null
        : (() => {
            let done = false
            return {
              open: () => {
                done = true
              },
              wait: () =>
                new Promise<void>((resolve) => {
                  const tick = () => {
                    if (done) {
                      resolve()
                      return
                    }
                    wait(tick, 1)
                  }
                  tick()
                }),
            }
          })()

    http.Server.prototype.listen = function (this: http.Server, ...items: unknown[]) {
      const cb = items.at(-1)
      if (typeof cb !== "function" || !gate) return Reflect.apply(listen, this, items)
      return Reflect.apply(listen, this, [
        ...items.slice(0, -1),
        () => {
          void gate.wait().then(() => cb())
        },
      ])
    } as typeof http.Server.prototype.listen

    const handlers: SessionHandlers = {
      openFile: async () => {},
      openUrl: async () => {},
      reloadPath: async () => {},
      clipboardWrite: async () => {},
    }

    try {
      const one = bridgeServer.createSession(handlers)
      const two = bridgeServer.createSession(handlers)
      const open = Promise.resolve().then(() => gate?.open())
      const list = await Promise.all([one, two])
      await open

      assert.strictEqual(
        list.every((item) => !item.baseUrl.includes(":0/")),
        true,
      )

      for (const item of list) {
        bridgeServer.removeSession(item.sessionId)
      }
    } finally {
      http.Server.prototype.listen = listen
    }
  })

  test("handler 异常时仍返回 SSE replyError", async () => {
    const handlers: SessionHandlers = {
      openFile: async () => {
        throw new Error("boom")
      },
      openUrl: async () => {},
      reloadPath: async () => {},
      clipboardWrite: async () => {},
    }

    const session = await bridgeServer.createSession(handlers)

    try {
      const res = await requestRoundtrip(session.baseUrl, session.token, {
        type: "openFile",
        payload: { path: "foo" },
      })

      assert.strictEqual(res.status, 400)
      assert.strictEqual(res.reply.ok, false)
      assert.strictEqual(String(res.reply.error).includes("openFile failed"), true)
    } finally {
      bridgeServer.removeSession(session.sessionId)
    }
  })

  test("openSession 在 SSE 连接建立后发送暂存的目标会话", async () => {
    const session = await bridgeServer.createSession({
      openFile: async () => {},
      openUrl: async () => {},
      reloadPath: async () => {},
      clipboardWrite: async () => {},
    })
    const server = bridgeServer as typeof bridgeServer & {
      openSession?: (bridgeSessionID: string, sessionID: string) => boolean
    }

    try {
      assert.ok(server.openSession)
      assert.strictEqual(server.openSession(session.sessionId, "target-session"), true)
      const sse = await openSSE(`${session.baseUrl}/events?token=${session.token}`)

      try {
        sse.res.setEncoding("utf8")
        const message = await new Promise<{ type?: string; payload?: { sessionID?: string } }>((resolve, reject) => {
          let buffer = ""
          const timer = setTimeout(() => reject(new Error("timeout waiting openSession")), TIMEOUT)
          sse.res.on("data", (chunk: string) => {
            buffer += chunk
            for (const event of buffer.split("\n\n")) {
              const line = event.split("\n").find((item) => item.startsWith("data:"))
              if (!line) continue
              const value = JSON.parse(line.slice(5).trim()) as { type?: string; payload?: { sessionID?: string } }
              if (value.type !== "openSession") continue
              clearTimeout(timer)
              resolve(value)
              return
            }
          })
        })

        assert.strictEqual(message.type, "openSession")
        assert.deepStrictEqual(message.payload, { sessionID: "target-session" })
      } finally {
        sse.req.destroy()
      }
    } finally {
      bridgeServer.removeSession(session.sessionId)
    }
  })

  test("stop 会关闭现有 SSE 连接", async () => {
    const handlers: SessionHandlers = {
      openFile: async () => {},
      openUrl: async () => {},
      reloadPath: async () => {},
      clipboardWrite: async () => {},
    }

    const session = await bridgeServer.createSession(handlers)
    const sse = await openSSE(`${session.baseUrl}/events?token=${session.token}`)

    try {
      sse.res.setEncoding("utf8")
      await new Promise<void>((resolve) => {
        sse.res.once("data", () => resolve())
      })

      const closed = new Promise<void>((resolve) => {
        sse.res.once("close", () => resolve())
      })

      bridgeServer.stop()

      await Promise.race([
        closed,
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("timeout waiting SSE close after stop")), TIMEOUT)
        }),
      ])
    } finally {
      sse.req.destroy()
      bridgeServer.removeSession(session.sessionId)
    }
  })
})
