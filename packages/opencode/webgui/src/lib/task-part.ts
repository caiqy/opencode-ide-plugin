import type { WebguiToolPart } from "../types/messages"
import { parseTaskResult } from "./task-result"

export function adaptPart(part: WebguiToolPart): WebguiToolPart {
  if (part.tool !== "task") return part
  const out =
    part.state && typeof part.state === "object" && "output" in part.state && typeof part.state.output === "string"
      ? part.state.output
      : ""
  return {
    ...part,
    parsed: {
      ...part.parsed,
      task_result: parseTaskResult(out),
    },
  }
}
