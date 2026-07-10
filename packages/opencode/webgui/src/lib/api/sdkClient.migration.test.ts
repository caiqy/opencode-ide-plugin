import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { sdk } from "./sdkClient"
import { resetScopedStateForTest } from "../../state/scopedStorage"

describe("sdk migration baseline", () => {
  beforeEach(() => {
    localStorage.clear()
    resetScopedStateForTest()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("sdk 不再暴露 kv/model 聚合接口", () => {
    expect("kv" in sdk).toBe(false)
    expect("model" in sdk).toBe(false)
  })

  it("auth.list maps to provider.list().connected", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          all: [],
          default: {},
          connected: ["openai", "anthropic"],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    )

    const r = await sdk.auth.list()
    expect(r).toEqual({
      openai: true,
      anthropic: true,
    })
  })

  it("auth.methods maps provider.auth record to single-provider array", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          openai: [{ label: "OAuth", type: "oauth" }],
          anthropic: [{ label: "API Key", type: "api" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    )

    const r = await sdk.auth.methods("openai")
    expect(r).toEqual([{ label: "OAuth", type: "oauth" }])
  })

  it("session.retry replays last user message via core session prompt", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "s1",
            slug: "s1",
            projectID: "p1",
            directory: "/tmp",
            title: "t",
            version: "1",
            time: { created: 1, updated: 2 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              info: {
                id: "m-user",
                role: "user",
                sessionID: "s1",
                time: { created: 1 },
                agent: "build",
                model: { providerID: "openai", modelID: "gpt-4.1", variant: "high" },
                format: { type: "json_schema", schema: { type: "object" } },
                system: "retry system",
                tools: { bash: false },
              },
              parts: [
                {
                  id: "p1",
                  type: "text",
                  text: "hello",
                  sessionID: "s1",
                  messageID: "m-user",
                },
              ],
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            info: { id: "m-assistant", role: "assistant", sessionID: "s1", time: { created: 2 } },
            parts: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )

    const r = await sdk.session.retry({ path: { sessionID: "s1" } })

    expect(r.error).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(3)

    const req1 = fetchMock.mock.calls[0][0] as Request
    expect(req1.url).toContain("/session/s1")
    expect(req1.url).not.toContain("/app" + "/api")

    const req2 = fetchMock.mock.calls[1][0] as Request
    expect(req2.url).toContain("/session/s1/message")
    expect(req2.url).not.toContain("/app" + "/api")

    const req3 = fetchMock.mock.calls[2][0] as Request
    expect(req3.url).toContain("/session/s1/message")
    expect(req3.url).not.toContain("/app" + "/api")
    expect(req3.method).toBe("POST")

    const body: unknown = JSON.parse(await req3.text())
    expect(body).toHaveProperty("parts", [{ type: "text", text: "hello" }])
    expect(body).toMatchObject({
      agent: "build",
      model: { providerID: "openai", modelID: "gpt-4.1" },
      variant: "high",
      format: { type: "json_schema", schema: { type: "object" } },
      system: "retry system",
      tools: { bash: false },
    })
  })

  it("session.retry respects revert boundary from session.get", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "s1",
            slug: "s1",
            projectID: "p1",
            directory: "/tmp",
            title: "t",
            version: "1",
            time: { created: 1, updated: 3 },
            revert: { messageID: "m-user-hidden" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              info: {
                id: "m-user-visible",
                role: "user",
                sessionID: "s1",
                time: { created: 1 },
                agent: "build",
                model: { providerID: "openai", modelID: "gpt-4.1", variant: "high" },
                format: { type: "json_schema", schema: { type: "object" } },
                system: "retry system",
                tools: { bash: false },
              },
              parts: [
                {
                  id: "p-visible",
                  type: "text",
                  text: "visible",
                  sessionID: "s1",
                  messageID: "m-user-visible",
                },
              ],
            },
            {
              info: {
                id: "m-user-hidden",
                role: "user",
                sessionID: "s1",
                time: { created: 2 },
                agent: "plan",
                model: { providerID: "anthropic", modelID: "claude-sonnet-4-5" },
              },
              parts: [
                {
                  id: "p-hidden",
                  type: "text",
                  text: "hidden",
                  sessionID: "s1",
                  messageID: "m-user-hidden",
                },
              ],
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            info: { id: "m-assistant", role: "assistant", sessionID: "s1", time: { created: 3 } },
            parts: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )

    const r = await sdk.session.retry({ path: { sessionID: "s1" } })

    expect(r.error).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(3)

    const req1 = fetchMock.mock.calls[0][0] as Request
    expect(req1.url).toContain("/session/s1")

    const req3 = fetchMock.mock.calls[2][0] as Request
    expect(req3.url).toContain("/session/s1/message")
    expect(req3.method).toBe("POST")

    const body: unknown = JSON.parse(await req3.text())
    expect(body).toHaveProperty("parts", [{ type: "text", text: "visible" }])
    expect(body).toMatchObject({
      agent: "build",
      model: { providerID: "openai", modelID: "gpt-4.1" },
      variant: "high",
      format: { type: "json_schema", schema: { type: "object" } },
      system: "retry system",
      tools: { bash: false },
    })
  })
})
