/**
 * Message types from OpenCode SDK
 * Re-exports types from @opencode-ai/sdk for use in webgui
 */

import type {
  Message as SDKMessage,
  UserMessage,
  AssistantMessage,
  Part,
  TextPart,
  ReasoningPart,
  ToolPart,
  FilePart,
  PatchPart,
  SnapshotPart,
  AgentPart,
  StepStartPart,
  StepFinishPart,
  RetryPart,
  QuestionRequest,
} from "@opencode-ai/sdk/v2/client"

// Re-export SDK message types
export type {
  UserMessage,
  AssistantMessage,
  Part,
  TextPart,
  ReasoningPart,
  ToolPart,
  FilePart,
  PatchPart,
  SnapshotPart,
  AgentPart,
  StepStartPart,
  StepFinishPart,
  RetryPart,
  SDKMessage,
  QuestionRequest,
}

export interface SessionErrorPart {
  type: "session-error"
  id: string
  sessionID: string
  messageID: string
  message: string
}

export interface QuestionRequestPart {
  type: "question"
  id: string
  sessionID: string
  messageID: string
  request: QuestionRequest
}

export type WebguiPart = Part | SessionErrorPart | QuestionRequestPart

// SDK's Message is the discriminated union (UserMessage | AssistantMessage)
// Webgui structure wraps this with parts array
export interface Message {
  info: SDKMessage
  parts: WebguiPart[]
}

// Type guard helpers
export function isUserMessage(msg: SDKMessage): msg is UserMessage {
  return msg.role === "user"
}

export function isAssistantMessage(msg: SDKMessage): msg is AssistantMessage {
  return msg.role === "assistant"
}
