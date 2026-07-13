import { expect, test } from "vitest"
import type { ServerEvent } from "./events"

const events = [
  { type: "session.created", properties: { sessionID: "session-1", info: { id: "session-1" } } },
  { type: "session.updated", properties: { sessionID: "session-1", info: { id: "session-1" } } },
] satisfies ServerEvent[]

test("session events expose info", () => {
  expect(events.map((event) => event.properties.info.id)).toEqual(["session-1", "session-1"])
})
