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
const dirty = {
  global: new Set<string>(),
  workspace: new Set<string>(),
  mem: new Set<string>(),
}
const writes = {
  global: new Map<string, Promise<ScopedStateWriteResult>>(),
  workspace: new Map<string, Promise<ScopedStateWriteResult>>(),
  mem: new Map<string, Promise<ScopedStateWriteResult>>(),
}
const seen = new Map<string, number>()
const delay = 5000

let report: ((input: { key: string; error: ScopedStateWriteError; message: string }) => void) | null = null

function browserKey(scope: StorageScope, key: string) {
  return `opencode:webgui:scoped:${scope}:${key}`
}

function browserGet(scope: StorageScope, key: string) {
  if (scope === "mem") return undefined
  try {
    return window.localStorage.getItem(browserKey(scope, key)) ?? undefined
  } catch {
    return undefined
  }
}

function browserSet(scope: StorageScope, key: string, value: string) {
  if (scope === "mem") return true
  try {
    window.localStorage.setItem(browserKey(scope, key), value)
    return true
  } catch {
    return false
  }
}

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
  dirty.global.clear()
  dirty.workspace.clear()
  dirty.mem.clear()
  writes.global.clear()
  writes.workspace.clear()
  writes.mem.clear()
  seen.clear()
  report = null
}

export async function scopedStateGet(scope: StorageScope, keys: string[]) {
  const mem = cache[scope]
  const dirtyKeys = dirty[scope]
  if (!ideBridge.isInstalled()) {
    return Object.fromEntries(
      keys.map((key) => {
        const local = dirtyKeys.has(key) || writes[scope].has(key)
        return [key, local ? (mem.get(key) ?? browserGet(scope, key)) : (browserGet(scope, key) ?? mem.get(key))]
      }),
    )
  }

  const host = await ideBridge.storageGet(scope, keys)
  if (!host) {
    return Object.fromEntries(keys.map((key) => [key, mem.get(key)]))
  }

  keys.forEach((key) => {
    const local = dirtyKeys.has(key) || writes[scope].has(key)
    if (!local && typeof host[key] === "string") {
      mem.set(key, host[key]!)
    }
  })

  return Object.fromEntries(
    keys.map((key) => {
      const local = dirtyKeys.has(key) || writes[scope].has(key)
      return [key, local ? (mem.get(key) ?? host[key]) : (host[key] ?? mem.get(key))]
    }),
  )
}

export function scopedStateSet(scope: StorageScope, key: string, value: string): Promise<ScopedStateWriteResult> {
  cache[scope].set(key, value)
  const queued = Promise.resolve(writes[scope].get(key))
    .catch(() => undefined)
    .then(() => writeScopedState(scope, key, value))
    .then((result) => {
      if (writes[scope].get(key) === queued) writes[scope].delete(key)
      return result
    })
  writes[scope].set(key, queued)
  return queued
}

async function writeScopedState(scope: StorageScope, key: string, value: string): Promise<ScopedStateWriteResult> {
  const dirtyKeys = dirty[scope]
  if (!ideBridge.isInstalled()) {
    const ok = browserSet(scope, key, value)
    if (ok) {
      dirtyKeys.delete(key)
      return { ok: true }
    }

    dirtyKeys.add(key)
    warn(key, "host_write_failed")
    return {
      ok: false,
      error: "host_write_failed",
    }
  }

  const ok = await Promise.resolve(ideBridge.storageSet(scope, key, value)).catch(() => false)
  if (ok) {
    dirtyKeys.delete(key)
    return { ok: true }
  }

  dirtyKeys.add(key)
  warn(key, "host_write_failed")
  return {
    ok: false,
    error: "host_write_failed",
  }
}

export async function flushScopedStateWrites(): Promise<void> {
  while (true) {
    const pending = [...writes.global.values(), ...writes.workspace.values(), ...writes.mem.values()]
    if (pending.length === 0) return
    await Promise.all(pending)
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
