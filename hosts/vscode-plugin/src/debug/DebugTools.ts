import * as path from "path"
import * as vscode from "vscode"
import { debugStateStore, isDebugApiAvailable } from "./DebugTracking"
import type { DebugPausedThread } from "./DebugState"

const MAX_STACK_FRAMES = 50
const MAX_VARIABLES = 200
const MAX_VARIABLE_DEPTH = 3

const EXECUTION_COMMANDS: Record<string, string> = {
  continue: "continue",
  stepOver: "next",
  stepIn: "stepIn",
  stepOut: "stepOut",
}

interface DapThread {
  id?: number
  name?: string
}

interface DapStackFrame {
  id?: number
  name?: string
  line?: number
  column?: number
  source?: { name?: string; path?: string }
}

interface DapScope {
  name?: string
  variablesReference?: number
  expensive?: boolean
}

interface DapVariable {
  name?: string
  value?: string
  type?: string
  variablesReference?: number
}

interface VariableNode {
  name?: string
  value?: string
  type?: string
  variablesReference?: number
  children?: VariableNode[]
  truncated?: boolean
}

/**
 * 执行 ACP「运行和调试」大类中的子工具。
 * 依赖 vscode.debug API 与 DebugAdapterTracker 维护的暂停状态缓存（debugStateStore）。
 * 读取运行时数据与执行控制仅在会话处于暂停时可用；pause 需要运行中的会话。
 */
