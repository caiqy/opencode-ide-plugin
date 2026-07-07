import { expect, test } from "bun:test"
import { Database as BunDatabase } from "bun:sqlite"
import * as DateTime from "effect/DateTime"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { SessionID } from "../../src/session/schema"
import { EventV2 } from "@opencode-ai/core/event"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionEvent } from "@opencode-ai/core/session-event"
import { SessionMessageUpdater } from "@opencode-ai/core/session-message-updater"
import projectorsNext from "../../src/session/projectors-next"

test("step snapshots carry over to assistant messages", () => {
  const state: SessionMessageUpdater.MemoryState = { messages: [] }
  const sessionID = SessionID.make("session")

  SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
    id: EventV2.ID.create(),
    type: "session.next.step.started",
    data: {
      sessionID,
      timestamp: DateTime.makeUnsafe(1),
      agent: "build",
      model: {
        id: ModelV2.ID.make("model"),
        providerID: ProviderV2.ID.make("provider"),
        variant: ModelV2.VariantID.make("default"),
      },
      snapshot: "before",
    },
  } satisfies SessionEvent.Event)

  SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
    id: EventV2.ID.create(),
    type: "session.next.step.ended",
    data: {
      sessionID,
      timestamp: DateTime.makeUnsafe(2),
      finish: "stop",
      cost: 0,
      tokens: {
        input: 1,
        output: 2,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      snapshot: "after",
    },
  } satisfies SessionEvent.Event)

  expect(state.messages[0]?.type).toBe("assistant")
  if (state.messages[0]?.type !== "assistant") return
  expect(state.messages[0].snapshot).toEqual({ start: "before", end: "after" })
  expect(state.messages[0].finish).toBe("stop")
})

test("text ended populates assistant text content", () => {
  const state: SessionMessageUpdater.MemoryState = { messages: [] }
  const sessionID = SessionID.make("session")

  SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
    id: EventV2.ID.create(),
    type: "session.next.step.started",
    data: {
      sessionID,
      timestamp: DateTime.makeUnsafe(1),
      agent: "build",
      model: {
        id: ModelV2.ID.make("model"),
        providerID: ProviderV2.ID.make("provider"),
        variant: ModelV2.VariantID.make("default"),
      },
    },
  } satisfies SessionEvent.Event)

  SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
    id: EventV2.ID.create(),
    type: "session.next.text.started",
    data: {
      sessionID,
      timestamp: DateTime.makeUnsafe(2),
    },
  } satisfies SessionEvent.Event)

  SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
    id: EventV2.ID.create(),
    type: "session.next.text.ended",
    data: {
      sessionID,
      timestamp: DateTime.makeUnsafe(3),
      text: "hello assistant",
    },
  } satisfies SessionEvent.Event)

  expect(state.messages[0]?.type).toBe("assistant")
  if (state.messages[0]?.type !== "assistant") return
  expect(state.messages[0].content).toEqual([{ type: "text", text: "hello assistant" }])
})

test("tool completion stores completed timestamp", () => {
  const state: SessionMessageUpdater.MemoryState = { messages: [] }
  const sessionID = SessionID.make("session")
  const callID = "call"

  SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
    id: EventV2.ID.create(),
    type: "session.next.step.started",
    data: {
      sessionID,
      timestamp: DateTime.makeUnsafe(1),
      agent: "build",
      model: {
        id: ModelV2.ID.make("model"),
        providerID: ProviderV2.ID.make("provider"),
        variant: ModelV2.VariantID.make("default"),
      },
    },
  } satisfies SessionEvent.Event)

  SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
    id: EventV2.ID.create(),
    type: "session.next.tool.input.started",
    data: {
      sessionID,
      timestamp: DateTime.makeUnsafe(2),
      callID,
      name: "bash",
    },
  } satisfies SessionEvent.Event)

  SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
    id: EventV2.ID.create(),
    type: "session.next.tool.called",
    data: {
      sessionID,
      timestamp: DateTime.makeUnsafe(3),
      callID,
      tool: "bash",
      input: { command: "pwd" },
      provider: { executed: true, metadata: { source: "provider" } },
    },
  } satisfies SessionEvent.Event)

  SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
    id: EventV2.ID.create(),
    type: "session.next.tool.success",
    data: {
      sessionID,
      timestamp: DateTime.makeUnsafe(4),
      callID,
      structured: {},
      content: [{ type: "text", text: "/tmp" }],
      provider: { executed: true, metadata: { status: "done" } },
    },
  } satisfies SessionEvent.Event)

  expect(state.messages[0]?.type).toBe("assistant")
  if (state.messages[0]?.type !== "assistant") return
  expect(state.messages[0].content[0]?.type).toBe("tool")
  if (state.messages[0].content[0]?.type !== "tool") return
  expect(state.messages[0].content[0].time.completed).toEqual(DateTime.makeUnsafe(4))
  expect(state.messages[0].content[0].provider).toEqual({ executed: true, metadata: { status: "done" } })
})

