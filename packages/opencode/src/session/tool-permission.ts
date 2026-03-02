import { PermissionNext } from "@/permission/next"

type AskInput = Parameters<typeof PermissionNext.ask>[0]

export function buildToolPermissionAsk(input: {
  sessionID: string
  messageID: string
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
