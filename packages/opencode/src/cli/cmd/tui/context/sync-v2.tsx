import { useEvent } from "@tui/context/event"
import type { Event } from "@opencode-ai/sdk/v2"
import { SessionEvent } from "@opencode-ai/core/session-event"
import { createStore, produce, reconcile } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { useSDK } from "./sdk"

type ToolContent =
  | {
      type: "text"
      text: string
    }
  | {
      type: "file"
      uri: string
      mime: string
      name?: string
    }

type SessionMessageAssistantTool = {
  type: "tool"
  id: string
  name: string
  provider?: {
    executed: boolean
    metadata?: Record<string, unknown>
  }
  state:
    | { status: "pending"; input: string }
    | { status: "running"; input: Record<string, unknown>; structured: Record<string, unknown>; content: ToolContent[] }
    | {
        status: "completed"
        input: Record<string, unknown>
        structured: Record<string, unknown>
        content: ToolContent[]
      }
    | {
        status: "error"
        input: Record<string, unknown>
        structured: Record<string, unknown>
        content: ToolContent[]
        error: { type: "unknown"; message: string }
      }
  time: {
    created: number
    ran?: number
    completed?: number
    pruned?: number
  }
}

type SessionMessageAssistantText = {
  type: "text"
  text: string
}

type SessionMessageAssistantReasoning = {
  type: "reasoning"
  id: string
  text: string
}

type SessionMessageAssistant = {
  id: string
  metadata?: Record<string, unknown>
  time: { created: number; completed?: number }
  type: "assistant"
  agent: string
  model: { id: string; providerID: string; variant: string }
  content: Array<SessionMessageAssistantText | SessionMessageAssistantReasoning | SessionMessageAssistantTool>
  snapshot?: { start?: string; end?: string }
  finish?: string
  cost?: number
  tokens?: {
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }
  error?: { type: "unknown"; message: string }
}

type SessionMessage =
  | {
      id: string
      metadata?: Record<string, unknown>
      time: { created: number }
      type: "user"
      text: string
      files?: Array<{ uri: string; mime: string; name?: string; description?: string }>
      agents?: Array<{ name: string }>
      references?: Array<{ name: string; kind: "local" | "git" | "invalid" }>
    }
  | {
      id: string
      metadata?: Record<string, unknown>
      time: { created: number }
      type: "synthetic"
      sessionID: string
      text: string
    }
  | {
      id: string
      metadata?: Record<string, unknown>
      time: { created: number; completed?: number }
      type: "shell"
      callID: string
      command: string
      output: string
    }
  | SessionMessageAssistant
  | {
      id: string
      metadata?: Record<string, unknown>
      time: { created: number }
      type: "compaction"
      reason: "auto" | "manual"
      summary: string
      include?: string
    }
  | {
      id: string
      metadata?: Record<string, unknown>
      time: { created: number }
      type: "agent-switched"
      agent: string
    }
  | {
      id: string
      metadata?: Record<string, unknown>
      time: { created: number }
      type: "model-switched"
      model: { id: string; providerID: string; variant: string }
    }

type NextEvent = {
  [T in SessionEvent.Type]: {
    id: string
    type: T
    properties: Extract<SessionEvent.Event, { type: T }>["data"]
  }
}[SessionEvent.Type]

function isNextEvent(event: unknown): event is NextEvent {
  return !!event && typeof event === "object" && "type" in event && typeof event.type === "string" && event.type.startsWith("session.next.")
}

function time(value: unknown) {
  return Number(value)
}

function activeAssistant(messages: SessionMessage[]) {
  const index = messages.findIndex((message) => message.type === "assistant" && !message.time.completed)
  if (index < 0) return
  const assistant = messages[index]
  return assistant?.type === "assistant" ? assistant : undefined
}

function activeCompaction(messages: SessionMessage[]) {
  const index = messages.findIndex((message) => message.type === "compaction")
  if (index < 0) return
  const compaction = messages[index]
  return compaction?.type === "compaction" ? compaction : undefined
}

function activeShell(messages: SessionMessage[], callID: string) {
  const index = messages.findIndex((message) => message.type === "shell" && message.callID === callID)
  if (index < 0) return
  const shell = messages[index]
  return shell?.type === "shell" ? shell : undefined
}

function latestTool(assistant: SessionMessageAssistant | undefined, callID?: string) {
  return assistant?.content.findLast(
    (item): item is SessionMessageAssistantTool => item.type === "tool" && (callID === undefined || item.id === callID),
  )
}

function latestText(assistant: SessionMessageAssistant | undefined) {
  return assistant?.content.findLast((item): item is SessionMessageAssistantText => item.type === "text")
}

function latestReasoning(assistant: SessionMessageAssistant | undefined, reasoningID: string) {
  return assistant?.content.findLast(
    (item): item is SessionMessageAssistantReasoning => item.type === "reasoning" && item.id === reasoningID,
  )
}

