import { execFile } from "child_process"
import { join } from "path"
import * as vscode from "vscode"
import { logger } from "../globals"
import { extensionId } from "../utils/extensionIdentity"

type NotificationOptions = {
  title: string
  message: string
  icon: string
  wait: boolean
  sound: boolean
}

type NotificationCallback = (error: Error | null, response: string, metadata?: unknown) => void

interface Notifier {
  notify(options: NotificationOptions, callback?: NotificationCallback): void
}

type NotifierModule = Notifier | { default?: Notifier }

export interface ShowSystemNotificationInput {
  bridgeSessionID: string
  sessionID: string
  title: string
  body: string
  extensionUri: vscode.Uri
}

export interface SystemNotificationDeps {
  asExternalUri?: (uri: vscode.Uri) => Thenable<vscode.Uri>
  authority?: string
  loadNotifier?: () => Promise<NotifierModule>
  openExternal?: (uri: vscode.Uri) => Thenable<boolean>
  platform?: NodeJS.Platform
  runCommand?: (command: string, args: string[], callback: (error: Error | null, stdout: string) => void) => void
  log?: (message: string) => void
}

export const systemNotificationUriPath = "/open-session"

export function createSystemNotificationUri(input: {
  authority?: string
  bridgeSessionID: string
  sessionID: string
}): vscode.Uri {
  const authority = input.authority ?? extensionId
  const query = new URLSearchParams({
    bridgeSessionID: input.bridgeSessionID,
    sessionID: input.sessionID,
  }).toString()

  return vscode.Uri.parse(`vscode://${authority}${systemNotificationUriPath}?${query}`)
}

export function parseSystemNotificationUri(uri: vscode.Uri):
  | { bridgeSessionID: string; sessionID: string }
  | undefined {
  if (uri.scheme !== "vscode" || uri.path !== systemNotificationUriPath) {
    return
  }

  const params = new URLSearchParams(uri.query)
  const bridgeSessionID = params.get("bridgeSessionID")?.trim()
  const sessionID = params.get("sessionID")?.trim()
  if (!bridgeSessionID || !sessionID) {
    return
  }

  return { bridgeSessionID, sessionID }
}

export async function showSystemNotification(
  input: ShowSystemNotificationInput,
  deps: SystemNotificationDeps = {},
): Promise<void> {
  const log = deps.log ?? ((message: string) => logger.appendLine(message))
  const openExternal = deps.openExternal ?? ((uri: vscode.Uri) => vscode.env.openExternal(uri))
  const authority = deps.authority ?? extensionId
  const platform = deps.platform ?? process.platform

  try {
    const sourceUri = createSystemNotificationUri({
      authority,
      bridgeSessionID: input.bridgeSessionID,
      sessionID: input.sessionID,
    })
    const icon = join(input.extensionUri.fsPath, "resources", "icon.png")

    if (platform === "win32") {
      const windowsNotifierPath = join(input.extensionUri.fsPath, "resources", "windows", "snoretoast-x64.exe")
      await new Promise<void>((resolve, reject) => {
        (deps.runCommand ?? runCommand)(
          windowsNotifierPath,
          ["-install", "OpenCodeUI\\OpenCodeUI", process.execPath, authority],
          (error) => {
            if (error) {
              reject(error)
              return
            }
            resolve()
          },
        )
      })

      const targetUri = await (deps.asExternalUri ?? ((uri) => vscode.env.asExternalUri(uri)))(sourceUri)

      ;(deps.runCommand ?? runCommand)(
        windowsNotifierPath,
        [
          "-appID",
          authority,
          "-pid",
          process.ppid.toString(),
          "-t",
          input.title,
          "-m",
          input.body,
          "-p",
          icon,
          "-silent",
          "-protocol",
          targetUri.toString(),
        ],
        (error) => {
          if (!error) {
            return
          }

          const code = error && "code" in error ? error.code : undefined
          if (typeof code === "number" && code >= 1 && code <= 5) {
            return
          }

          log(`system notification failed: ${error}`)
        },
      )
      return
    }

    const targetUri = sourceUri
    const options = {
      title: input.title,
      message: input.body,
      icon,
      wait: true,
      sound: false,
    }
    const callback = (error: Error | null, response: string) => {
      if (error) {
        log(`system notification failed: ${error}`)
        return
      }

      if (response !== "activate" && response !== "click") {
        return
      }

      try {
        void Promise.resolve(openExternal(targetUri))
          .then((opened) => {
            if (!opened) log("system notification click failed: URI was not opened")
          })
          .catch((openError: unknown) => {
            log(`system notification click failed: ${openError}`)
          })
      } catch (openError) {
        log(`system notification click failed: ${openError}`)
      }
    }

    if (platform === "linux") {
      (deps.runCommand ?? runCommand)(
        "notify-send",
        [
          "--app-name=OpenCode",
          `--icon=${options.icon}`,
          "--hint=boolean:suppress-sound:true",
          "--action=default=Open",
          "--wait",
          options.title,
          options.message,
        ],
        (error, stdout) => callback(error, stdout.trim() === "default" ? "click" : stdout.trim()),
      )
      return
    }

    const notifier = resolveNotifier(await (deps.loadNotifier ?? loadNotifier)())
    notifier.notify(options, callback)
  } catch (error) {
    log(`system notification failed: ${error}`)
  }
}

async function loadNotifier(): Promise<NotifierModule> {
  return import("node-notifier")
}

function resolveNotifier(module: NotifierModule): Notifier {
  if ("notify" in module) {
    return module
  }

  if (module.default) {
    return module.default
  }

  throw new Error("node-notifier module missing notify()")
}

function runCommand(
  command: string,
  args: string[],
  callback: (error: Error | null, stdout: string) => void,
): void {
  execFile(command, args, { encoding: "utf8", windowsHide: true }, (error, stdout) => {
    callback(error, stdout)
  })
}
