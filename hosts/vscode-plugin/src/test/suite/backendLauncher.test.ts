import * as assert from "assert"
import { EventEmitter } from "events"
import { BackendLauncher } from "../../backend/BackendLauncher"
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

    assert.deepStrictEqual(calls, ["SIGTERM"])
    assert.strictEqual((launcher as unknown as { currentProcess?: unknown }).currentProcess, undefined)
    assert.strictEqual((launcher as unknown as { currentConnection?: unknown }).currentConnection, undefined)
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
      assert.deepStrictEqual(calls, ["SIGTERM"])
      assert.strictEqual((launcher as unknown as { currentProcess?: unknown }).currentProcess, undefined)
      assert.strictEqual((launcher as unknown as { currentConnection?: unknown }).currentConnection, undefined)
    } finally {
      ;(errorHandler as unknown as { handleBackendLaunchError: typeof report }).handleBackendLaunchError = report
    }
  })
})
