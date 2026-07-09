import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { Log } from "../../src/util/log"
import type { Session as SessionNS } from "../../src/session/session"
import { SessionID, type SessionID as SessionIDType } from "../../src/session/schema"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

type ForegroundEvent = {
  phase: "start" | "finish"
  before: number
  after: number
  sessionID: SessionIDType
}

const foregroundEvents: ForegroundEvent[] = []
const actualForeground = await import("../../src/session/summary-scheduler-foreground")
const realApplyForegroundStart = actualForeground.applyForegroundStart
const realApplyForegroundFinish = actualForeground.applyForegroundFinish

spyOn(actualForeground, "applyForegroundStart").mockImplementation((...args) => {
  const [state, sessionID] = args
  const before = state.sessions.size
  realApplyForegroundStart(...args)
  foregroundEvents.push({ phase: "start", before, after: state.sessions.size, sessionID })
})

spyOn(actualForeground, "applyForegroundFinish").mockImplementation((...args) => {
  const [state, sessionID] = args
  const before = state.sessions.size
  const result = realApplyForegroundFinish(...args)
  foregroundEvents.push({ phase: "finish", before, after: state.sessions.size, sessionID })
  return result
})

const { Server } = await import("../../src/server/server")
const { setStandardForegroundReadTestGate } = await import("../../src/server/routes/instance/session")
const { SessionPaths } = await import("../../src/server/routes/instance/httpapi/groups/session")
const { Session } = await import("../../src/session/session")
const { Instance } = await import("../../src/project/instance")
const { AppRuntime } = await import("../../src/effect/app-runtime")

function pathFor(template: string, params: Record<string, string>) {
  return Object.entries(params).reduce((result, [key, value]) => result.replace(`:${key}`, value), template)
}

async function createSessionInDirectory(directory: string, input?: SessionNS.CreateInput) {
  return Instance.provide({
    directory,
    fn: () => AppRuntime.runPromise(Session.Service.use((session) => session.create(input))),
  })
}

async function waitFor(check: () => boolean, timeout = 1000) {
  const startedAt = Date.now()
  while (!check()) {
    if (Date.now() - startedAt >= timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

async function assertReadDoesNotGrowForegroundState(input: {
  directory: string
  kind: "messages" | "diff"
  sessionID: SessionIDType
  path: string
  expectedStatus: number
  expectedBody: unknown
}) {
  const headers = { "x-opencode-directory": input.directory }
  const release = Promise.withResolvers<void>()
  let started = false

  foregroundEvents.length = 0
  setStandardForegroundReadTestGate(async (current) => {
    if (current.sessionID !== input.sessionID || current.kind !== input.kind) return
    started = true
    await release.promise
  })

  try {
    const responsePromise = Promise.resolve().then(() =>
      Server.Default().app.request(input.path, { method: "GET", headers }),
    )
    let responded = false
    void responsePromise.then(
      () => {
        responded = true
      },
      () => {
        responded = true
      },
    )

    await waitFor(() => started || responded)
    if (!started) {
      const response = await responsePromise
      throw new Error(`foreground gate was not hit before response: ${response.status} ${await response.text()}`)
    }

    expect(foregroundEvents).toEqual([{ phase: "start", before: 0, after: 0, sessionID: input.sessionID }])

    release.resolve()

    const response = await responsePromise
    expect(response.status).toBe(input.expectedStatus)
    expect(await response.json()).toEqual(input.expectedBody)

    await waitFor(() => foregroundEvents.length === 2)
    expect(foregroundEvents).toEqual([
      { phase: "start", before: 0, after: 0, sessionID: input.sessionID },
      { phase: "finish", before: 0, after: 0, sessionID: input.sessionID },
    ])
  } finally {
    release.resolve()
    setStandardForegroundReadTestGate(undefined)
    foregroundEvents.length = 0
  }
}

afterEach(async () => {
  foregroundEvents.length = 0
  setStandardForegroundReadTestGate(undefined)
  await disposeAllInstances()
  await resetDatabase()
})

describe("session HttpApi foreground read state", () => {
  test("existing session messages and diff reads do not grow scheduler sessions state", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const session = await createSessionInDirectory(tmp.path, { title: "read-only" })

    await assertReadDoesNotGrowForegroundState({
      directory: tmp.path,
      kind: "messages",
      sessionID: session.id,
      path: pathFor(SessionPaths.messages, { sessionID: session.id }),
      expectedStatus: 200,
      expectedBody: [],
    })

    await assertReadDoesNotGrowForegroundState({
      directory: tmp.path,
      kind: "diff",
      sessionID: session.id,
      path: pathFor(SessionPaths.diff, { sessionID: session.id }),
      expectedStatus: 200,
      expectedBody: [],
    })
  })

  test("missing session messages and diff reads do not grow scheduler sessions state", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const sessionID = SessionID.descending()
    const missingSessionBody = {
      name: "NotFoundError",
      data: { message: `Session not found: ${sessionID}` },
    }

    await assertReadDoesNotGrowForegroundState({
      directory: tmp.path,
      kind: "messages",
      sessionID,
      path: pathFor(SessionPaths.messages, { sessionID }),
      expectedStatus: 404,
      expectedBody: missingSessionBody,
    })

    await assertReadDoesNotGrowForegroundState({
      directory: tmp.path,
      kind: "diff",
      sessionID,
      path: pathFor(SessionPaths.diff, { sessionID }),
      expectedStatus: 200,
      expectedBody: [],
    })
  })
})