export async function executeDebugTool(toolId: string, parameters: Record<string, unknown>): Promise<unknown> {
  if (!isDebugApiAvailable()) {
    throw new Error("vscode.debug API is not available in this environment")
  }

  switch (toolId) {
    case "listLaunchConfigs":
      return { output: JSON.stringify(listLaunchConfigs(), null, 2) }

    case "startDebugging": {
      const name = requireString(parameters.name, "name")
      const folder = vscode.workspace.workspaceFolders?.[0]
      if (!folder) {
        throw new Error("No workspace folder is open; cannot start a launch configuration")
      }
      const started = await vscode.debug.startDebugging(folder, name)
      if (!started) {
        throw new Error(`Failed to start debug configuration: ${name}`)
      }
      return { output: `Debug configuration "${name}" started` }
    }

    case "stopDebugging": {
      const session = requireActiveSession()
      await vscode.debug.stopDebugging(session)
      return { output: `Stopped debug session "${session.name}"` }
    }

    case "restartDebugging": {
      const session = requireActiveSession()
      const configuration = session.configuration
      const folder = session.workspaceFolder ?? vscode.workspace.workspaceFolders?.[0]
      await vscode.debug.stopDebugging(session)
      const started = await vscode.debug.startDebugging(folder, configuration)
      if (!started) {
        throw new Error(`Failed to restart debug configuration: ${session.name}`)
      }
      return { output: `Debug session "${session.name}" restarted` }
    }

    case "getDebugState": {
      const session = vscode.debug.activeDebugSession
      const snapshot = debugStateStore.snapshot()
      const tracked = session ? snapshot.sessions.find((item) => item.id === session.id) : undefined
      const pausedNow = (tracked?.pausedThreads.length ?? 0) > 0 || (tracked?.allThreadsStopped ?? false)
      return {
        output: JSON.stringify(
          {
            activeSession: session ? { id: session.id, name: session.name, type: session.type } : null,
            pausedThreads: tracked?.pausedThreads ?? [],
            allThreadsStopped: tracked?.allThreadsStopped ?? false,
            lastStopped: pausedNow ? (tracked?.lastStopped ?? null) : null,
            threads: session ? await readThreadNames(session) : [],
            sessions: snapshot.sessions.map((item) => ({
              id: item.id,
              name: item.name,
              type: item.type,
              paused: item.pausedThreads.length > 0 || item.allThreadsStopped,
            })),
          },
          null,
          2,
        ),
      }
    }

    case "getCallStack": {
      const session = requireActiveSession()
      const paused = await resolvePausedThread(session, optionalNumber(parameters.threadId))
      if (typeof paused.threadId !== "number") {
        throw new Error("No paused thread id is available")
      }
      const pausedThreadId = paused.threadId
      const response = (await session.customRequest("stackTrace", {
        threadId: pausedThreadId,
        startFrame: 0,
        levels: MAX_STACK_FRAMES,
      })) as { stackFrames?: DapStackFrame[] } | undefined
      const frames = Array.isArray(response?.stackFrames) ? response.stackFrames : []
      return {
        output: JSON.stringify(
          frames.map((frame) => ({
            id: frame.id,
            name: frame.name,
            source: frame.source?.path ?? frame.source?.name,
            line: frame.line,
            column: frame.column,
          })),
          null,
          2,
        ),
      }
    }

    case "getVariables": {
      const session = requireActiveSession()
      const variablesReference = optionalNumber(parameters.variablesReference)
      if (typeof variablesReference === "number") {
        await resolvePausedThread(session)
        const expansion = await expandVariables(session, variablesReference, 0, { remaining: MAX_VARIABLES })
        return { output: JSON.stringify(expansion, null, 2) }
      }
      const frameId = optionalNumber(parameters.frameId)
      if (typeof frameId !== "number") {
        throw new Error("Provide 'frameId' to read frame scopes or 'variablesReference' to expand a scope or variable")
      }
      await resolvePausedThread(session)
      const response = (await session.customRequest("scopes", { frameId })) as { scopes?: DapScope[] } | undefined
      const scopes = Array.isArray(response?.scopes) ? response.scopes : []
      return {
        output: JSON.stringify(
          scopes.map((scope) => ({
            name: scope.name,
            variablesReference: scope.variablesReference,
            expensive: scope.expensive,
          })),
          null,
          2,
        ),
      }
    }

    case "listBreakpoints":
      return { output: JSON.stringify(vscode.debug.breakpoints.map(describeBreakpoint), null, 2) }

    case "addBreakpoints": {
      const file = requireString(parameters.file, "file")
      const line = requireNumber(parameters.line, "line")
      if (line < 1) {
        throw new Error("'line' must be a 1-based line number")
      }
      const location = new vscode.Location(vscode.Uri.file(file), new vscode.Position(line - 1, 0))
      const breakpoint = new vscode.SourceBreakpoint(
        location,
        true,
        optionalString(parameters.condition),
        optionalString(parameters.hitCondition),
        optionalString(parameters.logMessage),
      )
      vscode.debug.addBreakpoints([breakpoint])
      return { output: `Breakpoint added at ${file}:${line}` }
    }

    case "removeBreakpoints": {
      const file = requireString(parameters.file, "file")
      const line = optionalNumber(parameters.line)
      const matches = vscode.debug.breakpoints.filter(
        (breakpoint) =>
          breakpoint instanceof vscode.SourceBreakpoint &&
          sameFilePath(breakpoint.location.uri.fsPath, file) &&
          (line === undefined || breakpoint.location.range.start.line + 1 === line),
      )
      if (matches.length === 0) {
        throw new Error(`No matching breakpoint found for ${file}${line === undefined ? "" : `:${line}`}`)
      }
      vscode.debug.removeBreakpoints(matches)
      return { output: `Removed ${matches.length} breakpoint(s) for ${file}` }
    }

    case "controlExecution": {
      const action = requireString(parameters.action, "action")
      if (action !== "pause" && !EXECUTION_COMMANDS[action]) {
        throw new Error(`Unsupported execution action: ${action}`)
      }
      const session = requireActiveSession()
      const threadIdParam = optionalNumber(parameters.threadId)

      if (action === "pause") {
        // 全局暂停（allThreadsStopped）意味着所有线程都已停止，任何 pause 都应被拒绝
        if (debugStateStore.isGloballyPaused(session.id)) {
          throw new Error("Debug session is already paused")
        }
        const pausedIds = new Set(debugStateStore.pausedThreads(session.id).map((thread) => thread.threadId))
        const threadId =
          threadIdParam ??
          (await readThreads(session)).find(
            (thread) => typeof thread.id === "number" && !pausedIds.has(thread.id),
          )?.id
        if (typeof threadId !== "number") {
          throw new Error("No running thread is available to pause")
        }
        if (pausedIds.has(threadId)) {
          throw new Error(`Thread ${threadId} is already paused`)
        }
        await session.customRequest("pause", { threadId })
        return { output: `Execution command "${action}" sent to debug session "${session.name}"` }
      }

      const paused = await resolvePausedThread(session, threadIdParam)
      if (typeof paused.threadId !== "number") {
        throw new Error("No paused thread id is available")
      }
      const pausedThreadId = paused.threadId
      const wasGloballyPaused = debugStateStore.isGloballyPaused(session.id)
      // 显式要求单线程控制（singleThread）。恢复范围按 DAP 规范与实际能力判定：
      // - continue：由响应 allThreadsContinued 决定（省略或 true 表示全部线程已恢复）；
      // - step：仅当适配器支持 supportsSingleThreadExecutionRequests 时其它线程保持暂停。
      // 请求成功后立即失效缓存；DAP 的 continued 事件不是控制请求的可靠确认。
      const response = (await session.customRequest(EXECUTION_COMMANDS[action], {
        threadId: pausedThreadId,
        singleThread: true,
      })) as { allThreadsContinued?: boolean } | undefined
      const continuedAll =
        action === "continue"
          ? response?.allThreadsContinued !== false
          : !debugStateStore.supportsSingleThreadExecution(session.id)
      if (continuedAll) {
        debugStateStore.clearPaused(session.id)
      } else {
        debugStateStore.clearPaused(session.id, pausedThreadId)
        if (wasGloballyPaused) {
          // 全局暂停只恢复了单个线程：尝试保留其余仍处于停止状态线程的可操作性。
          // 若线程列表不可用，则保守清空缓存；控制请求本身已成功，不影响返回结果。
          try {
            const others = (await readThreads(session))
              .map((thread) => thread.id)
              .filter((threadId): threadId is number => typeof threadId === "number" && threadId !== pausedThreadId)
            debugStateStore.addPausedThreads(session.id, others)
          } catch {
            debugStateStore.clearPaused(session.id)
          }
        }
      }
      return { output: `Execution command "${action}" sent to debug session "${session.name}"` }
    }

    case "evaluate": {
      const expression = requireString(parameters.expression, "expression")
      const session = requireActiveSession()
      await resolvePausedThread(session)
      const response = (await session.customRequest("evaluate", {
        expression,
        frameId: optionalNumber(parameters.frameId),
        context: optionalString(parameters.context) ?? "watch",
      })) as { result?: string; type?: string; variablesReference?: number } | undefined
      return {
        output: JSON.stringify(
          { result: response?.result, type: response?.type, variablesReference: response?.variablesReference },
          null,
          2,
        ),
      }
    }

    case "setExceptionBreakpoints": {
      if (!Array.isArray(parameters.filters)) {
        throw new Error("Missing 'filters' parameter")
      }
      const filters = parameters.filters.filter((filter): filter is string => typeof filter === "string")
      const session = requireActiveSession()
      await session.customRequest("setExceptionBreakpoints", { filters })
      return { output: `Exception breakpoint filters set: ${filters.length > 0 ? filters.join(", ") : "(none)"}` }
    }

    default:
      throw new Error(`Unsupported tool in debug category: ${toolId}`)
  }
}

