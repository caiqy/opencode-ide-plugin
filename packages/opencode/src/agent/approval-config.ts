export * as ApprovalAgent from "./approval-config"

import { Provider } from "@/provider/provider"
import { Approval } from "@opencode-ai/core/approval"

export const prompt = Approval.policy

export function resolve(input?: { model?: string; variant?: string }) {
  return {
    model: Provider.parseModel(input?.model ?? "openai/gpt-5.6-luna"),
    variant: input?.variant,
  }
}
