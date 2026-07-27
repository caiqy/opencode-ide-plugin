import { ideBridge } from "./ideBridge"

type Reason = "finished" | "permission" | "question"

export function shouldNotifySessionIdle(previous: string | undefined, current: string) {
  return current === "idle" && (previous === "busy" || previous === "retry")
}

export function sendIdeNotification(
  reason: Reason,
  sessionID: string,
  currentSessionID: string | null,
  detail?: string,
) {
  if (sessionID === currentSessionID && document.visibilityState === "visible" && document.hasFocus()) return false

  const text = detail?.replace(/\s+/g, " ").trim()
  const body = text
    ? text.length > 220
      ? `${text.slice(0, 217).trimEnd()}...`
      : text
    : reason === "finished"
      ? "Finished working."
      : reason === "permission"
        ? "Permission requested."
        : "Answer required."

  return ideBridge.sendTransient({
    type: "showSystemNotification",
    payload: {
      sessionID,
      title:
        reason === "finished"
          ? "Agent finished"
          : reason === "permission"
            ? "Agent needs permission"
            : "Agent has a question",
      body,
    },
  })
}
