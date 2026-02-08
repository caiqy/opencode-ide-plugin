import { describe, it, expect } from "vitest"
import type { Message } from "../types/messages"
import {
  createOptimisticUserMessage,
  isOptimisticMessage,
  removeOptimisticMessages,
  updateMessageInfoCleaningOptimistic,
} from "./messagesStore"

function fakeMessage(id: string, sessionID: string, role: "user" | "assistant" = "user"): Message {
  return {
    info: {
      id,
      sessionID,
      role,
      time: { created: Date.now() },
    } as any,
    parts: [],
  }
}

describe("optimistic user message", () => {
  describe("createOptimisticUserMessage", () => {
    it("creates a user message with optimistic- prefixed ID", () => {
      const msg = createOptimisticUserMessage("session-1", "hello world")
      expect(msg.info.id).toMatch(/^optimistic-/)
      expect(msg.info.sessionID).toBe("session-1")
      expect(msg.info.role).toBe("user")
    })

    it("includes a non-synthetic text part with the user input", () => {
      const msg = createOptimisticUserMessage("session-1", "hello world")
      expect(msg.parts).toHaveLength(1)
      const part = msg.parts[0]
      expect(part.type).toBe("text")
      expect((part as any).text).toBe("hello world")
      expect((part as any).synthetic).toBeFalsy()
    })

    it("sets time.created to a recent timestamp", () => {
      const before = Date.now()
      const msg = createOptimisticUserMessage("s1", "test")
      const after = Date.now()
      expect(msg.info.time.created).toBeGreaterThanOrEqual(before)
      expect(msg.info.time.created).toBeLessThanOrEqual(after)
    })
  })

  describe("isOptimisticMessage", () => {
    it("returns true for optimistic messages", () => {
      const msg = createOptimisticUserMessage("s1", "hi")
      expect(isOptimisticMessage(msg)).toBe(true)
    })

    it("returns false for regular messages", () => {
      const msg = fakeMessage("message-123", "s1")
      expect(isOptimisticMessage(msg)).toBe(false)
    })

    it("returns false for error- prefixed messages", () => {
      const msg = fakeMessage("error-456", "s1")
      expect(isOptimisticMessage(msg)).toBe(false)
    })
  })

  describe("removeOptimisticMessages", () => {
    it("removes all optimistic messages for a given session", () => {
      const opt1 = createOptimisticUserMessage("s1", "a")
      const opt2 = createOptimisticUserMessage("s1", "b")
      const real = fakeMessage("message-1", "s1")
      const messages = [opt1, real, opt2]

      const result = removeOptimisticMessages(messages, "s1")
      expect(result).toHaveLength(1)
      expect(result[0].info.id).toBe("message-1")
    })

    it("does not remove optimistic messages from other sessions", () => {
      const opt1 = createOptimisticUserMessage("s1", "a")
      const opt2 = createOptimisticUserMessage("s2", "b")
      const messages = [opt1, opt2]

      const result = removeOptimisticMessages(messages, "s1")
      expect(result).toHaveLength(1)
      expect(result[0].info.sessionID).toBe("s2")
    })

    it("returns same array reference when nothing to remove", () => {
      const messages = [fakeMessage("message-1", "s1")]
      const result = removeOptimisticMessages(messages, "s1")
      expect(result).toBe(messages)
    })
  })

  describe("updateMessageInfoCleaningOptimistic", () => {
    it("removes optimistic messages when a real user message arrives for the same session", () => {
      const opt = createOptimisticUserMessage("s1", "hello")
      const messages = [opt]

      const realInfo = {
        id: "message-real-1",
        sessionID: "s1",
        role: "user",
        time: { created: Date.now() },
      } as any

      const result = updateMessageInfoCleaningOptimistic(messages, realInfo.id, realInfo)
      // optimistic should be gone, real should be present
      expect(result.some((m) => isOptimisticMessage(m))).toBe(false)
      expect(result.some((m) => m.info.id === "message-real-1")).toBe(true)
    })

    it("does not remove optimistic messages when an assistant message arrives", () => {
      const opt = createOptimisticUserMessage("s1", "hello")
      const messages = [opt]

      const assistantInfo = {
        id: "message-assistant-1",
        sessionID: "s1",
        role: "assistant",
        time: { created: Date.now() },
      } as any

      const result = updateMessageInfoCleaningOptimistic(messages, assistantInfo.id, assistantInfo)
      // optimistic should still be there
      expect(result.some((m) => isOptimisticMessage(m))).toBe(true)
      expect(result).toHaveLength(2)
    })

    it("preserves optimistic messages from other sessions", () => {
      const opt1 = createOptimisticUserMessage("s1", "a")
      const opt2 = createOptimisticUserMessage("s2", "b")
      const messages = [opt1, opt2]

      const realInfo = {
        id: "message-real-1",
        sessionID: "s1",
        role: "user",
        time: { created: Date.now() },
      } as any

      const result = updateMessageInfoCleaningOptimistic(messages, realInfo.id, realInfo)
      expect(result.some((m) => m.info.sessionID === "s2" && isOptimisticMessage(m))).toBe(true)
      expect(result.some((m) => m.info.sessionID === "s1" && isOptimisticMessage(m))).toBe(false)
    })

    it("falls back to normal updateMessageInfo when no optimistic messages exist", () => {
      const existing = fakeMessage("message-1", "s1")
      const messages = [existing]

      const realInfo = {
        id: "message-2",
        sessionID: "s1",
        role: "user",
        time: { created: Date.now() },
      } as any

      const result = updateMessageInfoCleaningOptimistic(messages, realInfo.id, realInfo)
      expect(result).toHaveLength(2)
      expect(result[0].info.id).toBe("message-1")
      expect(result[1].info.id).toBe("message-2")
    })
  })
})
