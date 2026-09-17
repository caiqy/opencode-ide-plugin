export interface DebugPausedThread {
  threadId?: number
  reason?: string
  hitBreakpointIds?: number[]
}

export interface DebugStoppedEvent {
  threadId?: number
  reason?: string
  description?: string
  text?: string
  hitBreakpointIds?: number[]
}

export interface DebugSessionInfo {
  id: string
  name: string
  type: string
  pausedThreads: DebugPausedThread[]
  /**
   * 会话级全局暂停标记：最近一次 stopped 事件声明了 allThreadsStopped（或未携带 threadId）。
   * 与 pausedThreads 分开建模，避免把全局状态伪造成某个线程记录。
   */
  allThreadsStopped: boolean
  /** 最近一次 stopped 事件的元数据（暂停原因、命中信息等），供状态查询输出。 */
  lastStopped: DebugStoppedEvent | null
  /** 适配器能力：initialize 响应 body（即 Capabilities）的 supportsSingleThreadExecutionRequests。 */
  supportsSingleThreadExecutionRequests: boolean
  /** 已知线程列表：来自 threads 响应与 thread 事件，用于全局暂停被打破后保留其它线程状态。 */
  knownThreadIds: number[]
}

export interface DebugStateSnapshot {
  activeSessionId: string | null
  sessions: DebugSessionInfo[]
}

type DapMessage = {
  type?: string
  event?: string
  command?: string
  success?: boolean
  body?: Record<string, unknown>
}

function pausedThreadEntry(threadId: number): DebugPausedThread {
  return { threadId, reason: undefined, hitBreakpointIds: undefined }
}

/**
 * 维护调试会话、全局暂停标记、按线程暂停状态、适配器能力与已知线程列表的纯逻辑存储。
 * 由 DebugAdapterTracker 观察到的 DAP 消息（响应与事件）驱动，
 * 供 ACP「运行和调试」工具查询。
 */
export class DebugStateStore {
  private sessions = new Map<string, DebugSessionInfo>()
  private activeSessionId: string | null = null

  reset(): void {
    this.sessions.clear()
    this.activeSessionId = null
  }

  upsertSession(session: { id: string; name: string; type: string }): void {
    const existing = this.sessions.get(session.id)
    this.sessions.set(session.id, {
      id: session.id,
      name: session.name,
      type: session.type,
      pausedThreads: existing?.pausedThreads ?? [],
      allThreadsStopped: existing?.allThreadsStopped ?? false,
      lastStopped: existing?.lastStopped ?? null,
      supportsSingleThreadExecutionRequests: existing?.supportsSingleThreadExecutionRequests ?? false,
      knownThreadIds: existing?.knownThreadIds ?? [],
    })
  }

  removeSession(id: string): void {
    this.sessions.delete(id)
    if (this.activeSessionId === id) {
      this.activeSessionId = null
    }
  }

  setActive(session: { id: string; name: string; type: string } | null): void {
    if (!session) {
      this.activeSessionId = null
      return
    }
    this.upsertSession(session)
    this.activeSessionId = session.id
  }

