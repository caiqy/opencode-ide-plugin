import { describe, expect, test } from "bun:test"
import { jsonSchema, tool } from "ai"
import { createExecutionQueue, queueToolExecutions } from "../../src/tool/execution-queue"

describe("tool execution queue", () => {
  test("runs queued work in FIFO order and respects the concurrency limit", async () => {
    const queue = createExecutionQueue(2)
    let active = 0
    let peak = 0
    const order: string[] = []
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })

    const run = (name: string, wait = false) =>
      queue.run(async () => {
        active++
        peak = Math.max(peak, active)
        order.push(`${name}:start`)
        if (wait) await blocked
        order.push(`${name}:end`)
        active--
        return name
      })

    const first = run("first", true)
    const second = run("second", true)
    const third = run("third")

    await Promise.resolve()
    expect(peak).toBe(2)
    expect(order).toEqual(["first:start", "second:start"])

    release()
    await expect(Promise.all([first, second, third])).resolves.toEqual(["first", "second", "third"])
    expect(order).toEqual(["first:start", "second:start", "first:end", "second:end", "third:start", "third:end"])
  })

  test("does not start a queued task after its signal is aborted", async () => {
    const queue = createExecutionQueue(1)
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const first = queue.run(() => blocked)
    const abort = new AbortController()
    let called = false
    const cancelled = queue.run(() => {
      called = true
    }, abort.signal)

    abort.abort()
    release()

    await first
    await expect(cancelled).rejects.toThrow("Tool execution cancelled")
    expect(called).toBe(false)
  })

  test("releases the next task after an error or an empty result", async () => {
    const queue = createExecutionQueue(1)
    const failed = queue.run(() => {
      throw new Error("tool failed")
    })
    const empty = queue.run(() => undefined)
    const next = queue.run(() => "next")

    await expect(failed).rejects.toThrow("tool failed")
    await expect(empty).resolves.toBeUndefined()
    await expect(next).resolves.toBe("next")
  })

  test("holds an acquired task slot until it is released", async () => {
    const queue = createExecutionQueue(1)
    const release = await queue.acquire()
    let started = false
    const next = queue.run(() => {
      started = true
      return "next"
    })

    await Promise.resolve()
    expect(started).toBe(false)

    release()
    await expect(next).resolves.toBe("next")
  })

  test("publishes the release function when a task acquires a slot", async () => {
    const queue = createExecutionQueue(1)
    let published: (() => void) | undefined
    const release = await queue.acquire(undefined, (value) => {
      published = value
    })

    expect(published).toBe(release)
    release()
  })

  test("lowering the limit does not create capacity beside active work", async () => {
    const queue = createExecutionQueue(2)
    const first = await queue.acquire()
    const second = await queue.acquire()
    let started = false

    queue.setLimit(1)
    const next = queue.run(() => {
      started = true
    })
    await Promise.resolve()
    expect(started).toBe(false)

    first()
    await Promise.resolve()
    expect(started).toBe(false)

    second()
    await next
    expect(started).toBe(true)
  })

  test("wraps websearch without changing task or other tools", async () => {
    const execute = async () => "done"
    const makeTool = () => tool({ inputSchema: jsonSchema({ type: "object", properties: {} }), execute })
    const websearch = makeTool()
    const task = makeTool()
    const read = makeTool()
    const tools = queueToolExecutions({ websearch, task, read }, { websearch: 1, subagent: 2 })

    expect(tools.websearch).not.toBe(websearch)
    expect(tools.task).toBe(task)
    expect(tools.read).toBe(read)
    await expect(tools.websearch.execute?.({}, { toolCallId: "test", messages: [] })).resolves.toBe("done")
  })
})
