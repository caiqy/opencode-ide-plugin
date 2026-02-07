import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { sdk } from "./sdkClient"

describe("sdk migration baseline", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("state.get returns {data,error} shape", async () => {
    await sdk.state.update({ body: { theme: "dark" } })
    const r = await sdk.state.get()
    expect(r.error).toBeNull()
    expect(r.data?.theme).toBe("dark")
  })

  it("state.update merges and persists local state", async () => {
    await sdk.state.update({
      body: {
        provider: "openai",
        model: "gpt-4.1",
        variant: { "openai/gpt-4.1": "fast" },
        message_parts_auto_expand: false,
      },
    })
    await sdk.state.update({
      body: {
        agent: "build",
      },
    })

    const r = await sdk.state.get()
    expect(r.error).toBeNull()
    expect(r.data).toMatchObject({
      provider: "openai",
      model: "gpt-4.1",
      agent: "build",
      variant: { "openai/gpt-4.1": "fast" },
      message_parts_auto_expand: false,
    })
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
          JSON.stringify([
            {
              info: {
                id: "m-user",
                role: "user",
                sessionID: "s1",
                time: { created: 1 },
                agent: "build",
                model: { providerID: "openai", modelID: "gpt-4.1" },
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
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const req1 = fetchMock.mock.calls[0][0] as Request
    expect(req1.url).toContain("/session/s1/message")
    expect(req1.url).not.toContain("/app" + "/api")

    const req2 = fetchMock.mock.calls[1][0] as Request
    expect(req2.url).toContain("/session/s1/message")
    expect(req2.url).not.toContain("/app" + "/api")
    expect(req2.method).toBe("POST")

    const body = JSON.parse(await req2.text()) as {
      parts: Array<{ type: string; text?: string }>
      agent?: string
      model?: { providerID: string; modelID: string }
    }
    expect(body.parts).toEqual([{ type: "text", text: "hello", id: "p1" }])
    expect(body.agent).toBe("build")
    expect(body.model).toEqual({ providerID: "openai", modelID: "gpt-4.1" })
  })
})
