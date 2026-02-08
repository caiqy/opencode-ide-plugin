import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { sdk } from "./sdkClient"

describe("sdk migration baseline", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("kv.get returns {data,error} shape", async () => {
    await sdk.kv.update({ body: { webgui_agent: "build" } })
    const r = await sdk.kv.get()
    expect(r.error).toBeNull()
    expect(r.data?.webgui_agent).toBe("build")
  })

  it("kv.update merges and persists webgui preferences", async () => {
    await sdk.kv.update({
      body: {
        webgui_provider: "openai",
        webgui_model: "gpt-4.1",
        webgui_message_parts_auto_expand: false,
      },
    })
    await sdk.kv.update({
      body: {
        webgui_agent: "plan",
      },
    })

    const r = await sdk.kv.get()
    expect(r.error).toBeNull()
    expect(r.data).toMatchObject({
      webgui_provider: "openai",
      webgui_model: "gpt-4.1",
      webgui_agent: "plan",
      webgui_message_parts_auto_expand: false,
    })
  })

  it("kv.get migrates legacy state key when kv key is missing", async () => {
    localStorage.setItem(
      "opencode_webgui_state_v1",
      JSON.stringify({
        agent: "plan",
        provider: "openai",
        model: "gpt-4.1",
        agent_model: {
          plan: {
            provider_id: "openai",
            model_id: "gpt-4.1",
          },
        },
        message_parts_auto_expand: false,
      }),
    )

    const r = await sdk.kv.get()

    expect(r.error).toBeNull()
    expect(r.data).toMatchObject({
      webgui_agent: "plan",
      webgui_provider: "openai",
      webgui_model: "gpt-4.1",
      webgui_agent_model: {
        plan: {
          provider_id: "openai",
          model_id: "gpt-4.1",
        },
      },
      webgui_message_parts_auto_expand: false,
    })
  })

  it("model.get migrates legacy favorites key when model key is missing", async () => {
    localStorage.setItem("opencode_favorite_models_v1", JSON.stringify(["openai/gpt-4.1", "anthropic/claude-3"]))

    const r = await sdk.model.get()

    expect(r.error).toBeNull()
    expect(r.data?.favorite).toEqual([
      { providerID: "openai", modelID: "gpt-4.1" },
      { providerID: "anthropic", modelID: "claude-3" },
    ])
  })

  it("model.update keeps legacy favorites key in sync", async () => {
    await sdk.model.update({
      body: {
        favorite: [{ providerID: "openai", modelID: "gpt-4.1" }],
      },
    })

    expect(JSON.parse(localStorage.getItem("opencode_favorite_models_v1") || "[]")).toEqual(["openai/gpt-4.1"])
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
