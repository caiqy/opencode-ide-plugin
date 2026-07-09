import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import type { MessageID, SessionID } from "./schema"

type AskInput = PermissionV1.AskInput

export function buildToolPermissionAsk(input: {
  sessionID: SessionID
  messageID: MessageID
  callID: string
  ruleset: AskInput["ruleset"]
  overlayRuleset?: AskInput["ruleset"]
  req: Omit<AskInput, "sessionID" | "tool" | "ruleset">
}): AskInput {
  return {
    ...input.req,
    sessionID: input.sessionID,
    tool: {
      messageID: input.messageID,
      callID: input.callID,
    },
    ruleset: input.overlayRuleset ? [...input.ruleset, ...input.overlayRuleset] : input.ruleset,
  }
}
