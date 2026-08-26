import type { Tool } from "ai"

export function createExecutionQueue(limit: number) {
  let capacity = limit
  let active = 0
  const pending: Array<() => void> = []

  const drain = () => {
    while (active < capacity && pending.length > 0) pending.shift()?.()
  }

  const acquire = (signal?: AbortSignal, onAcquire?: (release: () => void) => void) => {
    if (signal?.aborted) return Promise.reject(new Error("Tool execution cancelled"))
    return new Promise<() => void>((resolve, reject) => {
      const next = () => {
        signal?.removeEventListener("abort", onAbort)
        if (signal?.aborted) {
          reject(new Error("Tool execution cancelled"))
          drain()
          return
        }

        active++
        let released = false
        const release = () => {
          if (released) return
          released = true
          active--
          drain()
        }
        onAcquire?.(release)
        resolve(release)
      }
      const onAbort = () => {
        const index = pending.indexOf(next)
        if (index < 0) return
        pending.splice(index, 1)
        reject(new Error("Tool execution cancelled"))
        drain()
      }
      pending.push(next)
      signal?.addEventListener("abort", onAbort, { once: true })
      drain()
    })
  }

  return {
    acquire,
    setLimit(limit: number) {
      capacity = limit
      drain()
    },
    run<T>(task: () => T | PromiseLike<T>, signal?: AbortSignal) {
      return acquire(signal).then((release) => {
        if (signal?.aborted) {
          release()
          throw new Error("Tool execution cancelled")
        }
        try {
          return Promise.resolve(task()).finally(release)
        } catch (error) {
          release()
          throw error
        }
      })
    },
  }
}

export function queueToolExecutions(
  tools: Record<string, Tool>,
  limits?: { readonly websearch?: number; readonly subagent?: number },
) {
  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => {
      const limit = name === "websearch" ? (limits?.websearch ?? 3) : undefined
      if (!limit || !tool.execute) return [name, tool]
      const queue = createExecutionQueue(limit)
      return [
        name,
        { ...tool, execute: (input, context) => queue.run(() => tool.execute?.(input, context), context?.abortSignal) },
      ]
    }),
  ) as Record<string, Tool>
}

export * as ToolExecutionQueue from "./execution-queue"
