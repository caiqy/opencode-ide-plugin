import * as assert from "assert"
import { EventEmitter } from "events"
import { BackendLauncher } from "../../backend/BackendLauncher"
import { ResourceExtractor } from "../../backend/ResourceExtractor"
import { errorHandler } from "../../utils/ErrorHandler"

suite("BackendLauncher Test Suite", () => {
  let launcher: BackendLauncher
  let timeout: typeof global.setTimeout

  setup(() => {
    launcher = new BackendLauncher()
    timeout = global.setTimeout
  })

  teardown(() => {
    global.setTimeout = timeout
    launcher.terminate()
  })

  test("should create BackendLauncher instance", () => {
    assert.ok(launcher instanceof BackendLauncher)
  })

  test("should keep string extension path constructor compatibility", () => {
    const scoped = new BackendLauncher("/tmp/opencode-extension")

    assert.ok(scoped instanceof BackendLauncher)
  })

  test("should pass extension version to ResourceExtractor", async () => {
    const original = ResourceExtractor.extractBinary
    let received: string | undefined
    ResourceExtractor.extractBinary = async (_path, version) => {
      received = version
      return "opencode"
    }
    try {
      const scoped = new BackendLauncher({ extensionPath: "/tmp/extension", extensionVersion: "26.7.902" })
      await (scoped as unknown as { extractBinary(): Promise<string> }).extractBinary()
      assert.strictEqual(received, "26.7.902")
    } finally {
      ResourceExtractor.extractBinary = original
    }
  })

  test("should inject extension version into backend environment", () => {
    const scoped = new BackendLauncher({ extensionVersion: "26.5.1602" })
    const env = (scoped as unknown as { buildEnvironment(): NodeJS.ProcessEnv }).buildEnvironment()

    assert.strictEqual(env.OPENCODE_UI_VERSION, "26.5.1602")
  })

  test("should not inject blank extension version into backend environment", () => {
    const previous = process.env.OPENCODE_UI_VERSION
    delete process.env.OPENCODE_UI_VERSION

    try {
      const scoped = new BackendLauncher({ extensionVersion: "   " })
      const env = (scoped as unknown as { buildEnvironment(): NodeJS.ProcessEnv }).buildEnvironment()

      assert.strictEqual(Object.prototype.hasOwnProperty.call(env, "OPENCODE_UI_VERSION"), false)
    } finally {
      if (previous === undefined) {
        delete process.env.OPENCODE_UI_VERSION
      } else {
        process.env.OPENCODE_UI_VERSION = previous
      }
    }
  })

  test("should remove inherited UI version when extension version is blank", () => {
    const previous = process.env.OPENCODE_UI_VERSION
    process.env.OPENCODE_UI_VERSION = "stale"

    try {
      const scoped = new BackendLauncher({ extensionVersion: "   " })
      const env = (scoped as unknown as { buildEnvironment(): NodeJS.ProcessEnv }).buildEnvironment()

      assert.strictEqual(Object.prototype.hasOwnProperty.call(env, "OPENCODE_UI_VERSION"), false)
    } finally {
      if (previous === undefined) {
        delete process.env.OPENCODE_UI_VERSION
      } else {
        process.env.OPENCODE_UI_VERSION = previous
      }
    }
  })

  test("should not be running initially", () => {
    assert.strictEqual(launcher.isRunning(), false)
  })

  test("should handle terminate when not running", () => {
    // Should not throw when terminating non-running process
    assert.doesNotThrow(() => {
      launcher.terminate()
    })
  })

  test("should remain not running after terminate", () => {
    launcher.terminate()
    assert.strictEqual(launcher.isRunning(), false)
  })

  test("should clear shared process state immediately when terminate runs", () => {
    const calls: string[] = []
    const proc = Object.assign(new EventEmitter(), {
      killed: false,
      kill(signal?: NodeJS.Signals | number) {
        calls.push(String(signal))
        return true
      },
    })
    const conn = { port: 1, uiBase: "http://127.0.0.1/app" }

    ;(launcher as unknown as { currentProcess?: typeof proc }).currentProcess = proc
    ;(launcher as unknown as { currentConnection?: typeof conn }).currentConnection = conn

    launcher.terminate()

    if (process.platform !== "win32") {
      assert.deepStrictEqual(calls, ["SIGTERM"])
    }
    assert.strictEqual((launcher as unknown as { currentProcess?: unknown }).currentProcess, undefined)
    assert.strictEqual((launcher as unknown as { currentConnection?: unknown }).currentConnection, undefined)
  })

  test("should point parsed backend UI base at /app", async () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
    })

    global.setTimeout = ((callback: (...args: unknown[]) => void) => {
      return timeout(callback, 1000)
    }) as typeof global.setTimeout

    const promise = (
      launcher as unknown as {
        parseConnectionInfo(process: typeof child): Promise<{ port: number; uiBase: string }>
      }
    ).parseConnectionInfo(child)

    child.stdout.emit("data", Buffer.from("opencode server listening on http://127.0.0.1:4096\n"))

    const connection = await promise

    assert.strictEqual(connection.port, 4096)
    assert.strictEqual(connection.uiBase, "http://127.0.0.1:4096/app")
  })

  test("should clean up failed shared process when connection parsing fails", async () => {
    const err = new Error("parse failed")
    const calls: string[] = []
    const child = Object.assign(new EventEmitter(), {
      killed: false,
      kill(signal?: NodeJS.Signals | number) {
        calls.push(String(signal))
        this.killed = true
        return true
      },
    })
    const report = errorHandler.handleBackendLaunchError

    ;(errorHandler as unknown as { handleBackendLaunchError: typeof report }).handleBackendLaunchError = async () => {}
    ;(launcher as unknown as { extractBinary: () => Promise<string> }).extractBinary = async () => "opencode"
    ;(launcher as unknown as { buildCommandArgs: (bin: string) => string[] }).buildCommandArgs = (bin) => [bin, "serve"]
    ;(launcher as unknown as { spawnBackend: () => typeof child }).spawnBackend = () => child
    ;(launcher as unknown as { parseConnectionInfo: () => Promise<never> }).parseConnectionInfo = async () => {
      throw err
    }
    ;(launcher as unknown as { getCustomCommand: () => string }).getCustomCommand = () => ""
    ;(launcher as unknown as { currentConnection?: { port: number; uiBase: string } }).currentConnection = {
      port: 1,
      uiBase: "http://stale/app",
    }

    try {
      await assert.rejects(() => launcher.launchBackend("."), err)
      if (process.platform !== "win32") {
        assert.deepStrictEqual(calls, ["SIGTERM"])
      }
      assert.strictEqual((launcher as unknown as { currentProcess?: unknown }).currentProcess, undefined)
      assert.strictEqual((launcher as unknown as { currentConnection?: unknown }).currentConnection, undefined)
    } finally {
      ;(errorHandler as unknown as { handleBackendLaunchError: typeof report }).handleBackendLaunchError = report
    }
  })
})
