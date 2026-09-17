import * as vscode from "vscode"
import { logger } from "../globals"
import { DebugStateStore } from "./DebugState"

/** 当前扩展进程内的调试会话状态；由 DAP 事件与 VS Code 会话事件驱动。 */
export const debugStateStore = new DebugStateStore()

export function isDebugApiAvailable(): boolean {
  return typeof vscode.debug?.startDebugging === "function"
}

function sessionInfo(session: vscode.DebugSession): { id: string; name: string; type: string } {
  return { id: session.id, name: session.name, type: session.type }
}

/**
 * 注册调试会话追踪（会话生命周期 + DAP 事件），为 ACP「运行和调试」工具维护暂停状态缓存。
 * 只观察，不改变 VS Code 调试行为。
 */
export function registerDebugTracking(): vscode.Disposable {
  const disposables: vscode.Disposable[] = []
  debugStateStore.reset()

  try {
    const debug = vscode.debug
    const active = debug.activeDebugSession
    if (active) {
      debugStateStore.setActive(sessionInfo(active))
    }

    disposables.push(
      debug.onDidStartDebugSession((session) => {
        debugStateStore.upsertSession(sessionInfo(session))
      }),
      debug.onDidTerminateDebugSession((session) => {
        debugStateStore.removeSession(session.id)
      }),
      debug.onDidChangeActiveDebugSession((session) => {
        debugStateStore.setActive(session ? sessionInfo(session) : null)
      }),
    )

    if (typeof debug.registerDebugAdapterTrackerFactory === "function") {
      disposables.push(
        debug.registerDebugAdapterTrackerFactory("*", {
          createDebugAdapterTracker(session) {
            return {
              onDidSendMessage(message: unknown) {
                debugStateStore.onDapMessage(session.id, message)
              },
            }
          },
        }),
      )
    }
  } catch (error) {
    logger.appendLine(`Failed to register debug tracking: ${error}`)
  }

  return vscode.Disposable.from(...disposables)
}
