import { ideBridge } from "../lib/ideBridge"

export type GlobalStateWriteError = "host_write_failed"

export type GlobalStateWriteResult =
  | {
      ok: true
    }
  | {
      ok: false
      error: GlobalStateWriteError
    }

const mem = new Map<string, string>()
const seen = new Map<string, number>()
const delay = 5000

let report: ((input: { key: string; error: GlobalStateWriteError; message: string }) => void) | null = null

function warn(key: string, error: GlobalStateWriteError) {
  const id = `${key}:${error}`
  const now = Date.now()
  const last = seen.get(id) ?? 0
  if (now - last < delay) return
  seen.set(id, now)
  report?.({ key, error, message: "设置未保存，本次会话可继续使用" })
}

export function setGlobalStateWriteErrorReporter(
  fn: ((input: { key: string; error: GlobalStateWriteError; message: string }) => void) | null,
) {
  report = fn
}

export function resetGlobalStateForTest() {
  mem.clear()
  seen.clear()
  report = null
}

export async function globalStateGet(keys: string[]) {
  if (!ideBridge.isInstalled()) {
    return Object.fromEntries(keys.map((key) => [key, mem.get(key)]))
  }

  const host = await ideBridge.storageGet(keys)
  if (!host) {
    return Object.fromEntries(keys.map((key) => [key, mem.get(key)]))
  }

  keys.forEach((key) => {
    if (typeof host[key] === "string") {
      mem.set(key, host[key]!)
    }
  })

  return Object.fromEntries(keys.map((key) => [key, host[key] ?? mem.get(key)]))
}

export async function globalStateSet(key: string, value: string): Promise<GlobalStateWriteResult> {
  mem.set(key, value)
  if (!ideBridge.isInstalled()) return { ok: true }

  const ok = await ideBridge.storageSet(key, value)
  if (ok) return { ok: true }

  warn(key, "host_write_failed")
  return {
    ok: false,
    error: "host_write_failed",
  }
}

export async function globalStateGetJSON<T>(key: string, fallback: T): Promise<T> {
  const raw = (await globalStateGet([key]))[key]
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export async function globalStateSetJSON(key: string, value: unknown): Promise<GlobalStateWriteResult> {
  return globalStateSet(key, JSON.stringify(value))
}
