import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { vi, describe, expect, it } from "vitest"
import { SessionErrorPart } from "./SessionErrorPart"

const { isSessionIdle, retrySession } = vi.hoisted(() => ({
  isSessionIdle: vi.fn((sessionID: string) => sessionID === "child"),
  retrySession: vi.fn(),
}))

vi.mock("../../state/SessionContext", () => ({
  useSession: () => ({
    currentSession: { id: "parent" },
    isIdle: true,
    isSessionIdle,
    retrySession,
  }),
}))

vi.mock("../../state/IdeBridgeContext", () => ({
  useCustomApi: () => true,
}))

it("retries an idle child session", async () => {
  const user = userEvent.setup()
  render(
    <SessionErrorPart
      part={{ id: "error", type: "session-error", sessionID: "child", messageID: "message", message: "failed" }}
    />,
  )

  await user.click(screen.getByRole("button", { name: "重试" }))

  expect(isSessionIdle).toHaveBeenCalledWith("child")
  expect(retrySession).toHaveBeenCalledWith("child")
  expect(retrySession).not.toHaveBeenCalledWith("parent")
})