function listLaunchConfigs(): Array<{ name?: string; type?: string; request?: string }> {
  const folder = vscode.workspace.workspaceFolders?.[0]
  const configurations = vscode.workspace
    .getConfiguration("launch", folder)
    .get<Array<{ name?: string; type?: string; request?: string }>>("configurations")
  if (!Array.isArray(configurations)) return []
  return configurations.map((config) => ({ name: config?.name, type: config?.type, request: config?.request }))
}

async function readThreads(session: vscode.DebugSession): Promise<DapThread[]> {
  const response = (await session.customRequest("threads")) as { threads?: DapThread[] } | undefined
  return Array.isArray(response?.threads) ? response.threads : []
}

/**
 * 状态查询用的线程列表：DAP threads 失败不应让整个状态查询失败。
 */
async function readThreadNames(session: vscode.DebugSession): Promise<Array<{ id?: number; name?: string }>> {
  try {
    const threads = await readThreads(session)
    return threads.map((thread) => ({ id: thread.id, name: thread.name }))
  } catch {
    return []
  }
}

/**
 * 解析当前可操作的暂停线程：
 * - 会话必须已暂停（存在暂停线程记录或全局暂停标记）；显式线程 ID 在全局暂停下可直接使用；
 * - 无显式 ID 时优先使用最近一个带线程 ID 的暂停记录；
 * - 全局暂停且没有具体线程记录时，回退到 DAP threads 的首个线程。
 */