export const { use: useSyncV2, provider: SyncProviderV2 } = createSimpleContext({
  name: "SyncV2",
  init: () => {
    const [store, setStore] = createStore<{
      messages: {
        [sessionID: string]: SessionMessage[]
      }
    }>({
      messages: {},
    })

    const event = useEvent()
    const sdk = useSDK()

    function update(sessionID: string, fn: (messages: SessionMessage[]) => void) {
      setStore(
        "messages",
        produce((draft) => {
          fn((draft[sessionID] ??= []))
        }),
      )
    }

    event.subscribe((event) => {
      const candidate: unknown = event
      if (!isNextEvent(candidate)) return
      const nextEvent = candidate
      switch (nextEvent.type) {
        case "session.next.prompted": {
          update(nextEvent.properties.sessionID, (draft) => {
            draft.unshift({
              id: nextEvent.id,
              type: "user",
              text: nextEvent.properties.prompt.text,
              files: nextEvent.properties.prompt.files?.map((item) => ({ ...item })),
              agents: nextEvent.properties.prompt.agents?.map((item) => ({ ...item })),
              references: nextEvent.properties.prompt.references?.map((item) => ({ ...item })),
              time: { created: time(nextEvent.properties.timestamp) },
            })
          })
          break
        }
        case "session.next.synthetic":
          update(nextEvent.properties.sessionID, (draft) => {
            draft.unshift({
              id: nextEvent.id,
              type: "synthetic",
              sessionID: nextEvent.properties.sessionID,
              text: nextEvent.properties.text,
              time: { created: time(nextEvent.properties.timestamp) },
            })
          })
          break
        case "session.next.shell.started":
          update(nextEvent.properties.sessionID, (draft) => {
            draft.unshift({
              id: nextEvent.id,
              type: "shell",
              callID: nextEvent.properties.callID,
              command: nextEvent.properties.command,
              output: "",
              time: { created: time(nextEvent.properties.timestamp) },
            })
          })
          break
        case "session.next.shell.ended":
          update(nextEvent.properties.sessionID, (draft) => {
            const match = activeShell(draft, nextEvent.properties.callID)
            if (!match) return
            match.output = nextEvent.properties.output
            match.time.completed = time(nextEvent.properties.timestamp)
          })
          break
        case "session.next.agent.switched":
          update(nextEvent.properties.sessionID, (draft) => {
            draft.unshift({
              id: nextEvent.id,
              type: "agent-switched",
              agent: nextEvent.properties.agent,
              time: { created: time(nextEvent.properties.timestamp) },
            })
          })
          break
        case "session.next.model.switched":
          update(nextEvent.properties.sessionID, (draft) => {
            draft.unshift({
              id: nextEvent.id,
              type: "model-switched",
              model: nextEvent.properties.model,
              time: { created: time(nextEvent.properties.timestamp) },
            })
          })
          break
        case "session.next.step.started":
          update(nextEvent.properties.sessionID, (draft) => {
            const currentAssistant = activeAssistant(draft)
            if (currentAssistant) currentAssistant.time.completed = time(nextEvent.properties.timestamp)
            draft.unshift({
              id: nextEvent.id,
              type: "assistant",
              agent: nextEvent.properties.agent,
              model: nextEvent.properties.model,
              content: [],
              snapshot: nextEvent.properties.snapshot ? { start: nextEvent.properties.snapshot } : undefined,
              time: { created: time(nextEvent.properties.timestamp) },
            })
          })
          break
        case "session.next.step.ended":
          update(nextEvent.properties.sessionID, (draft) => {
            const currentAssistant = activeAssistant(draft)
            if (!currentAssistant) return
            currentAssistant.time.completed = time(nextEvent.properties.timestamp)
            currentAssistant.finish = nextEvent.properties.finish
            currentAssistant.cost = nextEvent.properties.cost
            currentAssistant.tokens = nextEvent.properties.tokens
            if (nextEvent.properties.snapshot)
              currentAssistant.snapshot = { ...currentAssistant.snapshot, end: nextEvent.properties.snapshot }
          })
          break
        case "session.next.step.failed":
          update(nextEvent.properties.sessionID, (draft) => {
            const currentAssistant = activeAssistant(draft)
            if (!currentAssistant) return
            currentAssistant.time.completed = time(nextEvent.properties.timestamp)
            currentAssistant.finish = "error"
            currentAssistant.error = nextEvent.properties.error
          })
          break
        case "session.next.text.started":
          update(nextEvent.properties.sessionID, (draft) => {
            activeAssistant(draft)?.content.push({ type: "text", text: "" })
          })
          break
        case "session.next.text.delta":
          update(nextEvent.properties.sessionID, (draft) => {
            const match = latestText(activeAssistant(draft))
            if (match) match.text += nextEvent.properties.delta
          })
          break
        case "session.next.text.ended":
          update(nextEvent.properties.sessionID, (draft) => {
            const match = latestText(activeAssistant(draft))
            if (match) match.text = nextEvent.properties.text
          })
          break
        case "session.next.tool.input.started":
          update(nextEvent.properties.sessionID, (draft) => {
            activeAssistant(draft)?.content.push({
              type: "tool",
              id: nextEvent.properties.callID,
              name: nextEvent.properties.name,
              time: { created: time(nextEvent.properties.timestamp) },
              state: { status: "pending", input: "" },
            })
          })
          break
        case "session.next.tool.input.delta":
          update(nextEvent.properties.sessionID, (draft) => {
            const match = latestTool(activeAssistant(draft), nextEvent.properties.callID)
            if (match?.state.status === "pending") match.state.input += nextEvent.properties.delta
          })
          break
        case "session.next.tool.input.ended":
          break
        case "session.next.tool.called":
          update(nextEvent.properties.sessionID, (draft) => {
            const match = latestTool(activeAssistant(draft), nextEvent.properties.callID)
            if (!match) return
            match.time.ran = time(nextEvent.properties.timestamp)
            match.provider = nextEvent.properties.provider
            match.state = { status: "running", input: nextEvent.properties.input, structured: {}, content: [] }
          })
          break
        case "session.next.tool.progress":
          update(nextEvent.properties.sessionID, (draft) => {
            const match = latestTool(activeAssistant(draft), nextEvent.properties.callID)
            if (match?.state.status !== "running") return
            match.state.structured = nextEvent.properties.structured
            match.state.content = [...nextEvent.properties.content]
          })
          break
        case "session.next.tool.success":
          update(nextEvent.properties.sessionID, (draft) => {
            const match = latestTool(activeAssistant(draft), nextEvent.properties.callID)
            if (match?.state.status !== "running") return
            match.state = {
              status: "completed",
              input: match.state.input,
              structured: nextEvent.properties.structured,
              content: [...nextEvent.properties.content],
            }
            match.provider = nextEvent.properties.provider
            match.time.completed = time(nextEvent.properties.timestamp)
          })
          break
        case "session.next.tool.failed":
          update(nextEvent.properties.sessionID, (draft) => {
            const match = latestTool(activeAssistant(draft), nextEvent.properties.callID)
            if (match?.state.status !== "running") return
            match.state = {
              status: "error",
              error: nextEvent.properties.error,
              input: match.state.input,
              structured: match.state.structured,
              content: match.state.content,
            }
            match.provider = nextEvent.properties.provider
            match.time.completed = time(nextEvent.properties.timestamp)
          })
          break
        case "session.next.reasoning.started":
          update(nextEvent.properties.sessionID, (draft) => {
            activeAssistant(draft)?.content.push({
              type: "reasoning",
              id: nextEvent.properties.reasoningID,
              text: "",
            })
          })
          break
        case "session.next.reasoning.delta":
          update(nextEvent.properties.sessionID, (draft) => {
            const match = latestReasoning(activeAssistant(draft), nextEvent.properties.reasoningID)
            if (match) match.text += nextEvent.properties.delta
          })
          break
        case "session.next.reasoning.ended":
          update(nextEvent.properties.sessionID, (draft) => {
            const match = latestReasoning(activeAssistant(draft), nextEvent.properties.reasoningID)
            if (match) match.text = nextEvent.properties.text
          })
          break
        case "session.next.retried":
          break
        case "session.next.compaction.started":
          update(nextEvent.properties.sessionID, (draft) => {
            draft.unshift({
              id: nextEvent.id,
              type: "compaction",
              reason: nextEvent.properties.reason,
              summary: "",
              time: { created: time(nextEvent.properties.timestamp) },
            })
          })
          break
        case "session.next.compaction.delta":
          update(nextEvent.properties.sessionID, (draft) => {
            const match = activeCompaction(draft)
            if (match) match.summary += nextEvent.properties.text
          })
          break
        case "session.next.compaction.ended":
          update(nextEvent.properties.sessionID, (draft) => {
            const match = activeCompaction(draft)
            if (!match) return
            match.summary = nextEvent.properties.text
            match.include = nextEvent.properties.include
          })
          break
      }
    })

    const result = {
      data: store,
      session: {
        message: {
          async sync(sessionID: string) {
            const response = await sdk.client.session.messages({ sessionID })
            setStore("messages", sessionID, reconcile((response.data ?? []) as unknown as SessionMessage[]))
          },
          fromSession(sessionID: string) {
            const messages = store.messages[sessionID]
            if (!messages) return []
            return messages
          },
        },
      },
    }

    return result
  },
})
