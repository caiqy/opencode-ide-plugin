import * as assert from "assert"
import type { ReleaseInfo } from "../../update/ReleaseChecker"
import type { UpdateEvent, UpdateEventPayload } from "../../update/UpdateService"
import { UpdateService } from "../../update/UpdateService"

type EventRecord = { sessionId: string; type: UpdateEvent; payload: UpdateEventPayload }

suite("UpdateService Test Suite", () => {
  test("start 会安排首次延迟检查和周期轮询", () => {
    const calls: Array<{ type: "timeout" | "interval"; delay: number }> = []
    const scheduler = {
      setTimeout(_: () => void, delay: number) {
        calls.push({ type: "timeout", delay })
        return { type: "timeout" as const }
      },
      clearTimeout() {},
      setInterval(_: () => void, delay: number) {
        calls.push({ type: "interval", delay })
        return { type: "interval" as const }
      },
      clearInterval() {},
    }

    const service = new UpdateService({
      currentVersion: "26.4.1404",
      checker: {
        async getLatest() {
          return null
        },
      },
      installer: {
        async install() {
          return ""
        },
      },
      scheduler,
    })

    service.start()

    assert.deepStrictEqual(calls, [
      { type: "timeout", delay: 30_000 },
      { type: "interval", delay: 4 * 60 * 60 * 1000 },
    ])
  })

  test("dispose 会清理首次延迟检查和周期轮询", () => {
    const cleared: string[] = []
    const timeoutHandle = { kind: "timeout" }
    const intervalHandle = { kind: "interval" }
    const scheduler = {
      setTimeout() {
        return timeoutHandle
      },
      clearTimeout(handle: unknown) {
        if (handle === timeoutHandle) {
          cleared.push("timeout")
        }
      },
      setInterval() {
        return intervalHandle
      },
      clearInterval(handle: unknown) {
        if (handle === intervalHandle) {
          cleared.push("interval")
        }
      },
    }

    const service = new UpdateService({
      currentVersion: "26.4.1404",
      checker: {
        async getLatest() {
          return null
        },
      },
      installer: {
        async install() {
          return ""
        },
      },
      scheduler,
    })

    service.start()
    service.dispose()

    assert.deepStrictEqual(cleared, ["timeout", "interval"])
  })

  test("关闭和重新开启自动检查会清理并重建调度", () => {
    const scheduled: string[] = []
    const cleared: string[] = []
    const scheduler = {
      setTimeout() {
        scheduled.push("timeout")
        return "timeout"
      },
      clearTimeout(handle: unknown) {
        cleared.push(String(handle))
      },
      setInterval() {
        scheduled.push("interval")
        return "interval"
      },
      clearInterval(handle: unknown) {
        cleared.push(String(handle))
      },
    }
    const service = new UpdateService({
      currentVersion: "26.4.1404",
      checker: { getLatest: async () => null },
      installer: { install: async () => "" },
      scheduler,
    })

    service.setAutomaticChecks(true)
    service.setAutomaticChecks(false)
    service.setAutomaticChecks(true)

    assert.deepStrictEqual(scheduled, ["timeout", "interval", "timeout", "interval"])
    assert.deepStrictEqual(cleared, ["timeout", "interval"])
    assert.strictEqual(service.isAutomaticChecksEnabled(), true)
  })

  test("scheduled check failure 会通过本地错误处理上报", async () => {
    let task: (() => void) | undefined
    const reports: string[] = []
    const scheduler = {
      setTimeout(input: () => void) {
        task = input
        return { type: "timeout" as const }
      },
      clearTimeout() {},
      setInterval() {
        return { type: "interval" as const }
      },
      clearInterval() {},
    }
    const service = new UpdateService({
      currentVersion: "26.4.1404",
      checker: {
        async getLatest() {
          throw new Error("scheduled check failed")
        },
      },
      installer: {
        async install() {
          return ""
        },
      },
      scheduler,
      onScheduledError(error) {
        reports.push(error instanceof Error ? error.message : String(error))
      },
    })

    service.start()
    task?.()

    await new Promise((resolve) => setTimeout(resolve, 0))

    assert.deepStrictEqual(reports, ["scheduled check failed"])
  })

  test("发现新版本时只广播一次 updateAvailable", async () => {
    const events: EventRecord[] = []
    const latest: ReleaseInfo = {
      version: "26.4.1405",
      releaseUrl: "https://example.test/releases/26.4.1405",
      notes: "## update",
      publishedAt: "2026-04-14T12:00:00Z",
      vsixUrl: "https://example.test/opencode.vsix",
    }

    const service = new UpdateService({
      currentVersion: "26.4.1404",
      checker: {
        async getLatest() {
          return latest
        },
      },
      installer: {
        async install() {
          return ""
        },
      },
    })

    service.attachSession("session-a", (type, payload) => {
      events.push({ sessionId: "session-a", type, payload })
    })
    service.attachSession("session-b", (type, payload) => {
      events.push({ sessionId: "session-b", type, payload })
    })

    const first = await service.checkNow()
    const second = await service.checkNow()

    assert.deepStrictEqual(first, latest)
    assert.deepStrictEqual(second, latest)
    assert.deepStrictEqual(events, [
      { sessionId: "session-a", type: "updateAvailable", payload: latest },
      { sessionId: "session-b", type: "updateAvailable", payload: latest },
    ])
    assert.deepStrictEqual(service.getUpdateInfo(), {
      latest,
      notifiedVersion: "26.4.1405",
      hasUpdate: true,
    })
  })

  test("checkForUpdates 重复检查同一版本时只广播一次 updateAvailable", async () => {
    const events: EventRecord[] = []
    const latest: ReleaseInfo = {
      version: "26.4.1405",
      releaseUrl: "https://example.test/releases/26.4.1405",
      notes: "## update",
      publishedAt: "2026-04-14T12:00:00Z",
      vsixUrl: "https://example.test/opencode.vsix",
    }

    const service = new UpdateService({
      currentVersion: "26.4.1404",
      checker: {
        async getLatest(version: string) {
          assert.strictEqual(version, "26.4.1404")
          return latest
        },
      },
      installer: {
        async install() {
          return ""
        },
      },
    })

    service.attachSession("session-a", (type, payload) => {
      events.push({ sessionId: "session-a", type, payload })
    })

    const first = await service.checkForUpdates()
    const second = await service.checkForUpdates()

    assert.deepStrictEqual(first, {
      status: "available",
      latest,
    })
    assert.deepStrictEqual(second, {
      status: "available",
      latest,
    })
    assert.deepStrictEqual(service.getUpdateInfo(), {
      latest,
      notifiedVersion: latest.version,
      hasUpdate: true,
    })
    assert.deepStrictEqual(events, [{ sessionId: "session-a", type: "updateAvailable", payload: latest }])
  })

  test("checkForUpdates 在无更新时返回 up-to-date", async () => {
    const events: EventRecord[] = []
    const service = new UpdateService({
      currentVersion: "26.4.1404",
      checker: {
        async getLatest(version: string) {
          assert.strictEqual(version, "26.4.1404")
          return null
        },
      },
      installer: {
        async install() {
          return ""
        },
      },
    })

    service.attachSession("session-a", (type, payload) => {
      events.push({ sessionId: "session-a", type, payload })
    })

    const result = await service.checkForUpdates()

    assert.deepStrictEqual(result, {
      status: "up-to-date",
      currentVersion: "26.4.1404",
    })
    assert.deepStrictEqual(events, [])
    assert.deepStrictEqual(service.getUpdateInfo(), {
      latest: null,
      notifiedVersion: undefined,
      hasUpdate: false,
    })
  })

  test("installUpdate 会在下载完成后、安装命令前广播 installing", async () => {
    const events: EventRecord[] = []
    const steps: string[] = []
    const latest: ReleaseInfo = {
      version: "26.4.1405",
      releaseUrl: "https://example.test/releases/26.4.1405",
      notes: "## update",
      publishedAt: "2026-04-14T12:00:00Z",
      vsixUrl: "https://example.test/opencode.vsix",
    }

    const service = new UpdateService({
      currentVersion: "26.4.1404",
      checker: {
        async getLatest() {
          return latest
        },
      },
      installer: {
        async install(input: ReleaseInfo, hooks?: { onInstalling?: () => void }) {
          assert.deepStrictEqual(input, latest)
          steps.push("downloaded")
          assert.deepStrictEqual(events, [
            {
              sessionId: "session-a",
              type: "downloading",
              payload: { version: "26.4.1405" },
            },
          ])
          hooks?.onInstalling?.()
          steps.push("install-command")
          return "C:\\temp\\opencode-ui-26.4.1405.vsix"
        },
      },
    })

    service.attachSession("session-a", (type, payload) => {
      events.push({ sessionId: "session-a", type, payload })
    })

    await service.checkNow()
    events.length = 0

    const filePath = await service.installUpdate("26.4.1405")

    assert.strictEqual(filePath, "C:\\temp\\opencode-ui-26.4.1405.vsix")
    assert.deepStrictEqual(steps, ["downloaded", "install-command"])
    assert.deepStrictEqual(events, [
      {
        sessionId: "session-a",
        type: "downloading",
        payload: { version: "26.4.1405" },
      },
      {
        sessionId: "session-a",
        type: "installing",
        payload: { version: "26.4.1405" },
      },
      {
        sessionId: "session-a",
        type: "success",
        payload: { version: "26.4.1405", filePath: "C:\\temp\\opencode-ui-26.4.1405.vsix" },
      },
    ])
  })

  test("未检查到更新时 installUpdate 会 reject", async () => {
    const service = new UpdateService({
      currentVersion: "26.4.1404",
      checker: {
        async getLatest() {
          return null
        },
      },
      installer: {
        async install() {
          throw new Error("installer should not run")
        },
      },
    })

    await assert.rejects(() => service.installUpdate("26.4.1405"), /Update not available: 26\.4\.1405/)
  })

  test("版本不匹配时 installUpdate 会 reject", async () => {
    const latest: ReleaseInfo = {
      version: "26.4.1405",
      releaseUrl: "https://example.test/releases/26.4.1405",
      notes: "## update",
      publishedAt: "2026-04-14T12:00:00Z",
      vsixUrl: "https://example.test/opencode.vsix",
    }
    const service = new UpdateService({
      currentVersion: "26.4.1404",
      checker: {
        async getLatest() {
          return latest
        },
      },
      installer: {
        async install() {
          throw new Error("installer should not run")
        },
      },
    })

    await service.checkNow()

    await assert.rejects(() => service.installUpdate("26.4.1406"), /Update not available: 26\.4\.1406/)
  })

  test("installer.install 失败时 installUpdate 会广播 error 且保持可更新状态", async () => {
    const events: EventRecord[] = []
    const latest: ReleaseInfo = {
      version: "26.4.1405",
      releaseUrl: "https://example.test/releases/26.4.1405",
      notes: "## update",
      publishedAt: "2026-04-14T12:00:00Z",
      vsixUrl: "https://example.test/opencode.vsix",
    }

    const service = new UpdateService({
      currentVersion: "26.4.1404",
      checker: {
        async getLatest() {
          return latest
        },
      },
      installer: {
        async install(input: ReleaseInfo, hooks?: { onInstalling?: () => void }) {
          assert.deepStrictEqual(input, latest)
          hooks?.onInstalling?.()
          throw new Error("install failed")
        },
      },
    })

    service.attachSession("session-a", (type, payload) => {
      events.push({ sessionId: "session-a", type, payload })
    })

    await service.checkNow()
    events.length = 0

    const before = service.getUpdateInfo()

    await assert.rejects(() => service.installUpdate(latest.version), /install failed/)

    assert.deepStrictEqual(events, [
      {
        sessionId: "session-a",
        type: "downloading",
        payload: { version: latest.version },
      },
      {
        sessionId: "session-a",
        type: "installing",
        payload: { version: latest.version },
      },
      {
        sessionId: "session-a",
        type: "error",
        payload: { version: latest.version, error: "install failed" },
      },
    ])
    assert.ok(events.every((event) => event.type !== "success"))
    assert.deepStrictEqual(service.getUpdateInfo(), before)
    assert.deepStrictEqual(service.getUpdateInfo(), {
      latest,
      notifiedVersion: latest.version,
      hasUpdate: true,
    })
  })

  test("安装成功后服务状态会与已安装完成保持一致", async () => {
    const versions: string[] = []
    const latest: ReleaseInfo = {
      version: "26.4.1405",
      releaseUrl: "https://example.test/releases/26.4.1405",
      notes: "## update",
      publishedAt: "2026-04-14T12:00:00Z",
      vsixUrl: "https://example.test/opencode.vsix",
    }

    const service = new UpdateService({
      currentVersion: "26.4.1404",
      checker: {
        async getLatest(version: string) {
          versions.push(version)
          return version === latest.version ? null : latest
        },
      },
      installer: {
        async install(input: ReleaseInfo) {
          assert.deepStrictEqual(input, latest)
          return "C:\\temp\\opencode-ui-26.4.1405.vsix"
        },
      },
    })

    await service.checkNow()
    await service.installUpdate(latest.version)

    assert.deepStrictEqual(service.getUpdateInfo(), {
      latest: null,
      notifiedVersion: latest.version,
      hasUpdate: false,
    })

    const next = await service.checkNow()

    assert.strictEqual(next, null)
    assert.deepStrictEqual(versions, ["26.4.1404", "26.4.1405"])
    assert.deepStrictEqual(service.getUpdateInfo(), {
      latest: null,
      notifiedVersion: latest.version,
      hasUpdate: false,
    })
  })
})
