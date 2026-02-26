import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { VersionGate } from "./VersionGate"

const mocks = vi.hoisted(() => ({
  isInstalled: vi.fn(() => true),
  minVersion: "1.1.1" as string | null,
}))

vi.mock("../lib/ideBridge", () => ({
  ideBridge: mocks,
}))

describe("VersionGate", () => {
  beforeEach(() => {
    mocks.minVersion = "1.1.1"
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ healthy: true, version: "1.1.1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("在 standard 模式下请求 /global/health", async () => {
    render(
      <VersionGate>
        <div>ok</div>
      </VersionGate>,
    )

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith("/global/health")
    })
  })

  it("minVersion 缺失且未收到 connected 事件时不会永久 loading", async () => {
    mocks.minVersion = null

    render(
      <VersionGate>
        <div>ok</div>
      </VersionGate>,
    )

    await waitFor(() => {
      expect(screen.getByText("ok")).toBeInTheDocument()
    })

    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})
