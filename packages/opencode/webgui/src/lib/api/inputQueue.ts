import {
  createOpencodeClient,
  type SessionInputAddData,
  type SessionInputQueueSnapshot,
} from "@opencode-ai/sdk/v2/client"

const client = createOpencodeClient({
  baseUrl: typeof window === "undefined" ? "http://localhost:4096" : window.location.origin,
})
export type InputQueueSnapshot = SessionInputQueueSnapshot
export type QueuedSubmission = NonNullable<SessionInputAddData["body"]>
export type InputDelivery = QueuedSubmission["delivery"]

async function result(request: Promise<{ data?: InputQueueSnapshot; error?: unknown }>) {
  const response = await request
  if (response.data) return response.data
  const error = response.error
  throw new Error(
    error && typeof error === "object" && "message" in error ? String(error.message) : "待发送消息操作失败",
  )
}

export const inputQueue = {
  list: (sessionID: string) => result(client.session.inputList({ sessionID })),
  add: (sessionID: string, input: QueuedSubmission) => result(client.session.inputAdd({ sessionID, ...input })),
  update: (sessionID: string, inputID: string, delivery: InputDelivery) =>
    result(client.session.inputUpdate({ sessionID, inputID, delivery })),
  remove: (sessionID: string, inputID: string) => result(client.session.inputDelete({ sessionID, inputID })),
  next: (sessionID: string) => result(client.session.inputNext({ sessionID })),
}
