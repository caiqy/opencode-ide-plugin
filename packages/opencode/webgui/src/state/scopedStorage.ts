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

type ScopedStateWriteReport = { key: string; error: ScopedStateWriteError; message: string }

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
const revisions = {
  global: new Map<string, number>(),
  workspace: new Map<string, number>(),
  mem: new Map<string, number>(),
}
let report: ((input: ScopedStateWriteReport) => void) | null = null
let pendingReport: ScopedStateWriteReport | null = null
let warned = false

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
  if (warned) return
  const input = { key, error, message: "设置未保存，本次会话可继续使用" }
  if (!report) {
    pendingReport ??= input
    return
  }
  warned = true
  report(input)
}

export function setScopedStateWriteErrorReporter(fn: ((input: ScopedStateWriteReport) => void) | null) {
  report = fn
  if (!report || warned || !pendingReport) return
  warned = true
  report(pendingReport)
  pendingReport = null
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
  revisions.global.clear()
  revisions.workspace.clear()
  revisions.mem.clear()
  warned = false
  pendingReport = null
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

  const revisionsAtRead = new Map(keys.map((key) => [key, revisions[scope].get(key)]))
  // Keep write authority when an in-flight write settles before this host read returns.
  const localAtRead = new Set(keys.filter((key) => dirtyKeys.has(key) || writes[scope].has(key)))
  const host = await ideBridge.storageGet(scope, keys)
  if (!host) {
    return Object.fromEntries(keys.map((key) => [key, mem.get(key)]))
  }

  keys.forEach((key) => {
    const local =
      localAtRead.has(key) ||
      dirtyKeys.has(key) ||
      writes[scope].has(key) ||
      revisions[scope].get(key) !== revisionsAtRead.get(key)
    if (!local && typeof host[key] === "string") {
      mem.set(key, host[key]!)
    }
  })

  return Object.fromEntries(
    keys.map((key) => {
      const local =
        localAtRead.has(key) ||
        dirtyKeys.has(key) ||
        writes[scope].has(key) ||
        revisions[scope].get(key) !== revisionsAtRead.get(key)
      return [key, local ? (mem.get(key) ?? host[key]) : (host[key] ?? mem.get(key))]
    }),
  )
}

export function scopedStateSet(scope: StorageScope, key: string, value: string): Promise<ScopedStateWriteResult> {
  cache[scope].set(key, value)
  revisions[scope].set(key, (revisions[scope].get(key) ?? 0) + 1)
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
    if (pending.length === 0) {
      if (dirty.global.size || dirty.workspace.size || dirty.mem.size) {
        throw new Error("Scoped storage has unsaved state")
      }
      return
    }
    await Promise.all(pending)
  }
}

export async function retryScopedStateWrites(): Promise<void> {
  await Promise.all(
    (["global", "workspace", "mem"] as const).flatMap((scope) =>
      [...dirty[scope]].flatMap((key) => {
        if (writes[scope].has(key)) return []
        const value = cache[scope].get(key)
        return value === undefined ? [] : [scopedStateSet(scope, key, value)]
      }),
    ),
  )
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
