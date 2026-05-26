import { describe, expect, test } from "bun:test"
import { resolvePtyConnectTicket } from "./terminal"

describe("resolvePtyConnectTicket", () => {
  test("throws when a 200 response omits the ticket", () => {
    expect(() =>
      resolvePtyConnectTicket({
        response: { status: 200 },
      }),
    ).toThrow("PTY connect ticket response was 200 but did not include a valid ticket")
  })

  test("throws when a 200 response includes a non-string ticket", () => {
    expect(() =>
      resolvePtyConnectTicket({
        response: { status: 200 },
        data: { ticket: 123 },
      }),
    ).toThrow("PTY connect ticket response was 200 but did not include a valid ticket")
  })
})
