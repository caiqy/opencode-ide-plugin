import { ideBridge } from "../lib/ideBridge"

export type StorageScope = "global" | "workspace" | "mem"

export type ScopedStateWriteError = "host_write_failed"

export type ScopedStateWriteResult =
  | {
      ok: true
    }
  | {
      ok: false
      error: ScopedStateWriteError
    }

const cache = {
  global: new Map<string, string>(),
  workspace: new Map<string, string>(),
  mem: new Map<string, string>(),
}
const seen = new Map<string, number>()
const delay = 5000

let report: ((input: { key: string; error: ScopedStateWriteError; message: string }) => void) | null = null

function warn(key: string, error: ScopedStateWriteError) {
  const id = `${key}:${error}`
  const now = Date.now()
  const last = seen.get(id) ?? 0
  if (now - last < delay) return
  seen.set(id, now)
  report?.({ key, error, message: "设置未保存，本次会话可继续使用" })
}

export function setScopedStateWriteErrorReporter(
  fn: ((input: { key: string; error: ScopedStateWriteError; message: string }) => void) | null,
) {
  report = fn
}

export function resetScopedStateForTest() {
  cache.global.clear()
  cache.workspace.clear()
  cache.mem.clear()
  seen.clear()
  report = null
}

export async function scopedStateGet(scope: StorageScope, keys: string[]) {
  const mem = cache[scope]
  if (!ideBridge.isInstalled()) {
    return Object.fromEntries(keys.map((key) => [key, mem.get(key)]))
  }

  const host = await ideBridge.storageGet(scope, keys)
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

export async function scopedStateSet(scope: StorageScope, key: string, value: string): Promise<ScopedStateWriteResult> {
  const mem = cache[scope]
  mem.set(key, value)
  if (!ideBridge.isInstalled()) return { ok: true }

  const ok = await ideBridge.storageSet(scope, key, value)
  if (ok) return { ok: true }

  warn(key, "host_write_failed")
  return {
    ok: false,
    error: "host_write_failed",
  }
}

export async function scopedStateGetJSON<T>(scope: StorageScope, key: string, fallback: T): Promise<T> {
  const raw = (await scopedStateGet(scope, [key]))[key]
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export async function scopedStateSetJSON(
  scope: StorageScope,
  key: string,
  value: unknown,
): Promise<ScopedStateWriteResult> {
  return scopedStateSet(scope, key, JSON.stringify(value))
}
