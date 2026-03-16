import { PermissionNext } from "@/permission/next"
import type { MessageID, SessionID } from "./schema"

type AskInput = Parameters<typeof PermissionNext.ask>[0]

export function buildToolPermissionAsk(input: {
  sessionID: SessionID
  messageID: MessageID
  callID: string
  ruleset: AskInput["ruleset"]
  req: Omit<AskInput, "sessionID" | "tool" | "ruleset">
}): AskInput {
  return {
    ...input.req,
    sessionID: input.sessionID,
    tool: {
      messageID: input.messageID,
      callID: input.callID,
    },
    ruleset: input.ruleset,
  }
}