async function resolvePausedThread(
  session: vscode.DebugSession,
  explicitThreadId?: number,
): Promise<DebugPausedThread> {
  const paused = debugStateStore.pausedThreads(session.id)
  const globallyPaused = debugStateStore.isGloballyPaused(session.id)
  if (paused.length === 0 && !globallyPaused) {
    throw new Error(
      "Debug session is not paused; debug data is only available while a breakpoint or step suspends execution",
    )
  }
  if (explicitThreadId !== undefined) {
    const match = paused.find((thread) => thread.threadId === explicitThreadId)
    if (match) return match
    if (globallyPaused) {
      // 全局暂停时所有线程均已停止，任意线程都可读取
      return { threadId: explicitThreadId }
    }
    throw new Error(`Thread ${explicitThreadId} is not paused; debug data is only available for suspended threads`)
  }
  const withId = [...paused].reverse().find((thread) => typeof thread.threadId === "number")
  if (withId) {
    return withId
  }
  const threads = await readThreads(session)
  const first = threads.find((thread) => typeof thread.id === "number")
  if (!first) {
    throw new Error("No paused thread id is available")
  }
  const latest = paused[paused.length - 1]
  return { threadId: first.id, reason: latest?.reason, hitBreakpointIds: latest?.hitBreakpointIds }
}

async function expandVariables(
  session: vscode.DebugSession,
  variablesReference: number,
  depth: number,
  budget: { remaining: number },
): Promise<{ variables: VariableNode[]; truncated: boolean }> {
  const response = (await session.customRequest("variables", {
    variablesReference,
    count: MAX_VARIABLES,
  })) as { variables?: DapVariable[] } | undefined
  const variables = Array.isArray(response?.variables) ? response.variables : []
  const nodes: VariableNode[] = []
  let truncated = false

  for (const variable of variables) {
    if (budget.remaining <= 0) {
      truncated = true
      break
    }
    budget.remaining -= 1
    const node: VariableNode = {
      name: variable.name,
      value: variable.value,
      type: variable.type,
      variablesReference: variable.variablesReference,
    }
    const childReference =
      typeof variable.variablesReference === "number" && variable.variablesReference > 0
        ? variable.variablesReference
        : undefined
    if (childReference !== undefined) {
      if (depth < MAX_VARIABLE_DEPTH) {
        const child = await expandVariables(session, childReference, depth + 1, budget)
        if (child.variables.length > 0) {
          node.children = child.variables
        }
        if (child.truncated) {
          node.truncated = true
          truncated = true
        }
      } else {
        // 达到深度上限：仍有可展开子节点的变量标记为截断
        node.truncated = true
        truncated = true
      }
    }
    nodes.push(node)
  }

  // 请求了 count=MAX_VARIABLES：返回恰好等于上限时无法排除适配器分页截断，按截断标注
  if (variables.length >= MAX_VARIABLES || variables.length > nodes.length) {
    truncated = true
  }

  return { variables: nodes, truncated }
}

function describeBreakpoint(breakpoint: vscode.Breakpoint): Record<string, unknown> {
  const base = {
    id: breakpoint.id,
    enabled: breakpoint.enabled,
    condition: breakpoint.condition,
    hitCondition: breakpoint.hitCondition,
  }
  if (breakpoint instanceof vscode.SourceBreakpoint) {
    return {
      ...base,
      kind: "source",
      file: breakpoint.location.uri.fsPath,
      line: breakpoint.location.range.start.line + 1,
      logMessage: breakpoint.logMessage,
    }
  }
  if (breakpoint instanceof vscode.FunctionBreakpoint) {
    return { ...base, kind: "function", functionName: breakpoint.functionName }
  }
  return { ...base, kind: "other" }
}

function requireActiveSession(): vscode.DebugSession {
  const session = vscode.debug.activeDebugSession
  if (!session) {
    throw new Error("No active debug session")
  }
  return session
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing or invalid '${name}' parameter`)
  }
  return value.trim()
}

function requireNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Missing or invalid '${name}' parameter`)
  }
  return value
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function sameFilePath(left: string, right: string): boolean {
  const a = path.resolve(left)
  const b = path.resolve(right)
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b
}
