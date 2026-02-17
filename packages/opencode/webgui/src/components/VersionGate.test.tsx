import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { render, waitFor } from "@testing-library/react"
import { VersionGate } from "./VersionGate"

vi.mock("../lib/ideBridge", () => ({
  ideBridge: {
    isInstalled: vi.fn(() => true),
    minVersion: "1.1.1",
  },
}))

describe("VersionGate", () => {
  beforeEach(() => {
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
})
