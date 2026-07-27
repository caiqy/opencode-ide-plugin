import * as assert from "assert"
import * as path from "path"
import * as sinon from "sinon"
import * as vscode from "vscode"
import {
  createSystemNotificationUri,
  parseSystemNotificationUri,
  showSystemNotification,
  systemNotificationUriPath,
} from "../../ui/systemNotification"

type NotificationOptions = {
  title: string
  message: string
  icon: string
  wait: boolean
  sound: boolean
}

type NotificationCallback = (error: Error | null, response: string) => void

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function completeCommand(_command: string, _args: string[], callback: NotificationCallback) {
  callback(null, "")
}

function createNotifier() {
  const notifications: Array<{
    options: NotificationOptions
    callback?: NotificationCallback
  }> = []

  const notifier = {
    notify(notification: NotificationOptions, callback?: NotificationCallback) {
      notifications.push({ options: notification, callback })
      return notifier
    },
    once() {
      return notifier
    },
  }

  return {
    notifier,
    notifications,
  }
}

suite("system notification", () => {
  teardown(() => {
    sinon.restore()
  })

  test("returns immediately after notify and does not wait for click callback", async () => {
    const commands: Array<{ command: string; args: string[] }> = []
    const deps = {
      authority: "caiqy.opencode-ui",
      platform: "win32" as const,
      asExternalUri: async (uri: vscode.Uri) => uri,
      loadNotifier: async () => {
        throw new Error("node-notifier should not load on Windows")
      },
      runCommand: (command: string, args: string[], callback: NotificationCallback) => {
        commands.push({ command, args })
        if (args[0] === "-install") {
          callback(null, "")
        }
      },
      log: () => {},
    }

    const result = await Promise.race([
      showSystemNotification(
        {
          bridgeSessionID: "bridge-session-1",
          sessionID: "target-session-2",
          title: "Agent finished",
          body: "Finished working.",
          extensionUri: vscode.Uri.file("D:/test-extension"),
        },
        deps,
      ).then(() => "resolved"),
      wait(20).then(() => "timeout"),
    ])

    assert.strictEqual(result, "resolved")
    assert.strictEqual(commands.length, 2)
  })

  test("uses Windows toast arguments with the relay URI and never loads node-notifier", async () => {
    const commands: Array<{ command: string; args: string[] }> = []
    const relayUri1 = vscode.Uri.parse("https://relay.test/window/1")
    const relayUri2 = vscode.Uri.parse("https://relay.test/window/2")
    const extensionUri = vscode.Uri.file("D:/test-extension")
    const sourceUris: vscode.Uri[] = []
    const deps = {
      authority: "caiqy.opencode-ui",
      platform: "win32" as const,
      asExternalUri: async (uri: vscode.Uri) => {
        sourceUris.push(uri)
        if (sourceUris.length === 1) return relayUri1
        if (sourceUris.length === 2) return relayUri2
        throw new Error("unexpected relay request")
      },
      loadNotifier: async () => {
        throw new Error("node-notifier should not load on Windows")
      },
      runCommand: (command: string, args: string[], callback: NotificationCallback) => {
        commands.push({ command, args })
        if (args[0] === "-install") {
          callback(null, "")
        }
      },
      log: () => {},
    }

    await showSystemNotification(
      {
        bridgeSessionID: "bridge-session-1",
        sessionID: "target-session-2",
        title: "Agent finished",
        body: "Finished working.",
        extensionUri,
      },
      deps,
    )

    await showSystemNotification(
      {
        bridgeSessionID: "bridge-session-3",
        sessionID: "target-session-4",
        title: "Permission needed",
        body: "Approve tool call.",
        extensionUri,
      },
      deps,
    )

    assert.strictEqual(commands.length, 4)
    assert.deepStrictEqual(commands[0], {
      command: path.join(extensionUri.fsPath, "resources", "windows", "snoretoast-x64.exe"),
      args: ["-install", "OpenCodeUI\\OpenCodeUI", process.execPath, "caiqy.opencode-ui"],
    })
    assert.deepStrictEqual(commands[1], {
      command: path.join(extensionUri.fsPath, "resources", "windows", "snoretoast-x64.exe"),
      args: [
        "-appID",
        "caiqy.opencode-ui",
        "-pid",
        process.ppid.toString(),
        "-t",
        "Agent finished",
        "-m",
        "Finished working.",
        "-p",
        path.join(extensionUri.fsPath, "resources", "icon.png"),
        "-silent",
        "-protocol",
        relayUri1.toString(),
      ],
    })
    assert.deepStrictEqual(commands[2], {
      command: path.join(extensionUri.fsPath, "resources", "windows", "snoretoast-x64.exe"),
      args: ["-install", "OpenCodeUI\\OpenCodeUI", process.execPath, "caiqy.opencode-ui"],
    })
    assert.deepStrictEqual(commands[3], {
      command: path.join(extensionUri.fsPath, "resources", "windows", "snoretoast-x64.exe"),
      args: [
        "-appID",
        "caiqy.opencode-ui",
        "-pid",
        process.ppid.toString(),
        "-t",
        "Permission needed",
        "-m",
        "Approve tool call.",
        "-p",
        path.join(extensionUri.fsPath, "resources", "icon.png"),
        "-silent",
        "-protocol",
        relayUri2.toString(),
      ],
    })
  })

  test("logs Windows install failures without loading node-notifier", async () => {
    const commands: Array<{ command: string; args: string[] }> = []
    const logs: string[] = []
    let loadNotifierCalled = false

    await showSystemNotification(
      {
        bridgeSessionID: "bridge-session-1",
        sessionID: "target-session-2",
        title: "Agent finished",
        body: "Finished working.",
        extensionUri: vscode.Uri.file("D:/test-extension"),
      },
      {
        authority: "caiqy.opencode-ui",
        platform: "win32" as const,
        asExternalUri: async (uri: vscode.Uri) => uri,
        loadNotifier: async () => {
          loadNotifierCalled = true
          throw new Error("node-notifier should not load on Windows")
        },
        runCommand: (command: string, args: string[], callback: NotificationCallback) => {
          commands.push({ command, args })
          if (args[0] === "-install") {
            callback(new Error("install failed"), "")
          }
        },
        log: (message: string) => {
          logs.push(message)
        },
      },
    )

    assert.strictEqual(commands.length, 1)
    assert.strictEqual(loadNotifierCalled, false)
    assert.strictEqual(logs.length, 1)
    assert.ok(logs[0]?.includes("install failed"))
  })

  test("logs Windows relay resolution failures without loading node-notifier", async () => {
    const commands: Array<{ command: string; args: string[] }> = []
    const logs: string[] = []
    let loadNotifierCalled = false

    await showSystemNotification(
      {
        bridgeSessionID: "bridge-session-1",
        sessionID: "target-session-2",
        title: "Agent finished",
        body: "Finished working.",
        extensionUri: vscode.Uri.file("D:/test-extension"),
      },
      {
        authority: "caiqy.opencode-ui",
        platform: "win32" as const,
        asExternalUri: async () => {
          throw new Error("relay failed")
        },
        loadNotifier: async () => {
          loadNotifierCalled = true
          throw new Error("node-notifier should not load on Windows")
        },
        runCommand: (command: string, args: string[], callback: NotificationCallback) => {
          commands.push({ command, args })
          if (args[0] === "-install") {
            callback(null, "")
          }
        },
        log: (message: string) => {
          logs.push(message)
        },
      },
    )

    assert.strictEqual(commands.length, 1)
    assert.strictEqual(loadNotifierCalled, false)
    assert.strictEqual(logs.length, 1)
    assert.ok(logs[0]?.includes("relay failed"))
  })

  test("ignores Windows SnoreToast action exit codes 1 through 5", async () => {
    const logs: string[] = []
    const callbacks: NotificationCallback[] = []

    await showSystemNotification(
      {
        bridgeSessionID: "bridge-session-1",
        sessionID: "target-session-2",
        title: "Agent finished",
        body: "Finished working.",
        extensionUri: vscode.Uri.file("D:/test-extension"),
      },
      {
        authority: "caiqy.opencode-ui",
        platform: "win32" as const,
        asExternalUri: async (uri: vscode.Uri) => uri,
        loadNotifier: async () => {
          throw new Error("node-notifier should not load on Windows")
        },
        runCommand: (command: string, args: string[], callback: NotificationCallback) => {
          if (args[0] === "-install") {
            callback(null, "")
            return
          }

          callbacks.push(callback)
        },
        log: (message: string) => {
          logs.push(message)
        },
      },
    )

    assert.strictEqual(callbacks.length, 1)

    for (const code of [1, 2, 3, 4, 5]) {
      callbacks[0]?.(Object.assign(new Error(`action ${code}`), { code }), "")
      assert.strictEqual(logs.length, 0)
    }
  })

  test("logs Windows SnoreToast startup failures and non-action exit codes", async () => {
    const logs: string[] = []
    const callbacks: NotificationCallback[] = []

    await showSystemNotification(
      {
        bridgeSessionID: "bridge-session-1",
        sessionID: "target-session-2",
        title: "Agent finished",
        body: "Finished working.",
        extensionUri: vscode.Uri.file("D:/test-extension"),
      },
      {
        authority: "caiqy.opencode-ui",
        platform: "win32" as const,
        asExternalUri: async (uri: vscode.Uri) => uri,
        loadNotifier: async () => {
          throw new Error("node-notifier should not load on Windows")
        },
        runCommand: (command: string, args: string[], callback: NotificationCallback) => {
          if (args[0] === "-install") {
            callback(null, "")
            return
          }

          callbacks.push(callback)
        },
        log: (message: string) => {
          logs.push(message)
        },
      },
    )

    assert.strictEqual(callbacks.length, 1)

    callbacks[0]?.(new Error("spawn failed"), "")
    callbacks[0]?.(Object.assign(new Error("other exit"), { code: 6 }), "")

    assert.strictEqual(logs.length, 2)
    assert.ok(logs[0]?.includes("spawn failed"))
    assert.ok(logs[1]?.includes("other exit"))
  })

  test("uses actionable notify-send on Linux and opens the callback URI", async () => {
    const commands: Array<{ command: string; args: string[] }> = []
    const uris: vscode.Uri[] = []
    const extensionUri = vscode.Uri.file("/test-extension")
    let commandCallback: ((error: Error | null, stdout: string) => void) | undefined
    const deps = {
      platform: "linux" as const,
      loadNotifier: async () => {
        throw new Error("node-notifier should not load on Linux")
      },
      runCommand: (
        command: string,
        args: string[],
        callback: (error: Error | null, stdout: string) => void,
      ) => {
        commands.push({ command, args })
        commandCallback = callback
      },
      openExternal: async (uri: vscode.Uri) => {
        uris.push(uri)
        return true
      },
      log: () => {},
    }

    await showSystemNotification(
      {
        bridgeSessionID: "bridge-session-1",
        sessionID: "target-session-2",
        title: "Agent finished",
        body: "Finished working.",
        extensionUri,
      },
      deps,
    )

    assert.deepStrictEqual(commands, [
      {
        command: "notify-send",
        args: [
          "--app-name=OpenCode",
          `--icon=${path.join(extensionUri.fsPath, "resources", "icon.png")}`,
          "--hint=boolean:suppress-sound:true",
          "--action=default=Open",
          "--wait",
          "Agent finished",
          "Finished working.",
        ],
      },
    ])
    assert.ok(commandCallback)
    commandCallback(null, "default\n")
    await wait(0)

    assert.strictEqual(uris.length, 1)
    assert.deepStrictEqual(parseSystemNotificationUri(uris[0]!), {
      bridgeSessionID: "bridge-session-1",
      sessionID: "target-session-2",
    })
  })

  test("opens the notification URI for the originating VS Code window", async () => {
    const openedUris: vscode.Uri[] = []
    const { notifier, notifications } = createNotifier()
    const sourceUri = createSystemNotificationUri({
      authority: "caiqy.opencode-ui",
      bridgeSessionID: "bridge-session-1",
      sessionID: "target-session-2",
    })
    const deps = {
      authority: "caiqy.opencode-ui",
      platform: "darwin" as const,
      loadNotifier: async () => notifier,
      openExternal: async (uri: vscode.Uri) => {
        openedUris.push(uri)
        return true
      },
      runCommand: completeCommand,
      log: () => {},
    }

    await showSystemNotification(
      {
        bridgeSessionID: "bridge-session-1",
        sessionID: "target-session-2",
        title: "Agent finished",
        body: "Finished working.",
        extensionUri: vscode.Uri.file("D:/test-extension"),
      },
      deps,
    )

    notifications[0]?.callback?.(null, "activate")
    await wait(0)

    assert.deepStrictEqual(parseSystemNotificationUri(openedUris[0]!), {
      bridgeSessionID: "bridge-session-1",
      sessionID: "target-session-2",
    })
    assert.deepStrictEqual(openedUris, [sourceUri])
  })

  test("logs notifier failures and never falls back to showInformationMessage", async () => {
    const logs: string[] = []
    const { notifier, notifications } = createNotifier()
    const showInformationMessage = sinon.stub(vscode.window, "showInformationMessage")

    await showSystemNotification(
      {
        bridgeSessionID: "bridge-session-1",
        sessionID: "target-session-2",
        title: "Agent finished",
        body: "Finished working.",
        extensionUri: vscode.Uri.file("D:/test-extension"),
      },
      {
        authority: "caiqy.opencode-ui",
        platform: "darwin",
        loadNotifier: async () => notifier,
        openExternal: async () => true,
        runCommand: completeCommand,
        log: (message: string) => {
          logs.push(message)
        },
      },
    )

    notifications[0]?.callback?.(new Error("boom"), "timeout")

    assert.strictEqual(showInformationMessage.called, false)
    assert.strictEqual(logs.length, 1)
    assert.ok(logs[0]?.includes("system notification failed"))
    assert.ok(logs[0]?.includes("boom"))
  })

  test("logs synchronous URI open failures from the click callback", async () => {
    const logs: string[] = []
    const { notifier, notifications } = createNotifier()

    await showSystemNotification(
      {
        bridgeSessionID: "bridge-session-1",
        sessionID: "target-session-2",
        title: "Agent finished",
        body: "Finished working.",
        extensionUri: vscode.Uri.file("D:/test-extension"),
      },
      {
        authority: "caiqy.opencode-ui",
        platform: "darwin",
        loadNotifier: async () => notifier,
        openExternal: () => {
          throw new Error("open failed")
        },
        runCommand: completeCommand,
        log: (message: string) => {
          logs.push(message)
        },
      },
    )

    notifications[0]?.callback?.(null, "activate")
    await wait(0)

    assert.strictEqual(logs.length, 1)
    assert.ok(logs[0]?.includes("system notification click failed"))
    assert.ok(logs[0]?.includes("open failed"))
  })

  test("logs when URI opening resolves false", async () => {
    const logs: string[] = []
    const { notifier, notifications } = createNotifier()

    await showSystemNotification(
      {
        bridgeSessionID: "bridge-session-1",
        sessionID: "target-session-2",
        title: "Agent finished",
        body: "Finished working.",
        extensionUri: vscode.Uri.file("D:/test-extension"),
      },
      {
        authority: "caiqy.opencode-ui",
        platform: "darwin",
        loadNotifier: async () => notifier,
        openExternal: async () => false,
        runCommand: completeCommand,
        log: (message: string) => {
          logs.push(message)
        },
      },
    )

    notifications[0]?.callback?.(null, "activate")
    await wait(0)

    assert.strictEqual(logs.length, 1)
    assert.ok(logs[0]?.includes("system notification click failed"))
  })
})
