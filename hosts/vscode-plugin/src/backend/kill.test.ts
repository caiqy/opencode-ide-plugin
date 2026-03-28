import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import test from "node:test"
import { killTree } from "./kill"

test("killTree 在 win32 会使用 taskkill 杀掉整个进程树", async () => {
  const calls: string[] = []
  const args: string[][] = []
  const proc = Object.assign(new EventEmitter(), {
    pid: 42,
    exitCode: null,
    signalCode: null,
    kill(sig?: NodeJS.Signals | number) {
      calls.push(String(sig))
      return true
    },
  })

  await killTree(proc, {
    platform: "win32",
    spawn(cmd, list) {
      args.push([cmd, ...list])
      const child = new EventEmitter()
      queueMicrotask(() => child.emit("exit", 0))
      return child as EventEmitter & { once: EventEmitter["once"] }
    },
    sleep: async () => {},
  })

  assert.deepStrictEqual(args, [["taskkill", "/pid", "42", "/f", "/t"]])
  assert.deepStrictEqual(calls, [])
})