test("compaction events reduce to compaction message", () => {
  const state: SessionMessageUpdater.MemoryState = { messages: [] }
  const sessionID = SessionID.make("session")
  const id = EventV2.ID.create()

  SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
    id,
    type: "session.next.compaction.started",
    data: {
      sessionID,
      timestamp: DateTime.makeUnsafe(1),
      reason: "auto",
    },
  } satisfies SessionEvent.Event)

  SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
    id: EventV2.ID.create(),
    type: "session.next.compaction.delta",
    data: {
      sessionID,
      timestamp: DateTime.makeUnsafe(2),
      text: "hello ",
    },
  } satisfies SessionEvent.Event)

  SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
    id: EventV2.ID.create(),
    type: "session.next.compaction.delta",
    data: {
      sessionID,
      timestamp: DateTime.makeUnsafe(3),
      text: "summary",
    },
  } satisfies SessionEvent.Event)

  SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
    id: EventV2.ID.create(),
    type: "session.next.compaction.ended",
    data: {
      sessionID,
      timestamp: DateTime.makeUnsafe(4),
      text: "final summary",
      include: "recent context",
    },
  } satisfies SessionEvent.Event)

  expect(state.messages).toHaveLength(1)
  expect(state.messages[0]).toMatchObject({
    id,
    type: "compaction",
    reason: "auto",
    summary: "final summary",
    include: "recent context",
    time: { created: DateTime.makeUnsafe(1) },
  })
})

test("sqlite projector appends messages when session_message has a legacy seq column", () => {
  const sqlite = new BunDatabase(":memory:")
  const db = drizzle({ client: sqlite })
  const sessionID = SessionID.make("session")

  sqlite.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      slug TEXT NOT NULL,
      directory TEXT NOT NULL,
      title TEXT NOT NULL,
      version TEXT NOT NULL,
      agent TEXT,
      cost REAL NOT NULL DEFAULT 0,
      tokens_input INTEGER NOT NULL DEFAULT 0,
      tokens_output INTEGER NOT NULL DEFAULT 0,
      tokens_reasoning INTEGER NOT NULL DEFAULT 0,
      tokens_cache_read INTEGER NOT NULL DEFAULT 0,
      tokens_cache_write INTEGER NOT NULL DEFAULT 0,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL
    );

    CREATE TABLE session_message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      data TEXT NOT NULL,
      seq INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES session(id) ON DELETE CASCADE
    );
  `)

  sqlite
    .prepare(
      `INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(sessionID, "project", "session", ".", "Session", "1", 1, 1)

  const projector = projectorsNext.find(([def]) => def.type === SessionEvent.AgentSwitched.type)
  expect(projector).toBeDefined()
  if (!projector) return

  const [, run] = projector
  const event = {
    id: EventV2.ID.create(),
    seq: 7,
    aggregateID: sessionID,
    data: {
      sessionID,
      timestamp: DateTime.makeUnsafe(1),
      agent: "build",
    },
  }

  expect(() => run(db as never, event.data, event)).not.toThrow()
  const rows = sqlite.prepare("SELECT type, seq FROM session_message").all() as Array<{ type: string; seq: number }>
  expect(rows).toEqual([{ type: "agent-switched", seq: 0 }])
})