  onDapMessage(sessionId: string, message: unknown): void {
    if (!message || typeof message !== "object") return
    const dap = message as DapMessage
    const session = this.sessions.get(sessionId)
    if (!session) return
    const body = dap.body ?? {}

    if (dap.type === "response") {
      if (dap.success !== false && dap.command === "initialize") {
        // DAP InitializeResponse.body 直接就是 Capabilities，能力字段位于 body 顶层
        session.supportsSingleThreadExecutionRequests = body.supportsSingleThreadExecutionRequests === true
      }
      if (dap.success !== false && dap.command === "threads") {
        const threads = Array.isArray(body.threads) ? body.threads : []
        session.knownThreadIds = threads
          .map((thread) => (thread && typeof thread === "object" ? (thread as { id?: unknown }).id : undefined))
          .filter((id): id is number => typeof id === "number")
      }
      return
    }

    if (dap.type !== "event" || typeof dap.event !== "string") return

    if (dap.event === "thread") {
      const threadId = typeof body.threadId === "number" ? body.threadId : undefined
      if (threadId === undefined) return
      if (body.reason === "started") {
        if (!session.knownThreadIds.includes(threadId)) {
          session.knownThreadIds.push(threadId)
        }
      } else if (body.reason === "exited") {
        session.knownThreadIds = session.knownThreadIds.filter((id) => id !== threadId)
      }
      return
    }

    if (dap.event === "stopped") {
      const threadId = typeof body.threadId === "number" ? body.threadId : undefined
      session.lastStopped = {
        threadId,
        reason: typeof body.reason === "string" ? body.reason : undefined,
        description: typeof body.description === "string" ? body.description : undefined,
        text: typeof body.text === "string" ? body.text : undefined,
        hitBreakpointIds: Array.isArray(body.hitBreakpointIds)
          ? body.hitBreakpointIds.filter((value): value is number => typeof value === "number")
          : undefined,
      }
      if (threadId !== undefined) {
        session.pausedThreads = session.pausedThreads.filter((thread) => thread.threadId !== threadId)
        session.pausedThreads.push({
          threadId,
          reason: session.lastStopped.reason,
          hitBreakpointIds: session.lastStopped.hitBreakpointIds,
        })
      } else {
        session.pausedThreads = []
      }
      session.allThreadsStopped = body.allThreadsStopped === true || threadId === undefined
      return
    }

    if (dap.event === "continued") {
      // DAP 规范：allThreadsContinued 省略或为 true 表示全部线程已恢复；
      // 显式 false 且带 threadId 时只恢复该线程。
      const allContinued = body.allThreadsContinued !== false
      if (allContinued || typeof body.threadId !== "number") {
        session.pausedThreads = []
      } else {
        const resumedThreadId = body.threadId
        const wasGloballyPaused = session.allThreadsStopped
        session.pausedThreads = session.pausedThreads.filter((thread) => thread.threadId !== resumedThreadId)
        if (wasGloballyPaused) {
          // 全局暂停被外部单线程继续打破：其余已停止线程仍需保留可读状态
          for (const threadId of session.knownThreadIds) {
            if (threadId !== resumedThreadId && !session.pausedThreads.some((thread) => thread.threadId === threadId)) {
              session.pausedThreads.push(pausedThreadEntry(threadId))
            }
          }
        }
      }
      session.allThreadsStopped = false
      return
    }

    if (dap.event === "terminated") {
      session.pausedThreads = []
      session.allThreadsStopped = false
      session.lastStopped = null
    }
  }

  /**
   * 主动失效暂停缓存。控制请求（continue/step）成功后调用，
   * 因为 DAP 不保证适配器随后发送 continued 事件。
   * 无论按线程还是整体清理，都会同步清除会话级全局暂停标记。
   */
  clearPaused(sessionId: string, threadId?: number): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.pausedThreads =
      threadId === undefined ? [] : session.pausedThreads.filter((thread) => thread.threadId !== threadId)
    session.allThreadsStopped = false
  }

  /**
   * 将给定线程登记为暂停。用于全局暂停下只恢复单个线程时，
   * 保留其余仍处于停止状态线程的可操作性（去重）。
   */
  addPausedThreads(sessionId: string, threadIds: number[]): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    for (const threadId of threadIds) {
      if (!session.pausedThreads.some((thread) => thread.threadId === threadId)) {
        session.pausedThreads.push(pausedThreadEntry(threadId))
      }
    }
  }

  pausedThreads(sessionId: string): DebugPausedThread[] {
    return (this.sessions.get(sessionId)?.pausedThreads ?? []).map((thread) => ({ ...thread }))
  }

  isGloballyPaused(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.allThreadsStopped ?? false
  }

  lastStopped(sessionId: string): DebugStoppedEvent | null {
    const lastStopped = this.sessions.get(sessionId)?.lastStopped
    return lastStopped ? { ...lastStopped } : null
  }

  supportsSingleThreadExecution(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.supportsSingleThreadExecutionRequests ?? false
  }

  knownThreads(sessionId: string): number[] {
    return [...(this.sessions.get(sessionId)?.knownThreadIds ?? [])]
  }

  snapshot(): DebugStateSnapshot {
    return {
      activeSessionId: this.activeSessionId,
      sessions: Array.from(this.sessions.values()).map((session) => ({
        ...session,
        pausedThreads: session.pausedThreads.map((thread) => ({ ...thread })),
        lastStopped: session.lastStopped ? { ...session.lastStopped } : null,
        knownThreadIds: [...session.knownThreadIds],
      })),
    }
  }
}