test("sqlite projector appends messages with legacy seq inside a transaction", () => {
  const sqlite = new BunDatabase(":memory:")
  const db = drizzle({ client: sqlite })
  const sessionID = SessionID.make("session")

  sqlite.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      slug TEXT NOT NULL,
      directory TEXT NOT NULL,
      title TEXT NOT NULL,
      version TEXT NOT NULL,
      agent TEXT,
      cost REAL NOT NULL DEFAULT 0,
      tokens_input INTEGER NOT NULL DEFAULT 0,
      tokens_output INTEGER NOT NULL DEFAULT 0,
      tokens_reasoning INTEGER NOT NULL DEFAULT 0,
      tokens_cache_read INTEGER NOT NULL DEFAULT 0,
      tokens_cache_write INTEGER NOT NULL DEFAULT 0,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL
    );

    CREATE TABLE session_message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      data TEXT NOT NULL,
      seq INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES session(id) ON DELETE CASCADE
    );
  `)

  sqlite
    .prepare(
      `INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(sessionID, "project", "session", ".", "Session", "1", 1, 1)

  const projector = projectorsNext.find(([def]) => def.type === SessionEvent.AgentSwitched.type)
  expect(projector).toBeDefined()
  if (!projector) return

  const [, run] = projector
  const event = {
    id: EventV2.ID.create(),
    seq: 8,
    aggregateID: sessionID,
    data: {
      sessionID,
      timestamp: DateTime.makeUnsafe(1),
      agent: "build",
    },
  }

  expect(() => db.transaction((tx) => run(tx as never, event.data, event))).not.toThrow()
  const rows = sqlite.prepare("SELECT type, seq FROM session_message").all() as Array<{ type: string; seq: number }>
  expect(rows).toEqual([{ type: "agent-switched", seq: 0 }])
})

test("legacy session_message seq increments per session even when event seq repeats", () => {
  const sqlite = new BunDatabase(":memory:")
  const db = drizzle({ client: sqlite })
  const sessionID = SessionID.make("session")

  sqlite.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      slug TEXT NOT NULL,
      directory TEXT NOT NULL,
      title TEXT NOT NULL,
      version TEXT NOT NULL,
      agent TEXT,
      model TEXT,
      cost REAL NOT NULL DEFAULT 0,
      tokens_input INTEGER NOT NULL DEFAULT 0,
      tokens_output INTEGER NOT NULL DEFAULT 0,
      tokens_reasoning INTEGER NOT NULL DEFAULT 0,
      tokens_cache_read INTEGER NOT NULL DEFAULT 0,
      tokens_cache_write INTEGER NOT NULL DEFAULT 0,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL
    );

    CREATE TABLE session_message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      data TEXT NOT NULL,
      seq INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES session(id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX session_message_session_seq_idx ON session_message (session_id, seq);
  `)

  sqlite
    .prepare(
      `INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(sessionID, "project", "session", ".", "Session", "1", 1, 1)

  const agentSwitched = projectorsNext.find(([def]) => def.type === SessionEvent.AgentSwitched.type)
  const modelSwitched = projectorsNext.find(([def]) => def.type === SessionEvent.ModelSwitched.type)
  expect(agentSwitched).toBeDefined()
  expect(modelSwitched).toBeDefined()
  if (!agentSwitched || !modelSwitched) return

  const [, runAgentSwitched] = agentSwitched
  const [, runModelSwitched] = modelSwitched

  expect(() =>
    db.transaction((tx) => {
      runAgentSwitched(
        tx as never,
        {
          sessionID,
          timestamp: DateTime.makeUnsafe(1),
          agent: "build",
        },
        {
          id: EventV2.ID.create(),
          seq: 0,
          aggregateID: sessionID,
          data: {
            sessionID,
            timestamp: DateTime.makeUnsafe(1),
            agent: "build",
          },
        },
      )

      runModelSwitched(
        tx as never,
        {
          sessionID,
          timestamp: DateTime.makeUnsafe(2),
          model: {
            id: ModelV2.ID.make("model"),
            providerID: ProviderV2.ID.make("provider"),
            variant: ModelV2.VariantID.make("default"),
          },
        },
        {
          id: EventV2.ID.create(),
          seq: 0,
          aggregateID: sessionID,
          data: {
            sessionID,
            timestamp: DateTime.makeUnsafe(2),
            model: {
              id: ModelV2.ID.make("model"),
              providerID: ProviderV2.ID.make("provider"),
              variant: ModelV2.VariantID.make("default"),
            },
          },
        },
      )
    }),
  ).not.toThrow()

  const rows = sqlite.prepare("SELECT type, seq FROM session_message ORDER BY seq").all() as Array<{
    type: string
    seq: number
  }>
  expect(rows).toEqual([
    { type: "agent-switched", seq: 0 },
    { type: "model-switched", seq: 1 },
  ])
})
